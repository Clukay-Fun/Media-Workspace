// 结构化错误（PLAN 6.3）：{ code, path, message, hint }。CLI 按 code 决定退出码，MCP 和界面原样展示。

export type ErrorCode =
  | "VALIDATION"
  | "UNKNOWN_FIELD"
  | "REF_MISSING"
  | "DUPLICATE_ID"
  | "TIME_RANGE"
  | "NOT_FOUND"
  | "INVALID_OP"
  | "TRACK_LOCKED"
  | "IN_USE"
  | "CONFLICT"
  | "SRT_PARSE"
  | "MEDIA"
  | "RENDER"
  | "FONT_MISSING"
  | "USAGE";

export type Issue = {
  code: string;
  path: string;
  message: string;
  hint?: string;
};

export class MwError extends Error {
  readonly issues: Issue[];
  constructor(
    readonly code: ErrorCode,
    message: string,
    opts: { path?: string; hint?: string; issues?: Issue[] } = {},
  ) {
    super(message);
    this.name = "MwError";
    this.issues = opts.issues ?? [
      { code, path: opts.path ?? "", message, ...(opts.hint ? { hint: opts.hint } : {}) },
    ];
  }
}
