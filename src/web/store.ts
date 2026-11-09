import { create } from "zustand";
import type {
  AvailableProject,
  EditorState,
  FontCatalogResponse,
  FontWarning,
  HistoryResponse,
  LintResponse,
  PreviewProps,
} from "../core/api";
import type { ResolvedTimeline } from "../core/compile";
import { planSplit } from "../core/edit";
import { Layout, type LayoutInput } from "../core/layout";
import type { Op } from "../core/ops";
import type { NewComment, Review } from "../core/review";
import type { CropRect, Project } from "../core/schema";
import { type Api, ApiFailure, httpApi, type LiveEvent } from "./data/client";
import { msOfFrame } from "./lib/timeline";

// 界面状态。工程数据只从服务端读，修改一律提交 ops（AGENTS.md 规则 1）；
// 本地只有选中、播放头、拖动中的草稿这些不影响渲染的东西。

/** 右栏三页：属性（选中元素能点的选项；没选中时是工程概览和章节）、批注、AI 改动 */
export type SideTab = "props" | "comments" | "changes";
export type CaptionTab = "edit" | "style" | "list" | "motion";
/** 预览里调整裁切：拖动中的框（素材 0–1 坐标）和锁定的像素宽高比（null 为自由） */
export type CropEditing = { id: string; crop: CropRect; aspect: number | null };

/** 左栏两页：素材、样式库 */
export type LeftTab = "assets" | "styles";

const reviewedKey = (name: string) => `mw.reviewed.${name}`;

function saveReviewed(name: string, rev: number) {
  try {
    localStorage.setItem(reviewedKey(name), String(rev));
  } catch {}
}

/** 上次确认到哪一版；第一次打开这个工程时从当前版本算起，旧历史不算待确认 */
export function loadReviewed(name: string, current: number): number {
  try {
    const v = Number(localStorage.getItem(reviewedKey(name)));
    if (Number.isFinite(v) && v > 0) return v;
  } catch {}
  saveReviewed(name, current);
  return current;
}

export type AiChange = { actor: string; revision: number; changed: string[] };

export type Toast = { id: number; text: string; tone: "info" | "error" };

export type ExportJob = {
  progress: number;
  done: boolean;
  file?: string;
  error?: string;
  fontWarnings?: FontWarning[];
};

