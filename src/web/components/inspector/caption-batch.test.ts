import { describe, expect, it } from "vitest";
import { compile } from "../../../core/compile";
import { applyOps } from "../../../core/ops";
import { BUILTIN_STYLES } from "../../../core/presets";
import { Project } from "../../../core/schema";
import { PROJECT_FORMAT_VERSION } from "../../../core/version";
import { frameOfMs, timecode } from "../../lib/timeline";
import {
  allCaptionStyleOps,
  CAPTION_INSPECTOR_TABS,
  captionListEntries,
  captionListTimecode,
  DISABLED_STYLE_CONTROLS,
  underlineEditable,
} from "./caption-batch";

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
        items: [
          { id: "c1", type: "clip", asset: "a1", inMs: 0, outMs: 3000 },
          { id: "c2", type: "clip", asset: "a1", inMs: 5000, outMs: 9000 },
        ],
      },
      {
        id: "captions",
        kind: "caption",
        style: "cap",
        items: [
          { id: "s1", asset: "a1", startMs: 0, endMs: 2000, text: "开场" },
          { id: "s2", asset: "a1", startMs: 6000, endMs: 8000, text: "第一点" },
        ],
      },
      {
        id: "locked-captions",
        kind: "caption",
        locked: true,
        style: "cap",
        items: [{ id: "s3", asset: "a1", startMs: 1000, endMs: 1500, text: "锁定" }],
      },
      {
        id: "titles",
        kind: "overlay",
        items: [{ id: "o1", template: "title-bar", at: { ms: 0 }, durationMs: 1000, props: {} }],
      },
    ],
  });

describe("字幕列表用编译时间", () => {
  it("显示成片起点，而不是源 startMs", () => {
    const current = project();
    const track = current.tracks.find(
      (entry) => entry.kind === "caption" && entry.items.some((item) => item.id === "s2"),
    );
    if (track?.kind !== "caption") throw new Error("源字幕缺失");
    const source = track.items.find((item) => item.id === "s2");
    if (!source) throw new Error("源字幕缺失");
    const timeline = compile(current);
    const rows = captionListEntries(timeline.captions);
    const row = rows.find((entry) => entry.id === "s2");
    if (!row) throw new Error("编译后的字幕缺失");
    expect(captionListTimecode(row, timeline.fps)).toBe(timecode(row.from, timeline.fps));
    expect(row.from).not.toBe(frameOfMs(source.startMs, timeline.fps));
    expect(rows.some((entry) => entry.id === "s2")).toBe(true);
  });

  it("四页名称是字幕、编辑、样式、动效", () => {
    expect(CAPTION_INSPECTOR_TABS.map((tab) => tab.label)).toEqual([
      "字幕",
      "编辑",
      "样式",
      "动效",
    ]);
  });
});

describe("全部字幕", () => {
  it("跳过锁定轨，一次改未锁定的句子，不动共享样式和标题", () => {
    const before = project();
    const fill = "#112233";
    const beforeFill = before.styles.cap?.fill;
    const planned = allCaptionStyleOps(before, { fill }, "caption-word-yellow");
    expect(planned.count).toBe(2);
    expect(planned.skipped).toBe(1);
    const serialized = JSON.stringify(planned.ops);
    expect(serialized.includes("s3")).toBe(false);
    expect(serialized.includes("o1")).toBe(false);

    const after = applyOps(before, planned.ops).project;
    expect(after.styles.cap?.fill).toBe(beforeFill);
    const open = after.tracks.find((track) => track.id === "captions");
    const locked = after.tracks.find((track) => track.id === "locked-captions");
    if (open?.kind !== "caption" || locked?.kind !== "caption") throw new Error("字幕轨缺失");
    for (const item of open.items) {
      expect(item.style).toBeTruthy();
      expect(after.styles[item.style ?? ""]?.fill).toBe(fill);
    }
    expect(locked.items[0]?.style).toBeUndefined();
    expect(locked.style).toBe("cap");
  });

  it("规划失败时不返回半截 ops", () => {
    const broken = project();
    broken.styles = {};
    for (const track of broken.tracks) {
      if (track.kind === "caption") track.style = undefined;
    }
    expect(() => allCaptionStyleOps(broken, { fill: "#112233" }, "missing-style")).toThrow();
  });

  it("没有字段的样式控件保持禁用，下划线只在已有记号时接通", () => {
    expect(DISABLED_STYLE_CONTROLS.map((item) => item.label)).toEqual([
      "整体透明度",
      "斜体",
      "删除线",
      "背景偏移",
      "发光角度",
      "发光范围",
    ]);
    expect(underlineEditable({})).toBe(false);
    expect(underlineEditable({ highlight: { marker: { color: "#fff" } } })).toBe(true);
    expect(underlineEditable({ highlight: { underline: { color: "#fff" } } })).toBe(true);
  });
});
