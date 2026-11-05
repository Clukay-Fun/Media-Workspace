import { describe, expect, it } from "vitest";
import { compile } from "./compile";
import { nudgeDeltaMs, planDrag, planSplit, planTrackMove, planTransform } from "./edit";
import { MwError } from "./errors";
import { applyOps } from "./ops";
import { type ImageItem, Project } from "./schema";
import { PROJECT_FORMAT_VERSION } from "./version";

// 30fps；主轨两段：c1 源 0–2000、c2 源 4000–6000（时间线 0–2000、2000–4000）
const project = (opts: { locked?: boolean } = {}) =>
  Project.parse({
    version: PROJECT_FORMAT_VERSION,
    revision: 0,
    canvas: {},
    assets: {
      a1: { kind: "video", path: "/raw.mov", probe: { durationMs: 10_000 } },
      img: { kind: "image", path: "/a.png" },
    },
    tracks: [
      {
        id: "main",
        kind: "video",
        main: true,
        items: [
          { id: "c1", type: "clip", asset: "a1", inMs: 0, outMs: 2000 },
          { id: "c2", type: "clip", asset: "a1", inMs: 4000, outMs: 6000 },
        ],
      },
      {
        id: "pip",
        kind: "video",
        locked: opts.locked ?? false,
        items: [{ id: "i1", type: "image", asset: "img", at: { ms: 500 }, durationMs: 1000 }],
      },
      {
        id: "cap",
        kind: "caption",
        items: [
          {
            id: "s1",
            asset: "a1",
            startMs: 4200,
            endMs: 5000,
            text: "一二三四",
            charStartMs: [4200, 4400, 4600, 4800],
          },
        ],
      },
    ],
  });

const apply = (p: Project, ops: unknown[]) => applyOps(p, ops).project;

function mainTrackWithDurations(durationsMs: number[]): Project {
  const p = project();
  const main = p.tracks.find((track) => track.kind === "video" && track.main);
  if (!main || main.kind !== "video") throw new Error("main track fixture");
  const template = main.items[0];
  if (!template || !("type" in template) || template.type !== "clip")
    throw new Error("main clip fixture");
  let sourceMs = 0;
  main.items = durationsMs.map((durationMs, index) => {
    const item = {
      ...template,
      id: `c${index + 1}`,
      inMs: sourceMs,
      outMs: sourceMs + durationMs,
    };
    sourceMs += durationMs;
    return item;
  });
  p.assets.a1!.probe!.durationMs = sourceMs;
  return p;
}

