import { transformAt } from "./animate";
import { compile, layoutMainTrack, mapTimelineMs, type ResolvedTimeline } from "./compile";
import { MwError } from "./errors";
import type { Op } from "./ops";
import type { Caption, Keyframe, Project, Track, Transform } from "./schema";
import { canvasTargets, type SnapTarget, snapRange, snapValue, timelineTargets } from "./snap";
import { frameToMs } from "./time";

// 界面编辑的纯函数（阶段 B）：时间线拖动、裁剪、分割，预览画面里的移动缩放。
// 输入是当前工程和一次手势，输出是「松开时要提交的 ops」和拖动过程中的本地预览（D23）。
// 界面不自己算时间和剪辑逻辑，一律调用这里（AGENTS.md 规则 2）。

/** 吸附到的目标（时间线上用毫秒，画面里用像素） */
export type SnapHit = { at: number; kind: string; id?: string };

export type DragMode = "move" | "trimStart" | "trimEnd";

export type DragRequest = {
  id: string;
  mode: DragMode;
  /** 鼠标在时间线上移动的毫秒数（界面用 pxPerSecond 换算） */
  deltaMs: number;
  snap: boolean;
  /** 吸附阈值（毫秒），界面按 thresholdPx / pxPerSecond 换算；默认 100 */
  snapThresholdMs?: number;
  playheadMs?: number;
};

export type DragPlan = {
  ops: Op[];
  /** 松开后这个条目在时间线上的位置（毫秒），拖动过程中用它画本地预览 */
  preview: { startMs: number; endMs: number };
  snappedTo: SnapHit | null;
};

/** 最短保留一帧多一点，避免拖成 0 长度 */
const MIN_MS = 40;

/** 选中后方向键的步长：一帧，按住 Shift 是一秒 */
export function nudgeDeltaMs(fps: number, shift: boolean, direction: -1 | 1): number {
  const step = shift ? 1000 : 1000 / Math.max(1, fps);
  return direction * step;
}

type Found = { track: Track; index: number; item: Track["items"][number] };

function findItem(project: Project, id: string): Found {
  for (const track of project.tracks) {
    const index = track.items.findIndex((it) => it.id === id);
    const item = track.items[index];
    if (item) return { track, index, item };
  }
  throw new MwError("NOT_FOUND", `条目「${id}」不存在`);
}

function assertUnlocked(track: Track): void {
  if (track.locked) {
    throw new MwError("TRACK_LOCKED", `轨道「${track.name ?? track.id}」已锁定`, {
      hint: "先解锁这条轨道",
    });
  }
}

const isMainTrack = (t: Track) => t.kind === "video" && t.main;

/** 条目在时间线上的范围（毫秒）。字幕被剪成几段时取第一段开头到最后一段结尾 */
function itemRange(tl: ResolvedTimeline, id: string): { startMs: number; endMs: number } {
  const all = [...tl.videos, ...tl.images, ...tl.captions, ...tl.overlays].filter(
    (x) => x.id === id,
  );
  if (all.length === 0)
    throw new MwError("INVALID_OP", `条目「${id}」不在时间线上（可能已经被剪掉）`);
  const from = Math.min(...all.map((x) => x.from));
  const to = Math.max(...all.map((x) => x.from + x.durationInFrames));
  return { startMs: frameToMs(from, tl.fps), endMs: frameToMs(to, tl.fps) };
}

function msTargets(tl: ResolvedTimeline, id: string, playheadMs?: number): SnapTarget[] {
  const out = timelineTargets(tl, { exclude: id }).map((x) => ({
    ...x,
    at: frameToMs(x.at, tl.fps),
  }));
  if (playheadMs !== undefined) out.push({ at: playheadMs, kind: "playhead" });
  return out;
}

type TrackSpan = { id: string; startMs: number; endMs: number };

