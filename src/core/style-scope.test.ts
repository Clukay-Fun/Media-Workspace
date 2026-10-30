import { describe, expect, it } from "vitest";
import { applyOps } from "./ops";
import { BUILTIN_STYLES } from "./presets";
import { Project } from "./schema";
import { styleEditOps } from "./style-scope";

const project = () =>
  Project.parse({
    version: 6,
    revision: 1,
    canvas: {},
    assets: { a1: { kind: "video", path: "/raw.mov", probe: { durationMs: 20_000 } } },
    styles: { cap: BUILTIN_STYLES["caption-word-yellow"] },
    tracks: [
      {
        id: "main",
        kind: "video",
        main: true,
        items: [{ id: "c1", type: "clip", asset: "a1", inMs: 0, outMs: 10_000 }],
      },
      {
        id: "captions",
        kind: "caption",
        style: "cap",
        items: [
          { id: "s1", asset: "a1", startMs: 1000, endMs: 2000, text: "第一句" },
          { id: "s2", asset: "a1", startMs: 2000, endMs: 3000, text: "第二句" },
        ],
      },
    ],
  });

const run = (p: Project, ops: ReturnType<typeof styleEditOps>["ops"]) => applyOps(p, ops).project;
const red = { fill: "#FF0000" };

describe("styleEditOps", () => {
  it("默认只改这一句：第一次复制出专属样式，第二次直接改专属样式", () => {
    const p0 = project();
    const a = styleEditOps(p0, "s1", red, "item", "caption-word-yellow");
    expect(a.styleId).toBe("cap-s1");
    const p1 = run(p0, a.ops);
    expect(p1.styles["cap-s1"]?.fill).toBe("#FF0000");
    expect(p1.styles.cap?.fill).toBe("#FFFFFF");

    const b = styleEditOps(p1, "s1", { fill: "#00FF00" }, "item", "caption-word-yellow");
    expect(b.styleId).toBe("cap-s1");
    expect(b.ops.map((o) => o.op)).toEqual(["style.update"]);
    expect(run(p1, b.ops).styles["cap-s1"]?.fill).toBe("#00FF00");
  });

  it("应用到全部：改共享样式，不新建", () => {
    const r = styleEditOps(project(), "s1", red, "shared", "caption-word-yellow");
    expect(r.styleId).toBe("cap");
    expect(run(project(), r.ops).styles.cap?.fill).toBe("#FF0000");
  });

  it("用的是还没复制进工程的内置样式时，先复制进来", () => {
    const p = project();
    p.tracks[1] = { ...p.tracks[1], style: undefined } as (typeof p.tracks)[number];
    const r = styleEditOps(p, "s2", red, "shared", "caption-word-yellow");
    expect(r.ops.map((o) => o.op)).toEqual(["style.add", "style.update"]);
    expect(run(p, r.ops).styles["caption-word-yellow"]?.fill).toBe("#FF0000");
  });

  it("专属样式重名时加序号", () => {
    const p = project();
    p.styles["cap-s1"] = BUILTIN_STYLES["caption-word-yellow"];
    expect(styleEditOps(p, "s1", red, "item", "x").styleId).toBe("cap-s1-2");
  });
});