describe("planDrag", () => {
  it("整体移动时长不变，位置改成绝对时间", () => {
    const r = planDrag(project(), { id: "i1", mode: "move", deltaMs: 300, snap: false });
    expect(r.preview).toEqual({ startMs: 800, endMs: 1800 });
    expect(r.ops).toEqual([{ op: "item.update", id: "i1", set: { at: { ms: 800 } } }]);
  });

  it("跟随字幕的元素：移动只改 offsetMs，保留按字锚定", () => {
    const p = apply(project(), [
      { op: "item.update", id: "i1", set: { at: { caption: "s1", char: 2, offsetMs: 100 } } },
    ]);
    const r = planDrag(p, { id: "i1", mode: "move", deltaMs: -250, snap: false });
    expect(r.ops).toEqual([
      { op: "item.update", id: "i1", set: { at: { caption: "s1", char: 2, offsetMs: -150 } } },
    ]);
    // 提交后的位置和预览一致：第 3 个字在源 4600 → 时间线 2600，加 100 再减 250
    const tl = compile(apply(p, r.ops));
    expect(tl.images[0]?.from).toBe(Math.round((2450 * 30) / 1000));
    expect(r.preview.startMs).toBeCloseTo(2450, 0);
  });

  it("拖开头时结尾不动，拖结尾时开头不动", () => {
    const a = planDrag(project(), { id: "i1", mode: "trimStart", deltaMs: 200, snap: false });
    expect(a.preview).toEqual({ startMs: 700, endMs: 1500 });
    expect(a.ops[0]).toMatchObject({ set: { at: { ms: 700 }, durationMs: 800 } });
    const b = planDrag(project(), { id: "i1", mode: "trimEnd", deltaMs: -400, snap: false });
    expect(b.preview).toEqual({ startMs: 500, endMs: 1100 });
    expect(b.ops[0]).toMatchObject({ set: { durationMs: 600 } });
  });

  it("吸附到其他条目的边缘和播放头，吸附后仍然只有一次提交", () => {
    // 结尾 1500+470=1970，离 c1 结尾（2000）30ms
    const r = planDrag(project(), { id: "i1", mode: "move", deltaMs: 470, snap: true });
    expect(r.preview.endMs).toBe(2000);
    expect(r.snappedTo).toMatchObject({ kind: "clip" });
    expect(r.ops).toHaveLength(1);
    const p = planDrag(project(), {
      id: "i1",
      mode: "trimEnd",
      deltaMs: 20,
      snap: true,
      playheadMs: 1550,
    });
    expect(p.preview.endMs).toBe(1550);
    expect(p.snappedTo?.kind).toBe("playhead");
  });

  it("主轨移动 = 换顺序；裁剪 = 改入点出点，开头位置不变", () => {
    const m = planDrag(project(), { id: "c1", mode: "move", deltaMs: 2500, snap: false });
    expect(m.ops).toEqual([{ op: "item.move", id: "c1", index: 1 }]);
    const t = planDrag(project(), { id: "c2", mode: "trimStart", deltaMs: 500, snap: false });
    expect(t.ops).toEqual([{ op: "clip.trim", id: "c2", inMs: 4500 }]);
    expect(t.preview).toEqual({ startMs: 2000, endMs: 3500 });
    const e = planDrag(project(), { id: "c2", mode: "trimEnd", deltaMs: 9999, snap: false });
    // 出点不超过素材时长
    expect(e.ops).toEqual([{ op: "clip.trim", id: "c2", outMs: 10_000 }]);
  });

  it("主轨按指针落点换序，长短片段同一落点插入到目标之前", () => {
    for (const durations of [
      [12_000, 10_000],
      [12_000, 21_876],
    ]) {
      const r = planDrag(mainTrackWithDurations(durations), {
        id: "c2",
        mode: "move",
        deltaMs: -durations[0]!,
        dropMs: 2_500,
        snap: false,
      });
      expect(r.ops).toEqual([{ op: "item.move", id: "c2", index: 0 }]);
    }
  });

  it("主轨落点在目标中点前后分槽，中点正好算在目标之前", () => {
    const p = mainTrackWithDurations([2_000, 2_000, 2_000]);
    const drag = (dropMs: number) =>
      planDrag(p, { id: "c3", mode: "move", deltaMs: -4_000, dropMs, snap: false }).ops;

    expect(drag(999)).toEqual([{ op: "item.move", id: "c3", index: 0 }]);
    expect(drag(1_000)).toEqual([{ op: "item.move", id: "c3", index: 0 }]);
    expect(drag(1_001)).toEqual([{ op: "item.move", id: "c3", index: 1 }]);
  });

  it("主轨落在目标之后会插入其后，落回原槽不生成 op", () => {
    const p = mainTrackWithDurations([2_000, 2_000, 2_000]);
    const afterFirst = planDrag(p, {
      id: "c3",
      mode: "move",
      deltaMs: -4_000,
      dropMs: 1_500,
      snap: false,
    });
    expect(afterFirst.ops).toEqual([{ op: "item.move", id: "c3", index: 1 }]);

    const originalSlot = planDrag(p, {
      id: "c2",
      mode: "move",
      deltaMs: 0,
      dropMs: 3_000,
      snap: false,
    });
    expect(originalSlot.ops).toEqual([]);
  });

  it("字幕按源时间平移，逐字时间跟着移动", () => {
    const r = planDrag(project(), { id: "s1", mode: "move", deltaMs: 300, snap: false });
    const op = r.ops[0] as unknown as {
      set: { startMs: number; endMs: number; charStartMs: number[] };
    };
    expect(op.set.startMs - 4200).toBeCloseTo(300, -1);
    expect(op.set.endMs - op.set.startMs).toBe(800);
    expect(op.set.charStartMs[0]).toBe(op.set.startMs);
    // 提交后工程合法
    expect(() => apply(project(), r.ops)).not.toThrow();
  });

  it("字幕不能拖到别的素材之外（被剪掉的地方）", () => {
    expect(() =>
      planDrag(project(), { id: "s1", mode: "move", deltaMs: -100_000, snap: false }),
    ).not.toThrow(); // 夹到 0，落在 c1（同一个素材）上
    expect(() =>
      planDrag(project(), { id: "s1", mode: "move", deltaMs: 5000, snap: false }),
    ).toThrow(MwError);
  });

  it("锁定的轨道直接拒绝", () => {
    expect(() =>
      planDrag(project({ locked: true }), { id: "i1", mode: "move", deltaMs: 10, snap: false }),
    ).toThrow(expect.objectContaining({ code: "TRACK_LOCKED" }));
  });

  it("字幕拖到相邻字幕时停住，时长不变，提交后也不会被裁成一帧", () => {
    const p = project();
    const cap = p.tracks.find((t) => t.kind === "caption");
    if (!cap || cap.kind !== "caption") throw new Error("fixture");
    cap.items.push({
      id: "s2",
      asset: "a1",
      startMs: 5200,
      endMs: 5800,
      text: "今天天气真好",
      highlights: [],
    });
    // s1 在时间线 2200–3000，s2 在 3200–3800。往右拖 1500 会盖住 s2，应停在 2400–3200
    const r = planDrag(p, { id: "s1", mode: "move", deltaMs: 1500, snap: false });
    expect(r.preview.endMs - r.preview.startMs).toBeCloseTo(800, 0);
    expect(r.preview.startMs).toBeCloseTo(2400, 0);
    expect(r.preview.endMs).toBeCloseTo(3200, 0);
    const op = r.ops[0] as unknown as { set: { startMs: number; endMs: number } };
    expect(op.set.endMs - op.set.startMs).toBe(800);
    const tl = compile(apply(p, r.ops));
    const a = tl.captions.find((c) => c.id === "s1");
    const b = tl.captions.find((c) => c.id === "s2");
    expect(a?.durationInFrames).toBe(24);
    expect(b?.durationInFrames).toBe(18);
    expect((a?.from ?? 0) + (a?.durationInFrames ?? 0)).toBeLessThanOrEqual(b?.from ?? 0);

    // 空隙还够时照常移动
    const small = planDrag(p, { id: "s1", mode: "move", deltaMs: 50, snap: false });
    expect(small.preview.startMs).toBeCloseTo(2250, 0);
    expect(small.preview.endMs - small.preview.startMs).toBeCloseTo(800, 0);

    // 后一句往左拖，停在前一句的结尾
    const back = planDrag(p, { id: "s2", mode: "move", deltaMs: -2000, snap: false });
    expect(back.preview.startMs).toBeCloseTo(3000, 0);
    expect(back.preview.endMs - back.preview.startMs).toBeCloseTo(600, 0);

    // 拖结尾时停在下一句的开头，开头不动
    const trim = planDrag(p, { id: "s1", mode: "trimEnd", deltaMs: 900, snap: false });
    expect(trim.preview).toEqual({ startMs: 2200, endMs: 3200 });
  });

  it("吸附不能把字幕吸进下一句里面", () => {
    const p = project();
    const cap = p.tracks.find((t) => t.kind === "caption");
    if (!cap || cap.kind !== "caption") throw new Error("fixture");
    cap.items.push({
      id: "s2",
      asset: "a1",
      startMs: 5200,
      endMs: 5800,
      text: "今天天气真好",
      highlights: [],
    });
    // 播放头在两句中间偏右，吸附会把开头吸过去，约束再把它拉回邻居边上
    const r = planDrag(p, {
      id: "s1",
      mode: "move",
      deltaMs: 850,
      snap: true,
      playheadMs: 3100,
    });
    expect(r.preview.endMs - r.preview.startMs).toBeCloseTo(800, 0);
    expect(r.preview.endMs).toBeLessThanOrEqual(3200);
    expect(r.snappedTo).toBeNull();
  });

  it("标题和卡片叠在一起时时长不变，不会被裁短", () => {
    const p = project();
    p.tracks.push({
      id: "titles",
      kind: "overlay",
      locked: false,
      hidden: false,
      muted: false,
      items: [
        {
          id: "t1",
          template: "title",
          at: { ms: 0 },
          durationMs: 1000,
          props: { lines: ["今天天气真好"] },
        },
        {
          id: "k1",
          template: "card",
          size: "small",
          at: { ms: 1500 },
          durationMs: 800,
          props: { lines: ["今天天气真好"] },
        },
      ],
    });
    // 标题可以盖住卡片：叠加层没有字幕那种「后一句出现前一句消失」
    const move = planDrag(p, { id: "t1", mode: "move", deltaMs: 1200, snap: false });
    expect(move.preview).toEqual({ startMs: 1200, endMs: 2200 });
    const tl = compile(apply(p, move.ops));
    const title = tl.overlays.find((o) => o.id === "t1");
    const card = tl.overlays.find((o) => o.id === "k1");
    expect(title?.durationInFrames).toBe(30);
    expect(card?.durationInFrames).toBe(24);
  });
});