type State = {
  api: Api;
  projectId: string | null;
  projects: AvailableProject[];
  switchTarget: string | null;
  commentDraft: {
    text: string;
    atMs: number;
    target: string;
    point?: { x: number; y: number };
  } | null;
  name: string;
  /** 工程目录的绝对路径（右栏项目概览用）；mock 模式没有服务端，所以是 null */
  dir: string | null;
  project: Project | null;
  preview: PreviewProps | null;
  history: HistoryResponse | null;
  lint: LintResponse | null;
  review: Review | null;
  peaks: Record<string, { msPerPeak: number; peaks: number[] } | null>;
  live: boolean;
  /** 工程或预览加载失败的原因（例如缺字体），一直显示在画面区域，直到下次加载成功 */
  loadError: string | null;
  /** 字体缺失/回退提示；不阻断预览或导出，字体提示弹窗消费它。 */
  fontWarnings: FontWarning[];
  fontCatalog: FontCatalogResponse["fonts"];

  selected: string | null;
  /** 在画面、时间线上主动选中时加一（从列表跳过去时不加） */
  revealNonce: number;
  frame: number;
  /** 每次主动跳转加一，预览区据此调用 player.seekTo（播放时的帧变化不触发） */
  seekNonce: number;
  playing: boolean;
  /** 拖动画面元素时的草稿时间线：只用来预览，松开后提交 ops */
  draft: { timeline: ResolvedTimeline; guides: { axis: "h" | "v"; pos: number }[] } | null;
  /** 刚被别人（AI、CLI）改动的条目，时间线和画面上闪一下 */
  flash: { ids: string[]; at: number } | null;
  aiChange: AiChange | null;
  exportJob: ExportJob | null;
  toasts: Toast[];
  sideTab: SideTab;
  leftTab: LeftTab;
  /** 窄容器里左栏是抽屉，这里记开没开 */
  leftOpen: boolean;
  /** 窄容器里审阅栏是抽屉，这里记开没开 */
  sideOpen: boolean;
  /** 人已经看过、确认过的版本；之后 AI 的改动算「待确认」 */
  reviewedRev: number | null;
  /**
   * 编辑器设置（editor.json）：构图参考线、标尺、安全区显示、时间线缩放。
   * 只影响界面，不进导出；载入前为 null
   */
  editor: EditorState | null;
  /** 账号版式（所有工程共用，docs/decisions/0027）；没设置过为 null */
  layout: Layout | null;
  /** 正在编辑账号版式 */
  layoutEditing: boolean;
  /** 时间线拖动时吸附到字幕边界、播放头 */
  snap: boolean;
  /** 选中字幕时右栏看哪一页；换一句字幕时保持不变 */
  captionTab: CaptionTab;
  /** 正在预览里调整裁切的元素（问题 20）；调整时预览临时显示整张素材 */
  cropEditing: CropEditing | null;
  /** 正在等待用户在预览画面中点选批注目标 */
  annotating: boolean;
  /** 点选画面目标时钉下的位置（画布像素），写批注时一起提交 */
  pin: { x: number; y: number } | null;

  init(): () => void;
  requestProjectSwitch(id: string): void;
  resolveProjectSwitch(choice: "save" | "discard" | "cancel"): Promise<void>;
  setCommentDraft(draft: State["commentDraft"]): void;
  refresh(): Promise<void>;
  submit(ops: Op[], label?: string): Promise<boolean>;
  undo(direction: "undo" | "redo"): Promise<void>;
  /** 在播放头处分割选中的条目；没选中时分割播放头下的主轨片段 */
  splitAtPlayhead(): Promise<void>;
  /** 恢复主轨片段 clip 前面的剪辑点，连同随删句删掉的字幕（docs/decisions/0016） */
  restoreCut(clip: string): Promise<void>;
  addComment(c: NewComment): Promise<boolean>;
  setCommentStatus(id: string, status: "open" | "resolved"): Promise<void>;
  startExport(): Promise<void>;
  select(id: string | null, opts?: { reveal?: boolean }): void;
  seek(frame: number): void;
  setFrame(frame: number): void;
  setPlaying(playing: boolean): void;
  setDraft(draft: State["draft"]): void;
  setSideTab(tab: SideTab): void;
  setSideOpen(open: boolean): void;
  setLeftTab(tab: LeftTab): void;
  setLeftOpen(open: boolean): void;
  confirmAiChanges(): void;
  /** 改编辑器设置：本地立即生效，稍后合并进服务端最新的 editor.json（时间线也在写它） */
  updateEditor(patch: Partial<EditorState>): void;
  setLayoutEditing(on: boolean): void;
  /** 整份保存账号版式；界面先改本地，失败时提示并重新读取 */
  saveLayout(next: LayoutInput): Promise<void>;
  toggleSnap(): void;
  setCaptionTab(tab: CaptionTab): void;
  setCropEditing(editing: CropEditing | null): void;
  setAnnotating(on: boolean): void;
  setPin(pin: State["pin"]): void;
  dismissAiChange(): void;
  toast(text: string, tone?: Toast["tone"]): void;
};

