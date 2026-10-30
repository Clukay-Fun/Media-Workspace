import type { Project } from "./schema";

// 撤销 / 重做（F19）：从修改日志推算撤销栈。撤销 = 回退到上一版（作为新的一版写入），
// 所以撤销本身也有历史、也能被撤销；人和 AI 的修改在同一个栈里，界面上可以一键撤销 AI 的修改。

export type UndoLogEntry = {
  revision: number;
  kind: "init" | "apply" | "revert" | "undo" | "redo";
};

export type UndoState = {
  /** 撤销会回到哪一版的内容 */
  undo: { revision: number } | null;
  /** 重做会回到哪一版的内容 */
  redo: { revision: number } | null;
};

export function undoState(entries: UndoLogEntry[]): UndoState {
  // 栈里放的是「内容版本」：撤销后的新版本内容和栈顶相同，不另外入栈
  const done: number[] = [];
  const undone: number[] = [];
  for (const e of entries) {
    if (e.kind === "undo") {
      const top = done.pop();
      if (top !== undefined) undone.push(top);
    } else if (e.kind === "redo") {
      const top = undone.pop();
      if (top !== undefined) done.push(top);
    } else {
      done.push(e.revision);
      undone.length = 0;
    }
  }
  const prev = done.at(-2);
  const next = undone.at(-1);
  return {
    undo: prev === undefined ? null : { revision: prev },
    redo: next === undefined ? null : { revision: next },
  };
}

/** 两版之间改动了哪些条目和轨道（新增、删除、修改），给界面高亮用 */
export function changedIds(before: Project, after: Project): string[] {
  const index = (p: Project) => {
    const m = new Map<string, string>();
    for (const t of p.tracks) {
      const { items, ...rest } = t;
      m.set(t.id, JSON.stringify(rest));
      for (const it of items) m.set(it.id, JSON.stringify(it));
    }
    return m;
  };
  const a = index(before);
  const b = index(after);
  const out: string[] = [];
  for (const [id, v] of b) if (a.get(id) !== v) out.push(id);
  for (const id of a.keys()) if (!b.has(id)) out.push(id);
  return out;
}
