import { describe, expect, it } from "vitest";
import { compile, layoutMainTrack, mainShiftAt, mapTimelineMs } from "./compile";
import { coverView } from "./cover";
import { Project } from "./schema";
import { sourceFrameAt } from "./time";

const base = {
  version: 7,
  revision: 0,
  canvas: {},
  assets: {
    a1: { kind: "video", path: "/raw.mov", probe: { durationMs: 33_880 } },
    outro: { kind: "video", path: "/outro.mp4", probe: { durationMs: 1767 } },
  },
};

const make = (extra: object) => Project.parse({ ...base, ...extra });

describe("compile：1029 样片的结构", () => {
  // 裁头 2.607 秒、1.1 倍速、接片尾（docs/decisions/0001）
  const project = make({
    tracks: [
      {
        id: "main",
        kind: "video",
        main: true,
        items: [
          {
            id: "c1",
            type: "clip",
            asset: "a1",
            inMs: 2607,
            outMs: 32_380,
            speed: 1.1,
            transform: { scale: 1.265, x: 551, y: 970 },
          },
        ],
      },
      {
        id: "cap",
        kind: "caption",
        items: [{ id: "s1", asset: "a1", startMs: 2607 + 1100, endMs: 2607 + 2200, text: "一句" }],
      },
    ],
    outro: { asset: "outro" },
  });
  const tl = compile(project);

  it("主轨的入点和时长", () => {
    const v = tl.videos[0];
    expect(v?.trimBeforeFrames).toBe(78);
    expect(v?.from).toBe(0);
    // (32380 - 2607) / 1.1 = 27066.4ms → 812 帧
    expect(tl.mainEndFrame).toBe(812);
    expect(v?.transform).toEqual({
      x: 551,
      y: 970,
      scale: 1.265,
      rotation: 0,
      opacity: 1,
      radius: 0,
    });
  });

  it("片尾接在主轨后面", () => {
    expect(tl.outro).toMatchObject({ from: 812, durationInFrames: 53 });
    expect(tl.durationInFrames).toBe(865);
  });

  it("字幕按倍速换算到时间线", () => {
    // 源时间往后 1100ms，1.1 倍速 → 时间线 1000ms → 第 30 帧
    expect(tl.captions).toEqual([
      expect.objectContaining({ id: "s1", from: 30, durationInFrames: 30, partial: false }),
    ]);
  });

  it("帧映射和 spike 实测一致（第 805 帧 → 源第 963 帧）", () => {
    expect(sourceFrameAt(78, 1.1, 805)).toBe(963);
    expect(sourceFrameAt(78, 1.1, 10)).toBe(89);
  });
});