export function createWorkbenchStore(initialApi: Api = httpApi) {
  let toastId = 0;
  let editorPatch: Partial<EditorState> = {};
  let editorTimer: ReturnType<typeof setTimeout> | null = null;
  let editorPatchApi: Api | null = null;
  let baseApi = initialApi;
  let unsubscribeEvents: (() => void) | null = null;
  let requestGeneration = 0;
  let layoutGeneration = 0;
  let pendingWrites = 0;
  const writeFailures = new Map<number, string[]>();
  let writeWaiters: (() => void)[] = [];

  function beginWrite() {
    pendingWrites += 1;
    return requestGeneration;
  }

  function endWrite(generation: number, error?: unknown) {
    if (error) {
      const failures = writeFailures.get(generation) ?? [];
      failures.push(error instanceof Error ? error.message : String(error));
      writeFailures.set(generation, failures);
    }
    pendingWrites = Math.max(0, pendingWrites - 1);
    if (pendingWrites === 0) for (const resolve of writeWaiters.splice(0)) resolve();
  }

  function takeWriteFailures(generation: number): string[] {
    const failures = writeFailures.get(generation) ?? [];
    writeFailures.delete(generation);
    return failures;
  }

  function waitForWrites(): Promise<void> {
    return pendingWrites === 0
      ? Promise.resolve()
      : new Promise((resolve) => writeWaiters.push(resolve));
  }

  const store = create<State>((set, get) => {
    const fail = (e: unknown, id = get().projectId, generation = requestGeneration) => {
      const conflict = e instanceof ApiFailure && e.code === "CONFLICT";
      if (get().projectId === id && requestGeneration === generation) {
        get().toast(
          conflict
            ? "工程刚被其他地方修改过，已刷新到最新版本，请再操作一次"
            : e instanceof Error
              ? e.message
              : String(e),
          "error",
        );
        void get().refresh();
      }
    };

    const loadPeaks = async (project: Project, api: Api, id: string, generation: number) => {
      const peaks = get().peaks;
      for (const [assetId, a] of Object.entries(project.assets)) {
        if (a.kind === "image" || assetId in peaks) continue;
        if (generation !== requestGeneration) return;
        set((s) => ({ peaks: { ...s.peaks, [assetId]: null } }));
        const p = await api.peaks(assetId);
        if (generation !== requestGeneration || get().projectId !== id) return;
        if (p) set((s) => ({ peaks: { ...s.peaks, [assetId]: p } }));
      }
    };

    const onEvent = (e: LiveEvent, id: string, generation: number) => {
      if (generation !== requestGeneration || get().projectId !== id || e.projectId !== id) return;
      const s = get();
      if (e.type === "hello") {
        if (e.revision !== s.project?.revision) void s.refresh();
        return;
      }
      if (e.type === "review") {
        void s.api.review().then((r) => {
          if (generation === requestGeneration && get().projectId === id) set({ review: r.review });
        });
        return;
      }
      if (e.type === "export") {
        set({
          exportJob: {
            progress: e.progress,
            done: e.done,
            file: e.file,
            error: e.error?.message,
            fontWarnings: e.fontWarnings,
          },
        });
        if (e.done)
          s.toast(
            e.error ? `导出失败：${e.error.message}` : `已导出：${e.file}`,
            e.error ? "error" : "info",
          );
        return;
      }
      if (e.revision === s.project?.revision) return;
      void s.refresh();
      // 界面自己的提交不提示；别人（AI、CLI）的修改高亮并给出一键撤销
      const mine = e.source === "ui" && e.actor === "user";
      if (!mine && e.changed.length > 0) {
        set({
          flash: { ids: e.changed, at: Date.now() },
          aiChange: { actor: e.actor, revision: e.revision, changed: e.changed },
        });
      }
    };

    const flushEditor = async () => {
      if (!editorTimer || !editorPatchApi) return;
      clearTimeout(editorTimer);
      editorTimer = null;
      const patch = editorPatch;
      const api = editorPatchApi;
      editorPatch = {};
      editorPatchApi = null;
      const writeGeneration = beginWrite();
      try {
        const { editor } = await api.editor();
        await api.saveEditor({ ...editor, ...patch });
        endWrite(writeGeneration);
      } catch (e) {
        endWrite(writeGeneration, e);
        throw e;
      }
    };

    const switchToProject = async (id: string) => {
      const current = get();
      if (current.projectId === id) return;
      if (current.exportJob && !current.exportJob.done) {
        current.toast("请等当前工程导出完成后再切换", "error");
        return;
      }
      if (current.draft || current.cropEditing) {
        current.toast("请先完成或取消画面、时间线的拖动或裁切，再切换工程", "error");
        return;
      }
      const previousId = current.projectId;
      const previousGeneration = requestGeneration;
      try {
        await flushEditor();
        await waitForWrites();
        const failures = takeWriteFailures(previousGeneration);
        if (failures.length) throw new Error(`当前工程有未保存修改：${failures.join("；")}`);
      } catch (e) {
        const failures = takeWriteFailures(previousGeneration);
        fail(
          failures.length ? new Error(`当前工程有未保存修改：${failures.join("；")}`) : e,
          previousId,
          previousGeneration,
        );
        return;
      }

      const api = baseApi.forProject(id);
      requestGeneration += 1;
      const generation = requestGeneration;
      unsubscribeEvents?.();
      unsubscribeEvents = null;
      const url = new URL(window.location.href);
      url.searchParams.set("project", id);
      window.history.replaceState(null, "", url);
      set({
        api,
        projectId: id,
        switchTarget: null,
        commentDraft: null,
        name: "",
        dir: null,
        project: null,
        preview: null,
        history: null,
        lint: null,
        review: null,
        peaks: {},
        live: false,
        loadError: null,
        fontWarnings: [],
        fontCatalog: [],
        selected: null,
        frame: 0,
        seekNonce: 0,
        playing: false,
        draft: null,
        flash: null,
        aiChange: null,
        exportJob: null,
        reviewedRev: null,
        editor: null,
        cropEditing: null,
        annotating: false,
        pin: null,
      });
      unsubscribeEvents = api.subscribe(
        (event) => onEvent(event, id, generation),
        (live) => {
          if (generation === requestGeneration && get().projectId === id) set({ live });
        },
      );
      void get().refresh();
      void api
        .editor()
        .then(({ editor }) => {
          if (generation === requestGeneration && get().projectId === id) set({ editor });
        })
        .catch((e) => fail(e, id, generation));
    };

    const requestProjectSwitch = (id: string) => {
      if (id === get().projectId) return;
      if (get().exportJob && !get().exportJob?.done) {
        get().toast("请等当前工程导出完成后再切换", "error");
        return;
      }
      if (get().draft || get().cropEditing) {
        get().toast("请先完成或取消画面、时间线的拖动或裁切，再切换工程", "error");
        return;
      }
      if (get().commentDraft?.text.trim()) set({ switchTarget: id });
      else void switchToProject(id);
    };

    const resolveProjectSwitch = async (choice: "save" | "discard" | "cancel") => {
      const target = get().switchTarget;
      if (!target || choice === "cancel") {
        set({ switchTarget: null });
        return;
      }
      const id = get().projectId;
      const generation = requestGeneration;
      if (!id) return;
      if (get().exportJob && !get().exportJob?.done) {
        get().toast("请等当前工程导出完成后再切换", "error");
        set({ switchTarget: null });
        return;
      }
      if (choice === "discard") {
        set({ commentDraft: null });
        await switchToProject(target);
        return;
      }

      try {
        await flushEditor();
        await waitForWrites();
        const failures = takeWriteFailures(generation);
        if (failures.length) throw new Error(`当前工程有未保存修改：${failures.join("；")}`);
        const draft = get().commentDraft;
        if (draft?.text.trim()) {
          const writeGeneration = beginWrite();
          try {
            const saved = await get().api.comment({
              text: draft.text,
              atMs: draft.atMs,
              target: draft.target,
              point: draft.point,
              actor: "user",
            });
            const latest = await get().api.project();
            if (latest.id && latest.id !== id)
              throw new Error("保存结果来自另一个工程，已取消切换");
            if (latest.project.revision < saved.comment.revision)
              throw new Error("批注对应的工程版本尚未确认，已取消切换");
            endWrite(writeGeneration);
          } catch (e) {
            endWrite(writeGeneration, e);
            throw e;
          }
        }
        if (generation !== requestGeneration || get().projectId !== id) return;
        set({ commentDraft: null });
        await switchToProject(target);
      } catch (e) {
        const failures = takeWriteFailures(generation);
        fail(
          failures.length ? new Error(`当前工程有未保存修改：${failures.join("；")}`) : e,
          id,
          generation,
        );
      }
    };

    return {
      api: httpApi,
      projectId: null,
      projects: [],
      switchTarget: null,
      commentDraft: null,
      name: "",
      dir: null,
      project: null,
      preview: null,
      history: null,
      lint: null,
      review: null,
      peaks: {},
      live: false,
      loadError: null,
      fontWarnings: [],
      fontCatalog: [],
      selected: null,
      frame: 0,
      seekNonce: 0,
      playing: false,
      draft: null,
      flash: null,
      aiChange: null,
      exportJob: null,
      toasts: [],
      sideTab: "props",
      leftTab: "assets",
      leftOpen: false,
      sideOpen: false,
      reviewedRev: null,
      editor: null,
      layout: null,
      layoutEditing: false,
      snap: true,
      captionTab: "edit",
      cropEditing: null,
      annotating: false,
      pin: null,
      revealNonce: 0,

      init() {
        baseApi = get().api.projectId === null || baseApi === httpApi ? get().api : baseApi;
        const generation = ++requestGeneration;
        const currentLayoutGeneration = ++layoutGeneration;
        let closed = false;
        void baseApi
          .projects()
          .then(({ projects }) => {
            if (closed || generation !== requestGeneration) return;
            set({ projects });
            const queryId = new URL(window.location.href).searchParams.get("project");
            const selected =
              projects.find((project) => project.id === queryId)?.id ?? projects[0]?.id;
            if (selected) void switchToProject(selected);
            else set({ loadError: "默认工程目录中没有可打开的工程" });
          })
          .catch((e) => {
            if (!closed && generation === requestGeneration)
              set({ loadError: e instanceof Error ? e.message : String(e) });
          });
        void baseApi
          .layout()
          .then((r) => {
            if (!closed && currentLayoutGeneration === layoutGeneration) set({ layout: r.layout });
          })
          .catch(() => {});
        return () => {
          closed = true;
          if (generation === requestGeneration) requestGeneration += 1;
          if (currentLayoutGeneration === layoutGeneration) layoutGeneration += 1;
          unsubscribeEvents?.();
          unsubscribeEvents = null;
        };
      },

      requestProjectSwitch,
      resolveProjectSwitch,
      setCommentDraft: (commentDraft) => set({ commentDraft }),

      async refresh() {
        const { api, projectId } = get();
        const generation = requestGeneration;
        if (!projectId) return;
        try {
          const [p, v, h, l, r, f] = await Promise.all([
            api.project(),
            api.preview(),
            api.history(),
            api.lint(),
            api.review(),
            (typeof api.fonts === "function"
              ? api.fonts()
              : Promise.resolve({
                  ok: true,
                  platform: "unknown",
                  scannedAt: new Date(0).toISOString(),
                  warnings: [],
                  fonts: [],
                } satisfies FontCatalogResponse)
            ).catch(
              () =>
                ({
                  ok: true,
                  platform: "unknown",
                  scannedAt: new Date(0).toISOString(),
                  warnings: [],
                  fonts: [],
                }) satisfies FontCatalogResponse,
            ),
          ]);
          if (generation !== requestGeneration || get().projectId !== projectId) return;
          if ((p.id && p.id !== projectId) || (v.projectId && v.projectId !== projectId))
            throw new Error("服务端返回了不匹配的工程数据");
          set({
            name: p.name,
            dir: p.dir ?? null,
            project: p.project,
            preview: v.props,
            fontWarnings: v.fontWarnings ?? [],
            fontCatalog: f.fonts,
            history: h,
            lint: l,
            review: r.review,
            loadError: null,
            reviewedRev: get().reviewedRev ?? loadReviewed(p.name, p.project.revision),
          });
          void loadPeaks(p.project, api, projectId, generation);
        } catch (e) {
          if (generation === requestGeneration && get().projectId === projectId)
            set({ loadError: e instanceof Error ? e.message : String(e) });
        }
      },

      async submit(ops, label) {
        const { api, project, projectId } = get();
        if (!project || ops.length === 0) return false;
        const generation = requestGeneration;
        const writeGeneration = beginWrite();
        try {
          await api.ops({ ops, baseRevision: project.revision, actor: "user" });
          endWrite(writeGeneration);
          if (generation !== requestGeneration || get().projectId !== projectId) return true;
          if (label) get().toast(label);
          await get().refresh();
          return true;
        } catch (e) {
          endWrite(writeGeneration, e);
          fail(e, projectId, generation);
          return false;
        }
      },

      async splitAtPlayhead() {
        const { project, preview, frame, selected, submit, toast } = get();
        if (!project || !preview) return;
        const tl = preview.timeline;
        const under = tl.videos.find(
          (v) => v.main && frame > v.from && frame < v.from + v.durationInFrames,
        );
        const id = selected ?? under?.id;
        if (!id) return toast("播放头下没有可以分割的片段", "error");
        try {
          const { ops } = planSplit(project, { id, atMs: msOfFrame(frame, tl.fps) });
          await submit(ops, `已在播放头处分割 ${id}`);
        } catch (e) {
          toast(e instanceof Error ? e.message : String(e), "error");
        }
      },

      async restoreCut(clip) {
        const { api, project, projectId } = get();
        if (!project) return;
        const generation = requestGeneration;
        const writeGeneration = beginWrite();
        try {
          const r = await api.restoreCut({ clip, baseRevision: project.revision, actor: "user" });
          endWrite(writeGeneration);
          if (generation !== requestGeneration || get().projectId !== projectId) return;
          set({ flash: { ids: r.changed, at: Date.now() } });
          const back = r.captions.length ? `，找回 ${r.captions.length} 句字幕` : "";
          const left = r.skipped.length ? `；${r.skipped.length} 句和现有字幕重叠，没放回` : "";
          get().toast(
            `已恢复剪掉的 ${((r.restoredMs[1] - r.restoredMs[0]) / 1000).toFixed(1)} 秒${back}${left}`,
          );
          await get().refresh();
        } catch (e) {
          endWrite(writeGeneration, e);
          fail(e, projectId, generation);
        }
      },

      async undo(direction) {
        const { api, project, history, projectId } = get();
        if (!project || !history?.[direction]) return;
        const generation = requestGeneration;
        const writeGeneration = beginWrite();
        try {
          const r = await api.undo(direction, project.revision);
          endWrite(writeGeneration);
          if (generation !== requestGeneration || get().projectId !== projectId) return;
          set({ flash: { ids: r.changed, at: Date.now() }, aiChange: null });
          get().toast(direction === "undo" ? "已撤销" : "已重做");
          await get().refresh();
        } catch (e) {
          endWrite(writeGeneration, e);
          fail(e, projectId, generation);
        }
      },

      async addComment(c) {
        const { api, projectId } = get();
        const generation = requestGeneration;
        const writeGeneration = beginWrite();
        try {
          await api.comment({ ...c, actor: "user" });
          endWrite(writeGeneration);
        } catch (e) {
          endWrite(writeGeneration, e);
          fail(e, projectId, generation);
          return false;
        }
        if (generation !== requestGeneration || get().projectId !== projectId) return true;
        try {
          const result = await api.review();
          if (generation !== requestGeneration || get().projectId !== projectId) return true;
          set({ review: result.review, pin: null, commentDraft: null });
          get().toast("批注已记下，AI 下次工作时会先处理它");
        } catch (e) {
          fail(e, projectId, generation);
        }
        return true;
      },

      async setCommentStatus(id, status) {
        const { api, projectId } = get();
        const generation = requestGeneration;
        const writeGeneration = beginWrite();
        try {
          await api.setComment(id, { status, actor: "user" });
          endWrite(writeGeneration);
        } catch (e) {
          endWrite(writeGeneration, e);
          fail(e, projectId, generation);
          return;
        }
        if (generation !== requestGeneration || get().projectId !== projectId) return;
        try {
          const result = await api.review();
          if (generation === requestGeneration && get().projectId === projectId)
            set({ review: result.review });
        } catch (e) {
          fail(e, projectId, generation);
        }
      },

      async startExport() {
        if (get().exportJob && !get().exportJob?.done) return;
        const { api, projectId } = get();
        const generation = requestGeneration;
        try {
          set({ exportJob: { progress: 0, done: false } });
          await api.exportVideo();
        } catch (e) {
          if (
            generation === requestGeneration &&
            get().projectId === projectId &&
            !get().exportJob?.done
          ) {
            set({ exportJob: null });
            fail(e, projectId, generation);
          }
        }
      },

      select: (id, opts) =>
        set((s) => ({
          selected: id,
          ...(id && opts?.reveal !== false
            ? { revealNonce: s.revealNonce + 1, sideTab: "props" as const }
            : {}),
        })),
      seek: (frame) =>
        set((s) => ({ frame: Math.max(0, Math.round(frame)), seekNonce: s.seekNonce + 1 })),
      setFrame: (frame) => set({ frame }),
      setPlaying: (playing) => set({ playing }),
      setDraft: (draft) => set({ draft }),
      // 窄容器里两边都是抽屉，同一时间只开一个
      setSideTab: (sideTab) => set({ sideTab, sideOpen: true, leftOpen: false }),
      setSideOpen: (sideOpen) =>
        set((s) => ({ sideOpen, leftOpen: sideOpen ? false : s.leftOpen })),
      setLeftTab: (leftTab) => set({ leftTab, leftOpen: true, sideOpen: false }),
      setLeftOpen: (leftOpen) =>
        set((s) => ({ leftOpen, sideOpen: leftOpen ? false : s.sideOpen })),
      confirmAiChanges() {
        const { project, name } = get();
        if (!project) return;
        set({ reviewedRev: project.revision, aiChange: null });
        saveReviewed(name, project.revision);
      },
      updateEditor(patch) {
        set((s) => ({ editor: s.editor ? { ...s.editor, ...patch } : s.editor }));
        editorPatch = { ...editorPatch, ...patch };
        editorPatchApi = get().api;
        if (editorTimer) clearTimeout(editorTimer);
        // 连续拖动只存最后一次；保存使用修改发生时绑定的工程 API。
        editorTimer = setTimeout(() => {
          void flushEditor().catch(() => get().toast("预览设置保存失败", "error"));
        }, 240);
      },
      setLayoutEditing: (layoutEditing) => set({ layoutEditing }),
      async saveLayout(next) {
        const { api } = get();
        const before = get().layout;
        const parsed = Layout.safeParse(next);
        if (!parsed.success) {
          get().toast(`版式不合法：${parsed.error.issues[0]?.message ?? ""}`, "error");
          return;
        }
        // 先改本地，拖动时不等网络
        set({ layout: parsed.data });
        try {
          const r = await api.saveLayout(next);
          set({ layout: r.layout });
        } catch (e) {
          set({ layout: before });
          get().toast(e instanceof Error ? e.message : String(e), "error");
        }
      },
      toggleSnap: () => set((s) => ({ snap: !s.snap })),
      setCaptionTab: (captionTab) => set({ captionTab }),
      setCropEditing: (cropEditing) => set({ cropEditing }),
      setAnnotating: (annotating) =>
        set((s) => ({
          annotating,
          ...(annotating ? { playing: false, pin: null } : {}),
        })),
      setPin: (pin) => set({ pin }),
      dismissAiChange: () => set({ aiChange: null }),
      toast(text, tone = "info") {
        const id = ++toastId;
        set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone }] }));
        setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200);
      },
    };
  });
  return store;
}

export const useStore = createWorkbenchStore();