describe("planSplit", () => {
  it("主轨片段按时间线位置分割", () => {
    const r = planSplit(project(), { id: "c2", atMs: 2500 });
    expect(r.ops).toEqual([{ op: "clip.split", id: "c2", atMs: 2500 }]);
    expect(() => apply(project(), r.ops)).not.toThrow();
  });

  it("字幕有逐字时间时在播放头之后的第一个字处断开", () => {
    // 时间线 2500 → 源 4500，第一个 ≥4500 的字是「三」（下标 2）
    const r = planSplit(project(), { id: "s1", atMs: 2500 });
    expect(r.ops).toEqual([{ op: "caption.split", id: "s1", at: 2, atMs: 4500 }]);
    const p = apply(project(), r.ops);
    expect(p.tracks[2]?.items.map((c) => ("text" in c ? c.text : ""))).toEqual(["一二", "三四"]);
  });

  it("图片分割成前后两段，总时长不变", () => {
    const r = planSplit(project(), { id: "i1", atMs: 900 });
    const p = apply(project(), r.ops);
    const tl = compile(p);
    expect(tl.images.map((i) => [i.from, i.durationInFrames])).toEqual([
      [15, 12],
      [27, 18],
    ]);
  });

  it("播放头不在条目上时报错", () => {
    expect(() => planSplit(project(), { id: "i1", atMs: 100 })).toThrow(MwError);
  });
});

