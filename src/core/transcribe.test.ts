import { describe, expect, it } from "vitest";
import { alignScript, chunkRegions, heardChars, segmentLines, speechRegions } from "./transcribe";

const RATE = 1000;
/** 按 [开始, 结束] 毫秒造一段「有声音」的采样（1kHz，一个采样 = 1ms） */
function audio(totalMs: number, voiced: [number, number][]): Float32Array {
  const s = new Float32Array(totalMs);
  for (const [a, b] of voiced) for (let i = a; i < b; i++) s[i] = i % 2 ? 0.3 : -0.3;
  return s;
}
/** 一串字，每 180ms 一个，从 fromMs 开始 */
const say = (text: string, fromMs: number, punct: Record<number, string> = {}) =>
  [...text].map((c, i) => ({ c, startMs: fromMs + i * 180, punct: punct[i] ?? "" }));

describe("说话段落", () => {
  it("短停顿不断开，长停顿断开；加上偏移和余量", () => {
    const s = audio(3000, [
      [100, 800],
      [900, 1200],
      [1800, 2500],
    ]);
    expect(speechRegions(s, RATE, { offsetMs: 10_000, minSilenceMs: 200, padMs: 20 })).toEqual([
      { startMs: 10_080, endMs: 11_220 },
      { startMs: 11_780, endMs: 12_520 },
    ]);
    expect(speechRegions(new Float32Array(1000), RATE)).toEqual([]);
  });

  it("拼成不超过上限的小段，只在段落之间切", () => {
    const r = [
      { startMs: 0, endMs: 8000 },
      { startMs: 9000, endMs: 15_000 },
      { startMs: 16_000, endMs: 30_000 },
    ];
    expect(chunkRegions(r, 20_000)).toEqual([
      { startMs: 0, endMs: 15_000 },
      { startMs: 16_000, endMs: 30_000 },
    ]);
  });
});

describe("识音结果展开", () => {
  it("一个 token 多个字时平均分；标点挂到前一个字上", () => {
    expect(
      heardChars(
        [
          { text: "你好", startMs: 0 },
          { text: "，", startMs: 400 },
          { text: "ok", startMs: 500 },
        ],
        900,
      ),
    ).toEqual([
      { c: "你", startMs: 0, punct: "" },
      { c: "好", startMs: 200, punct: "，" },
      { c: "o", startMs: 500, punct: "" },
      { c: "k", startMs: 700, punct: "" },
    ]);
  });
});

describe("文稿校字", () => {
  it("同音错字按文稿改、时间用识音的，标点用文稿的", () => {
    const heard = say("今天天汽真号", 1000);
    const { spoken, diffs } = alignScript("今天天气真好。", heard);
    expect(spoken.map((s) => s.c).join("")).toBe("今天天气真好");
    expect(spoken.map((s) => s.startMs)).toEqual(heard.map((h) => h.startMs));
    expect(spoken.at(-1)?.punct).toBe("。");
    expect(diffs).toEqual([
      { kind: "fixed", script: "气", heard: "汽", atMs: 1540 },
      { kind: "fixed", script: "好", heard: "号", atMs: 1900 },
    ]);
  });

  it("漏读插值时间；多读、改口列出来", () => {
    const missing = alignScript("我们明天出发", say("我们出发", 0));
    expect(missing.diffs).toEqual([{ kind: "missing", script: "明天", heard: "", atMs: 360 }]);
    const t = missing.spoken.map((s) => s.startMs);
    expect(t).toEqual([0, 180, 240, 300, 360, 540]);
    const extra = alignScript("马上开始吧", say("马上马上开始吧", 0));
    expect(extra.diffs).toEqual([{ kind: "extra", script: "", heard: "马上", atMs: 0 }]);
    expect(extra.spoken.map((s) => s.c).join("")).toBe("马上开始吧");
  });
});

describe("断句", () => {
  const region = (sp: { startMs: number }[]) => [
    { startMs: (sp[0]?.startMs ?? 0) - 50, endMs: (sp.at(-1)?.startMs ?? 0) + 200 },
  ];

  it("有标点时按标点断，行尾标点不显示，顿号留着", () => {
    const sp = say("今天天气真好我们出门走走时间地点", 0, { 5: "，", 11: "。", 13: "、" });
    const lines = segmentLines(sp, region(sp));
    expect(lines.map((l) => l.text)).toEqual(["今天天气真好", "我们出门走走", "时间、地点"]);
    // 每个字（包括顿号）都有开始时间，相邻两行首尾相接
    for (const l of lines) expect(l.charStartMs).toHaveLength([...l.text].length);
    expect(lines[1]?.startMs).toBe(lines[0]?.endMs);
  });

  it("太长的句子在词边界上切，差不多长时前短后长", () => {
    const sp = say("别等客人到了门口才发现座位或餐具没有准备好", 0, { 20: "。" });
    expect(segmentLines(sp, region(sp)).map((l) => l.text)).toEqual([
      "别等客人到了门口",
      "才发现座位或餐具没有准备好",
    ]);
  });

  it("顿号连起来的并列不拆开，连词前面断", () => {
    const sp = say("出发日期集合地点和随身物品都要提前确认好", 0, { 3: "、", 19: "。" });
    expect(segmentLines(sp, region(sp)).map((l) => l.text)).toEqual([
      "出发日期、集合地点",
      "和随身物品都要提前确认好",
    ]);
  });

  it("没有标点时按停顿断；最后一行收到念完之后", () => {
    const a = say("今天天气真好", 0);
    const b = say("我们出门走走", 2000);
    const lines = segmentLines(
      [...a, ...b],
      [
        { startMs: 0, endMs: 1100 },
        { startMs: 1950, endMs: 3100 },
      ],
    );
    expect(lines.map((l) => l.text)).toEqual(["今天天气真好", "我们出门走走"]);
    expect(lines[0]).toMatchObject({ startMs: 0, endMs: 1250 });
    expect(lines[1]).toMatchObject({ startMs: 1940, endMs: 3250 });
  });
});

describe("断句：一行放不下", () => {
  it("切成最少的几行，标出是切开的；一行放得下的不标", () => {
    const sp = say("别等客人到了门口才发现座位或餐具没有准备好", 0, { 20: "。" });
    const lines = segmentLines(sp, [{ startMs: 0, endMs: 4000 }], { maxChars: 10 });
    expect(lines).toHaveLength(3);
    for (const l of lines) expect([...l.text].length).toBeLessThanOrEqual(10);
    expect(lines.every((l) => l.split)).toBe(true);
    const short = segmentLines(say("需要分别把关", 0, { 5: "。" }), [{ startMs: 0, endMs: 1200 }]);
    expect(short.map((l) => l.split)).toEqual([false]);
  });
});
