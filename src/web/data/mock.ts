import { EditorState, type HistoryEntry, type ServerEvent } from "../../core/api";
import { compile } from "../../core/compile";
import { MwError } from "../../core/errors";
import { lintProject } from "../../core/lint";
import { applyOps } from "../../core/ops";
import { BUILTIN_STYLES } from "../../core/presets";
import { addComment, Review, setCommentStatus } from "../../core/review";
import { Project } from "../../core/schema";
import { changedIds, undoState } from "../../core/undo";
import { TEMPLATES } from "../../templates";
import { type Api, ApiFailure, type LiveEvent } from "./client";

// Mock 模式（VITE_MW_MOCK=1）：不连服务端，在浏览器里用 core 的真实逻辑维护一份内存工程。
// 提交的操作照样校验、编排；撤销、批注、质检也是真的，只是没有视频画面和渲染。

const SECOND = 1000;

function demoProject(): Project {
  // 示例文案是编的，不来自任何用户素材
  const lines = [
    "很多人存不下钱",
    "不是因为赚得少",
    "而是钱流走了自己都不知道",
    "第一件事 先记三个月的账",
    "你会发现大部分钱花在了小额消费上",
    "第二件事 工资一到先转走一部分",
    "第三件事 给每一笔大支出留出等待期",
    "坚持半年 你会回来感谢自己",
  ];
  // 第 3、5 句后面各有一段被粗剪掉的废话（口误、停顿）
  const cutAfter: Record<number, number> = { 2: 1600, 4: 1300 };
  let t = 2600;
  const captions = lines.map((text, i) => {
    const len = 1300 + [...text].length * 160;
    const c = { id: `s${i + 1}`, asset: "raw", startMs: t, endMs: t + len, text };
    t += len + 240 + (cutAfter[i] ?? 0);
    return c;
  });
  const at = (i: number) => captions[i] ?? { startMs: 0, endMs: 0 };
  return Project.parse({
    version: 4,
    revision: 0,
    canvas: { background: "#1a1b1f" },
    assets: {
      raw: {
        kind: "video",
        path: "/素材/口播原片.mov",
        probe: { durationMs: t + 2000, width: 1080, height: 1920, fps: 30 },
        cache: { faces: "cache/media/demo.faces.json" },
      },
      outro: {
        kind: "video",
        path: "/素材/片尾.mp4",
        probe: { durationMs: 1800, width: 1080, height: 1920, fps: 30 },
      },
    },
    styles: Object.fromEntries(
      Object.entries(BUILTIN_STYLES).map(([k, v]) => [
        k,
        { ...v, font: { ...v.font, family: "PingFang SC", fallback: [] } },
      ]),
    ),
    tracks: [
      {
        id: "main",
        name: "主轨",
        kind: "video",
        main: true,
        items: [
          {
            id: "c1",
            type: "clip",
            asset: "raw",
            inMs: 2400,
            outMs: at(2).endMs + 120,
            speed: 1.1,
          },
          {
            id: "c2",
            type: "clip",
            asset: "raw",
            inMs: at(3).startMs - 120,
            outMs: at(4).endMs + 120,
            speed: 1.1,
            cutBefore: "口误",
          },
          {
            id: "c3",
            type: "clip",
            asset: "raw",
            inMs: at(5).startMs - 120,
            outMs: t,
            speed: 1.1,
            cutBefore: "停顿",
          },
        ],
      },
      { id: "cap", name: "字幕", kind: "caption", items: captions },
      {
        id: "ov",
        name: "标题",
        kind: "overlay",
        items: [
          {
            id: "o1",
            template: "title-bar",
            at: { ms: 0 },
            durationMs: "toEnd",
            props: { lines: ["普通人存钱", "先搞懂这三件事"] },
          },
        ],
      },
    ],
    outro: { asset: "outro" },
    chapters: [
      { title: "开场", at: { caption: "s1" } },
      { title: "记账", at: { caption: "s4" } },
      { title: "先存", at: { caption: "s6" } },
      { title: "等待期", at: { caption: "s7" } },
      { title: "结尾", at: { caption: "s8" } },
    ],
  });
}

type Entry = { project: Project; log: HistoryEntry };

