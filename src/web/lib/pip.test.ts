import { describe, expect, it } from "vitest";
import { MwError } from "../../core/errors";
import { applyOps } from "../../core/ops";
import { Project } from "../../core/schema";
import { containBox, cornerPlacement, placeAsset, resizeFromCorner } from "./pip";

const canvas = Project.parse({ version: 5, revision: 0, canvas: {} }).canvas;

const videoProject = () =>
  Project.parse({
    version: 5,
    revision: 0,
    canvas: {},
    assets: {
      v1: {
        kind: "video",
        path: "/v.mp4",
        probe: { durationMs: 5000, width: 1080, height: 1920 },
      },
      v2: {
        kind: "video",
        path: "/wide.mp4",
        probe: { durationMs: 5000, width: 1920, height: 1080 },
      },
      i1: {
        kind: "image",
        path: "/i.png",
        probe: { durationMs: 0, width: 1200, height: 800 },
      },
      a1: { kind: "audio", path: "/a.mp3", probe: { durationMs: 5000 } },
    },
    tracks: [
      {
        id: "main",
        kind: "video",
        main: true,
        items: [{ id: "c1", type: "clip", asset: "v1", inMs: 0, outMs: 5000 }],
      },
    ],
  });

describe("contain 后的内容框", () => {
  it("竖屏素材铺满画布；横屏素材上下留黑边", () => {
    expect(containBox(1080, 1920, 1080, 1920)).toEqual({
      x0: 0,
      y0: 0,
      x1: 1080,
      y1: 1920,
    });
    expect(containBox(1080, 1920, 1920, 1080)).toEqual({
      x0: 0,
      y0: 656.25,
      x1: 1080,
      y1: 1263.75,
    });
  });

  it("没有素材宽高时退回整幅画布", () => {
    expect(containBox(1080, 1920)).toEqual({ x0: 0, y0: 0, x1: 1080, y1: 1920 });
    expect(containBox(1080, 1920, 0, 0)).toEqual({ x0: 0, y0: 0, x1: 1080, y1: 1920 });
  });
});

describe("四角小窗位置", () => {
  it("竖屏素材：1/3 画面宽，落在安全区里侧，四角不越界", () => {
    expect(cornerPlacement("top-left", canvas)).toEqual({ scale: 0.333, x: 262, y: 522 });
    expect(cornerPlacement("top-right", canvas)).toEqual({ scale: 0.333, x: 708, y: 522 });
    expect(cornerPlacement("bottom-left", canvas)).toEqual({ scale: 0.333, x: 262, y: 1138 });
    expect(cornerPlacement("bottom-right", canvas)).toEqual({ scale: 0.333, x: 708, y: 1138 });
  });

  it("横屏素材：按 contain 后的 360×202 内容框贴角", () => {
    expect(cornerPlacement("top-left", canvas, 1920, 1080)).toEqual({
      scale: 0.333,
      x: 262,
      y: 303,
    });
    expect(cornerPlacement("top-right", canvas, 1920, 1080)).toEqual({
      scale: 0.333,
      x: 708,
      y: 303,
    });
    expect(cornerPlacement("bottom-left", canvas, 1920, 1080)).toEqual({
      scale: 0.333,
      x: 262,
      y: 1357,
    });
    expect(cornerPlacement("bottom-right", canvas, 1920, 1080)).toEqual({
      scale: 0.333,
      x: 708,
      y: 1357,
    });
  });

  it("没有素材尺寸时和竖屏退回一致", () => {
    expect(cornerPlacement("top-left", canvas, undefined, undefined)).toEqual({
      scale: 0.333,
      x: 262,
      y: 522,
    });
  });
});

describe("拖角等比缩放", () => {
  const box = { x0: 360, y0: 640, x1: 720, y1: 1280 };
  const base = { box, scale: 0.333 };

  it("对角固定，中心和缩放一起变", () => {
    const r = resizeFromCorner({
      ...base,
      corner: "bottom-right",
      pointer: { x: 800, y: 1500 },
    });
    expect(r).toEqual({ scale: 0.438, x: 597, y: 1061 });
    // 换成新的 scale 和中心后，左上角仍然在 (360, 640)
    const w = canvas.width * 0.438;
    const h = canvas.height * 0.438;
    expect(Math.abs(597 - w / 2 - 360)).toBeLessThan(1);
    expect(Math.abs(1061 - h / 2 - 640)).toBeLessThan(1);
  });

  it("拖过对角只缩到最小，不翻转；拖得再远也不超过上限", () => {
    expect(
      resizeFromCorner({ ...base, corner: "bottom-right", pointer: { x: 360, y: 640 } }),
    ).toMatchObject({ scale: 0.02 });
    expect(
      resizeFromCorner({ ...base, corner: "bottom-right", pointer: { x: 100_000, y: 100_000 } }),
    ).toMatchObject({ scale: 20 });
  });
});

describe("素材放到画面上", () => {
  it("没有非主轨时先建轨道；视频整段、默认右上角小窗", () => {
    const project = videoProject();
    const plan = placeAsset(project, "v1", 1200);
    expect(plan.itemId).toBe("pip1");
    expect(plan.trackId).toBe("pip");
    expect(plan.ops.map((o) => o.op)).toEqual(["track.add", "item.add"]);

    const next = applyOps(project, plan.ops).project;
    const track = next.tracks.find((t) => t.id === "pip");
    expect(track?.kind).toBe("video");
    const item = track?.items[0];
    expect(item).toMatchObject({
      id: "pip1",
      type: "clip",
      asset: "v1",
      at: { ms: 1200 },
      inMs: 0,
      outMs: 5000,
      gainDb: -60,
      transform: cornerPlacement("top-right", canvas, 1080, 1920),
    });
  });

  it("横屏视频按内容框放到右上角", () => {
    const project = videoProject();
    const next = applyOps(project, placeAsset(project, "v2", 0).ops).project;
    const item = next.tracks.find((t) => t.id === "pip")?.items[0];
    expect(item).toMatchObject({
      asset: "v2",
      gainDb: -60,
      transform: { scale: 0.333, x: 708, y: 303 },
    });
  });

  it("已有轨道时不再建轨；图片默认 3 秒；id 不重复", () => {
    const project = videoProject();
    const first = applyOps(project, placeAsset(project, "v1", 0).ops).project;
    const plan = placeAsset(first, "i1", 1500);
    expect(plan.itemId).toBe("img1");
    expect(plan.ops.map((o) => o.op)).toEqual(["item.add"]);

    const next = applyOps(first, plan.ops).project;
    const track = next.tracks.find((t) => t.kind === "video" && !t.main);
    expect(track?.items.map((i) => i.id)).toEqual(["pip1", "img1"]);
    expect(track?.items[1]).toMatchObject({ type: "image", durationMs: 3000, at: { ms: 1500 } });

    expect(placeAsset(next, "v1", 0).itemId).toBe("pip2");
  });

  it("优先用没锁的轨道；音频不能放到画面上", () => {
    const project = videoProject();
    project.tracks.push(
      ...Project.parse({
        version: 5,
        revision: 0,
        canvas: {},
        tracks: [
          { id: "locked", kind: "video", locked: true, items: [] },
          { id: "free", kind: "video", items: [] },
        ],
      }).tracks,
    );
    // locked 排在前面，但应该跳过它
    expect(placeAsset(project, "v1", 0).trackId).toBe("free");
    expect(() => placeAsset(project, "a1", 0)).toThrowError(MwError);
  });
});
