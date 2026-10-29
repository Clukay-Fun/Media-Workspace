import { create } from "zustand";
import type { HistoryResponse, LintResponse, PreviewProps } from "../core/api";
import type { ResolvedTimeline } from "../core/compile";
import type { Op } from "../core/ops";
import type { NewComment, Review } from "../core/review";
import type { Project } from "../core/schema";
import { type Api, ApiFailure, type LiveEvent } from "./data/client";

// 界面状态。工程数据只从服务端读，修改一律提交 ops（AGENTS.md 规则 1）；
// 本地只有选中、播放头、拖动中的草稿这些不影响渲染的东西。

/** 侧栏分页。「选中」只在窄屏合并成一栏时出现，宽屏时选中的内容在右栏 */
export type PanelTab = "selection" | "comments" | "styles" | "assets";

export type AiChange = { actor: string; revision: number; changed: string[] };

export type Toast = { id: number; text: string; tone: "info" | "error" };

export type ExportJob = { progress: number; done: boolean; file?: string; error?: string };

type State = {
  api: Api;
  name: string;
  project: Project | null;
  preview: PreviewProps | null;
  history: HistoryResponse | null;
  lint: LintResponse | null;
  review: Review | null;
  peaks: Record<string, { msPerPeak: number; peaks: number[] } | null>;
  live: boolean;
  /** 工程或预览加载失败的原因（例如缺字体），一直显示在画面区域，直到下次加载成功 */
  loadError: string | null;

  selected: string | null;
  /** 在画面、时间线上主动选中时加一；窄屏侧栏据此切到「选中」页（从批注列表跳过去时不加） */
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
  panelTab: PanelTab;
  safeArea: boolean;
  composerNonce: number;
  /** 双击画面钉下的位置（画布像素），写批注时一起提交 */
  pin: { x: number; y: number } | null;

  init(): () => void;
  refresh(): Promise<void>;
  submit(ops: Op[], label?: string): Promise<boolean>;
  undo(direction: "undo" | "redo"): Promise<void>;
  addComment(c: NewComment): Promise<void>;
  setCommentStatus(id: string, status: "open" | "resolved"): Promise<void>;
  startExport(): Promise<void>;
  select(id: string | null, opts?: { reveal?: boolean }): void;
  seek(frame: number): void;
  setFrame(frame: number): void;
  setPlaying(playing: boolean): void;
  setDraft(draft: State["draft"]): void;
  setPanelTab(tab: PanelTab): void;
  toggleSafeArea(): void;
  focusComposer(): void;
  setPin(pin: State["pin"]): void;
  dismissAiChange(): void;
  toast(text: string, tone?: Toast["tone"]): void;
};

let toastId = 0;

export const useStore = create<State>((set, get) => {
  const fail = (e: unknown) => {
    const conflict = e instanceof ApiFailure && e.code === "CONFLICT";
    get().toast(
      conflict
        ? "工程刚被其他地方修改过，已刷新到最新版本，请再操作一次"
        : e instanceof Error
          ? e.message
          : String(e),
      "error",
    );
    void get().refresh();
  };

  const loadPeaks = async (project: Project) => {
    const { api, peaks } = get();
    for (const [id, a] of Object.entries(project.assets)) {
      if (a.kind === "image" || id in peaks) continue;
      set((s) => ({ peaks: { ...s.peaks, [id]: null } }));
      const p = await api.peaks(id);
      if (p) set((s) => ({ peaks: { ...s.peaks, [id]: p } }));
    }
  };

  const onEvent = (e: LiveEvent) => {
    const s = get();
    if (e.type === "hello") {
      if (e.revision !== s.project?.revision) void s.refresh();
      return;
    }
    if (e.type === "review") {
      void s.api.review().then((r) => set({ review: r.review }));
      return;
    }
    if (e.type === "export") {
      set({
        exportJob: {
          progress: e.progress,
          done: e.done,
          file: e.file,
          error: e.error?.message,
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

  return {
    api: undefined as unknown as Api,
    name: "",
    project: null,
    preview: null,
    history: null,
    lint: null,
    review: null,
    peaks: {},
    live: false,
    loadError: null,
    selected: null,
    frame: 0,
    seekNonce: 0,
    playing: false,
    draft: null,
    flash: null,
    aiChange: null,
    exportJob: null,
    toasts: [],
    panelTab: "comments",
    safeArea: false,
    composerNonce: 0,
    pin: null,
    revealNonce: 0,

    init() {
      void get().refresh();
      return get().api.subscribe(onEvent, (live) => set({ live }));
    },

    async refresh() {
      const { api } = get();
      try {
        const [p, v, h, l, r] = await Promise.all([
          api.project(),
          api.preview(),
          api.history(),
          api.lint(),
          api.review(),
        ]);
        set({
          name: p.name,
          project: p.project,
          preview: v.props,
          history: h,
          lint: l,
          review: r.review,
          loadError: null,
        });
        void loadPeaks(p.project);
      } catch (e) {
        set({ loadError: e instanceof Error ? e.message : String(e) });
      }
    },

    async submit(ops, label) {
      const { api, project } = get();
      if (!project || ops.length === 0) return false;
      try {
        await api.ops({ ops, baseRevision: project.revision, actor: "user" });
        if (label) get().toast(label);
        await get().refresh();
        return true;
      } catch (e) {
        fail(e);
        return false;
      }
    },

    async undo(direction) {
      const { api, project, history } = get();
      if (!project || !history?.[direction]) return;
      try {
        const r = await api.undo(direction, project.revision);
        set({ flash: { ids: r.changed, at: Date.now() }, aiChange: null });
        get().toast(direction === "undo" ? "已撤销" : "已重做");
        await get().refresh();
      } catch (e) {
        fail(e);
      }
    },

    async addComment(c) {
      try {
        await get().api.comment({ ...c, actor: "user" });
        set({ review: (await get().api.review()).review, pin: null });
        get().toast("批注已记下，AI 下次工作时会先处理它");
      } catch (e) {
        fail(e);
      }
    },

    async setCommentStatus(id, status) {
      try {
        await get().api.setComment(id, { status, actor: "user" });
        set({ review: (await get().api.review()).review });
      } catch (e) {
        fail(e);
      }
    },

    async startExport() {
      if (get().exportJob && !get().exportJob?.done) return;
      try {
        set({ exportJob: { progress: 0, done: false } });
        await get().api.exportVideo();
      } catch (e) {
        set({ exportJob: null });
        fail(e);
      }
    },

    select: (id, opts) =>
      set((s) => ({
        selected: id,
        revealNonce: id && opts?.reveal !== false ? s.revealNonce + 1 : s.revealNonce,
      })),
    seek: (frame) =>
      set((s) => ({ frame: Math.max(0, Math.round(frame)), seekNonce: s.seekNonce + 1 })),
    setFrame: (frame) => set({ frame }),
    setPlaying: (playing) => set({ playing }),
    setDraft: (draft) => set({ draft }),
    setPanelTab: (panelTab) => set({ panelTab }),
    toggleSafeArea: () => set((s) => ({ safeArea: !s.safeArea })),
    focusComposer: () => set((s) => ({ composerNonce: s.composerNonce + 1 })),
    setPin: (pin) => set({ pin }),
    dismissAiChange: () => set({ aiChange: null }),
    toast(text, tone = "info") {
      const id = ++toastId;
      set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone }] }));
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200);
    },
  };
});
