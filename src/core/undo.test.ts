import { describe, expect, it } from "vitest";
import { applyOps } from "./ops";
import { Project } from "./schema";
import { changedIds, type UndoLogEntry, undoState } from "./undo";

const log = (...kinds: UndoLogEntry["kind"][]): UndoLogEntry[] =>
  kinds.map((kind, i) => ({ revision: i, kind }));

describe("undoState", () => {
  it("新工程不能撤销", () => {
    expect(undoState(log("init"))).toEqual({ undo: null, redo: null });
  });

  it("撤销回到上一版，重做回到撤销前那一版", () => {
    expect(undoState(log("init", "apply", "apply"))).toEqual({ undo: { revision: 1 }, redo: null });
    // 第 3 版是撤销（内容 = 第 1 版）
    expect(undoState(log("init", "apply", "apply", "undo"))).toEqual({
      undo: { revision: 0 },
      redo: { revision: 2 },
    });
    expect(undoState(log("init", "apply", "apply", "undo", "undo"))).toEqual({
      undo: null,
      redo: { revision: 1 },
    });
    expect(undoState(log("init", "apply", "apply", "undo", "undo", "redo"))).toEqual({
      undo: { revision: 0 },
      redo: { revision: 2 },
    });
  });

  it("撤销后有新的修改，重做栈清空", () => {
    expect(undoState(log("init", "apply", "undo", "apply"))).toEqual({
      undo: { revision: 0 },
      redo: null,
    });
  });
});

describe("changedIds", () => {
  it("列出新增、删除、修改的条目和轨道", () => {
    const p = Project.parse({
      version: 6,
      revision: 0,
      canvas: {},
      tracks: [
        {
          id: "o",
          kind: "overlay",
          items: [{ id: "a", template: "x", at: { ms: 0 }, durationMs: 1 }],
        },
      ],
    });
    const q = applyOps(p, [
      { op: "item.update", id: "a", set: { durationMs: 2 } },
      { op: "track.update", id: "o", set: { locked: true } },
    ]).project;
    expect(changedIds(p, q).sort()).toEqual(["a", "o"]);
    expect(changedIds(p, p)).toEqual([]);
  });
});
