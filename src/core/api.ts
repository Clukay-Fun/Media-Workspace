import { z } from "zod";
import type { ResolvedTimeline } from "./compile";
import type { ErrorCode, Issue } from "./errors";
import type { Layout } from "./layout";
import type { LintIssue } from "./lint";
import { Ops } from "./ops";
import { type Comment, NewComment, type Review } from "./review";
import type { Project } from "./schema";
import type { TextStyle } from "./text-style";

// 本地服务和网页工作台之间的接口约定（阶段 B）。
// 服务端（src/server）按这里实现，网页（src/web）按这里调用；两边都只从这里取类型，不各写一份。

export const API_PORT = 5170;

/** 编辑器状态（editor.json，D22）：不影响渲染，不经过 revision */
export const EditorState = z.strictObject({
  rulers: z.boolean().default(true),
  guides: z
    .strictObject({
      hidden: z.boolean().default(false),
      locked: z.boolean().default(false),
      items: z
        .array(z.strictObject({ id: z.string().min(1), axis: z.enum(["h", "v"]), pos: z.number() }))
        .default([]),
    })
    .default({ hidden: false, locked: false, items: [] }),
  snap: z
    .strictObject({
      enabled: z.boolean().default(true),
      thresholdPx: z.number().positive().default(8),
    })
    .default({ enabled: true, thresholdPx: 8 }),
  showSafeArea: z.string().default("all"),
  timeline: z
    .strictObject({
      pxPerSecond: z.number().positive().default(80),
      scrollMs: z.number().nonnegative().default(0),
    })
    .default({ pxPerSecond: 80, scrollMs: 0 }),
});
export type EditorState = z.infer<typeof EditorState>;

/** 预览用的合成组件参数：直接传给 <Player component={Main} inputProps={…}>，和导出用的是同一份结构 */
export type PreviewProps = {
  timeline: ResolvedTimeline;
  styles: Record<string, TextStyle>;
  /** 素材 ID → 媒体 URL（预览给代理文件，导出给标准化文件） */
  srcs: Record<string, string>;
  fonts: { css: string; weight: number; url: string }[];
};

// ---- 请求 ----

export const OpsRequest = z.strictObject({
  ops: Ops,
  baseRevision: z.number().int().nonnegative(),
  actor: z.string().min(1).default("user"),
  dryRun: z.boolean().default(false),
});
export type OpsRequest = z.input<typeof OpsRequest>;

export const UndoRequest = z.strictObject({
  baseRevision: z.number().int().nonnegative(),
  actor: z.string().min(1).default("user"),
});
export type UndoRequest = z.input<typeof UndoRequest>;

/** 恢复剪辑点：clip 是剪辑点后面那个主轨片段（docs/decisions/0016） */
export const RestoreCutRequest = z.strictObject({
  clip: z.string().min(1),
  baseRevision: z.number().int().nonnegative(),
  actor: z.string().min(1).default("user"),
});
export type RestoreCutRequest = z.input<typeof RestoreCutRequest>;
export type RestoreCutResponse = OpsResponse & {
  /** 接回来的源时间区间 */
  restoredMs: [number, number];
  /** 从历史里找回的字幕 */
  captions: string[];
  /** 和现有字幕重叠、没有放回的字幕 */
  skipped: string[];
};

export const ExportRequest = z.strictObject({
  /** 输出文件；不写时放在工程的 renders/ 下 */
  out: z.string().min(1).optional(),
});
export type ExportRequest = z.input<typeof ExportRequest>;

/** 写批注（POST /api/comments） */
export const CommentRequest = NewComment.extend({ actor: z.string().min(1).default("user") });
export type CommentRequest = z.input<typeof CommentRequest>;

/** 标记已处理 / 重新打开（POST /api/comments/:id） */
export const CommentStatusRequest = z.strictObject({
  status: z.enum(["open", "resolved"]),
  note: z.string().optional(),
  actor: z.string().min(1).default("user"),
});
export type CommentStatusRequest = z.input<typeof CommentStatusRequest>;

// ---- 返回 ----

export type ApiError = {
  ok: false;
  code: ErrorCode | "INTERNAL";
  message: string;
  issues: Issue[];
};

export type CompileWarningDto = { code: string; path: string; message: string };

/**
 * name 是工程目录名（去掉 .mwproj）。
 * dir 是工程目录的绝对路径（右栏项目概览用）；mock 模式没有服务端，所以是可选的。
 */
