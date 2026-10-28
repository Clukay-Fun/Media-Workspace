import type { ResolvedTimeline } from "./compile";

// 吸附（F4）：纯函数，时间线和预览画面拖动时调用。界面只负责显示吸附线。

export type SnapTarget = { at: number; kind: string; id?: string };

/** 时间线上的吸附点（帧）：片段、字幕、叠加层的首尾，主轨结束，播放头 */
export function timelineTargets(
  tl: ResolvedTimeline,
  opts: { playhead?: number; exclude?: string } = {},
): SnapTarget[] {
  const t: SnapTarget[] = [
    { at: 0, kind: "start" },
    { at: tl.mainEndFrame, kind: "main-end" },
  ];
  if (opts.playhead !== undefined) t.push({ at: opts.playhead, kind: "playhead" });
  const items = [
    ...tl.videos.map((v) => ({ ...v, kind: "clip" })),
    ...tl.images.map((v) => ({ ...v, kind: "image" })),
    ...tl.captions.map((v) => ({ ...v, kind: "caption" })),
    ...tl.overlays.map((v) => ({ ...v, kind: "overlay" })),
  ];
  for (const it of items) {
    if (it.id === opts.exclude) continue;
    t.push(
      { at: it.from, kind: it.kind, id: it.id },
      { at: it.from + it.durationInFrames, kind: it.kind, id: it.id },
    );
  }
  return t;
}

/** 把一个值吸附到最近的目标；超过阈值不吸附。距离相同时取列表里靠前的目标 */
export function snapValue(
  value: number,
  targets: SnapTarget[],
  threshold: number,
): { value: number; target: SnapTarget | null } {
  let best: SnapTarget | null = null;
  for (const t of targets) {
    const d = Math.abs(t.at - value);
    if (d <= threshold && (best === null || d < Math.abs(best.at - value))) best = t;
  }
  return { value: best ? best.at : value, target: best };
}

/**
 * 拖动一个区间（开头和结尾一起移动，时长不变）：开头和结尾分别找吸附点，取距离更近的那个。
 */
export function snapRange(
  start: number,
  length: number,
  targets: SnapTarget[],
  threshold: number,
): { start: number; target: SnapTarget | null; edge: "start" | "end" | null } {
  const a = snapValue(start, targets, threshold);
  const b = snapValue(start + length, targets, threshold);
  const da = a.target ? Math.abs(a.value - start) : Number.POSITIVE_INFINITY;
  const db = b.target ? Math.abs(b.value - (start + length)) : Number.POSITIVE_INFINITY;
  if (da === Number.POSITIVE_INFINITY && db === Number.POSITIVE_INFINITY)
    return { start, target: null, edge: null };
  return da <= db
    ? { start: a.value, target: a.target, edge: "start" }
    : { start: b.value - length, target: b.target, edge: "end" };
}

/** 预览画面里的吸附线（像素）：画面中线、边缘、安全区、参考线 */
export function canvasTargets(
  width: number,
  height: number,
  extra: { axis: "h" | "v"; pos: number; kind: string }[] = [],
): { x: SnapTarget[]; y: SnapTarget[] } {
  const x: SnapTarget[] = [
    { at: width / 2, kind: "center" },
    { at: 0, kind: "edge" },
    { at: width, kind: "edge" },
  ];
  const y: SnapTarget[] = [
    { at: height / 2, kind: "center" },
    { at: 0, kind: "edge" },
    { at: height, kind: "edge" },
  ];
  for (const e of extra) (e.axis === "v" ? x : y).push({ at: e.pos, kind: e.kind });
  return { x, y };
}