/** 同一条轨道上、用户看得到的范围。一句字幕被剪成几段时合成一段 */
function trackSpans(tl: ResolvedTimeline, trackId: string): TrackSpan[] {
  const pieces = [
    ...tl.videos.filter((x) => x.trackId === trackId),
    ...tl.images.filter((x) => x.trackId === trackId),
    ...tl.captions.filter((x) => x.trackId === trackId),
    ...tl.overlays.filter((x) => x.trackId === trackId),
  ];
  const byId = new Map<string, TrackSpan>();
  for (const x of pieces) {
    const startMs = frameToMs(x.from, tl.fps);
    const endMs = frameToMs(x.from + x.durationInFrames, tl.fps);
    const prev = byId.get(x.id);
    if (!prev) byId.set(x.id, { id: x.id, startMs, endMs });
    else {
      prev.startMs = Math.min(prev.startMs, startMs);
      prev.endMs = Math.max(prev.endMs, endMs);
    }
  }
  return [...byId.values()].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

/**
 * 同一条字幕轨道上，拖动不能盖住相邻字幕。
 * 移动时时长不变，贴到邻居就停；左右都没有空隙时留在原地。
 * 裁剪时停在邻居边上，宽度可以变，直到碰到。
 */
function limitToNeighbors(
  tl: ResolvedTimeline,
  trackId: string,
  id: string,
  cur: { startMs: number; endMs: number },
  startMs: number,
  endMs: number,
  mode: DragMode,
): { startMs: number; endMs: number } {
  const spans = trackSpans(tl, trackId);
  const index = spans.findIndex((s) => s.id === id);
  if (index < 0) return { startMs, endMs };
  const prev = spans[index - 1];
  const next = spans[index + 1];
  const len = cur.endMs - cur.startMs;
  if (mode === "move") {
    const lo = Math.max(0, prev ? prev.endMs : 0);
    const hi = next ? next.startMs - len : Number.POSITIVE_INFINITY;
    if (hi < lo - 0.5) return { startMs: cur.startMs, endMs: cur.endMs };
    const start = Math.min(hi, Math.max(lo, startMs));
    return { startMs: start, endMs: start + len };
  }
  if (mode === "trimStart") {
    let start = startMs;
    if (prev && prev.endMs <= endMs - MIN_MS) start = Math.max(start, prev.endMs);
    start = Math.min(Math.max(0, start), endMs - MIN_MS);
    return { startMs: start, endMs };
  }
  let end = endMs;
  if (next && next.startMs >= startMs + MIN_MS) end = Math.min(end, next.startMs);
  end = Math.max(end, startMs + MIN_MS);
  return { startMs, endMs: end };
}

/** 时间线拖动：整体移动时长不变；拖开头时结尾不动；拖结尾时开头不动 */
export function planDrag(project: Project, req: DragRequest): DragPlan {
  const { track, index, item } = findItem(project, req.id);
  assertUnlocked(track);
  const tl = compile(project);
  const cur = itemRange(tl, req.id);
  const threshold = req.snapThresholdMs ?? 100;
  const targets = req.snap ? msTargets(tl, req.id, req.playheadMs) : [];

  let start = cur.startMs;
  let end = cur.endMs;
  let hit: SnapTarget | null = null;
  if (req.mode === "move") {
    const r = snapRange(cur.startMs + req.deltaMs, cur.endMs - cur.startMs, targets, threshold);
    start = Math.max(0, r.start);
    end = start + (cur.endMs - cur.startMs);
    hit = r.target;
  } else if (req.mode === "trimStart") {
    const r = snapValue(cur.startMs + req.deltaMs, targets, threshold);
    start = Math.max(0, Math.min(r.value, cur.endMs - MIN_MS));
    hit = r.target;
  } else {
    const r = snapValue(cur.endMs + req.deltaMs, targets, threshold);
    end = Math.max(r.value, cur.startMs + MIN_MS);
    hit = r.target;
  }
  // 只有字幕会被后一句裁成一帧（handoff = cut）。标题和卡片允许重叠，不在这里挡
  if (track.kind === "caption") {
    const limited = limitToNeighbors(tl, track.id, req.id, cur, start, end, req.mode);
    start = limited.startMs;
    end = limited.endMs;
    if (hit && Math.abs(hit.at - start) > 0.5 && Math.abs(hit.at - end) > 0.5) hit = null;
  }
  const snappedTo = hit ? { at: hit.at, kind: hit.kind, ...(hit.id ? { id: hit.id } : {}) } : null;
  const dStart = start - cur.startMs;
  const dEnd = end - cur.endMs;

  // 主轨：磁吸，移动 = 换顺序，裁剪 = 改入点 / 出点，后面的片段自动跟上
  if (isMainTrack(track) && "type" in item && item.type === "clip" && !("at" in item)) {
    if (req.mode === "move") {
      const segs = layoutMainTrack(project).filter((s) => s.clip.id !== req.id);
      const mid = (start + end) / 2;
      const to = segs.filter((s) => (s.startMs + s.endMs) / 2 < mid).length;
      const ops: Op[] = to === index ? [] : [{ op: "item.move", id: req.id, index: to }];
      return { ops, preview: { startMs: start, endMs: end }, snappedTo };
    }
    const dur = project.assets[item.asset]?.probe?.durationMs ?? Number.POSITIVE_INFINITY;
    if (req.mode === "trimStart") {
      const inMs = clampInt(item.inMs + dStart * item.speed, 0, item.outMs - MIN_MS * item.speed);
      const kept = (item.outMs - inMs) / item.speed;
      return {
        ops: [{ op: "clip.trim", id: req.id, inMs }],
        // 磁吸主轨：开头位置不变，片段变短
        preview: { startMs: cur.startMs, endMs: cur.startMs + kept },
        snappedTo,
      };
    }
    const outMs = clampInt(item.outMs + dEnd * item.speed, item.inMs + MIN_MS * item.speed, dur);
    return {
      ops: [{ op: "clip.trim", id: req.id, outMs }],
      preview: { startMs: cur.startMs, endMs: cur.startMs + (outMs - item.inMs) / item.speed },
      snappedTo,
    };
  }

  // 字幕：绑定素材源时间（D19），在时间线上移动 = 换算成源时间后平移
  if (track.kind === "caption") {
    const cap = item as Caption;
    const segs = layoutMainTrack(project);
    const toSrc = (ms: number, edge: "start" | "end") => {
      // 结尾落在片段末尾时，取前一毫秒所在的片段，避免算到下一个片段上
      const m = mapTimelineMs(segs, edge === "end" ? Math.max(0, ms - 1) : ms);
      if (!m || m.asset !== cap.asset)
        throw new MwError("INVALID_OP", "字幕只能放在它对应素材的画面上", {
          hint: "字幕绑定素材源时间（D19）；换素材请重新导入字幕",
        });
      return Math.round(edge === "end" ? m.srcMs + 1 : m.srcMs);
    };
    const set: Partial<Caption> = {};
    if (req.mode === "move") {
      const shift = toSrc(start, "start") - cap.startMs;
      set.startMs = cap.startMs + shift;
      set.endMs = cap.endMs + shift;
      if (cap.charStartMs) set.charStartMs = cap.charStartMs.map((v) => Math.max(0, v + shift));
    } else if (req.mode === "trimStart") {
      set.startMs = Math.min(toSrc(start, "start"), cap.endMs - MIN_MS);
    } else {
      set.endMs = Math.max(toSrc(end, "end"), cap.startMs + MIN_MS);
    }
    return {
      ops: [{ op: "caption.update", id: req.id, set }],
      preview: { startMs: start, endMs: end },
      snappedTo,
    };
  }

  // 普通轨道上的片段、图片、叠加层：跟随字幕 / 片段的锚点保留下来，只调 offsetMs（D28：
  // 「早一点 / 晚一点」之后，剪切、变速时仍然跟着那句话走）；本来就是绝对时间的照旧改 ms
  const anchor = "at" in item ? item.at : null;
  const at =
    anchor && !("ms" in anchor)
      ? { ...anchor, offsetMs: anchor.offsetMs + Math.round(start - cur.startMs) }
      : { ms: Math.round(start) };
  const set: Record<string, unknown> = {};
  if (req.mode === "move") set.at = at;
  if ("type" in item && item.type === "clip") {
    const speed = item.speed;
    if (req.mode === "trimStart") {
      set.at = at;
      set.inMs = clampInt(item.inMs + dStart * speed, 0, item.outMs - MIN_MS * speed);
    } else if (req.mode === "trimEnd") {
      const dur = project.assets[item.asset]?.probe?.durationMs ?? Number.POSITIVE_INFINITY;
      set.outMs = clampInt(item.outMs + dEnd * speed, item.inMs + MIN_MS * speed, dur);
    }
  } else if (req.mode !== "move") {
    if (req.mode === "trimStart") set.at = at;
    set.durationMs = Math.max(MIN_MS, Math.round(end - start));
  }
  return {
    ops: [{ op: "item.update", id: req.id, set }],
    preview: { startMs: start, endMs: end },
    snappedTo,
  };
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.round(Math.min(hi, Math.max(lo, v)));
}

/** 在播放头处分割（atMs 是时间线毫秒） */
export function planSplit(project: Project, req: { id: string; atMs: number }): { ops: Op[] } {
  const { track, index, item } = findItem(project, req.id);
  assertUnlocked(track);
  const tl = compile(project);
  const cur = itemRange(tl, req.id);
  if (req.atMs <= cur.startMs || req.atMs >= cur.endMs)
    throw new MwError("TIME_RANGE", "播放头不在这个条目上，不能分割");

  if (isMainTrack(track)) return { ops: [{ op: "clip.split", id: req.id, atMs: req.atMs }] };

  if (track.kind === "caption") {
    const cap = item as Caption;
    const m = mapTimelineMs(layoutMainTrack(project), req.atMs);
    if (!m || m.asset !== cap.asset)
      throw new MwError("INVALID_OP", "这个位置不在字幕对应的素材上");
    const srcMs = Math.round(m.srcMs);
    const chars = [...cap.text];
    // 有逐字时间时在播放头之后第一个开始念的字前断开；没有时按时间比例估算
    let at = cap.charStartMs
      ? cap.charStartMs.findIndex((t) => t >= srcMs)
      : Math.round((chars.length * (srcMs - cap.startMs)) / (cap.endMs - cap.startMs));
    if (at < 0) at = chars.length - 1;
    at = Math.min(chars.length - 1, Math.max(1, at));
    return { ops: [{ op: "caption.split", id: req.id, at, atMs: srcMs }] };
  }

  const rel = Math.round(req.atMs - cur.startMs);
  if ("type" in item && item.type === "clip") {
    return { ops: [{ op: "clip.split", id: req.id, atMs: rel }] };
  }
  // 图片、叠加层没有专门的分割操作：缩短原来的，后面复制一份
  const { id: _id, ...rest } = item as Record<string, unknown> & { id: string };
  const total = Math.round(cur.endMs - cur.startMs);
  const keyframes = (rest.keyframes as { atMs: number }[] | undefined) ?? [];
  return {
    ops: [
      {
        op: "item.update",
        id: req.id,
        set: { durationMs: rel, keyframes: keyframes.filter((k) => k.atMs <= rel) },
      },
      {
        op: "item.add",
        track: track.id,
        index: index + 1,
        item: {
          ...rest,
          at: { ms: Math.round(req.atMs) },
          durationMs: total - rel,
          keyframes: keyframes
            .filter((k) => k.atMs >= rel)
            .map((k) => ({ ...k, atMs: k.atMs - rel })),
        },
      },
    ],
  };
}

export type TransformRequest = {
  id: string;
  /** 手势结束时的变换（只写改动的字段） */
  transform: Transform;
  snap: boolean;
  /** 吸附阈值（画布像素），默认 8 */
  thresholdPx?: number;
  /** 参考线（editor.json） */
  guides?: { axis: "h" | "v"; pos: number }[];
  /**
   * 播放头相对元素开始的毫秒数。元素有关键帧时 transform 不起作用，改动写进这个时间的关键帧
   * （docs/decisions/0017）；不传时照旧写 transform
   */
  atMs?: number;
};

export type TransformPlan = {
  ops: Op[];
  preview: Required<Transform>;
  /** 吸附到的线，界面画出来 */
  guides: { axis: "h" | "v"; pos: number; kind: string }[];
};

const TRANSFORM_DEFAULT = (w: number, h: number): Required<Transform> => ({
  x: w / 2,
  y: h / 2,
  scale: 1,
  rotation: 0,
  opacity: 1,
  radius: 0,
});

/** 预览画面里移动、缩放：中心点和边缘吸附到画面中线、边缘和参考线 */
export function planTransform(project: Project, req: TransformRequest): TransformPlan {
  const { track, item } = findItem(project, req.id);
  assertUnlocked(track);
  if (!("transform" in item) && track.kind === "caption")
    throw new MwError("INVALID_OP", "字幕的位置由样式决定，请修改字幕样式的 layout");
  const { width, height } = project.canvas;
  const own = (item as { transform?: Transform }).transform ?? {};
  const kfs = (item as { keyframes?: Keyframe[] }).keyframes ?? [];
  const keyed = req.atMs !== undefined && kfs.length > 0 ? req.atMs : null;
  // 播放头离某个关键帧不到半帧，就算在这个关键帧上
  const halfFrame = 500 / project.canvas.fps;
  const onKf = keyed === null ? undefined : kfs.find((k) => Math.abs(k.atMs - keyed) < halfFrame);
  const base = { ...TRANSFORM_DEFAULT(width, height), ...stripUndefined(own) };
  // 有关键帧时，从画面上此刻的样子开始改，新加的关键帧不会跳
  const current =
    keyed === null
      ? base
      : transformAt(
          base,
          kfs.map((k) => ({
            frame: k.atMs,
            transform: { ...base, ...stripUndefined(k.transform) },
            easing: k.easing,
          })),
          onKf?.atMs ?? keyed,
        );
  const next: Required<Transform> = { ...current, ...stripUndefined(req.transform) };
  const hits: TransformPlan["guides"] = [];
  if (req.snap) {
    const th = req.thresholdPx ?? 8;
    const t = canvasTargets(
      width,
      height,
      (req.guides ?? []).map((g) => ({ ...g, kind: "guide" })),
    );
    // 画面按整幅画布大小缩放（视频、图片都是铺满后再缩放）
    const halfW = (width * next.scale) / 2;
    const halfH = (height * next.scale) / 2;
    const snapAxis = (c: number, half: number, ts: SnapTarget[], axis: "h" | "v") => {
      const cands = [
        { off: 0, r: snapValue(c, ts, th) },
        { off: -half, r: snapValue(c - half, ts, th) },
        { off: half, r: snapValue(c + half, ts, th) },
      ].filter((x) => x.r.target);
      if (cands.length === 0) return c;
      const best = cands.reduce((a, b) =>
        Math.abs(a.r.value - (c + a.off)) <= Math.abs(b.r.value - (c + b.off)) ? a : b,
      );
      const target = best.r.target as SnapTarget;
      hits.push({ axis, pos: target.at, kind: target.kind });
      return best.r.value - best.off;
    };
    if (req.transform.x !== undefined) next.x = snapAxis(next.x, halfW, t.x, "v");
    if (req.transform.y !== undefined) next.y = snapAxis(next.y, halfH, t.y, "h");
  }
  const patch = {
    ...req.transform,
    ...(req.transform.x !== undefined ? { x: Math.round(next.x) } : {}),
    ...(req.transform.y !== undefined ? { y: Math.round(next.y) } : {}),
  };
  if (keyed !== null) {
    const transform = stripUndefined({ ...(onKf ? onKf.transform : current), ...patch });
    return {
      ops: [
        {
          op: "keyframe.set",
          item: req.id,
          atMs: onKf?.atMs ?? Math.round(keyed),
          transform,
          ...(onKf ? { easing: onKf.easing } : {}),
        },
      ],
      preview: next,
      guides: hits,
    };
  }
  const set = stripUndefined({ ...own, ...patch });
  return {
    ops: [{ op: "item.update", id: req.id, set: { transform: set } }],
    preview: next,
    guides: hits,
  };
}

/** 主视频之下不能再插入。返回的是拿走被拖轨道之后的最小下标。 */
export function trackInsertFloor(project: Project, id: string): number {
  const from = project.tracks.findIndex((t) => t.id === id);
  const mainAt = project.tracks.findIndex((t) => isMainTrack(t));
  if (from < 0 || mainAt < 0) return 0;
  const mainInWithout = mainAt > from ? mainAt - 1 : mainAt;
  return mainInWithout + 1;
}

/**
 * 拖左侧轨道头改层级。index 是把这条轨道拿出来之后的插入位置，和 track.move 一致。
 * 主视频固定在最下面；顺序没变时不产生操作。
 */
export function planTrackMove(project: Project, req: { id: string; index: number }): { ops: Op[] } {
  const from = project.tracks.findIndex((t) => t.id === req.id);
  const track = project.tracks[from];
  if (!track) throw new MwError("NOT_FOUND", `轨道「${req.id}」不存在`);
  assertUnlocked(track);
  if (isMainTrack(track)) throw new MwError("INVALID_OP", "主视频轨道固定在最下面");
  const floor = trackInsertFloor(project, req.id);
  const index = Math.max(floor, Math.min(Math.round(req.index), project.tracks.length - 1));
  if (index === from) return { ops: [] };
  return { ops: [{ op: "track.move", id: req.id, index }] };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
