import type { HistoryEntry, HistoryResponse } from "../../core/api";

/** 别人（AI、CLI）做的修改；界面上人自己的操作不算 */
export const isAiEntry = (e: HistoryEntry) =>
  !(e.source === "ui" && e.actor === "user") && e.kind !== "init";

/** 最近的 AI 修改，新的在前；revision 大于 reviewedRev 的是待确认 */
export function aiChanges(history: HistoryResponse | null, reviewedRev: number | null) {
  const all = (history?.entries ?? []).filter(isAiEntry).toReversed();
  const pending = all.filter((e) => reviewedRev !== null && e.revision > reviewedRev);
  return { all, pending };
}
