import { describe, expect, it } from "vitest";
import { Project } from "../../core/schema";
import { projectSteps } from "./progress";

const make = (extra: object) =>
  Project.parse({
    version: 4,
    revision: 0,
    canvas: {},
    assets: { a: { kind: "video", path: "/a.mov" } },
    ...extra,
  });

const done = (p: Project, exported = false) =>
  projectSteps(p, exported)
    .filter((s) => s.done)
    .map((s) => s.key);

describe("projectSteps", () => {
  it("空工程一步都没做", () => {
    expect(done(make({}))).toEqual([]);
  });

  it("按工程内容推断：剪过、分了章节，字幕没对齐", () => {
    const p = make({
      tracks: [
        {
          id: "main",
          kind: "video",
          main: true,
          items: [
            { id: "c1", type: "clip", asset: "a", inMs: 0, outMs: 1000 },
            { id: "c2", type: "clip", asset: "a", inMs: 2000, outMs: 3000, cutBefore: "口误" },
          ],
        },
        {
          id: "cap",
          kind: "caption",
          items: [{ id: "s1", asset: "a", startMs: 0, endMs: 900, text: "一句" }],
        },
      ],
      chapters: [{ title: "开场", at: { ms: 0 } }],
    });
    expect(done(p)).toEqual(["import", "cut", "chapters"]);
    expect(projectSteps(p, false)[1]?.detail).toBe("1 句未对齐");
  });
});
