// @vitest-environment happy-dom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { FontWarning } from "../../../core/api";
import { FONT_FAMILIES } from "../../../core/fonts";
import { applyOps } from "../../../core/ops";
import { BUILTIN_STYLES } from "../../../core/presets";
import { Project } from "../../../core/schema";
import { PROJECT_FORMAT_VERSION } from "../../../core/version";
import { findItem } from "../../lib/project";
import { useStore } from "../../store";
import { FontWarningDialog, FontWarningModal } from "../font-warning-modal";
import {
  affectedFontLine,
  dismissFontWarningPatch,
  FONT_LICENSE_NOTE,
  type FontCatalogEntry,
  fontCanExport,
  fontChoices,
  fontFallbackStyle,
  fontPickerLine,
  fontReplacementOps,
  licenseStatusLabel,
} from "./font-choice";
import { TextStyleEditor } from "./text-style-editor";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function mount(node: ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(node);
  });
}

async function unmount() {
  if (root) {
    await act(async () => {
      root?.unmount();
    });
  }
  host?.remove();
  root = null;
  host = null;
  useStore.setState({
    project: null,
    projectId: null,
    dir: null,
    name: "",
    editor: null,
    fontWarnings: [],
    fontCatalog: [],
  });
}

afterEach(unmount);

const project = () =>
  Project.parse({
    version: PROJECT_FORMAT_VERSION,
    revision: 1,
    canvas: {},
    assets: { a1: { kind: "video", path: "/raw.mov", probe: { durationMs: 8000 } } },
    styles: {
      cap: BUILTIN_STYLES["caption-word-yellow"],
      title: BUILTIN_STYLES["title-bar-yellow"],
    },
    tracks: [
      {
        id: "main",
        kind: "video",
        main: true,
        items: [{ id: "c1", type: "clip", asset: "a1", inMs: 0, outMs: 8000 }],
      },
      {
        id: "captions",
        kind: "caption",
        style: "cap",
        items: [
          { id: "s1", asset: "a1", startMs: 0, endMs: 1000, text: "第一句" },
          { id: "s2", asset: "a1", startMs: 1000, endMs: 2000, text: "第二句" },
        ],
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
            props: { text: "金句", source: "出处" },
          },
        ],
      },
    ],
  });

const missingFontWarning = (): FontWarning => ({
  code: "FONT_MISSING",
  requested: "PingFang SC",
  actual: "Noto Sans SC",
  weight: 400,
  source: "missing",
  elements: ["s1", "o1"],
  message: "找不到 PingFang SC",
  license: { status: "未知", source: "docs/font-licenses.md" },
});

async function showProjectWarning(projectId: string) {
  await act(async () => {
    useStore.setState({
      project: project(),
      projectId,
      name: projectId,
      dir: `/projects/${projectId}`,
      editor: null,
      fontWarnings: [missingFontWarning()],
      fontCatalog: [],
    });
  });
}

async function clickLater() {
  const button = [...(host?.querySelectorAll("button") ?? [])].find(
    (entry) => entry.textContent?.trim() === "稍后处理",
  );
  if (!button) throw new Error("找不到稍后处理按钮");
  await act(async () => {
    button.click();
  });
}