describe("planTransform", () => {
  it("中心点吸附到画面中线，边缘吸附到参考线", () => {
    const r = planTransform(project(), {
      id: "i1",
      transform: { x: 545, y: 300, scale: 0.5 },
      snap: true,
      guides: [{ axis: "h", pos: 785 }],
    });
    expect(r.preview.x).toBe(540);
    // 半高 480：上边缘 300-480=-180 不吸附；下边缘 300+480=780 → 吸到 785
    expect(r.preview.y).toBe(305);
    expect(r.guides.map((g) => g.kind).sort()).toEqual(["center", "guide"]);
    expect(r.ops).toEqual([
      { op: "item.update", id: "i1", set: { transform: { x: 540, y: 305, scale: 0.5 } } },
    ]);
  });

  it("不吸附时原样提交", () => {
    const r = planTransform(project(), { id: "i1", transform: { x: 545 }, snap: false });
    expect(r.ops[0]).toMatchObject({ set: { transform: { x: 545 } } });
  });

  // 画布 1080×1920，中心 (540, 960)
  const keyed = () => {
    const p = project();
    const img = p.tracks
      .flatMap((t) => t.items as { id: string }[])
      .find((i) => i.id === "i1") as ImageItem;
    img.keyframes = [
      { atMs: 0, transform: { x: 100 }, easing: "linear" },
      { atMs: 1000, transform: { x: 300, scale: 2 }, easing: "linear" },
    ];
    return p;
  };

  it("有关键帧时改动写进播放头处的关键帧；在两帧之间就从此刻的样子新加一个", () => {
    const r = planTransform(keyed(), { id: "i1", transform: { y: 400 }, snap: false, atMs: 500 });
    expect(r.ops).toEqual([
      {
        op: "keyframe.set",
        item: "i1",
        atMs: 500,
        transform: { x: 200, y: 400, scale: 1.5, rotation: 0, opacity: 1, radius: 0 },
      },
    ]);
  });

  it("播放头离关键帧不到半帧就改那一帧，保留它原来的缓动", () => {
    const r = planTransform(keyed(), { id: "i1", transform: { y: 400 }, snap: false, atMs: 1010 });
    expect(r.ops).toEqual([
      {
        op: "keyframe.set",
        item: "i1",
        atMs: 1000,
        transform: { x: 300, scale: 2, y: 400 },
        easing: "linear",
      },
    ]);
  });

  it("没有关键帧时即使传了 atMs 也照旧写 transform", () => {
    const r = planTransform(project(), { id: "i1", transform: { x: 545 }, snap: false, atMs: 0 });
    expect(r.ops[0]).toMatchObject({ op: "item.update" });
  });
});

