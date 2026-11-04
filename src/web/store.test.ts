import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "../core/api";
import { Layout } from "../core/layout";
import { Review } from "../core/review";
import { Project } from "../core/schema";
import type { Api } from "./data/client";
import { createWorkbenchStore } from "./store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((ok, bad) => {
    resolve = ok;
    reject = bad;
  });
  return { promise, resolve, reject };
}

function emptyProject() {
  return Project.parse({ version: 9, revision: 0, canvas: {}, tracks: [] });
}

const defaultEditor = EditorState.parse({});

function installWindow(project = "A") {
  const location = { href: `http://127.0.0.1/?project=${encodeURIComponent(project)}` };
  vi.stubGlobal("window", {
    location,
    history: {
      replaceState: (_state: unknown, _title: string, url: URL) => {
        location.href = String(url);
      },
    },
  });
}

function createApi(overridesFor: (id: string | null) => Partial<Api> = () => ({})): Api {
  const create = (id: string | null): Api => {
    const defaults = {
      projectId: id,
      projects: async () => ({
        ok: true as const,
        projects: ["A", "B"].map((name) => ({ id: name, name, revision: 0 })),
      }),
      forProject: (next: string) => create(next),
      project: async () => ({
        ok: true as const,
        id: id ?? undefined,
        name: id ?? "项目",
        project: emptyProject(),
      }),
      preview: async () => ({ ok: true as const, projectId: id ?? undefined, props: {} as never }),
      history: async () => ({ ok: true as const, entries: [], undo: null, redo: null }),
      revision: async () => ({ ok: true as const, revision: 0, baseRevision: 0, changes: [] }),
      lint: async () => ({ ok: true as const, revision: 0, issues: [], noFaceData: [] }),
      review: async () => ({ ok: true as const, review: Review.parse({}) }),
      editor: async () => ({ ok: true as const, editor: defaultEditor }),
      saveEditor: async () => {},
      libraryStyles: async () => ({ ok: true as const, styles: [], skipped: [] }),
      saveLibraryStyle: async () => ({ ok: true as const, saved: "style" }),
      layout: async () => ({ ok: true as const, layout: null }),
      saveLayout: async () => ({ ok: true as const, layout: null }),
      peaks: async () => null,
      ops: async () => ({
        ok: true as const,
        revision: 1,
        changed: [],
        warnings: [],
        dryRun: false,
      }),
      restoreCut: async () => ({
        ok: true as const,
        revision: 1,
        changed: [],
        warnings: [],
        dryRun: false,
        captions: [],
        skipped: [],
        restoredMs: [0, 0] as [number, number],
      }),
      undo: async () => ({
        ok: true as const,
        revision: 1,
        changed: [],
        warnings: [],
        dryRun: false,
      }),
      comment: async () => ({
        ok: true as const,
        comment: {
          id: "k1",
          text: "测试",
          author: "user",
          source: "ui" as const,
          createdAt: "2026-11-04T00:00:00.000Z",
          revision: 0,
          status: "open" as const,
        },
      }),
      setComment: async () => ({ ok: true as const, comment: {} as never }),
      exportVideo: async () => ({ ok: true as const, jobId: "job" }),
      cover: async () => ({ ok: true as const, revision: 0, file: "cover.png", frame: 0 }),
      subscribe: () => () => {},
    };
    return { ...defaults, ...overridesFor(id), forProject: (next: string) => create(next) } as Api;
  };
  return create(null);
}

function storeOnA(overridesFor: (id: string | null) => Partial<Api> = () => ({})) {
  const manager = createApi(overridesFor);
  const store = createWorkbenchStore(manager);
  store.setState({
    api: manager.forProject("A"),
    projectId: "A",
    name: "A",
    project: emptyProject(),
    review: Review.parse({}),
  });
  return store;
}

afterEach(() => vi.unstubAllGlobals());