describe("字体授权和替换", () => {
  it("授权只保留四档，其余写成未知", () => {
    expect(licenseStatusLabel("已确认")).toBe("已确认");
    expect(licenseStatusLabel("需付费")).toBe("需付费");
    expect(licenseStatusLabel("未登记")).toBe("未登记");
    expect(licenseStatusLabel("未知")).toBe("未知");
    expect(licenseStatusLabel("商用")).toBe("未知");
    expect(licenseStatusLabel(undefined)).toBe("未知");
  });

  it("选择器行带上来源、字重、能否导出和授权", () => {
    expect(
      fontPickerLine({
        source: "project",
        weights: [700, 400, 400],
        available: true,
        exportable: true,
        status: "已确认",
      }),
    ).toBe("项目字体 · 字重 400/700 · 可导出 · 已确认");
    expect(
      fontPickerLine({
        source: "system",
        weights: [400],
        available: false,
        exportable: true,
        status: "未登记",
      }),
    ).toBe("系统字体 · 字重 400 · 只能回退 · 未登记");
    expect(
      fontPickerLine({
        source: "system",
        weights: [],
        available: true,
        exportable: false,
        status: "需付费",
      }),
    ).toBe("系统字体 · 字重 未知 · 不能导出 · 需付费");
    expect(fontCanExport([{ available: false, exportable: true }])).toBe(false);
    expect(
      fontCanExport([
        { available: true, exportable: false },
        { available: true, exportable: true },
      ]),
    ).toBe(true);
  });

  it("不再提醒只生成 editor.json 补丁", () => {
    const patch = dismissFontWarningPatch(["kept"], "FONT_MISSING|PingFang SC|");
    expect(Object.keys(patch)).toEqual(["fontWarningsDismissed"]);
    expect(patch).toEqual({
      fontWarningsDismissed: ["kept", "FONT_MISSING|PingFang SC|"],
    });
    expect("op" in patch).toBe(false);
    expect(JSON.stringify(patch)).not.toContain("style.update");
    expect(
      dismissFontWarningPatch(patch.fontWarningsDismissed, "FONT_MISSING|PingFang SC|"),
    ).toEqual(patch);
  });

  it("替换当前元素和共享样式都走样式 op，不写 editor.json", () => {
    const before = project();
    const itemOps = fontReplacementOps(
      before,
      ["s1", "s2", "o1"],
      "noto-sans-sc",
      "item",
      fontFallbackStyle,
    );
    expect(itemOps.ops.some((op) => op.op === "style.update")).toBe(true);
    expect(JSON.stringify(itemOps.ops)).not.toContain("fontWarningsDismissed");
    const itemNext = applyOps(before, itemOps.ops).project;
    const captions = itemNext.tracks.find((track) => track.kind === "caption");
    if (captions?.kind !== "caption") throw new Error("字幕轨道缺失");
    for (const id of ["s1", "s2"] as const) {
      const captionItem = captions.items.find((entry) => entry.id === id);
      if (!captionItem?.style) throw new Error(`${id} 没有专属样式`);
      expect(itemNext.styles[captionItem.style]?.font.family).toBe("noto-sans-sc");
      expect(itemNext.styles[captionItem.style]?.font.size).toBe(before.styles.cap?.font.size);
    }
    expect(itemNext.styles.cap?.font.family).toBe(before.styles.cap?.font.family);
    const titles = itemNext.tracks.find((track) => track.kind === "overlay");
    const title = titles?.items.find((entry) => entry.id === "o1");
    if (!title || !("style" in title) || !title.style || !("props" in title)) {
      throw new Error("标题缺失");
    }
    expect(itemNext.styles[title.style]?.font.family).toBe("noto-sans-sc");
    expect(itemNext.styles[title.style]?.font.size).toBe(before.styles.title?.font.size);
    const beforeTitle = before.tracks.find((track) => track.kind === "overlay")?.items[0];
    if (!beforeTitle || !("props" in beforeTitle)) throw new Error("原标题缺失");
    expect(title.props).toEqual(beforeTitle.props);

    const shared = fontReplacementOps(
      before,
      ["s1", "o1"],
      "noto-sans-sc",
      "shared",
      fontFallbackStyle,
    );
    expect(shared.ops).toEqual([
      { op: "style.update", id: "cap", set: { font: { family: "noto-sans-sc" } } },
    ]);
    const sharedNext = applyOps(before, shared.ops).project;
    expect(sharedNext.styles.cap?.font.family).toBe("noto-sans-sc");
    expect(sharedNext.styles.cap?.font.size).toBe(before.styles.cap?.font.size);
    expect(sharedNext.styles.title?.font.family).toBe(before.styles.title?.font.family);
    expect(JSON.stringify(shared.ops)).not.toContain("fontWarningsDismissed");
  });

  it("规划到不存在的元素时抛出，原来的工程不变", () => {
    const before = project();
    const snapshot = structuredClone(before);
    expect(() =>
      fontReplacementOps(before, ["s1", "missing"], "noto-sans-sc", "item", fontFallbackStyle),
    ).toThrow();
    expect(before).toEqual(snapshot);
  });

  it("弹窗写出字体、受影响字幕和标题模板、实际回退，以及三个动作", () => {
    const current = project();
    const warning = missingFontWarning();
    const html = renderToStaticMarkup(
      <FontWarningDialog
        project={current}
        warning={warning}
        catalog={[]}
        dismissed={[]}
        onIgnore={() => undefined}
        onUpdateEditor={() => undefined}
        onSubmit={async () => true}
      />,
    );
    const caption = affectedFontLine(current, "s1");
    const title = affectedFontLine(current, "o1");
    expect(caption).toBe("字幕 第一句");
    expect(title).toBe("标题 / 卡片 金句 · 模板 quote");
    expect(html).toContain("字体「PingFang SC」");
    expect(html).toContain("Noto Sans SC");
    expect(html).toContain(caption);
    expect(html).toContain(title);
    expect(html).toContain(FONT_LICENSE_NOTE);
    expect(html).toContain("替换");
    expect(html).toContain("继续回退");
    expect(html).toContain("稍后处理");
    expect(html).not.toContain("继续使用回退");
    expect(html).not.toContain("替换字体");
    expect(html).not.toContain("非法律意见");
  });

  it("替换列表只显示预览可用且可导出的字体", () => {
    const catalog: FontCatalogEntry[] = [
      {
        id: "preview-only",
        family: "Preview Only",
        source: "system",
        available: true,
        exportable: false,
        weight: 400,
        license: { status: "已确认" },
      },
      {
        id: "not-installed",
        family: "Not Installed",
        source: "system",
        available: false,
        exportable: true,
        weight: 400,
        license: { status: "已确认" },
      },
      {
        id: "noto-400",
        family: "Noto Sans SC",
        source: "system",
        available: true,
        exportable: false,
        weight: 400,
        license: { status: "已确认" },
      },
      {
        id: "noto-700",
        family: "Noto Sans SC",
        source: "system",
        available: true,
        exportable: true,
        weight: 700,
        license: { status: "已确认" },
      },
    ];
    const html = renderToStaticMarkup(
      <FontWarningDialog
        project={project()}
        warning={missingFontWarning()}
        catalog={catalog}
        dismissed={[]}
        onIgnore={() => undefined}
        onUpdateEditor={() => undefined}
        onSubmit={async () => true}
      />,
    );

    expect(html).toContain("仅显示预览可用且可导出的字体");
    expect(html).toContain("选择可导出字体");
    expect(html).not.toContain("Preview Only");
    expect(html).not.toContain("Not Installed");
    expect(html).toContain("Noto Sans SC · 可导出 · 已确认");
  });

  it("稍后处理同一字体 warning 时只忽略当前工程", async () => {
    await showProjectWarning("project-a");
    await mount(<FontWarningModal />);
    expect(host?.querySelector('[role="dialog"]')).not.toBeNull();

    await clickLater();
    expect(host?.querySelector('[role="dialog"]')).toBeNull();

    await showProjectWarning("project-b");
    expect(host?.querySelector('[role="dialog"]')).not.toBeNull();

    await clickLater();
    expect(host?.querySelector('[role="dialog"]')).toBeNull();

    await showProjectWarning("project-a");
    expect(host?.querySelector('[role="dialog"]')).toBeNull();
  });

  it("编辑页字体选择器只显示字体名称", () => {
    const current = project();
    const ref_ = findItem(current, "s1");
    if (!ref_) throw new Error("测试字幕缺失");
    const catalog: FontCatalogEntry[] = [
      {
        id: "alibaba-puhuiti-3",
        family: FONT_FAMILIES["alibaba-puhuiti-3"]!.css,
        weight: 600,
        source: "project",
        available: true,
        exportable: true,
        license: { status: "已确认" },
      },
      {
        id: "songti-sc-400",
        family: "Songti SC",
        weight: 400,
        source: "system",
        available: true,
        exportable: false,
        license: { status: "需付费" },
      },
      {
        id: "songti-sc-700",
        family: "Songti SC",
        weight: 700,
        source: "system",
        available: false,
        exportable: true,
        license: { status: "需付费" },
      },
      {
        id: "weird",
        family: "Weird Face",
        weight: 400,
        source: "system",
        available: true,
        exportable: true,
        license: { status: "商用" },
      },
    ];
    const choices = fontChoices(FONT_FAMILIES, catalog, {
      family: "alibaba-puhuiti-3",
      weight: 600,
    });
    const html = renderToStaticMarkup(
      <TextStyleEditor
        project={current}
        id="s1"
        ref_={ref_}
        fallback="caption-word-yellow"
        elementLabel="字幕"
        section="edit"
        catalog={catalog}
      />,
    );
    for (const choice of choices) {
      expect(html).toContain(choice.family);
    }
    expect(html).not.toContain(FONT_LICENSE_NOTE);
    expect(html).not.toContain("项目字体 ·");
    expect(html).not.toContain("系统字体 ·");
    expect(html).not.toContain("字重 600");
    expect(html).not.toContain("只能回退");
  });
});