describe("compile：分割、剪切、转场", () => {
  const clip = (id: string, inMs: number, outMs: number, extra: object = {}) => ({
    id,
    type: "clip",
    asset: "a1",
    inMs,
    outMs,
    ...extra,
  });
  const caption = (id: string, startMs: number, endMs: number) => ({
    id,
    asset: "a1",
    startMs,
    endMs,
    text: id,
  });

  it("只分割不剪掉内容时，字幕合成一段", () => {
    const tl = compile(
      make({
        tracks: [
          {
            id: "main",
            kind: "video",
            main: true,
            items: [clip("c1", 0, 1000), clip("c2", 1000, 3000)],
          },
          { id: "cap", kind: "caption", items: [caption("s1", 500, 1500)] },
        ],
      }),
    );
    expect(tl.captions).toHaveLength(1);
    expect(tl.captions[0]).toMatchObject({ from: 15, durationInFrames: 30, partial: false });
  });

  it("剪掉中间一段后，字幕分成两段显示，完全剪掉的字幕给出警告", () => {
    const tl = compile(
      make({
        tracks: [
          {
            id: "main",
            kind: "video",
            main: true,
            items: [clip("c1", 0, 1000), clip("c2", 2000, 3000)],
          },
          {
            id: "cap",
            kind: "caption",
            items: [caption("s1", 500, 2500), caption("s2", 1200, 1800)],
          },
        ],
      }),
    );
    expect(tl.captions.map((c) => [c.id, c.part, c.from, c.durationInFrames])).toEqual([
      ["s1", 0, 15, 15],
      ["s1", 1, 30, 15],
    ]);
    expect(tl.captions.every((c) => c.partial)).toBe(true);
    expect(tl.warnings.map((w) => w.code)).toEqual(["CAPTION_CUT"]);
  });

  it("逐字时间映射到时间线：倍速换算，剪掉的字按前后处理", () => {
    const tl = compile(
      make({
        tracks: [
          {
            id: "main",
            kind: "video",
            main: true,
            items: [clip("c1", 0, 1000), { ...clip("c2", 2000, 3000), speed: 2 }],
          },
          {
            id: "cap",
            kind: "caption",
            items: [
              {
                ...caption("s1", 500, 2500),
                text: "一二三四",
                charStartMs: [500, 800, 1500, 2200],
              },
            ],
          },
        ],
      }),
    );
    // 第一段 500–1000ms（时间线 500–1000）：「三」被剪掉、在这一段之后 → 段末；「四」同理
    expect(tl.captions[0]?.charStartMs).toEqual([0, 300, 500, 500]);
    // 第二段源 2000–2500 在时间线 1000–1250（2 倍速）：前三个字在这一段之前 → 0，「四」在 2200 → 1100
    expect(tl.captions[1]?.charStartMs).toEqual([0, 0, 0, 100]);
  });

  it("按字锚定：念到第几个字时出现；没有逐字时间时按字数估算", () => {
    const tl = compile(
      make({
        tracks: [
          { id: "main", kind: "video", main: true, items: [clip("c1", 0, 3000)] },
          {
            id: "cap",
            kind: "caption",
            items: [
              {
                ...caption("s1", 1000, 2000),
                text: "一二三四",
                charStartMs: [1000, 1100, 1700, 1800],
              },
              { ...caption("s2", 2000, 3000), text: "甲乙丙丁" },
            ],
          },
          {
            id: "o",
            kind: "overlay",
            items: [
              {
                id: "o1",
                template: "title-bar",
                at: { caption: "s1", char: 2 },
                durationMs: 500,
                props: { lines: ["x"] },
              },
              {
                id: "o2",
                template: "title-bar",
                at: { caption: "s2", char: 2, offsetMs: 100 },
                durationMs: 500,
                props: { lines: ["x"] },
              },
            ],
          },
        ],
      }),
    );
    // 「三」在 1700ms → 第 51 帧；s2 第 3 个字估算在 2500ms，再加 100ms → 第 78 帧
    expect(tl.overlays.map((o) => [o.id, o.from])).toEqual([
      ["o1", 51],
      ["o2", 78],
    ]);
  });

  it("主轨转场不占时间：后一段照常接在前一段后面，总时长不变（0019）", () => {
    const tl = compile(
      make({
        tracks: [
          {
            id: "main",
            kind: "video",
            main: true,
            items: [
              clip("c1", 0, 1000),
              clip("c2", 1000, 2000, {
                transitionIn: { type: "slide", direction: "up", durationMs: 400 },
              }),
            ],
          },
        ],
      }),
    );
    expect(tl.videos.map((v) => [v.from, v.durationInFrames])).toEqual([
      [0, 30],
      [30, 30],
    ]);
    expect(tl.mainEndFrame).toBe(60);
    expect(tl.videos[1]?.transitionIn).toEqual({
      type: "slide",
      direction: "up",
      durationInFrames: 12,
    });
  });

  it("多次变速后首尾帧严格相接，不累计误差", () => {
    const items = Array.from({ length: 7 }, (_, i) =>
      clip(`c${i}`, i * 1000, i * 1000 + 1000, { speed: 1.3 }),
    );
    const tl = compile(make({ tracks: [{ id: "main", kind: "video", main: true, items }] }));
    for (let i = 1; i < tl.videos.length; i++) {
      const prev = tl.videos[i - 1];
      expect(tl.videos[i]?.from).toBe((prev?.from ?? 0) + (prev?.durationInFrames ?? 0));
    }
    // 7000 / 1.3 = 5384.6ms → 161.5 帧 → 162
    expect(tl.mainEndFrame).toBe(162);
  });

  it("叠加层锚定字幕，toEnd 显示到主轨结束", () => {
    const tl = compile(
      make({
        tracks: [
          { id: "main", kind: "video", main: true, items: [clip("c1", 0, 4000)] },
          { id: "cap", kind: "caption", items: [caption("s1", 1000, 2000)] },
          {
            id: "ov",
            kind: "overlay",
            items: [
              { id: "o1", template: "title-bar", at: { ms: 0 }, durationMs: "toEnd" },
              {
                id: "o2",
                template: "info-card",
                at: { caption: "s1", offsetMs: 100 },
                durationMs: 1000,
              },
              { id: "o3", template: "info-card", at: { caption: "nope" }, durationMs: 1000 },
            ],
          },
        ],
        outro: { asset: "outro" },
      }),
    );
    expect(tl.overlays.map((o) => [o.id, o.from, o.durationInFrames])).toEqual([
      ["o1", 0, 120],
      ["o2", 33, 30],
    ]);
    expect(tl.warnings.map((w) => w.code)).toEqual(["ANCHOR_CUT"]);
  });
});

