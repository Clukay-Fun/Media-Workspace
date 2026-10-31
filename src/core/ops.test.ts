import { describe, expect, it } from "vitest";
import { compile } from "./compile";
import { MwError } from "./errors";
import { applyOps } from "./ops";
import { type MainClip, Project } from "./schema";

const project = (locked = false) =>
  Project.parse({
    version: 7,
    revision: 3,
    canvas: {},
    assets: { a1: { kind: "video", path: "/raw.mov", probe: { durationMs: 20_000 } } },
    tracks: [
      {
        id: "main",
        kind: "video",
        main: true,
        locked,
        items: [{ id: "c1", type: "clip", asset: "a1", inMs: 0, outMs: 10_000 }],
      },
      {
        id: "cap",
        kind: "caption",
        items: [
          { id: "s1", asset: "a1", startMs: 1000, endMs: 2000, text: "第一句话" },
          { id: "s2", asset: "a1", startMs: 2100, endMs: 3000, text: "第二句" },
          {
            id: "s3",
            asset: "a1",
            startMs: 4000,
            endMs: 5000,
            text: "第三句",
            highlights: [{ text: "三" }],
          },
        ],
      },
    ],
  });

const mainClips = (p: Project) =>
  (p.tracks[0]?.items ?? []).map((c) => {
    const m = c as MainClip;
    return [m.id, m.inMs, m.outMs];
  });

const fail = (fn: () => unknown): MwError => {
  try {
    fn();
  } catch (e) {
    if (e instanceof MwError) return e;
    throw e;
  }
  throw new Error("没有抛出错误");
};

describe("applyOps：原子性和锁定", () => {
  it("一批操作里有一个失败，全部不生效，原工程不变", () => {
    const p = project();
    const before = structuredClone(p);
    const e = fail(() =>
      applyOps(p, [
        { op: "item.update", id: "s1", set: { text: "改了" } },
        { op: "item.remove", id: "nope" },
      ]),
    );
    expect(e.code).toBe("NOT_FOUND");
    expect(e.message).toContain("第 2 个操作");
    expect(p).toEqual(before);
  });

  it("锁定的轨道上的修改被拒绝（TRACK_LOCKED）", () => {
    const e = fail(() => applyOps(project(true), [{ op: "clip.split", id: "c1", atMs: 5000 }]));
    expect(e.code).toBe("TRACK_LOCKED");
  });

  it("锁定的轨道仍然可以解锁、隐藏、静音，但不能改名", () => {
    const r = applyOps(project(true), [{ op: "track.update", id: "main", set: { locked: false } }]);
    expect(r.project.tracks[0]?.locked).toBe(false);
    expect(
      fail(() => applyOps(project(true), [{ op: "track.update", id: "main", set: { name: "x" } }]))
        .code,
    ).toBe("TRACK_LOCKED");
  });

  it("锁定的轨道不能移动，解锁后可以移动", () => {
    expect(
      fail(() => applyOps(project(true), [{ op: "track.move", id: "main", index: 1 }])).code,
    ).toBe("TRACK_LOCKED");
    const moved = applyOps(project(), [{ op: "track.move", id: "main", index: 1 }]);
    expect(moved.project.tracks.map((t) => t.id)).toEqual(["cap", "main"]);
  });

  it("拼错的字段报 UNKNOWN_FIELD，不会悄悄丢掉", () => {
    const e = fail(() =>
      applyOps(project(), [{ op: "item.update", id: "c1", set: { sped: 1.1 } }]),
    );
    expect(e.code).toBe("UNKNOWN_FIELD");
    expect(e.issues[0]?.path).toContain("sped");
    expect(
      fail(() => applyOps(project(), [{ op: "item.remove", id: "c1", force: true }])).code,
    ).toBe("INVALID_OP");
  });

  it("set 里的 null 表示去掉这个字段（JSON 里没有 undefined）", () => {
    const fade = { type: "fade", durationMs: 300 } as const;
    const added = applyOps(project(), [
      { op: "item.update", id: "c1", set: { transitionIn: fade } },
    ]).project;
    const removed = applyOps(added, [
      { op: "item.update", id: "c1", set: { transitionIn: null } },
    ]).project;
    const clip = removed.tracks[0]?.items[0] as Record<string, unknown>;
    expect("transitionIn" in clip).toBe(false);
  });

  it("引用不存在的素材报 REF_MISSING", () => {
    const e = fail(() =>
      applyOps(project(), [{ op: "item.update", id: "c1", set: { asset: "zz" } }]),
    );
    expect(e.issues[0]?.code).toBe("REF_MISSING");
  });
});

