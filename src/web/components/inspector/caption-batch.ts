import { applyOps, type Op } from "../../../core/ops";
import type { Project } from "../../../core/schema";
import { styleEditOps } from "../../../core/style-scope";
import { timecode } from "../../lib/timeline";

/** 字幕检查器四页。列表页沿用 list，避免和「全部字幕」这个提交范围混名。 */
export const CAPTION_INSPECTOR_TABS = [
  { id: "list", label: "字幕" },
  { id: "edit", label: "编辑" },
  { id: "style", label: "样式" },
  { id: "motion", label: "动效" },
] as const;

export type CaptionInspectorTab = (typeof CAPTION_INSPECTOR_TABS)[number]["id"];

/** 列表只用编译结果。part 0 是一句的第一段，时间用 from，不用源 startMs。 */
export function captionListEntries<T extends { part: number; from: number }>(captions: T[]): T[] {
  return captions.filter((caption) => caption.part === 0).toSorted((a, b) => a.from - b.from);
}

export function captionListTimecode(entry: { from: number }, fps: number): string {
  return timecode(entry.from, fps);
}

export function filterCaptionEntries<T extends { text: string }>(entries: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((entry) => entry.text.toLowerCase().includes(q));
}

/** 全部字幕会碰到的句子。锁定轨只计数，不进入提交。 */
export function captionStyleTargets(project: Project): { count: number; skipped: number } {
  let count = 0;
  let skipped = 0;
  for (const track of project.tracks) {
    if (track.kind !== "caption") continue;
    for (const _item of track.items) {
      if (track.locked) skipped += 1;
      else count += 1;
    }
  }
  return { count, skipped };
}

/**
 * 把同一份样式补丁套到未锁定的字幕上。每句走 styleEditOps 的 item，不是 shared。
 * 规划中途失败就抛出，调用方不得提交已经拼到一半的 ops。
 */
export function allCaptionStyleOps(
  project: Project,
  patch: Record<string, unknown>,
  fallback: string,
): { ops: Op[]; count: number; skipped: number } {
  const ids: string[] = [];
  let skipped = 0;
  for (const track of project.tracks) {
    if (track.kind !== "caption") continue;
    for (const item of track.items) {
      if (track.locked) skipped += 1;
      else ids.push(item.id);
    }
  }
  let rolling = project;
  const ops: Op[] = [];
  for (const id of ids) {
    const planned = styleEditOps(rolling, id, patch, "item", fallback);
    ops.push(...planned.ops);
    rolling = applyOps(rolling, planned.ops).project;
  }
  return { ops, count: ids.length, skipped };
}

/** 样式页上没有字段的控件。只展示，不产生 patch。 */
export const DISABLED_STYLE_CONTROLS = [
  { id: "opacity", label: "整体透明度", reason: "未支持" },
  { id: "italic", label: "斜体", reason: "未支持" },
  { id: "strike", label: "删除线", reason: "未支持" },
  { id: "box-offset", label: "背景偏移", reason: "未支持" },
  { id: "glow-angle", label: "发光角度", reason: "未支持" },
  { id: "glow-spread", label: "发光范围", reason: "未支持" },
] as const;

/** 高亮里已经有下划线或记号时，下划线才接通。否则不要写入。 */
export function underlineEditable(style: {
  highlight?: { underline?: unknown; marker?: unknown } | null;
}): boolean {
  return Boolean(style.highlight?.underline || style.highlight?.marker);
}
