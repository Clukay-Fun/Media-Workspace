import { describe, expect, it } from "vitest";
import { compile } from "../../core/compile";
import { BUILTIN_STYLES } from "../../core/presets";
import { Project } from "../../core/schema";
import { hitBoxes, pick, transformBox } from "./geometry";
import { containBox } from "./pip";

const project = (overlayTransform?: object) =>
  Project.parse({
    version: 6,
    revision: 0,
    canvas: {},
    assets: { a1: { kind: "video", path: "/raw.mov", probe: { durationMs: 10_000 } } },
    styles: BUILTIN_STYLES,
    tracks: [
      {
        id: "main",
        kind: "video",
        main: true,
        items: [{ id: "c1", type: "clip", asset: "a1", inMs: 0, outMs: 10_000 }],
      },
      {
        id: "cap",
        kind: "caption",
        items: [{ id: "s1", asset: "a1", startMs: 1000, endMs: 3000, text: "一句话" }],
      },
      {
        id: "ov",
        kind: "overlay",
        items: [
          {
            id: "o1",
            template: "title-bar",
            at: { ms: 0 },
            durationMs: "toEnd",
            props: { lines: ["标题"] },
            ...(overlayTransform ? { transform: overlayTransform } : {}),
          },
        ],
      },
    ],
  });

describe("预览画面点选", () => {
  it("当前帧可见的元素，上层的在前；点空白处选中主轨画面", () => {
    const tl = compile(project());
    const at = (f: number) => hitBoxes(tl, BUILTIN_STYLES, f).map((h) => h.id);
    expect(at(0)).toEqual(["o1", "c1"]);
    // 标题轨排在字幕轨后面，渲染时在上层
    expect(at(45)).toEqual(["o1", "s1", "c1"]);
    const boxes = hitBoxes(tl, BUILTIN_STYLES, 45);
    // 字幕在 y≈1165，标题条在 96–355
    expect(pick(boxes, 540, 1165)?.id).toBe("s1");
    expect(pick(boxes, 540, 200)?.id).toBe("o1");
    expect(pick(boxes, 540, 1700)?.id).toBe("c1");
  });

  it("叠加层的位置按 transform 换算（和合成组件一致）", () => {
    const moved = hitBoxes(compile(project({ y: 1060 })), BUILTIN_STYLES, 0).find(
      (h) => h.id === "o1",
    );
    // 往下移 100px
    expect(moved?.box.y0).toBeCloseTo(96 - 7 + 100);
    expect(
      transformBox(
        { x0: 0, y0: 0, x1: 1080, y1: 1920 },
        {
          x: 540,
          y: 960,
          scale: 0.5,
          rotation: 0,
          opacity: 1,
          radius: 0,
        },
        1080,
        1920,
      ),
    ).toEqual({ x0: 270, y0: 480, x1: 810, y1: 1440 });
  });

  it("主轨只标记 main；非主轨视频也能点选，并按 transform 算框", () => {
    const p = Project.parse({
      version: 6,
      revision: 0,
      canvas: {},
      assets: { a1: { kind: "video", path: "/raw.mov", probe: { durationMs: 10_000 } } },
      tracks: [
        {
          id: "main",
          kind: "video",
          main: true,
          items: [{ id: "c1", type: "clip", asset: "a1", inMs: 0, outMs: 10_000 }],
        },
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
              outMs: 10_000,
              transform: { x: 800, y: 500, scale: 0.3 },
            },
          ],
        },
      ],
    });
    const boxes = hitBoxes(compile(p), BUILTIN_STYLES, 0);
    expect(boxes.find((h) => h.id === "c1")?.main).toBe(true);
    expect(boxes.find((h) => h.id === "p1")?.main).toBe(false);
    expect(boxes.find((h) => h.id === "p1")?.box).toEqual(
      transformBox(
        { x0: 0, y0: 0, x1: 1080, y1: 1920 },
        { x: 800, y: 500, scale: 0.3, rotation: 0, opacity: 1, radius: 0 },
        1080,
        1920,
      ),
    );
    expect(pick(boxes, 800, 500)?.id).toBe("p1");
  });

  it("横屏图片和画中画按 contain 后的内容框算，不按整幅画布", () => {
    const p = Project.parse({
      version: 6,
      revision: 0,
      canvas: {},
      assets: {
        img: {
          kind: "image",
          path: "/wide.png",
          probe: { durationMs: 0, width: 1920, height: 1080 },
        },
        vid: {
          kind: "video",
          path: "/wide.mp4",
          probe: { durationMs: 10_000, width: 1920, height: 1080 },
        },
      },
      tracks: [
        {
          id: "main",
          kind: "video",
          main: true,
          items: [{ id: "c1", type: "clip", asset: "vid", inMs: 0, outMs: 10_000 }],
        },
        {
          id: "imgs",
          kind: "video",
          items: [
            {
              id: "img1",
              type: "image",
              asset: "img",
              at: { ms: 0 },
              durationMs: 3000,
              transform: { x: 540, y: 960, scale: 1 },
            },
          ],
        },
        {
          id: "pip",
          kind: "video",
          items: [
            {
              id: "p1",
              type: "clip",
              asset: "vid",
              at: { ms: 0 },
              inMs: 0,
              outMs: 10_000,
              transform: { x: 708, y: 303, scale: 0.333 },
            },
          ],
        },
      ],
    });
    const content = containBox(1080, 1920, 1920, 1080);
    const boxes = hitBoxes(compile(p), BUILTIN_STYLES, 0, p.assets);
    expect(boxes.find((h) => h.id === "img1")?.box).toEqual(
      transformBox(
        content,
        { x: 540, y: 960, scale: 1, rotation: 0, opacity: 1, radius: 0 },
        1080,
        1920,
      ),
    );
    expect(boxes.find((h) => h.id === "p1")?.box).toEqual(
      transformBox(
        content,
        { x: 708, y: 303, scale: 0.333, rotation: 0, opacity: 1, radius: 0 },
        1080,
        1920,
      ),
    );
    // 不传素材尺寸时退回整幅画布，兼容旧调用
    expect(hitBoxes(compile(p), BUILTIN_STYLES, 0).find((h) => h.id === "img1")?.box).toEqual(
      transformBox(
        { x0: 0, y0: 0, x1: 1080, y1: 1920 },
        { x: 540, y: 960, scale: 1, rotation: 0, opacity: 1, radius: 0 },
        1080,
        1920,
      ),
    );
  });
});
