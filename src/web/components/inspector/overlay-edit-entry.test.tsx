import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BUILTIN_STYLES } from "../../../core/presets";
import { Project } from "../../../core/schema";
import { PROJECT_FORMAT_VERSION } from "../../../core/version";
import { findItem } from "../../lib/project";
import { OverlayInspector } from "./overlay";

const project = Project.parse({
  version: PROJECT_FORMAT_VERSION,
  revision: 1,
  canvas: {},
  assets: { a1: { kind: "video", path: "/raw.mov", probe: { durationMs: 8000 } } },
  styles: { title: BUILTIN_STYLES["title-bar-yellow"] },
  tracks: [
    {
      id: "main",
      kind: "video",
      main: true,
      items: [{ id: "c1", type: "clip", asset: "a1", inMs: 0, outMs: 8000 }],
    },
    {
      id: "titles",
      kind: "overlay",
      items: [
        {
          id: "o1",
          template: "quote",
          style: "title",
          at: { ms: 0 },
          durationMs: 1000,
          props: { text: "原来的金句", source: "出处" },
        },
        {
          id: "o2",
          template: "text-card",
          style: "title",
          at: { ms: 1000 },
          durationMs: 1000,
          props: { title: "卡片标题", body: "卡片正文" },
        },
      ],
    },
  ],
});

describe("标题和卡片的基础编辑入口", () => {
  for (const [id, content] of [
    ["o1", "金句"],
    ["o2", "正文"],
  ] as const) {
    it(`${id} 的编辑页同时显示内容和基础文字样式控件`, () => {
      const ref_ = findItem(project, id);
      if (!ref_) throw new Error(`找不到 ${id}`);
      const html = renderToStaticMarkup(
        <OverlayInspector project={project} id={id} ref_={ref_} fps={30} />,
      );

      expect(html).toContain(content);
      expect(html).toContain('aria-label="搜索字体"');
      expect(html).toContain("字号");
      expect(html).toContain("填充色");
      expect(html).toContain("位置与排列");
    });
  }
});