export type ProjectResponse = { ok: true; name: string; dir?: string; project: Project };
export type PreviewResponse = { ok: true; props: PreviewProps };
export type EditorResponse = { ok: true; editor: EditorState };
export type OpsResponse = {
  ok: true;
  revision: number;
  changed: string[];
  warnings: CompileWarningDto[];
  dryRun: boolean;
};

export type HistoryEntry = {
  revision: number;
  at: string;
  actor: string;
  source: "cli" | "mcp" | "ui";
  kind: "init" | "apply" | "revert" | "undo" | "redo";
  /** 这一版改了哪些条目 */
  changed: string[];
  /** 操作摘要，例如 ["item.update", "caption.split"] */
  ops: string[];
};
export type HistoryResponse = {
  ok: true;
  entries: HistoryEntry[];
  /** 现在能不能撤销 / 重做，以及会回到哪一版 */
  undo: { revision: number } | null;
  redo: { revision: number } | null;
};

export type ExportStarted = { ok: true; jobId: string };

/** 导出封面（POST /api/cover）：file 是生成的 PNG 绝对路径，frame 是截的那一帧 */
export type CoverResponse = { ok: true; revision: number; file: string; frame: number };

/** 样式模板库里的一项（跨工程共用；内置样式不能覆盖或删除） */
export type LibraryStyle = {
  name: string;
  description: string;
  builtin: boolean;
  savedAt: string | null;
  style: TextStyle;
};
export type LibraryStylesResponse = { ok: true; styles: LibraryStyle[]; skipped: string[] };

/** 把工程里的样式存进模板库；套用模板就是提交 style.add，走 ops */
export const SaveLibraryStyleRequest = z.strictObject({
  style: z.string().min(1),
  as: z.string().min(1).optional(),
  description: z.string().max(200).optional(),
  overwrite: z.boolean().default(false),
});
export type SaveLibraryStyleRequest = z.input<typeof SaveLibraryStyleRequest>;

/** 账号版式（GET 读，PUT 整份替换）；没设置过时 layout 为 null */
export type LayoutResponse = { ok: true; layout: Layout | null };

/** 质检结果（GET /api/lint）：界面可以在时间线上标出 atMs 的位置 */
export type LintResponse = {
  ok: true;
  revision: number;
  issues: LintIssue[];
  /** 没有人脸数据的视频素材（挡脸检查没覆盖到） */
  noFaceData: string[];
};

/** 批注列表（GET /api/comments）：全部批注，界面自己按状态筛选 */
export type ReviewResponse = { ok: true; review: Review };
export type CommentResponse = { ok: true; comment: Comment };

/** 波形：每 msPerPeak 毫秒一个 0–1 的峰值（素材源时间） */
export type PeaksResponse = { ok: true; msPerPeak: number; peaks: number[] };

// ---- 推送（GET /api/events，SSE） ----

export type ServerEvent =
  | {
      type: "project";
      revision: number;
      changed: string[];
      actor: string;
      source: "cli" | "mcp" | "ui";
      kind: HistoryEntry["kind"];
    }
  | {
      type: "export";
      jobId: string;
      progress: number;
      done: boolean;
      file?: string;
      error?: { code: string; message: string };
    }
  /** 批注有变化（任何来源），重新拉 GET /api/comments */
  | { type: "review" };

// ---- 路由 ----

export const ROUTES = {
  project: "/api/project",
  preview: "/api/preview",
  editor: "/api/editor",
  ops: "/api/ops",
  history: "/api/history",
  undo: "/api/undo",
  redo: "/api/redo",
  peaks: (assetId: string) => `/api/media/${encodeURIComponent(assetId)}/peaks`,
  export: "/api/export",
  cover: "/api/cover",
  lint: "/api/lint",
  comments: "/api/comments",
  comment: (id: string) => `/api/comments/${encodeURIComponent(id)}`,
  events: "/api/events",
  libraryStyles: "/api/library/styles",
  layout: "/api/library/layout",
  restoreCut: "/api/restore-cut",
} as const;

/** 错误码 → HTTP 状态 */
export function httpStatus(code: ApiError["code"]): 400 | 404 | 409 | 422 | 423 | 500 {
  switch (code) {
    case "CONFLICT":
      return 409;
    case "TRACK_LOCKED":
      return 423;
    case "NOT_FOUND":
      return 404;
    case "USAGE":
      return 400;
    case "MEDIA":
    case "RENDER":
    case "INTERNAL":
      return 500;
    default:
      return 422;
  }
}
