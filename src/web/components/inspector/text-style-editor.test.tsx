import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { applyOps } from "../../../core/ops";
import { BUILTIN_STYLES } from "../../../core/presets";
import { Project } from "../../../core/schema";
import { styleEditOps } from "../../../core/style-scope";
import { PROJECT_FORMAT_VERSION } from "../../../core/version";
import { findItem } from "../../lib/project";
import {
  animationOptionsFor,
  CAPTION_ANIMATION_PRESETS,
  TextStyleEditor,
} from "./text-style-editor";

const project = () =>
  Project.parse({
    version: PROJECT_FORMAT_VERSION,
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
      {
        id: "titles",
        kind: "overlay",
        items: [{ id: "o1", template: "title-bar", at: { ms: 0 }, durationMs: 3000, props: {} }],
      },
    ],
  });

describe("字幕动画快捷选项", () => {
  it("写入三个规定的完整动画参数", () => {
    expect(CAPTION_ANIMATION_PRESETS.map(({ label, animation }) => ({ label, animation }))).toEqual(
      [
        {
          label: "默认模板逐词短淡入",
          animation: {
            in: { preset: "fade", durationMs: 300, easing: "ease-out" },
            unit: "word",
            stagger: { fraction: 0.75 },
            inSlot: 0.6,
          },
        },
        {
          label: "跟随语音",
          animation: {
            in: { preset: "fade", durationMs: 220, easing: "ease-out" },
            unit: "word",
            stagger: "spread",
            inSlot: 0.8,
          },
        },
        {
          label: "整行淡入",
          animation: {
            in: { preset: "fade", durationMs: 200, easing: "ease-out" },
            unit: "line",
            stagger: "spread",
            inSlot: null,
          },
        },
      ],
    );
    expect(CAPTION_ANIMATION_PRESETS[1]?.note).toContain("charStartMs");
    expect(CAPTION_ANIMATION_PRESETS[1]?.note).toContain("按句长平均");
  });

  it("编辑器不再提供 color-sweep，新建旧值仍会显示为选中且停用", () => {
    const current = project();
    const legacyStyle = current.styles.cap!;
    current.styles.cap = {
      ...legacyStyle,
      animation: {
        ...legacyStyle.animation,
        in: { preset: "color-sweep", durationMs: 300, easing: "ease-out" },
      },
    };
    const ref_ = findItem(current, "s1");
    if (!ref_) throw new Error("测试字幕缺失");
    const html = renderToStaticMarkup(
      <TextStyleEditor
        project={current}
        id="s1"
        ref_={ref_}
        fallback="caption-word-yellow"
        elementLabel="字幕"
      />,
    );
    const legacyOption = html.match(/<option\b[^>]*>颜色扫过（旧值，已停用）<\/option>/)?.[0];

    expect(legacyOption).toBeDefined();
    expect(legacyOption).toContain('value="color-sweep"');
    expect(legacyOption).toContain('disabled=""');
    expect(legacyOption).toContain('selected=""');
    expect(html).toContain("默认模板字幕");
    expect(html).toContain("默认模板逐词短淡入");
    expect(html).toContain("默认模板样式");
    expect(html).toContain("跟随语音");
    expect(html).toContain("整行淡入");
    expect(html).toContain("不会更改字体、颜色、位置或高亮");
  });

  it("标题预设使用默认模板名称", () => {
    const current = project();
    const ref_ = findItem(current, "o1");
    if (!ref_) throw new Error("测试标题缺失");
    const html = renderToStaticMarkup(
      <TextStyleEditor
        project={current}
        id="o1"
        ref_={ref_}
        fallback="title-bar-yellow"
        elementLabel="标题"
      />,
    );

    expect(html).toContain("默认模板标题");
    expect(html).not.toContain("1029 标题");
  });

  it("逐项套用时仅更改 animation，保留其余字段和当前 / 共用范围规则", () => {
    for (const preset of CAPTION_ANIMATION_PRESETS) {
      for (const scope of ["item", "shared"] as const) {
        const before = project();
        const original = before.styles.cap!;
        const edit = styleEditOps(
          before,
          "s1",
          { animation: preset.animation },
          scope,
          "caption-word-yellow",
        );
        const after = applyOps(before, edit.ops).project;
        const changed = after.styles[edit.styleId]!;
        const captionTrack = after.tracks.find((track) => track.kind === "caption");
        expect(captionTrack?.kind).toBe("caption");
        if (!captionTrack || captionTrack.kind !== "caption") throw new Error("字幕轨道缺失");

        expect(changed.animation).toEqual({ ...original.animation, ...preset.animation });
        expect(changed.font).toEqual(original.font);
        expect(changed.fill).toBe(original.fill);
        expect(changed.layout).toEqual(original.layout);
        expect(changed.highlight).toEqual(original.highlight);

        if (scope === "item") {
          expect(edit.styleId).toBe("cap-s1");
          expect(after.styles.cap).toEqual(original);
          expect(captionTrack.items[0]).toMatchObject({ style: "cap-s1" });
          expect(captionTrack.items[1]).not.toHaveProperty("style");
        } else {
          expect(edit.styleId).toBe("cap");
          expect(captionTrack.style).toBe("cap");
        }
      }
    }
  });

  it("不再提供 color-sweep 新选项，但已有值仍显示为停用项", () => {
    expect(animationOptionsFor(null).some((option) => option.value === "color-sweep")).toBe(false);
    expect(animationOptionsFor("color-sweep")).toContainEqual({
      value: "color-sweep",
      label: "颜色扫过（旧值，已停用）",
      disabled: true,
    });
  });
});
