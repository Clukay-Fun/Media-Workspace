// @vitest-environment happy-dom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { OpsRequest } from "../../../core/api";
import { BUILTIN_STYLES } from "../../../core/presets";
import type { Project } from "../../../core/schema";
import { Project as ProjectSchema } from "../../../core/schema";
import { PROJECT_FORMAT_VERSION } from "../../../core/version";
import { httpApi } from "../../data/client";
import { findItem } from "../../lib/project";
import { useStore } from "../../store";
import { CaptionInspector } from "./caption";
import { OverlayInspector } from "./overlay";

const calls: OpsRequest[] = [];
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function captionProject() {
  return ProjectSchema.parse({
    version: PROJECT_FORMAT_VERSION,
    revision: 2,
    canvas: {},
    assets: { a1: { kind: "video", path: "/raw.mov", probe: { durationMs: 8000 } } },
    styles: { cap: BUILTIN_STYLES["caption-word-yellow"] },
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
          {
            id: "s1",
            asset: "a1",
            startMs: 0,
            endMs: 2000,
            text: "原来的字幕",
            charStartMs: [0, 120, 240, 360, 480],
          },
        ],
      },
    ],
  });
}

function cardProject() {
  return ProjectSchema.parse({
    version: PROJECT_FORMAT_VERSION,
    revision: 3,
    canvas: {},
    assets: {},
    styles: { title: BUILTIN_STYLES["title-bar-yellow"] },
    tracks: [
      {
        id: "titles",
        kind: "overlay",
        items: [
          {
            id: "card1",
            template: "text-card",
            style: "title",
            size: "small",
            at: { ms: 0 },
            durationMs: 1000,
            props: { title: "卡片标题", body: "验收正文" },
          },
        ],
      },
    ],
  });
}

function install(project: Project) {
  calls.length = 0;
  useStore.setState({
    project,
    projectId: null,
    captionTab: "edit",
    api: {
      ...useStore.getState().api,
      ops: async (req) => {
        calls.push(req);
        return {
          ok: true as const,
          revision: project.revision + 1,
          changed: [],
          warnings: [],
          dryRun: false,
        };
      },
    },
  });
}

async function mount(node: ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(node);
  });
}

async function unmount() {
  await act(async () => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
}

async function replaceText(el: HTMLTextAreaElement, value: string) {
  await act(async () => {
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!setter) throw new Error("读不到 textarea 的值");
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pressKey(el: HTMLTextAreaElement, key: string) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

afterEach(async () => {
  await unmount();
  useStore.setState({ project: null, projectId: null, captionTab: "edit", api: httpApi });
});

describe("字幕文字 Escape", () => {
  it("Escape 恢复原文，并且不提交 caption.update", async () => {
    const project = captionProject();
    const ref_ = findItem(project, "s1");
    if (!ref_) throw new Error("字幕缺失");
    install(project);
    await mount(<CaptionInspector project={project} id="s1" ref_={ref_} fps={30} />);
    const textarea = document.querySelector("textarea.caption-text");
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("没有字幕文字框");

    await replaceText(textarea, "改过的字幕");
    expect(textarea.value).toBe("改过的字幕");
    await pressKey(textarea, "Escape");

    expect(textarea.value).toBe("原来的字幕");
    expect(calls).toEqual([]);
  });

  it("失焦会提交当前文字", async () => {
    const project = captionProject();
    const ref_ = findItem(project, "s1");
    if (!ref_) throw new Error("字幕缺失");
    install(project);
    await mount(<CaptionInspector project={project} id="s1" ref_={ref_} fps={30} />);
    const textarea = document.querySelector("textarea.caption-text");
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("没有字幕文字框");

    await replaceText(textarea, "改过的字幕");
    expect(textarea.value).toBe("改过的字幕");
    await pressKey(textarea, "Enter");

    expect(calls).toHaveLength(1);
    const op = calls[0]?.ops[0];
    if (!op || op.op !== "caption.update") throw new Error("没有提交字幕修改");
    expect(op.id).toBe("s1");
    expect(op.set.text).toBe("改过的字幕");
    expect(calls[0]?.baseRevision).toBe(project.revision);
  });
});

describe("标题卡片 Escape", () => {
  it("Escape 恢复标题，并且不提交 item.update", async () => {
    const project = cardProject();
    const ref_ = findItem(project, "card1");
    if (!ref_) throw new Error("卡片缺失");
    install(project);
    await mount(<OverlayInspector project={project} id="card1" ref_={ref_} fps={30} />);
    const textarea = document.querySelector('textarea[aria-label="标题"]');
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("没有标题输入框");

    await replaceText(textarea, "新的标题");
    expect(textarea.value).toBe("新的标题");
    await pressKey(textarea, "Escape");

    expect(textarea.value).toBe("卡片标题");
    expect(calls).toEqual([]);
  });

  it("失焦会提交标题，正文保持不动", async () => {
    const project = cardProject();
    const ref_ = findItem(project, "card1");
    if (!ref_) throw new Error("卡片缺失");
    install(project);
    await mount(<OverlayInspector project={project} id="card1" ref_={ref_} fps={30} />);
    const textarea = document.querySelector('textarea[aria-label="标题"]');
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("没有标题输入框");

    await replaceText(textarea, "新的标题");
    expect(textarea.value).toBe("新的标题");
    await pressKey(textarea, "Enter");

    expect(calls).toHaveLength(1);
    const op = calls[0]?.ops[0];
    if (!op || op.op !== "item.update") throw new Error("没有提交标题修改");
    expect(op.id).toBe("card1");
    expect(op.set.props).toEqual({ title: "新的标题", body: "验收正文" });
    expect(calls[0]?.baseRevision).toBe(project.revision);
  });
});