export function createMockApi(): Api {
  const init = demoProject();
  const entries: Entry[] = [
    {
      project: init,
      log: {
        revision: 0,
        at: new Date().toISOString(),
        actor: "user",
        source: "cli",
        kind: "init",
        changed: [],
        ops: [],
      },
    },
  ];
  let review = Review.parse({});
  let editor = EditorState.parse({});
  const listeners = new Set<(e: LiveEvent) => void>();
  const emit = (e: ServerEvent) => {
    for (const fn of listeners) fn(e);
  };
  const current = () => entries.at(-1)?.project ?? init;

  const commit = (
    next: Project,
    meta: Omit<HistoryEntry, "revision" | "at" | "changed">,
    changed: string[],
  ) => {
    const project = { ...next, revision: current().revision + 1 };
    const log = { ...meta, revision: project.revision, at: new Date().toISOString(), changed };
    entries.push({ project, log });
    emit({ type: "project", revision: project.revision, changed, ...meta });
    return { ok: true as const, revision: project.revision, changed, warnings: [], dryRun: false };
  };

  const fail = (e: unknown): never => {
    if (e instanceof MwError) throw new ApiFailure(e.code, e.message);
    throw e;
  };
  const checkBase = (base: number) => {
    if (base !== current().revision)
      throw new ApiFailure(
        "CONFLICT",
        `工程已经是第 ${current().revision} 版，提交基于第 ${base} 版`,
      );
  };
  const meta = (author: string) => ({
    author,
    now: new Date().toISOString(),
    revision: current().revision,
  });

  review = addComment(
    review,
    { text: "标题条再往上一点，别压到额头", atMs: 1200, target: "o1" },
    { ...meta("user"), source: "ui" },
  );
  review = addComment(
    review,
    { text: "「小额消费」这几个字要高亮", atMs: 14_000, target: "s5" },
    { ...meta("user"), source: "ui" },
  );
  review = setCommentStatus(review, "k2", "resolved", {
    ...meta("claude"),
    note: "给 s5 加了关键词高亮「小额消费」",
  });

  const api: Api = {
    project: async () => ({ ok: true, name: "存钱三件事（示例）", project: current() }),
    preview: async () => ({
      ok: true,
      props: { timeline: compile(current()), styles: current().styles, srcs: {}, fonts: [] },
    }),
    history: async () => {
      const logs = entries.map((e) => e.log);
      return { ok: true, entries: logs, ...undoState(logs) };
    },
    lint: async () => ({
      ok: true,
      revision: current().revision,
      issues: lintProject(current(), {
        styles: { ...BUILTIN_STYLES, ...current().styles },
        overlayBounds: (o, style) => {
          const tpl = TEMPLATES[o.template];
          const props = tpl?.schema.safeParse(o.props);
          if (!tpl?.bounds || !props?.success) return { text: [], shapes: [] };
          return tpl.bounds(props.data, style, current().canvas.width, current().canvas.height);
        },
      }),
      noFaceData: ["outro"],
    }),
    review: async () => ({ ok: true, review }),
    editor: async () => ({ ok: true, editor }),
    saveEditor: async (next) => {
      editor = EditorState.parse(next);
    },
    // 假波形：有起伏的说话声，句子之间安静
    peaks: async () => ({
      ok: true,
      msPerPeak: 10,
      peaks: Array.from({ length: 4000 }, (_, i) => {
        const syllable = Math.abs(Math.sin(i / 7) * Math.sin(i / 23));
        const pause = Math.sin(i / 160) > 0.92 ? 0.08 : 1;
        return Math.min(1, 0.12 + syllable * 0.8 * pause);
      }),
    }),
    ops: async (req) => {
      checkBase(req.baseRevision);
      try {
        const r = applyOps(current(), req.ops);
        return commit(
          r.project,
          { actor: req.actor ?? "user", source: "ui", kind: "apply", ops: [] },
          changedIds(current(), r.project),
        );
      } catch (e) {
        return fail(e);
      }
    },
    undo: async (direction, base) => {
      checkBase(base);
      const st = undoState(entries.map((e) => e.log))[direction];
      if (!st)
        throw new ApiFailure(
          "NOT_FOUND",
          direction === "undo" ? "没有可以撤销的修改" : "没有可以重做的修改",
        );
      const target = entries.find((e) => e.log.revision === st.revision)?.project ?? init;
      return commit(
        target,
        { actor: "user", source: "ui", kind: direction, ops: [] },
        changedIds(current(), target),
      );
    },
    comment: async (req) => {
      const { actor, ...input } = req;
      review = addComment(review, input, { ...meta(actor ?? "user"), source: "ui" });
      emit({ type: "review" });
      return { ok: true, comment: review.comments.at(-1) as Review["comments"][number] };
    },
    setComment: async (id, req) => {
      try {
        review = setCommentStatus(review, id, req.status, {
          ...meta(req.actor ?? "user"),
          note: req.note,
        });
      } catch (e) {
        fail(e);
      }
      emit({ type: "review" });
      return {
        ok: true,
        comment: review.comments.find((c) => c.id === id) as Review["comments"][number],
      };
    },
    exportVideo: async () => {
      const jobId = `export-mock-${Date.now()}`;
      let p = 0;
      const tick = setInterval(() => {
        p = Math.min(1, p + 0.08);
        const done = p >= 1;
        emit({
          type: "export",
          jobId,
          progress: p,
          done,
          ...(done ? { file: "renders/示例.mp4" } : {}),
        });
        if (done) clearInterval(tick);
      }, 250);
      return { ok: true, jobId };
    },
    subscribe(onEvent, onStatus) {
      listeners.add(onEvent);
      onStatus(true);
      onEvent({ type: "hello", revision: current().revision });
      return () => listeners.delete(onEvent);
    },
  };

  // 模拟 AI：几秒后按第一条批注把标题条上移，并标记已处理，演示「AI 改动」提示和撤销
  setTimeout(async () => {
    const p = current();
    const r = applyOps(p, [{ op: "item.update", id: "o1", set: { transform: { y: 900 } } }]);
    commit(r.project, { actor: "claude", source: "mcp", kind: "apply", ops: ["item.update"] }, [
      "o1",
    ]);
    review = setCommentStatus(review, "k1", "resolved", {
      ...meta("claude"),
      note: "标题条整体上移 60px",
    });
    emit({ type: "review" });
  }, 6 * SECOND);

  return api;
}
