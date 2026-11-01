import { describe, expect, it } from "vitest";
import { Project } from "../../core/schema";
import { PROJECT_FORMAT_VERSION } from "../../core/version";
import { displayName, findItem } from "./project";

const project = Project.parse({
  version: PROJECT_FORMAT_VERSION,
  revision: 0,
  canvas: {},
  assets: { a1: { kind: "video", path: "/素材/原片.mov", probe: { durationMs: 10_000 } } },
  tracks: [
    {
      id: "main",
      kind: "video",
      main: true,
      items: [{ id: "c1", type: "clip", asset: "a1", inMs: 0, outMs: 5000 }],
    },
    {
      id: "cap",
      kind: "caption",
      items: [{ id: "s1", asset: "a1", startMs: 0, endMs: 1000, text: "今天天气真好" }],
    },
    {
      id: "ov",
      kind: "overlay",
      items: [
        { id: "o1", template: "title-bar", at: { ms: 0 }, durationMs: 1000, props: {} },
        {
          id: "o2",
          template: "title-bar",
          at: { ms: 0 },
          durationMs: 1000,
          props: { lines: ["周末", "去哪"] },
        },
      ],
    },
  ],
});

const name = (id: string) => {
  const ref = findItem(project, id);
  if (!ref) throw new Error(id);
  return displayName(project, ref);
};

describe("displayName", () => {
  it("字幕用文字，片段用素材文件名，卡片用文字，没有文字时用模板名", () => {
    expect(name("s1")).toBe("今天天气真好");
    expect(name("c1")).toBe("原片.mov");
    expect(name("o2")).toBe("周末 去哪");
    expect(name("o1")).toBe("title-bar");
  });
});
