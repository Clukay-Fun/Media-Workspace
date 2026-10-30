import { describe, expect, it } from "vitest";
import { compile } from "./compile";
import { planDrag, planSplit, planTransform } from "./edit";
import { MwError } from "./errors";
import { applyOps } from "./ops";
import { type ImageItem, Project } from "./schema";

// 30fps；主轨两段：c1 源 0–2000、c2 源 4000–6000（时间线 0–2000、2000–4000）
const project = (opts: { locked?: boolean } = {}) =>
  Project.parse({
    version: 6,
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