describe("mapTimelineMs", () => {
  it("时间线时间反算回源时间", () => {
    const p = make({
      tracks: [
        {
          id: "main",
          kind: "video",
          main: true,
          items: [
            { id: "c1", type: "clip", asset: "a1", inMs: 1000, outMs: 2000, speed: 2 },
            { id: "c2", type: "clip", asset: "a1", inMs: 5000, outMs: 6000 },
          ],
        },
      ],
    });
    const segs = layoutMainTrack(p);
    expect(mapTimelineMs(segs, 250)).toEqual({ asset: "a1", srcMs: 1500, clip: "c1" });
    expect(mapTimelineMs(segs, 500)).toEqual({ asset: "a1", srcMs: 5000, clip: "c2" });
    expect(mapTimelineMs(segs, 1500)).toEqual({ asset: "a1", srcMs: 6000, clip: "c2" });
    expect(mapTimelineMs(segs, 1501)).toBeNull();
  });
});

describe("章节和剪辑理由（v4）", () => {
  const project = make({
    tracks: [
      {
        id: "main",
        kind: "video",
        main: true,
        items: [
          { id: "c1", type: "clip", asset: "a1", inMs: 0, outMs: 3000 },
          { id: "c2", type: "clip", asset: "a1", inMs: 5000, outMs: 9000, cutBefore: "口误" },
        ],
      },
      {
        id: "cap",
        kind: "caption",
        items: [
          { id: "s1", asset: "a1", startMs: 0, endMs: 2000, text: "开场" },
          { id: "s2", asset: "a1", startMs: 3500, endMs: 4500, text: "剪掉了" },
          { id: "s3", asset: "a1", startMs: 6000, endMs: 8000, text: "第一点" },
        ],
      },
    ],
    chapters: [
      { title: "第一点", at: { caption: "s3" } },
      { title: "开场", at: { ms: 0 } },
      { title: "没了", at: { caption: "s2" } },
    ],
  });
  const tl = compile(project);

  it("章节按时间排序，锚点被剪掉的不出现", () => {
    // s3 在源 6000ms，c2 从源 5000ms 接在时间线 3000ms 处 → 4000ms = 120 帧
    expect(tl.chapters).toEqual([
      { title: "开场", from: 0 },
      { title: "第一点", from: 120 },
    ]);
    expect(tl.warnings.some((w) => w.path === "chapters[2].at")).toBe(true);
  });

  it("主轨片段带上剪辑理由", () => {
    expect(tl.videos.map((v) => v.cutBefore)).toEqual([null, "口误"]);
  });
});