describe("卡片尺寸和模板素材（v7）", () => {
  const opts = {
    templates: ["card", "bar"],
    templateSizes: (t: string) => (t === "card" ? ["small", "half"] : []),
    templateAssets: (o: { props: Record<string, unknown> }) =>
      typeof o.props.image === "string" ? [o.props.image] : [],
  };
  const add = (item: object) =>
    applyOps(
      project(),
      [
        { op: "track.add", track: { id: "ov", kind: "overlay", items: [] } },
        {
          op: "item.add",
          track: "ov",
          item: { id: "k", at: { ms: 0 }, durationMs: 1000, ...item },
        },
      ],
      opts,
    );
  const issue = (item: object) => fail(() => add(item)).issues[0];

  it("卡片要写 size，尺寸要在模板支持的范围里；不是卡片不能写 size", () => {
    expect(add({ template: "card", size: "half" }).project).toBeDefined();
    expect(add({ template: "bar" }).project).toBeDefined();
    expect(issue({ template: "card" })?.path).toMatch(/size$/);
    expect(issue({ template: "card", size: "full" })?.path).toMatch(/size$/);
    expect(issue({ template: "bar", size: "small" })?.path).toMatch(/size$/);
  });

  it("模板引用的素材要存在", () => {
    expect(issue({ template: "card", size: "small", props: { image: "zz" } })?.code).toBe(
      "REF_MISSING",
    );
  });
});

describe("clip.split", () => {
  it("在时间线位置分割，考虑倍速；字幕不需要重新绑定", () => {
    const p = applyOps(project(), [{ op: "item.update", id: "c1", set: { speed: 2 } }]).project;
    const r = applyOps(p, [{ op: "clip.split", id: "c1", atMs: 1000 }]);
    expect(mainClips(r.project)).toEqual([
      ["c1", 0, 2000],
      ["c1-1", 2000, 10_000],
    ]);
    expect(r.changed).toEqual(["c1", "c1-1"]);
    // 分割前后，字幕在时间线上的位置不变
    expect(compile(r.project).captions).toEqual(compile(p).captions);
  });

  it("剪辑理由只留在前半段", () => {
    const r = applyOps(project(), [
      { op: "item.update", id: "c1", set: { cutBefore: "停顿" } },
      { op: "clip.split", id: "c1", atMs: 4000 },
    ]);
    const [x, y] = (r.project.tracks[0]?.items ?? []) as MainClip[];
    expect([x?.cutBefore, y?.cutBefore]).toEqual(["停顿", undefined]);
  });

  it("chapters.set 整体替换章节", () => {
    const r = applyOps(project(), [
      { op: "chapters.set", chapters: [{ title: "开场", at: { caption: "s1" } }] },
    ]);
    expect(r.project.chapters).toEqual([{ title: "开场", at: { caption: "s1", offsetMs: 0 } }]);
  });

  it("分割点在片段外报 TIME_RANGE", () => {
    expect(
      fail(() => applyOps(project(), [{ op: "clip.split", id: "c1", atMs: 10_000 }])).code,
    ).toBe("TIME_RANGE");
  });

  it("关键帧分到两段，后半段的关键帧时间重新从 0 算", () => {
    const r = applyOps(project(), [
      { op: "keyframe.set", item: "c1", atMs: 1000, transform: { scale: 1.2 } },
      { op: "keyframe.set", item: "c1", atMs: 6000, transform: { scale: 1.5 } },
      { op: "clip.split", id: "c1", atMs: 4000 },
    ]);
    const [a, b] = (r.project.tracks[0]?.items ?? []) as MainClip[];
    expect(a?.keyframes.map((k) => k.atMs)).toEqual([1000]);
    expect(b?.keyframes.map((k) => k.atMs)).toEqual([2000]);
  });
});

