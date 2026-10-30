import { describe, expect, it } from "vitest";
import {
  ease,
  highlightMask,
  markerProgress,
  splitUnits,
  sweepProgress,
  transformAt,
  unitStarts,
} from "./animate";

describe("splitUnits", () => {
  it("中文按词拆分，标点不单独占节拍", () => {
    const u = splitUnits("房产取得时间、身份情况", "word");
    expect(u.map((x) => x.text)).toEqual(["房产", "取得", "时间", "、", "身份", "情况"]);
    expect(u.filter((x) => x.silent).map((x) => x.text)).toEqual(["、"]);
    expect(u.map((x) => [x.start, x.end])).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
      [6, 7],
      [7, 9],
      [9, 11],
    ]);
  });

  it("逐字和换行", () => {
    const u = splitUnits("你好\n世界", "char");
    expect(u.map((x) => x.text)).toEqual(["你", "好", "世", "界"]);
    expect(u.map((x) => x.breakBefore)).toEqual([false, false, true, false]);
    expect(u[2]?.start).toBe(3);
  });
});

describe("unitStarts", () => {
  const u = splitUnits("房产取得时间、身份情况", "word");
  it("totalMs：在给定时间内全部出现，标点跟着前一个词", () => {
    expect(unitStarts(u, { totalMs: 500 }, 1600, 100)).toEqual([0, 100, 200, 200, 300, 400]);
  });
  it("spread：按字数分配字幕时长，标点不占时间", () => {
    expect(unitStarts(u, "spread", 1100, 100)).toEqual([0, 200, 400, 400, 600, 800]);
    // 「移民财产转移的条件」：的 只有一个字，占的时间是两字词的一半
    const v = splitUnits("移民财产转移的条件", "word");
    expect(v.map((x) => x.text)).toEqual(["移民", "财产", "转移", "的", "条件"]);
    expect(unitStarts(v, "spread", 900, 0)).toEqual([0, 200, 400, 600, 700]);
  });
});

describe("highlightMask", () => {
  it("按文字匹配，nth 只匹配第几次出现", () => {
    expect(highlightMask("身份和身份", [{ text: "身份", nth: 1 }])).toEqual([
      false,
      false,
      false,
      true,
      true,
    ]);
    expect(highlightMask("身份和身份", [{ text: "身份" }]).filter(Boolean)).toHaveLength(4);
  });
});

describe("transformAt", () => {
  const base = { x: 540, y: 960, scale: 1, rotation: 0, opacity: 1, radius: 0 };
  const kfs = [
    { frame: 10, transform: { ...base, scale: 1 }, easing: "linear" as const },
    { frame: 20, transform: { ...base, scale: 2 }, easing: "linear" as const },
  ];
  it("关键帧之间插值，两端保持", () => {
    expect(transformAt(base, kfs, 0).scale).toBe(1);
    expect(transformAt(base, kfs, 15).scale).toBe(1.5);
    expect(transformAt(base, kfs, 30).scale).toBe(2);
    expect(transformAt(base, [], 15)).toBe(base);
  });
  it("缓动曲线两端固定", () => {
    for (const k of ["linear", "ease-in", "ease-out", "ease-in-out", "spring"] as const) {
      expect(ease(k, 0)).toBe(0);
      expect(ease(k, 1)).toBe(1);
    }
  });
});

describe("unitStarts：剪映节奏（fraction）", () => {
  it("前快后慢：第 k 个单位在二次缓出的进度到 k/n 时出现，标点跟着前一个，不看识音时间", () => {
    const u = splitUnits("一，二三四", "char");
    // 4 个有声单位，T = 1000 × 0.8 = 800：800 × (1 - √(1 - k/4))
    const s = unitStarts(u, { fraction: 0.8 }, 1000, 0, [0, 0, 900, 900, 900]);
    expect(s.map(Math.round)).toEqual([0, 0, 107, 234, 400]);
  });
});

describe("unitStarts：识音得到的逐字时间", () => {
  it("每个词从它第一个字开始念的时候出现，标点跟前一个词", () => {
    const units = splitUnits("你好，世界", "char");
    expect(unitStarts(units, "spread", 1000, 120, [0, 150, 150, 600, 820])).toEqual([
      0, 150, 150, 600, 820,
    ]);
  });
});

describe("卡拉 OK 扫色和荧光笔", () => {
  it("扫色：每个字从开始念扫到下一个字开始，标点不扫", () => {
    const text = "你好，世界";
    const units = splitUnits(text, "char");
    const starts = [0, 200, 200, 400, 600];
    expect(sweepProgress(text, units, starts, 100, 800)).toEqual([0.5, 0, 0, 0, 0]);
    expect(sweepProgress(text, units, starts, 500, 800)).toEqual([1, 1, 0, 0.5, 0]);
    expect(sweepProgress(text, units, starts, 800, 800)).toEqual([1, 1, 0, 1, 1]);
  });

  it("扫色：一个词多个字时平分这个词的时长", () => {
    const text = "今天好";
    const units = [
      { text: "今天", start: 0, end: 2, breakBefore: false, silent: false },
      { text: "好", start: 2, end: 3, breakBefore: false, silent: false },
    ];
    expect(sweepProgress(text, units, [0, 400], 300, 600)).toEqual([1, 0.5, 0]);
  });

  it("荧光笔：连续的关键词字从左往右依次画完", () => {
    const text = "海外身份";
    const units = splitUnits(text, "char");
    const mask = highlightMask(text, [{ text: "身份" }]);
    const starts = [0, 100, 200, 300];
    expect(markerProgress(mask, units, starts, 200, 300)).toEqual([0, 0, 0, 0]);
    expect(markerProgress(mask, units, starts, 275, 300)).toEqual([0, 0, 0.5, 0]);
    expect(markerProgress(mask, units, starts, 500, 300)).toEqual([0, 0, 1, 1]);
  });
});
