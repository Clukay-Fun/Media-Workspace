import { applyOps, type Op } from "../../../core/ops";
import type { Project } from "../../../core/schema";
import { styleEditOps } from "../../../core/style-scope";
import { TEMPLATES } from "../../../templates";

/** 设计稿上的外观名。有内置样式的只换 TextStyle，没有的保持禁用，不改 overlay.template。 */
export const TITLE_LOOKS = [
  { id: "title-bar-yellow", label: "金黄描边", enabled: true },
  { id: "card-white", label: "简约白字", enabled: true },
  { id: "warm-title", label: "暖色标题", enabled: false },
] as const;

export function titleLookPatch(id: string): { styleId: string } | null {
  const look = TITLE_LOOKS.find((item) => item.id === id);
  if (!look?.enabled) return null;
  return { styleId: look.id };
}

/**
 * 保留原来的 props，只替换一个字段，并用该模板的 schema 校验。
 * 校验失败抛出，不返回半份 props。空字符串表示去掉可选字段。
 */
export function overlayPropPatch(
  template: string,
  props: Record<string, unknown>,
  field: string,
  value: unknown,
): Record<string, unknown> {
  const schema = TEMPLATES[template]?.schema;
  if (!schema) throw new Error(`没有模板「${template}」`);
  const next: Record<string, unknown> = { ...props };
  if (value === "" || value === undefined) delete next[field];
  else next[field] = value;
  const parsed = schema.safeParse(next);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "字段不合法");
  return next;
}

/** 一次 item.update，只写 props。不要把文字写到条目自己的 text 上。 */
export function overlayPropOp(
  id: string,
  template: string,
  props: Record<string, unknown>,
  field: string,
  value: unknown,
): Op {
  return {
    op: "item.update",
    id,
    set: { props: overlayPropPatch(template, props, field, value) },
  };
}

export function titleStyleTargets(project: Project): { count: number; skipped: number } {
  let count = 0;
  let skipped = 0;
  for (const track of project.tracks) {
    if (track.kind !== "overlay") continue;
    for (const _item of track.items) {
      if (track.locked) skipped += 1;
      else count += 1;
    }
  }
  return { count, skipped };
}

/** 全部标题：只收集未锁定的标题 / 卡片，不碰字幕。规划失败则抛出。 */
export function allTitleStyleOps(
  project: Project,
  patch: Record<string, unknown>,
  fallback: string,
): { ops: Op[]; count: number; skipped: number } {
  const ids: string[] = [];
  let skipped = 0;
  for (const track of project.tracks) {
    if (track.kind !== "overlay") continue;
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
