import type { ResolvedTimeline } from "../../core/compile";
import type { Project, Track } from "../../core/schema";
import { frameToMs, msToFrame, sourceFrameAt } from "../../core/time";

// 时间线概览的布局：按工程的轨道分行，每个条目给出起止帧。界面只按帧比例画，不自己换算时间。

export type Block = {
  id: string;
  /** 同一句字幕被剪成几段时，每段一个块 */
  key: string;
  from: number;
  to: number;
  label: string;
  kind: "clip" | "caption" | "overlay" | "image" | "outro";
  asset?: string;
  /** 主轨片段：素材里的起点和倍速，画波形用 */
  trimBeforeFrames?: number;
  speed?: number;
};

export type Row = {
  track: Track;
  label: string;
  kind: Track["kind"] | "main";
  blocks: Block[];
};

const KIND_LABEL: Record<Track["kind"], string> = {
  video: "画面",
  caption: "字幕",
  overlay: "标题 / 卡片",
  audio: "音频",
};

/** 上层的轨道排在上面，主轨在最下面（和剪映一致） */
export function timelineRows(project: Project, tl: ResolvedTimeline): Row[] {
  const rows: Row[] = project.tracks.map((track) => {
    const main = track.kind === "video" && track.main;
    const blocks: Block[] = [];
    for (const v of tl.videos.filter((x) => x.trackId === track.id)) {
      blocks.push({
        id: v.id,
        key: v.id,
        from: v.from,
        to: v.from + v.durationInFrames,
        label: v.asset,
        kind: "clip",
        asset: v.asset,
        trimBeforeFrames: v.trimBeforeFrames,
        speed: v.speed,
      });
    }
    for (const i of tl.images.filter((x) => x.trackId === track.id)) {
      blocks.push({
        id: i.id,
        key: i.id,
        from: i.from,
        to: i.from + i.durationInFrames,
        label: i.asset,
        kind: "image",
      });
    }
    for (const c of tl.captions.filter((x) => x.trackId === track.id)) {
      blocks.push({
        id: c.id,
        key: `${c.id}-${c.part}`,
        from: c.from,
        to: c.from + c.durationInFrames,
        label: c.text,
        kind: "caption",
      });
    }
    for (const o of tl.overlays.filter((x) => x.trackId === track.id)) {
      const lines = (o.props as { lines?: unknown }).lines;
      blocks.push({
        id: o.id,
        key: o.id,
        from: o.from,
        to: o.from + o.durationInFrames,
        label: Array.isArray(lines) ? lines.join(" / ") : o.template,
        kind: "overlay",
      });
    }
    if (main && tl.outro) {
      blocks.push({
        id: "outro",
        key: "outro",
        from: tl.outro.from,
        to: tl.outro.from + tl.outro.durationInFrames,
        label: "片尾",
        kind: "outro",
      });
    }
    return {
      track,
      label: track.name ?? (main ? "主轨" : KIND_LABEL[track.kind]),
      kind: main ? "main" : track.kind,
      blocks: blocks.toSorted((a, b) => a.from - b.from),
    };
  });
  return rows.toReversed();
}

/** 时间码：分:秒.十分之一秒 */
export function timecode(frame: number, fps: number): string {
  const ms = Math.max(0, frameToMs(frame, fps));
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const d = Math.floor((ms % 1000) / 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${d}`;
}

export const frameOfMs = (ms: number, fps: number) => msToFrame(ms, fps);
export const msOfFrame = (frame: number, fps: number) => Math.round(frameToMs(frame, fps));

/** 刻度间隔（秒）：让相邻两个刻度至少隔 minPx 像素 */
export function tickStep(pxPerSecond: number, minPx = 64): number {
  return [0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((s) => s * pxPerSecond >= minPx) ?? 300;
}

/**
 * 主轨片段的波形：每个像素列取对应素材时间段里的最大峰值（0–1）。
 * 时间线帧 → 素材帧用 core/time 的 sourceFrameAt（考虑倍速），再换算成素材毫秒去取峰值。
 */
export function waveform(
  block: Block,
  peaks: { msPerPeak: number; peaks: number[] },
  fps: number,
  columns: number,
): number[] {
  const frames = block.to - block.from;
  if (columns <= 0 || frames <= 0) return [];
  const trim = block.trimBeforeFrames ?? 0;
  const speed = block.speed ?? 1;
  const srcMs = (n: number) => frameToMs(sourceFrameAt(trim, speed, n), fps);
  return Array.from({ length: columns }, (_, i) => {
    const a = Math.floor(srcMs((i / columns) * frames) / peaks.msPerPeak);
    const b = Math.max(a + 1, Math.floor(srcMs(((i + 1) / columns) * frames) / peaks.msPerPeak));
    let max = 0;
    for (let k = a; k < b && k < peaks.peaks.length; k++) max = Math.max(max, peaks.peaks[k] ?? 0);
    return max;
  });
}

/** 条目在时间线上占的帧范围（被剪成几段时取整体），不在时间线上返回 null */
export function itemFrames(tl: ResolvedTimeline, id: string): { from: number; to: number } | null {
  const parts = [...tl.videos, ...tl.images, ...tl.captions, ...tl.overlays].filter(
    (x) => x.id === id,
  );
  if (parts.length === 0) return null;
  return {
    from: Math.min(...parts.map((p) => p.from)),
    to: Math.max(...parts.map((p) => p.from + p.durationInFrames)),
  };
}