describe("schema", () => {
  it("不认识的字段直接报错（D25）", () => {
    const r = Project.safeParse({
      ...base,
      tracks: [
        {
          id: "main",
          kind: "video",
          main: true,
          items: [{ id: "c1", type: "clip", asset: "a1", inMs: 0, outMs: 1000, sped: 1.1 }],
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("普通轨道上带 at 的片段不会被当成主轨片段", () => {
    const p = make({
      tracks: [
        {
          id: "pip",
          kind: "video",
          items: [{ id: "p1", type: "clip", asset: "a1", at: { ms: 500 }, inMs: 0, outMs: 1000 }],
        },
      ],
    });
    const item = p.tracks[0]?.items[0];
    expect(item && "at" in item).toBe(true);
  });

  it("画中画的循环动画（v6）传到时间线；只开放呼吸", () => {
    const pip = (preset: string) => ({
      tracks: [
        {
          id: "pip",
          kind: "video",
          items: [
            {
              id: "p1",
              type: "clip",
              asset: "a1",
              at: { ms: 0 },
              inMs: 0,
              outMs: 1000,
              animLoop: { preset, durationMs: 2400 },
            },
          ],
        },
      ],
    });
    const tl = compile(make(pip("breathe")));
    expect(tl.videos.find((v) => v.id === "p1")?.animLoop).toMatchObject({
      preset: "breathe",
      durationMs: 2400,
    });
    expect(Project.safeParse({ ...base, ...pip("pop") }).success).toBe(false);
  });
});

describe("卡片尺寸和半屏让位（v7）", () => {
  const card = (id: string, ms: number, durationMs: number, size?: string) => ({
    id,
    template: "title-bar",
    at: { ms },
    durationMs,
    ...(size ? { size } : {}),
    props: { lines: ["x"] },
  });
  const project = make({
    tracks: [
      {
        id: "main",
        kind: "video",
        main: true,
        items: [{ id: "c1", type: "clip", asset: "a1", inMs: 0, outMs: 10_000 }],
      },
      {
        id: "o",
        kind: "overlay",
        items: [
          card("a", 1000, 2000, "half"),
          card("b", 2500, 1500, "half"),
          card("c", 6000, 100, "half"),
          card("d", 7000, 1000, "small"),
          card("e", 8000, 1000),
        ],
      },
    ],
  });
  const tl = compile(project);

  it("重叠的半屏卡合并成一段，小卡和没写尺寸的不让位", () => {
    expect(tl.overlays.map((o) => o.size)).toEqual(["half", "half", "half", "small", null]);
    expect(tl.mainShifts).toEqual([
      { from: 30, to: 120, rampFrames: 12 },
      { from: 180, to: 183, rampFrames: 1 },
    ]);
  });

  it("上移量：进出缓动，中间保持，段外为 0", () => {
    expect(mainShiftAt(tl.mainShifts, 29)).toBe(0);
    expect(mainShiftAt(tl.mainShifts, 30)).toBe(0);
    expect(mainShiftAt(tl.mainShifts, 36)).toBeCloseTo(0.5);
    expect(mainShiftAt(tl.mainShifts, 60)).toBe(1);
    expect(mainShiftAt(tl.mainShifts, 114)).toBeCloseTo(0.5);
    expect(mainShiftAt(tl.mainShifts, 120)).toBe(0);
  });

  it("封面只留主轨，再加封面标题", () => {
    const v = coverView({
      ...project,
      cover: { atMs: 1000, title: { template: "title-bar", props: { lines: ["封面"] } } },
    });
    expect(v.tracks.map((t) => t.kind)).toEqual(["video", "overlay"]);
    expect(v.outro).toBeNull();
    const c = compile(v);
    expect(c.overlays).toHaveLength(1);
    expect(c.overlays[0]).toMatchObject({ from: 0, props: { lines: ["封面"] } });
    expect(coverView({ ...project, cover: null }).tracks).toHaveLength(1);
  });
});