describe("字幕快剪", () => {
  it("cut.removeCaptions 剪掉这句对应的画面，并删除字幕", () => {
    const r = applyOps(project(), [{ op: "cut.removeCaptions", ids: ["s2"] }]);
    expect(mainClips(r.project)).toEqual([
      ["c1", 0, 2100],
      ["c1-1", 3000, 10_000],
    ]);
    expect(r.project.tracks[1]?.items.map((c) => c.id)).toEqual(["s1", "s3"]);
    // 第三句在时间线上提前了 900ms
    const s3 = compile(r.project).captions.find((c) => c.id === "s3");
    expect(s3?.from).toBe(93); // (4000 - 900) × 30 / 1000
  });

  it("cut.restore 把剪掉的源时间接回前一段，去掉剪辑标记", () => {
    const cut = applyOps(project(), [{ op: "cut.removeCaptions", ids: ["s2"] }]).project;
    const r = applyOps(cut, [{ op: "cut.restore", clip: "c1-1" }]);
    expect(mainClips(r.project)).toEqual([
      ["c1", 0, 3000],
      ["c1-1", 3000, 10_000],
    ]);
    expect(r.project.tracks[0]?.items[1]).not.toHaveProperty("cutBefore");
    // 字幕不由这个操作找回（node 层从历史里找）
    expect(r.project.tracks[1]?.items.map((c) => c.id)).toEqual(["s1", "s3"]);
  });

  it("cut.restore 前面不是剪辑点时报 INVALID_OP", () => {
    expect(fail(() => applyOps(project(), [{ op: "cut.restore", clip: "c1" }])).code).toBe(
      "INVALID_OP",
    );
    const split = applyOps(project(), [{ op: "clip.split", id: "c1", atMs: 4000 }]).project;
    expect(fail(() => applyOps(split, [{ op: "cut.restore", clip: "c1-1" }])).code).toBe(
      "INVALID_OP",
    );
  });

  it("cut.removePauses 去掉超过阈值的停顿，两边保留余量", () => {
    const r = applyOps(project(), [
      { op: "cut.removePauses", track: "cap", minGapMs: 500, keepMs: 100 },
    ]);
    // s1-s2 之间只有 100ms，不剪；s2-s3 之间 1000ms，剪掉 3100–3900
    expect(mainClips(r.project)).toEqual([
      ["c1", 0, 3100],
      ["c1-1", 3900, 10_000],
    ]);
  });

  it("cut.removeSilence 按 PCM 分析后给出的源区间剪主轨，不依赖字幕轨", () => {
    const p = project();
    p.tracks = p.tracks.filter((track) => track.kind !== "caption");
    const r = applyOps(p, [
      {
        op: "cut.removeSilence",
        asset: "a1",
        ranges: [{ startMs: 3000, endMs: 4000 }],
        minPauseMs: 600,
        keepMs: 100,
      },
    ]);
    expect(mainClips(r.project)).toEqual([
      ["c1", 0, 3000],
      ["c1-1", 4000, 10_000],
    ]);
    expect(r.project.tracks[0]?.items[1]).toMatchObject({ cutBefore: "停顿" });
    expect(r.project.tracks.some((track) => track.kind === "caption")).toBe(false);
  });
});