describe("工程切换异步隔离", () => {
  it("批注刷新在切换后返回时不覆盖新工程的 review", async () => {
    installWindow();
    const oldReview = deferred<Awaited<ReturnType<Api["review"]>>>();
    const store = storeOnA((id) => (id === "A" ? { review: () => oldReview.promise } : {}));

    const adding = store.getState().addComment({ text: "A 的批注" });
    await vi.waitFor(() => expect(store.getState().review).toEqual(Review.parse({})));
    store.getState().requestProjectSwitch("B");
    await vi.waitFor(() => expect(store.getState().projectId).toBe("B"));
    oldReview.resolve({ ok: true, review: Review.parse({ comments: [] }) });
    await adding;

    expect(store.getState().projectId).toBe("B");
    expect(store.getState().review).toEqual(Review.parse({}));
  });

  it("批注状态刷新在切换后返回时不覆盖新工程的 review", async () => {
    installWindow();
    const statusWrite = deferred<Awaited<ReturnType<Api["setComment"]>>>();
    const oldReview = deferred<Awaited<ReturnType<Api["review"]>>>();
    let reviewStarted = false;
    const store = storeOnA((id) =>
      id === "A"
        ? {
            setComment: () => statusWrite.promise,
            review: () => {
              reviewStarted = true;
              return oldReview.promise;
            },
          }
        : {},
    );

    const updating = store.getState().setCommentStatus("k1", "resolved");
    statusWrite.resolve({ ok: true, comment: {} as never });
    await vi.waitFor(() => expect(reviewStarted).toBe(true));
    store.getState().requestProjectSwitch("B");
    await vi.waitFor(() => expect(store.getState().projectId).toBe("B"));
    oldReview.resolve({ ok: true, review: Review.parse({}) });
    await updating;

    expect(store.getState().projectId).toBe("B");
    expect(store.getState().review).toEqual(Review.parse({}));
  });

  it("导出进行中阻止切换，完成后允许切换", async () => {
    installWindow();
    const start = deferred<{ ok: true; jobId: string }>();
    const store = storeOnA((id) => (id === "A" ? { exportVideo: () => start.promise } : {}));

    const exporting = store.getState().startExport();
    store.getState().requestProjectSwitch("B");
    expect(store.getState().projectId).toBe("A");
    expect(store.getState().exportJob?.done).toBe(false);

    start.resolve({ ok: true, jobId: "job" });
    await exporting;
    store.setState({ exportJob: { progress: 1, done: true } });
    store.getState().requestProjectSwitch("B");
    await vi.waitFor(() => expect(store.getState().projectId).toBe("B"));
  });

  it("并发写入中一项失败后，后续成功不会抹掉失败并放行切换", async () => {
    installWindow();
    const failedOps = deferred<never>();
    const commentWrite = deferred<Awaited<ReturnType<Api["comment"]>>>();
    const store = storeOnA((id) =>
      id === "A" ? { ops: () => failedOps.promise, comment: () => commentWrite.promise } : {},
    );

    const submit = store.getState().submit([{} as never]);
    const comment = store.getState().addComment({ text: "并发批注" });
    failedOps.reject(new Error("ops 写入失败"));
    await submit;
    commentWrite.resolve({
      ok: true,
      comment: {
        id: "k1",
        text: "并发批注",
        author: "user",
        source: "ui",
        createdAt: "2026-11-04T00:00:00.000Z",
        revision: 0,
        status: "open",
      },
    });
    await comment;

    store.getState().requestProjectSwitch("B");
    await vi.waitFor(() =>
      expect(store.getState().toasts.some((toast) => toast.text.includes("ops 写入失败"))).toBe(
        true,
      ),
    );
    expect(store.getState().projectId).toBe("A");
  });

  it("工程请求开始新代后，全局账号版式仍能载入", async () => {
    installWindow();
    const layout = Layout.parse({ guides: [{ id: "center", axis: "v", pos: 0.5 }] });
    const layoutRequest = deferred<Awaited<ReturnType<Api["layout"]>>>();
    const manager = createApi((id) => (id === null ? { layout: () => layoutRequest.promise } : {}));
    const store = createWorkbenchStore(manager);
    store.setState({ api: manager });

    store.getState().init();
    await vi.waitFor(() => expect(store.getState().projectId).toBe("A"));
    layoutRequest.resolve({ ok: true, layout });
    await vi.waitFor(() => expect(store.getState().layout).toEqual(layout));
  });
});
