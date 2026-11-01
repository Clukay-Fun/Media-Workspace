import { describe, expect, it } from "vitest";
import { aspectOf, aspectSize, planAspect } from "./aspect";
import { applyOps } from "./ops";
import { BUILTIN_STYLES } from "./presets";
import { type MainClip, Project } from "./schema";
import { PROJECT_FORMAT_VERSION } from "./version";

const project = (
  o: { mainScale?: number; mainCrop?: boolean; mainOffset?: boolean; locked?: boolean } = {},
) =>
  Project.parse({
    version: PROJECT_FORMAT_VERSION,
    revision: 0,
    canvas: {},
    styles: { ...BUILTIN_STYLES },
    assets: {
      wide: {
        kind: "video",
        path: "/素材/横屏.mov",
        probe: { durationMs: 20_000, width: 1920, height: 1080 },
      },
      tall: {
        kind: "video",
        path: "/素材/竖屏.mov",
        probe: { durationMs: 20_000, width: 1080, height: 1920 },
      },
      pic: {
        kind: "image",
        path: "/素材/图.png",
        probe: { durationMs: 0, width: 1200, height: 800 },
      },
    },
    tracks: [
      {
        id: "main",
        kind: "video",
        main: true,
        items: [
          {
            id: "c1",
            type: "clip",
            asset: "wide",
            inMs: 0,
            outMs: 5000,
            ...(o.mainScale && { transform: { scale: o.mainScale } }),
            ...(o.mainCrop && { crop: { x: 0.3418, y: 0, width: 0.3164, height: 1 } }),
          },
          {
            id: "c2",
            type: "clip",
            asset: "tall",
            inMs: 0,
            outMs: 5000,
            ...(o.mainOffset && { transform: { x: 535, y: 964, scale: 1.268 } }),
          },
        ],
      },
      {
        id: "pip",
        kind: "video",
        locked: o.locked ?? false,
        items: [
          {
            id: "i1",
            type: "image",
            asset: "pic",
            at: { ms: 0 },
            durationMs: 3000,
            // 下半部、没贴边
            transform: { scale: 0.35, x: 540, y: 1270 },
          },
          {
            id: "p1",
            type: "clip",
            asset: "tall",
            at: { ms: 0 },
            inMs: 0,
            outMs: 3000,
            // 右上角：宽 324，离右边、上边各 32
            transform: { scale: 0.3, x: 1080 - 32 - 162, y: 32 + 288 },
          },
        ],
      },
      {
        id: "ov",
        kind: "overlay",
        items: [
          {
            id: "o1",
            template: "title-bar",
            at: { ms: 0 },
            durationMs: 1000,
            props: {},
            transform: { x: 540, y: 1165 },
          },
        ],
      },
    ],
  });

const run = (p: Project, target: "9:16" | "16:9") => applyOps(p, planAspect(p, target).ops).project;
const item = (p: Project, id: string) =>
  p.tracks.flatMap((t) => t.items as { id: string }[]).find((i) => i.id === id) as MainClip;

describe("画幅", () => {
  it("认出画幅；换算时短边不变", () => {
    expect(aspectOf({ width: 1080, height: 1920 })).toBe("9:16");
    expect(aspectOf({ width: 1280, height: 720 })).toBe("16:9");
    expect(aspectOf({ width: 1080, height: 1080 })).toBeNull();
    expect(aspectSize("16:9", { width: 1080, height: 1920 })).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(aspectSize("9:16", { width: 1280, height: 720 })).toEqual({ width: 720, height: 1280 });
  });

  it("已经是这个画幅时不出 ops", () => {
    expect(planAspect(project(), "9:16").ops).toEqual([]);
  });

  it("竖屏 → 横屏：字幕到下方、字号不变、可用宽度跟着变宽", () => {
    const p = run(project(), "16:9");
    expect(p.canvas).toMatchObject({ width: 1920, height: 1080 });
    const cap = p.styles["caption-word-yellow"];
    expect(cap?.font.size).toBe(84);
    expect(cap?.layout.x).toBe(960);
    expect(cap?.layout.y).toBeGreaterThan(1080 * 0.78);
    expect(cap?.layout.y).toBeLessThan(1080 * 0.85);
    expect(cap?.layout.maxWidth).toBe(Math.round((859 / 1080) * 1920));
    // 拖过的标题和字幕用同一套换算
    expect(item(p, "o1").transform).toEqual({ x: 960, y: cap?.layout.y });
  });

  it("来回切一次，样式回到原来的位置（误差 1 像素内）", () => {
    const a = project();
    const b = run(run(a, "16:9"), "9:16");
    for (const [id, s] of Object.entries(a.styles)) {
      const t = b.styles[id];
      expect(Math.abs((t?.layout.y ?? 0) - s.layout.y), id).toBeLessThanOrEqual(1);
      expect(t?.font.size, id).toBe(s.font.size);
    }
  });

  it("画中画贴右上角：换完一样大，还贴着右上角", () => {
    const p = run(project(), "16:9");
    const t = item(p, "p1").transform;
    // 竖素材在横画布里 contain 后宽 607.5，要显示 324 宽
    expect(t?.scale).toBeCloseTo(324 / 607.5, 3);
    expect(t?.x).toBe(1920 - 32 - 162);
    expect(t?.y).toBe(32 + 288);
  });

  it("主轨横素材放大铺满竖屏的，横屏下回到整张；竖素材没动过的不出 op", () => {
    const plan = planAspect(project({ mainScale: 3.161 }), "16:9");
    const ups = plan.ops.filter((o) => o.op === "item.update");
    expect(ups.find((o) => "id" in o && o.id === "c2")).toBeUndefined();
    const p = applyOps(project({ mainScale: 3.161 }), plan.ops).project;
    expect(item(p, "c1").transform).toEqual({ scale: 1 });
    // 再切回竖屏：重新铺满
    const back = run(p, "9:16");
    expect(item(back, "c1").transform?.scale).toBeCloseTo(1920 / 607.5, 2);
  });

  it("主轨按画布比例裁过的，换成新比例；正好整张时去掉裁切", () => {
    const p = run(project({ mainCrop: true }), "16:9");
    expect(item(p, "c1").crop).toBeUndefined();
    const back = run(p, "9:16");
    // 横屏下已经没有裁切，回到竖屏是 contain，不会自动再裁
    expect(item(back, "c1").crop).toBeUndefined();
  });

  it("来回切一次，图片、画中画、主轨人像回到原位", () => {
    const a = project({ mainOffset: true });
    const b = run(run(a, "16:9"), "9:16");
    for (const id of ["i1", "p1", "c2"]) {
      const t0 = item(a, id).transform;
      const t1 = item(b, id).transform;
      expect(Math.abs((t1?.x ?? 0) - (t0?.x ?? 0)), id).toBeLessThanOrEqual(1);
      expect(Math.abs((t1?.y ?? 0) - (t0?.y ?? 0)), id).toBeLessThanOrEqual(1);
      expect(t1?.scale, id).toBeCloseTo(t0?.scale ?? 1, 2);
    }
  });

  it("锁定轨道上的元素不动，列在 skipped 里", () => {
    const plan = planAspect(project({ locked: true }), "16:9");
    expect(plan.skipped.map((x) => x.id)).toEqual(["i1", "p1"]);
    expect(() => applyOps(project({ locked: true }), plan.ops)).not.toThrow();
  });
});