describe("方向键步长", () => {
  it("一帧，按住 Shift 是一秒", () => {
    expect(nudgeDeltaMs(30, false, 1)).toBeCloseTo(1000 / 30);
    expect(nudgeDeltaMs(30, false, -1)).toBeCloseTo(-1000 / 30);
    expect(nudgeDeltaMs(30, true, 1)).toBe(1000);
    expect(nudgeDeltaMs(30, true, -1)).toBe(-1000);
  });
});

describe("轨道层级", () => {
  const layers = () =>
    Project.parse({
      version: PROJECT_FORMAT_VERSION,
      revision: 0,
      canvas: {},
      assets: { a1: { kind: "video", path: "/raw.mov", probe: { durationMs: 4000 } } },
      tracks: [
        { id: "main", kind: "video", main: true, items: [] },
        { id: "pip", kind: "video", name: "画中画", items: [] },
        { id: "cap", kind: "caption", items: [] },
        { id: "title", kind: "overlay", items: [] },
      ],
    });

  it("松开时用 track.move 改顺序，主视频留在最下面", () => {
    const up = planTrackMove(layers(), { id: "pip", index: 3 });
    expect(up.ops).toEqual([{ op: "track.move", id: "pip", index: 3 }]);
    expect(applyOps(layers(), up.ops).project.tracks.map((t) => t.id)).toEqual([
      "main",
      "cap",
      "title",
      "pip",
    ]);
    const down = planTrackMove(layers(), { id: "title", index: 1 });
    expect(applyOps(layers(), down.ops).project.tracks.map((t) => t.id)).toEqual([
      "main",
      "title",
      "pip",
      "cap",
    ]);
  });

  it("拖到主视频下面会被挡回去；位置没变就不提交", () => {
    expect(planTrackMove(layers(), { id: "pip", index: 0 }).ops).toEqual([]);
    expect(planTrackMove(layers(), { id: "title", index: 3 }).ops).toEqual([]);
    expect(() => planTrackMove(layers(), { id: "main", index: 2 })).toThrow(MwError);
    expect(() => planTrackMove(layers(), { id: "main", index: 2 })).toThrow(/主视频/);
  });

  it("锁定的轨道不能拖，不存在的轨道会说明", () => {
    const locked = layers();
    const cap = locked.tracks[2];
    if (!cap || cap.kind !== "caption") throw new Error("字幕轨不在预期位置");
    cap.locked = true;
    expect(() => planTrackMove(locked, { id: "cap", index: 1 })).toThrow(/锁定/);
    expect(() => planTrackMove(layers(), { id: "missing", index: 1 })).toThrow(/不存在/);
  });
});