describe("字幕编辑", () => {
  it("caption.merge 合并相邻两句", () => {
    const r = applyOps(project(), [{ op: "caption.merge", ids: ["s2", "s1"] }]);
    expect(r.project.tracks[1]?.items).toEqual([
      expect.objectContaining({ id: "s1", startMs: 1000, endMs: 3000, text: "第一句话第二句" }),
      expect.objectContaining({ id: "s3" }),
    ]);
  });

  it("逐字时间：拆分时跟着字走、默认在后半句第一个字处断开；合并时拼接；改字数时去掉", () => {
    const p = project();
    const cap = p.tracks[1]?.items as { charStartMs?: number[] }[];
    (cap[0] as { charStartMs?: number[] }).charStartMs = [1000, 1200, 1500, 1700];
    (cap[1] as { charStartMs?: number[] }).charStartMs = [2100, 2400, 2700];
    const split = applyOps(p, [{ op: "caption.split", id: "s1", at: 2 }]).project;
    expect(split.tracks[1]?.items.slice(0, 2)).toEqual([
      expect.objectContaining({ endMs: 1500, text: "第一", charStartMs: [1000, 1200] }),
      expect.objectContaining({ startMs: 1500, text: "句话", charStartMs: [1500, 1700] }),
    ]);
    const merged = applyOps(p, [{ op: "caption.merge", ids: ["s1", "s2"] }]).project;
    expect(merged.tracks[1]?.items[0]).toMatchObject({
      charStartMs: [1000, 1200, 1500, 1700, 2100, 2400, 2700],
    });
    const noTiming = applyOps(p, [{ op: "caption.merge", ids: ["s2", "s3"] }]).project;
    expect(noTiming.tracks[1]?.items[1]).not.toHaveProperty("charStartMs");
    const sameLen = applyOps(p, [{ op: "caption.update", id: "s1", set: { text: "第一句子" } }]);
    expect(sameLen.project.tracks[1]?.items[0]).toHaveProperty("charStartMs");
    const longer = applyOps(p, [{ op: "caption.update", id: "s1", set: { text: "第一句话呀" } }]);
    expect(longer.project.tracks[1]?.items[0]).not.toHaveProperty("charStartMs");
    expect(() =>
      applyOps(p, [{ op: "caption.update", id: "s2", set: { charStartMs: [1, 2] } }]),
    ).toThrow(MwError);
  });

  it("caption.split 按字数比例分时间，高亮跟着文字走", () => {
    const r = applyOps(project(), [{ op: "caption.split", id: "s3", at: 2 }]);
    const items = r.project.tracks[1]?.items ?? [];
    expect(items.slice(2)).toEqual([
      expect.objectContaining({
        id: "s3",
        startMs: 4000,
        endMs: 4667,
        text: "第三",
        highlights: [{ text: "三" }],
      }),
      expect.objectContaining({ id: "s4", startMs: 4667, endMs: 5000, text: "句", highlights: [] }),
    ]);
  });

  it("caption.import 用 timeline 时间基准，按主轨反算回源时间", () => {
    const p = applyOps(project(), [
      { op: "item.update", id: "c1", set: { inMs: 2000, speed: 1.1 } },
    ]).project;
    const r = applyOps(p, [
      {
        op: "caption.import",
        track: "cap",
        timebase: "timeline",
        srt: "1\n00:00:01,000 --> 00:00:02,000\n你好\n",
      },
    ]);
    expect(r.project.tracks[1]?.items).toEqual([
      { id: "s1", asset: "a1", startMs: 3100, endMs: 4200, text: "你好", highlights: [] },
    ]);
  });

  it("caption.add 带逐字时间加字幕，按时间排好；replace 清空原有的", () => {
    const item = { asset: "a1", startMs: 100, endMs: 600, text: "你好", charStartMs: [100, 300] };
    const late = { ...item, startMs: 700, endMs: 900, text: "再见", charStartMs: [700, 800] };
    const r = applyOps(project(), [
      { op: "caption.add", track: "cap", items: [late, item], mode: "replace" },
    ]);
    const caps = r.project.tracks[1]?.items ?? [];
    expect(caps).toEqual([
      { ...item, id: expect.any(String), highlights: [] },
      { ...late, id: expect.any(String), highlights: [] },
    ]);
    const more = applyOps(r.project, [{ op: "caption.add", track: "cap", items: [item] }]);
    expect(more.project.tracks[1]?.items).toHaveLength(3);
    expect(
      fail(() => applyOps(project(), [{ op: "caption.add", track: "main", items: [item] }])).code,
    ).toBe("INVALID_OP");
  });

  it("SRT 格式错误报 SRT_PARSE", () => {
    const e = fail(() =>
      applyOps(project(), [
        { op: "caption.import", track: "cap", timebase: "timeline", srt: "1\n坏了\n" },
      ]),
    );
    expect(e.code).toBe("SRT_PARSE");
  });
});

describe("样式", () => {
  const style = {
    font: { family: "alibaba-puhuiti-3", size: 64 },
    fill: "#FFFFFF",
    layout: { x: 540, y: 1167, maxWidth: 859 },
  };

  it("style.update 只改写到的字段；还在使用的样式不能删", () => {
    const r = applyOps(project(), [
      { op: "style.add", id: "cap-center", style },
      { op: "style.update", id: "cap-center", set: { font: { size: 72 } } },
      { op: "track.update", id: "cap", set: { style: "cap-center" } },
    ]);
    const s = r.project.styles["cap-center"];
    expect(s?.font).toMatchObject({ family: "alibaba-puhuiti-3", size: 72, weight: 700 });
    expect(fail(() => applyOps(r.project, [{ op: "style.remove", id: "cap-center" }])).code).toBe(
      "IN_USE",
    );
  });
});

describe("asset.cache", () => {
  it("只改写到的缓存字段，null 删除", () => {
    const r = applyOps(project(), [
      { op: "asset.cache", id: "a1", set: { faces: "cache/media/x.faces.json", proxy: "p.mp4" } },
      { op: "asset.cache", id: "a1", set: { proxy: null } },
    ]);
    expect(r.project.assets.a1?.cache).toEqual({ faces: "cache/media/x.faces.json" });
    expect(fail(() => applyOps(project(), [{ op: "asset.cache", id: "nope", set: {} }])).code).toBe(
      "NOT_FOUND",
    );
  });
});
