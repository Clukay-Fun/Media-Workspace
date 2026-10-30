import { MwError } from "./errors";
import type { Op } from "./ops";
import { BUILTIN_STYLES } from "./presets";
import type { Project } from "./schema";
import type { TextStyle } from "./text-style";

// 改样式的编辑范围（docs/decisions/0015）：几句字幕常常共用一个样式，
// 默认只改选中的这一句——第一次改时复制出它专属的样式，之后一直改这份；
// 「应用到所有用这个样式的元素」才改共享的样式。界面、CLI、AI 都按这个规则生成 ops。

export type StyleScope = "item" | "shared";

type Patch = Record<string, unknown>;

function locate(project: Project, itemId: string) {
  for (const t of project.tracks) {
    const item = t.items.find((i) => i.id === itemId);
    if (item) {
      const own = "style" in item ? (item.style as string | undefined) : undefined;
      const track = "style" in t ? (t.style as string | undefined) : undefined;
      return { own, track, isCaption: t.kind === "caption" };
    }
  }
  throw new MwError("NOT_FOUND", `元素「${itemId}」不存在`);
}

/** 元素实际在用的样式 ID：自己指定的 → 所在轨道的 → 调用方给的默认（模板 / 内置） */
export function effectiveStyleId(project: Project, itemId: string, fallback: string): string {
  const { own, track } = locate(project, itemId);
  return own ?? track ?? fallback;
}

/** 有多少个地方在用这个样式（轨道默认样式算一处，它覆盖的每个元素不重复算） */
function usages(project: Project, styleId: string): number {
  let n = 0;
  for (const t of project.tracks) {
    if ("style" in t && t.style === styleId) n++;
    for (const i of t.items) if ("style" in i && i.style === styleId) n++;
  }
  return n;
}

/** 专属样式的 ID：<原样式>-<元素 ID>，重名时加序号 */
function ownId(project: Project, base: string, itemId: string): string {
  const stem = `${base}-${itemId}`;
  let id = stem;
  for (let k = 2; project.styles[id]; k++) id = `${stem}-${k}`;
  return id;
}

/**
 * 修改一个字幕 / 标题的样式。返回要提交的 ops 和改完后它用的样式 ID。
 * - item：样式只有这个元素在用（它的专属样式）就直接改；否则复制一份给它，再改副本。
 * - shared：改共享的样式，所有用它的元素一起变。
 * 内置样式还没复制进工程时，先复制进来。
 */
export function styleEditOps(
  project: Project,
  itemId: string,
  patch: Patch,
  scope: StyleScope,
  fallback: string,
): { ops: Op[]; styleId: string } {
  const { own, track, isCaption } = locate(project, itemId);
  const cur = own ?? track ?? fallback;
  const inProject = project.styles[cur];
  const base = inProject ?? (BUILTIN_STYLES as Record<string, TextStyle>)[cur];
  if (!base) throw new MwError("NOT_FOUND", `样式「${cur}」不存在`);
  const ops: Op[] = [];

  if (scope === "shared" || (inProject && own === cur && usages(project, cur) === 1)) {
    if (!inProject) ops.push({ op: "style.add", id: cur, style: base });
    ops.push({ op: "style.update", id: cur, set: patch });
    return { ops, styleId: cur };
  }
  const id = ownId(project, cur, itemId);
  ops.push({ op: "style.add", id, style: base });
  ops.push({ op: "style.update", id, set: patch });
  ops.push(
    isCaption
      ? { op: "caption.update", id: itemId, set: { style: id } }
      : { op: "item.update", id: itemId, set: { style: id } },
  );
  return { ops, styleId: id };
}
