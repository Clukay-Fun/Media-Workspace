import type { FontFamily } from "../../../core/fonts";
import { applyOps, type Op } from "../../../core/ops";
import type { Project } from "../../../core/schema";
import { type StyleScope, styleEditOps } from "../../../core/style-scope";
import { TEMPLATES } from "../../../templates";
import { displayName, findItem, kindLabel } from "../../lib/project";

/** 选择器和缺字体弹窗共用这一句，不能改写。 */
export const FONT_LICENSE_NOTE = "仅供参考，不构成法律意见。";

const FONT_LICENSE_STATUSES = ["已确认", "未知", "需付费", "未登记"] as const;
export type FontLicenseStatus = (typeof FONT_LICENSE_STATUSES)[number];

/** 授权只显示这四档。目录里没有的，或读到别的写法，都算未知。 */
export function licenseStatusLabel(status: string | null | undefined): FontLicenseStatus {
  if (status === "已确认" || status === "需付费" || status === "未登记" || status === "未知") {
    return status;
  }
  return "未知";
}

/** 至少有一个已经可用、并且标记可导出的字重，这一族才能用于导出。 */
export function fontCanExport(
  entries: readonly { available: boolean; exportable: boolean }[],
): boolean {
  return entries.some((entry) => entry.available && entry.exportable);
}

export type FontPickerFacts = {
  source: "project" | "system";
  weights: readonly number[];
  available: boolean;
  exportable: boolean;
  status: string | null | undefined;
};

export type FontCatalogEntry = {
  id: string;
  family: string;
  source: "project" | "system";
  available: boolean;
  exportable: boolean;
  weight: number;
  license: { status?: string | null };
};

export type FontChoice = {
  value: string;
  family: string;
  group: string;
  source: "project" | "system";
  available: boolean;
  exportable: boolean;
  status: FontLicenseStatus;
  weights: number[];
};

/** 项目字体在前，系统字体按家族并成一行。当前字体不在目录里时补一行，标成只能回退。 */
export function fontChoices(
  families: Record<string, Pick<FontFamily, "css" | "group" | "faces">>,
  catalog: readonly FontCatalogEntry[],
  current?: { family: string; weight: number },
): FontChoice[] {
  const fonts: FontChoice[] = Object.entries(families).map(([fontId, font]) => {
    const entries = catalog.filter((entry) => entry.id === fontId);
    return {
      value: fontId,
      family: font.css,
      group: font.group,
      source: "project",
      available: entries.some((entry) => entry.available),
      exportable: fontCanExport(entries),
      status: licenseStatusLabel(entries[0]?.license.status ?? "未登记"),
      weights: Object.keys(font.faces).map(Number),
    };
  });
  const seen = new Set<string>();
  for (const entry of catalog) {
    if (entry.source !== "system" || seen.has(entry.family)) continue;
    seen.add(entry.family);
    const familyEntries = catalog.filter(
      (candidate) => candidate.source === "system" && candidate.family === entry.family,
    );
    fonts.push({
      value: entry.family,
      family: entry.family,
      group: "本机系统字体",
      source: "system",
      available: familyEntries.some((candidate) => candidate.available),
      exportable: fontCanExport(familyEntries),
      status: licenseStatusLabel(entry.license.status),
      weights: familyEntries.map((candidate) => candidate.weight),
    });
  }
  if (current?.family && !fonts.some((font) => font.value === current.family)) {
    fonts.push({
      value: current.family,
      family: current.family,
      group: "当前工程字体",
      source: "system",
      available: false,
      exportable: false,
      status: "未知",
      weights: [current.weight],
    });
  }
  return fonts;
}

/** 字体行：来源、字重、能否导出、授权。不可用时写只能回退，不把授权写成第五档。 */
export function fontPickerLine(font: FontPickerFacts): string {
  const source = font.source === "project" ? "项目字体" : "系统字体";
  const weights = [...new Set(font.weights.filter((weight) => Number.isFinite(weight)))].sort(
    (a, b) => a - b,
  );
  const weight = weights.length > 0 ? `字重 ${weights.join("/")}` : "字重 未知";
  const usable = !font.available ? "只能回退" : font.exportable ? "可导出" : "不能导出";
  return `${source} · ${weight} · ${usable} · ${licenseStatusLabel(font.status)}`;
}

/** 弹窗里的一行：字幕或标题，标题带上模板名。 */
export function affectedFontLine(project: Project, id: string): string | null {
  const ref = findItem(project, id);
  if (!ref) return null;
  const name = displayName(project, ref);
  if (ref.track.kind === "caption") return `字幕 ${name}`;
  if (ref.track.kind === "overlay" && "template" in ref.item) {
    return `标题 / 卡片 ${name} · 模板 ${ref.item.template}`;
  }
  return `${kindLabel(ref)} ${name}`;
}

/** 和样式编辑器一样：字幕用内置字幕样式，标题用该模板的默认样式。 */
export function fontFallbackStyle(project: Project, id: string): string {
  const ref = findItem(project, id);
  if (!ref || ref.track.kind === "caption") return "caption-word-yellow";
  return "template" in ref.item
    ? (TEMPLATES[ref.item.template]?.meta.defaultStyle ?? "title-bar-yellow")
    : "title-bar-yellow";
}

/**
 * 「不再提醒」只进 editor.json。返回值不是工程 op。
 */
export function dismissFontWarningPatch(
  dismissed: readonly string[],
  key: string,
): { fontWarningsDismissed: string[] } {
  return { fontWarningsDismissed: [...new Set([...dismissed, key])] };
}

/** 「稍后处理」是会话内状态，必须按工程隔离。 */
export function projectScopedFontWarningKey(projectId: string, key: string): string {
  return JSON.stringify([projectId, key]);
}

/**
 * 把字体族写成样式补丁。item 逐个走 styleEditOps，并用 applyOps 滚动，避免后一项还看见旧样式。
 * shared 只改第一项正在用的共享样式。规划失败就抛出，调用方不能提交半截 ops。
 * 这里不写 fontWarningsDismissed。
 */
export function fontReplacementOps(
  project: Project,
  ids: readonly string[],
  family: string,
  scope: StyleScope,
  fallbackFor: (project: Project, id: string) => string,
): { ops: Op[] } {
  if (!family || ids.length === 0) return { ops: [] };
  const patch = { font: { family } };
  if (scope === "shared") {
    const id = ids[0];
    if (!id) return { ops: [] };
    return { ops: styleEditOps(project, id, patch, "shared", fallbackFor(project, id)).ops };
  }
  let rolling = project;
  const ops: Op[] = [];
  for (const id of ids) {
    const planned = styleEditOps(rolling, id, patch, "item", fallbackFor(rolling, id));
    ops.push(...planned.ops);
    rolling = applyOps(rolling, planned.ops).project;
  }
  return { ops };
}
