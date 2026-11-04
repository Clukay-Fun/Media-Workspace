import {
  type ApiError,
  type CommentRequest,
  type CommentResponse,
  type CommentStatusRequest,
  type CoverResponse,
  type EditorResponse,
  type EditorState,
  type ExportStarted,
  type HistoryResponse,
  type LayoutResponse,
  type LibraryStylesResponse,
  type LintResponse,
  type OpsRequest,
  type OpsResponse,
  type PeaksResponse,
  type PreviewResponse,
  type ProjectResponse,
  type ProjectsResponse,
  type RestoreCutRequest,
  type RestoreCutResponse,
  type ReviewResponse,
  type RevisionDiffResponse,
  ROUTES,
  type SaveLibraryStyleRequest,
  type ServerEvent,
} from "../../core/api";
import type { LayoutInput } from "../../core/layout";

// 界面所有网络请求都从这里发出；forProject 创建的 API 把目标工程固定在该标签页上下文中。

export type Api = {
  readonly projectId: string | null;
  projects(): Promise<ProjectsResponse>;
  forProject(id: string): Api;
  project(): Promise<ProjectResponse>;
  preview(): Promise<PreviewResponse>;
  history(): Promise<HistoryResponse>;
  revision(rev: number): Promise<RevisionDiffResponse>;
  lint(): Promise<LintResponse>;
  review(): Promise<ReviewResponse>;
  editor(): Promise<EditorResponse>;
  saveEditor(editor: EditorState): Promise<void>;
  libraryStyles(): Promise<LibraryStylesResponse>;
  saveLibraryStyle(req: SaveLibraryStyleRequest): Promise<{ ok: true; saved: string }>;
  layout(): Promise<LayoutResponse>;
  saveLayout(layout: LayoutInput): Promise<LayoutResponse>;
  peaks(assetId: string): Promise<PeaksResponse | null>;
  ops(req: OpsRequest): Promise<OpsResponse>;
  restoreCut(req: RestoreCutRequest): Promise<RestoreCutResponse>;
  undo(direction: "undo" | "redo", baseRevision: number): Promise<OpsResponse>;
  comment(req: CommentRequest): Promise<CommentResponse>;
  setComment(id: string, req: CommentStatusRequest): Promise<CommentResponse>;
  exportVideo(): Promise<ExportStarted>;
  cover(): Promise<CoverResponse>;
  subscribe(onEvent: (e: LiveEvent) => void, onStatus: (live: boolean) => void): () => void;
};

export type LiveEvent =
  | (ServerEvent & { projectId: string })
  | {
      type: "hello";
      projectId: string;
      revision: number;
    };

export class ApiFailure extends Error {
  constructor(
    readonly code: ApiError["code"],
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown },
  projectId?: string | null,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers["content-type"] = "application/json";
  if (projectId) headers["x-mw-project"] = encodeURIComponent(projectId);
  const res = await fetch(path, {
    method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
    headers: Object.keys(headers).length ? headers : undefined,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json().catch(() => null)) as (T & { ok: boolean }) | ApiError | null;
  if (!data) throw new ApiFailure("INTERNAL", `服务没有响应（HTTP ${res.status}）`);
  if (!data.ok) {
    const e = data as ApiError;
    throw new ApiFailure(e.code, e.message);
  }
  const responseProjectId =
    "projectId" in data && typeof data.projectId === "string"
      ? data.projectId
      : "id" in data && typeof data.id === "string"
        ? data.id
        : null;
  if (projectId && responseProjectId && responseProjectId !== projectId)
    throw new ApiFailure("CONFLICT", "服务端返回了另一个工程的数据，已丢弃这次响应");
  return data as T;
}

function createHttpApi(projectId: string | null): Api {
  const req = <T>(path: string, init?: { method?: string; body?: unknown }) =>
    request<T>(path, init, projectId);
  return {
    projectId,
    projects: () => request(ROUTES.projects),
    forProject: (id) => createHttpApi(id),
    project: () => req(ROUTES.project),
    preview: () => req(ROUTES.preview),
    history: () => req(ROUTES.history),
    revision: (rev) => req(ROUTES.revision(rev)),
    lint: () => req(ROUTES.lint),
    review: () => req(ROUTES.comments),
    editor: () => req(ROUTES.editor),
    saveEditor: async (editor) => {
      await req<{ ok: true }>(ROUTES.editor, { method: "PUT", body: editor });
    },
    libraryStyles: () => request(ROUTES.libraryStyles),
    saveLibraryStyle: (body) => req(ROUTES.libraryStyles, { body }),
    layout: () => request(ROUTES.layout),
    saveLayout: (layout) => request(ROUTES.layout, { method: "PUT", body: layout }),
    peaks: (id) => req<PeaksResponse>(ROUTES.peaks(id)).catch(() => null),
    ops: (body) => req(ROUTES.ops, { body }),
    restoreCut: (body) => req(ROUTES.restoreCut, { body }),
    undo: (direction, baseRevision) => req(ROUTES[direction], { body: { baseRevision } }),
    comment: (body) => req(ROUTES.comments, { body }),
    setComment: (id, body) => req(ROUTES.comment(id), { body }),
    exportVideo: () => req(ROUTES.export, { body: {} }),
    cover: () => req(ROUTES.cover, { body: {} }),
    subscribe(onEvent, onStatus) {
      const eventUrl = projectId
        ? `${ROUTES.events}?project=${encodeURIComponent(projectId)}`
        : ROUTES.events;
      const es = new EventSource(eventUrl);
      const handle = (m: MessageEvent<string>) =>
        onEvent({ ...(JSON.parse(m.data) as ServerEvent), projectId: projectId ?? "" });
      for (const type of ["project", "review", "export"]) es.addEventListener(type, handle);
      es.addEventListener("hello", (m) => {
        onStatus(true);
        const data = JSON.parse((m as MessageEvent<string>).data) as {
          revision: number;
          projectId?: string;
        };
        onEvent({
          type: "hello",
          revision: data.revision,
          projectId: data.projectId ?? projectId ?? "",
        });
      });
      es.onerror = () => onStatus(false);
      return () => es.close();
    },
  };
}

export const httpApi: Api = createHttpApi(null);
