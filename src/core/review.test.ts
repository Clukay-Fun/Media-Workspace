import { describe, expect, it } from "vitest";
import { MwError } from "./errors";
import { addComment, Review, removeComment, setCommentStatus } from "./review";

const meta = {
  author: "user",
  source: "ui" as const,
  now: "2026-10-29T10:00:00.000Z",
  revision: 7,
};

describe("审片批注", () => {
  it("写批注：编号递增，记下当时的版本", () => {
    let r = Review.parse({});
    r = addComment(r, { text: "这里太快了", atMs: 5200, target: "s3" }, meta);
    r = addComment(r, { text: "  卡片换成半屏 " }, { ...meta, revision: 8 });
    expect(r.nextId).toBe(3);
    expect(r.comments).toMatchObject([
      { id: "k1", text: "这里太快了", atMs: 5200, target: "s3", revision: 7, status: "open" },
      { id: "k2", text: "卡片换成半屏", revision: 8 },
    ]);
  });

  it("空批注和拼错的字段会报错", () => {
    const r = Review.parse({});
    expect(() => addComment(r, { text: "  " }, meta)).toThrow();
    expect(() => addComment(r, { text: "x", atMS: 1 } as never, meta)).toThrow();
  });

  it("标记已处理、重新打开、删除", () => {
    let r = addComment(Review.parse({}), { text: "字太小" }, meta);
    r = setCommentStatus(r, "k1", "resolved", { ...meta, author: "claude", note: "字号 84 → 96" });
    expect(r.comments[0]).toMatchObject({
      status: "resolved",
      resolution: { by: "claude", note: "字号 84 → 96", revision: 7 },
    });
    r = setCommentStatus(r, "k1", "open", meta);
    expect(r.comments[0]?.status).toBe("open");
    expect(r.comments[0]?.resolution).toBeUndefined();
    expect(removeComment(r, "k1").comments).toEqual([]);
    expect(() => removeComment(r, "k9")).toThrow(MwError);
  });
});
