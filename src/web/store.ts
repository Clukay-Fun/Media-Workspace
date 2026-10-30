import { create } from "zustand";
import type { HistoryResponse, LintResponse, PreviewProps } from "../core/api";
import type { ResolvedTimeline } from "../core/compile";
import { planSplit } from "../core/edit";
import type { Op } from "../core/ops";
import type { NewComment, Review } from "../core/review";
import type { Project } from "../core/schema";
import { type Api, ApiFailure, type LiveEvent } from "./data/client";
import { msOfFrame } from "./lib/timeline";

// 界面状态。工程数据只从服务端读，修改一律提交 ops（AGENTS.md 规则 1）；
// 本地只有选中、播放头、拖动中的草稿这些不影响渲染的东西。

/** 右栏三页：属性（选中元素能点的选项；没选中时是章节和质检）、批注、AI 改动 */
export type SideTab = "props" | "comments" | "changes";

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

export type ExportJob = { progress: number; done: boolean; file?: string; error?: string };

type State = {
  api: Api;
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
  safeArea: boolean;
  referenceGuides: { horizontal: boolean; vertical: boolean };
  /** 时间线拖动时吸附到字幕边界、播放头 */
  snap: boolean;
  /** 选中字幕时显示全部字幕列表 */
  captionList: boolean;
  /** 正在等待用户在预览画面中点选批注目标 */
  annotating: boolean;
  /** 点选画面目标时钉下的位置（画布像素），写批注时一起提交 */
  pin: { x: number; y: number } | null;

  init(): () => void;
  refresh(): Promise<void>;
  submit(ops: Op[], label?: string): Promise<boolean>;
  undo(direction: "undo" | "redo"): Promise<void>;
  /** 在播放头处分割选中的条目；没选中时分割播放头下的主轨片段 */
  splitAtPlayhead(): Promise<void>;
  addComment(c: NewComment): Promise<void>;
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
  toggleSafeArea(): void;
  toggleReferenceGuide(axis: "horizontal" | "vertical"): void;
  setCaptionList(on: boolean): void;
  toggleSnap(): void;
  setAnnotating(on: boolean): void;
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
    dir: null,
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
    sideTab: "props",
    leftTab: "assets",
    leftOpen: false,
    sideOpen: false,
    reviewedRev: null,
    safeArea: false,
    referenceGuides: { horizontal: false, vertical: false },
    captionList: false,
    snap: true,
    annotating: false,
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
          dir: p.dir ?? null,
          project: p.project,
          preview: v.props,
          history: h,
          lint: l,
          review: r.review,
          loadError: null,
          reviewedRev: get().reviewedRev ?? loadReviewed(p.name, p.project.revision),
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
    setSideOpen: (sideOpen) => set((s) => ({ sideOpen, leftOpen: sideOpen ? false : s.leftOpen })),
    setLeftTab: (leftTab) => set({ leftTab, leftOpen: true, sideOpen: false }),
    setLeftOpen: (leftOpen) => set((s) => ({ leftOpen, sideOpen: leftOpen ? false : s.sideOpen })),
    confirmAiChanges() {
      const { project, name } = get();
      if (!project) return;
      set({ reviewedRev: project.revision, aiChange: null });
      saveReviewed(name, project.revision);
    },
    toggleSafeArea: () => set((s) => ({ safeArea: !s.safeArea })),
    toggleReferenceGuide: (axis) =>
      set((s) => ({
        referenceGuides: { ...s.referenceGuides, [axis]: !s.referenceGuides[axis] },
      })),
    setCaptionList: (captionList) => set({ captionList }),
    toggleSnap: () => set((s) => ({ snap: !s.snap })),
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
