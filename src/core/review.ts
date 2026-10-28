import { z } from "zod";
import { MwError } from "./errors";

// 审片批注（docs/decisions/0008）：人在界面上看片时，在某个时刻、某个元素上写下意见，AI 读取后逐条处理。
// 存在工程目录的 review.json，不进 project.json：写批注不产生新版本，也不会和 AI 的修改冲突。

export const REVIEW_FORMAT_VERSION = 1;

export const CommentAnchor = z.strictObject({
  /** 时间线毫秒（看片时的播放头位置） */
  atMs: z.number().int().nonnegative().optional(),
  /** 指向的条目 ID（片段、字幕、叠加层） */
  target: z.string().min(1).optional(),
  /** 画面上点的位置（画布像素），在预览区钉图钉用 */
  point: z.strictObject({ x: z.number(), y: z.number() }).optional(),
});

export const Comment = z.strictObject({
  id: z.string().min(1),
  text: z.string().min(1),
  ...CommentAnchor.shape,
  author: z.string().min(1),
  source: z.enum(["cli", "mcp", "ui"]),
  createdAt: z.string(),
  /** 写批注时工程的版本：AI 处理时可以看出这条意见针对的是哪一版 */
  revision: z.number().int().nonnegative(),
  status: z.enum(["open", "resolved"]).default("open"),
  resolution: z
    .strictObject({
      by: z.string().min(1),
      at: z.string(),
      /** 怎么处理的（或者为什么不改） */
      note: z.string().default(""),
      /** 处理之后工程的版本 */
      revision: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export const Review = z.strictObject({
  version: z.literal(REVIEW_FORMAT_VERSION).default(REVIEW_FORMAT_VERSION),
  nextId: z.number().int().positive().default(1),
  comments: z.array(Comment).default([]),
});

export const NewComment = z.strictObject({
  text: z.string().trim().min(1),
  ...CommentAnchor.shape,
});

export type CommentAnchor = z.infer<typeof CommentAnchor>;
export type Comment = z.infer<typeof Comment>;
export type Review = z.infer<typeof Review>;
export type NewComment = z.input<typeof NewComment>;

type Meta = { author: string; source: Comment["source"]; now: string; revision: number };

export function addComment(review: Review, input: NewComment, meta: Meta): Review {
  const c = NewComment.parse(input);
  const comment = Comment.parse({
    id: `k${review.nextId}`,
    ...c,
    author: meta.author,
    source: meta.source,
    createdAt: meta.now,
    revision: meta.revision,
  });
  return { ...review, nextId: review.nextId + 1, comments: [...review.comments, comment] };
}

/** 标记已处理（或重新打开）。重新打开时清掉处理记录 */
export function setCommentStatus(
  review: Review,
  id: string,
  status: Comment["status"],
  meta: Omit<Meta, "source"> & { note?: string },
): Review {
  const found = review.comments.some((c) => c.id === id);
  if (!found) throw new MwError("NOT_FOUND", `批注「${id}」不存在`);
  return {
    ...review,
    comments: review.comments.map((c) => {
      if (c.id !== id) return c;
      if (status === "open") {
        const { resolution: _, ...rest } = c;
        return { ...rest, status };
      }
      return {
        ...c,
        status,
        resolution: {
          by: meta.author,
          at: meta.now,
          note: meta.note ?? "",
          revision: meta.revision,
        },
      };
    }),
  };
}

export function removeComment(review: Review, id: string): Review {
  if (!review.comments.some((c) => c.id === id))
    throw new MwError("NOT_FOUND", `批注「${id}」不存在`);
  return { ...review, comments: review.comments.filter((c) => c.id !== id) };
}
