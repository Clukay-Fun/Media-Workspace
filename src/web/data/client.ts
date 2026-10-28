import {
  type ApiError,
  type CommentRequest,
  type CommentResponse,
  type CommentStatusRequest,
  type ExportStarted,
  type HistoryResponse,
  type LintResponse,
  type OpsRequest,
  type OpsResponse,
  type PeaksResponse,
  type PreviewResponse,
  type ProjectResponse,
  type ReviewResponse,
  ROUTES,
  type ServerEvent,
} from "../../core/api";

// 界面所有的网络请求都在这里。真实服务端和 mock（VITE_MW_MOCK=1）实现同一个接口，组件不关心是哪一个。

export type Api = {
  project(): Promise<ProjectResponse>;
  preview(): Promise<PreviewResponse>;
  history(): Promise<HistoryResponse>;
  lint(): Promise<LintResponse>;
  review(): Promise<ReviewResponse>;
  peaks(assetId: string): Promise<PeaksResponse | null>;
  ops(req: OpsRequest): Promise<OpsResponse>;
  undo(direction: "undo" | "redo", baseRevision: number): Promise<OpsResponse>;
  comment(req: CommentRequest): Promise<CommentResponse>;
  setComment(id: string, req: CommentStatusRequest): Promise<CommentResponse>;
  exportVideo(): Promise<ExportStarted>;
  /** 订阅推送；返回取消订阅。onStatus 报告连接状态 */
  subscribe(onEvent: (e: LiveEvent) => void, onStatus: (live: boolean) => void): () => void;
};

/** 推送事件，加上连接建立时的 hello（带当前 revision，断线重连后据此判断要不要刷新） */
export type LiveEvent = ServerEvent | { type: "hello"; revision: number };

/** 服务端返回的结构化错误 */
export class ApiFailure extends Error {
  constructor(
    readonly code: ApiError["code"],
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
    headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json().catch(() => null)) as (T & { ok: boolean }) | ApiError | null;
  if (!data) throw new ApiFailure("INTERNAL", `服务没有响应（HTTP ${res.status}）`);
  if (!data.ok) {
    const e = data as ApiError;
    throw new ApiFailure(e.code, e.message);
  }
  return data as T;
}

export const httpApi: Api = {
  project: () => request(ROUTES.project),
  preview: () => request(ROUTES.preview),
  history: () => request(ROUTES.history),
  lint: () => request(ROUTES.lint),
  review: () => request(ROUTES.comments),
  peaks: (id) => request<PeaksResponse>(ROUTES.peaks(id)).catch(() => null),
  ops: (req) => request(ROUTES.ops, { body: req }),
  undo: (direction, baseRevision) => request(ROUTES[direction], { body: { baseRevision } }),
  comment: (req) => request(ROUTES.comments, { body: req }),
  setComment: (id, req) => request(ROUTES.comment(id), { body: req }),
  exportVideo: () => request(ROUTES.export, { body: {} }),
  subscribe(onEvent, onStatus) {
    const es = new EventSource(ROUTES.events);
    const handle = (m: MessageEvent<string>) => onEvent(JSON.parse(m.data) as ServerEvent);
    for (const type of ["project", "review", "export"]) es.addEventListener(type, handle);
    es.addEventListener("hello", (m) => {
      onStatus(true);
      const { revision } = JSON.parse((m as MessageEvent<string>).data) as { revision: number };
      onEvent({ type: "hello", revision });
    });
    es.onerror = () => onStatus(false);
    return () => es.close();
  },
};
