import { slotCenter } from "./safe-area";
import {
  type Anchor,
  type Caption,
  type FloatClip,
  type Highlight,
  isMainClip,
  type MainClip,
  type Project,
  type Transform,
  type Transition,
} from "./schema";
import type { Anim, Easing } from "./text-style";
import { clipTimelineMs, frameToMs, msToFrame } from "./time";

// compile(project) → ResolvedTimeline：唯一的毫秒 → 帧换算入口（D7）。
// 预览、导出、校验、时间线界面、吸附都只读它的结果。纯函数，不做 I/O。

export type FullTransform = Required<Transform>;

export type ResolvedKeyframe = { frame: number; transform: FullTransform; easing: Easing };

export type ResolvedTransition = {
  type: Transition["type"];
  direction: NonNullable<Transition["direction"]>;
  durationInFrames: number;
};

type Flags = {
  trackId: string;
  /** 叠放顺序：轨道在 tracks 里的位置，越靠后越在上层 */
  z: number;
  hidden: boolean;
  muted: boolean;
  locked: boolean;
};

export type ResolvedVideo = Flags & {
  id: string;
  kind: "video" | "audio";
  /** 主轨片段为 true；渲染时主轨按 TransitionSeries 排列 */
  main: boolean;
  asset: string;
  from: number;
  durationInFrames: number;
  trimBeforeFrames: number;
  speed: number;
  gainDb: number;
  transform: FullTransform;
  keyframes: ResolvedKeyframe[];
  transitionIn: ResolvedTransition | null;
  animIn: Anim | null;
  animOut: Anim | null;
  animLoop: Anim | null;
  /** 主轨片段前面剪掉的内容的理由（MainClip.cutBefore） */
  cutBefore: string | null;
};

export type ResolvedImage = Flags & {
  id: string;
  asset: string;
  from: number;
  durationInFrames: number;
  transform: FullTransform;
  keyframes: ResolvedKeyframe[];
  animIn: Anim | null;
  animOut: Anim | null;
  animLoop: Anim | null;
};

export type ResolvedCaption = Flags & {
  /** 同一句字幕可能被分成几段显示（中间被剪掉一部分），第一段的 part 为 0 */
  id: string;
  part: number;
  from: number;
  durationInFrames: number;
  text: string;
  highlights: Highlight[];
  style: string | null;
  /** 只露出了一部分（头或尾被裁掉） */
  partial: boolean;
  /** 提前出现的帧数（TextStyle.timing.leadMs）；逐字动画从 from + leadFrames 开始 */
  leadFrames: number;
  /**
   * 每个字开始出现的时间（毫秒，相对 from + leadFrames），由 Caption.charStartMs 映射到时间线；
   * 被剪掉的字：在这一段之前的算一开始就出现，之后的算到段末。没有逐字时间时为 null
   */
  charStartMs: number[] | null;
};

export type ResolvedOverlay = Flags & {
  id: string;
  template: string;
  from: number;
  durationInFrames: number;
  style: string | null;
  transform: FullTransform;
  props: Record<string, unknown>;
};

export type ResolvedOutro = {
  asset: string;
  from: number;
  durationInFrames: number;
  gainDb: number;
  transitionIn: ResolvedTransition | null;
};

/** 章节按开始时间排序；锚点被剪掉的章节不出现 */
export type ResolvedChapter = { title: string; from: number };

export type CompileWarning = { code: string; path: string; message: string };

export type ResolvedTimeline = {
  width: number;
  height: number;
  fps: number;
  background: string;
  durationInFrames: number;
  /** 主轨结束的帧（片尾从这里接上，toEnd 的叠加层显示到这里） */
  mainEndFrame: number;
  videos: ResolvedVideo[];
  images: ResolvedImage[];
  captions: ResolvedCaption[];
  overlays: ResolvedOverlay[];
  outro: ResolvedOutro | null;
  chapters: ResolvedChapter[];
  warnings: CompileWarning[];
};

/** 主轨片段在时间线上的位置（毫秒，不取整），给字幕映射和 SRT 反算用 */
export type MainSegment = {
  clip: MainClip;
  index: number;
  startMs: number;
  endMs: number;
};

export function layoutMainTrack(project: Project): MainSegment[] {
  const track = project.tracks.find((t) => t.kind === "video" && t.main);
  if (!track || track.kind !== "video") return [];
  const segments: MainSegment[] = [];
  let cursor = 0;
  for (const item of track.items) {
    if (!isMainClip(item)) continue;
    const overlap = segments.length > 0 ? (item.transitionIn?.durationMs ?? 0) : 0;
    const startMs = cursor - overlap;
    const endMs = startMs + clipTimelineMs(item);
    segments.push({ clip: item, index: segments.length, startMs, endMs });
    cursor = endMs;
  }
  return segments;
}

export type SourceRange = {
  startMs: number;
  endMs: number;
  srcStartMs: number;
  srcEndMs: number;
};

/** 源时间 → 时间线毫秒的所有可见区间（一段源时间可能在多个片段里露出） */
export function mapSourceRange(
  segments: MainSegment[],
  asset: string,
  srcStartMs: number,
  srcEndMs: number,
): SourceRange[] {
  const out: SourceRange[] = [];
  for (const { clip, startMs } of segments) {
    if (clip.asset !== asset) continue;
    const lo = Math.max(srcStartMs, clip.inMs);
    const hi = Math.min(srcEndMs, clip.outMs);
    if (hi <= lo) continue;
    out.push({
      startMs: startMs + (lo - clip.inMs) / clip.speed,
      endMs: startMs + (hi - clip.inMs) / clip.speed,
      srcStartMs: lo,
      srcEndMs: hi,
    });
  }
  return out;
}

/** 时间线毫秒 → 源时间（SRT 用 timeline 时间基准导入时用）。落在转场重叠区时取后一个片段 */
export function mapTimelineMs(
  segments: MainSegment[],
  ms: number,
): { asset: string; srcMs: number; clip: string } | null {
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (!seg) continue;
    const isLast = i === segments.length - 1;
    if (ms >= seg.startMs && (ms < seg.endMs || (isLast && ms === seg.endMs))) {
      return {
        asset: seg.clip.asset,
        srcMs: seg.clip.inMs + (ms - seg.startMs) * seg.clip.speed,
        clip: seg.clip.id,
      };
    }
  }
  return null;
}

export function compile(project: Project): ResolvedTimeline {
  const { width, height, fps, background } = project.canvas;
  const f = (ms: number) => msToFrame(ms, fps);
  const warnings: CompileWarning[] = [];
  const base: FullTransform = {
    x: width / 2,
    y: height / 2,
    scale: 1,
    rotation: 0,
    opacity: 1,
    radius: 0,
  };
  const full = (
    t: Transform | undefined,
    slot?: Parameters<typeof slotCenter>[0],
  ): FullTransform => {
    const pos = slot ? slotCenter(slot, project.canvas.safeArea.preset, width, height) : null;
    return { ...base, ...(pos ?? {}), ...stripUndefined(t ?? {}) };
  };
  const keyframes = (
    t: FullTransform,
    kfs: { atMs: number; transform: Transform; easing: Easing }[],
  ): ResolvedKeyframe[] =>
    [...kfs]
      .sort((a, b) => a.atMs - b.atMs)
      .map((k) => ({
        frame: f(k.atMs),
        transform: { ...t, ...stripUndefined(k.transform) },
        easing: k.easing,
      }));
  const transition = (t: Transition | undefined): ResolvedTransition | null =>
    t
      ? { type: t.type, direction: t.direction ?? "left", durationInFrames: f(t.durationMs) }
      : null;

  // 1. 主轨：用理想毫秒的结束位置取整，前后片段首尾帧严格相接，不会累计误差
  const segments = layoutMainTrack(project);
  const mainTrack = project.tracks.find((t) => t.kind === "video" && t.main);
  const videos: ResolvedVideo[] = [];
  const clipFrames = new Map<string, number>();
  let prevEnd = 0;
  for (const seg of segments) {
    const { clip } = seg;
    const trans = seg.index > 0 ? transition(clip.transitionIn) : null;
    const from = prevEnd - (trans?.durationInFrames ?? 0);
    const end = f(seg.endMs);
    const t = full(clip.transform);
    videos.push({
      id: clip.id,
      kind: "video",
      main: true,
      trackId: mainTrack?.id ?? "main",
      z: Math.max(
        0,
        project.tracks.findIndex((t) => t === mainTrack),
      ),
      hidden: mainTrack?.hidden ?? false,
      muted: mainTrack?.muted ?? false,
      locked: mainTrack?.locked ?? false,
      asset: clip.asset,
      from,
      durationInFrames: end - from,
      trimBeforeFrames: f(clip.inMs),
      speed: clip.speed,
      gainDb: clip.gainDb,
      transform: t,
      keyframes: keyframes(t, clip.keyframes),
      transitionIn: trans,
      animIn: clip.animIn ?? null,
      animOut: clip.animOut ?? null,
      animLoop: clip.animLoop ?? null,
      cutBefore: clip.cutBefore ?? null,
    });
    clipFrames.set(clip.id, from);
    prevEnd = end;
  }
  const mainEndFrame = prevEnd;

  // 2. 字幕：按素材源时间映射到主轨，被剪掉的部分不显示（D19）
  const captions: ResolvedCaption[] = [];
  const captionStart = new Map<string, number>();
  /** 每句字幕每个字开始念的时间线毫秒（被剪掉的字为 null），给按字锚定用 */
  const captionChars = new Map<string, (number | null)[]>();
  project.tracks.forEach((track, ti) => {
    if (track.kind !== "caption") return;
    const trackCaptions: ResolvedCaption[] = [];
    track.items.forEach((cap: Caption, ci) => {
      const ranges = mapSourceRange(segments, cap.asset, cap.startMs, cap.endMs);
      const pieces: ResolvedCaption[] = [];
      const pieceRanges: SourceRange[][] = [];
      let prevSrcEnd = Number.NaN;
      let pieceSrcStart = Number.NaN;
      // 头或尾被剪掉才算 partial；只是被分割到两个片段里不算
      const partial = (srcStart: number, srcEnd: number) =>
        srcStart > cap.startMs || srcEnd < cap.endMs;
      for (const r of ranges) {
        const from = f(r.startMs);
        const to = f(r.endMs);
        if (to <= from) continue;
        const prev = pieces.at(-1);
        // 只分割、没剪掉内容时（时间线和源时间都连着），合成一段，避免动画重新播放
        const contiguous =
          prev && prev.from + prev.durationInFrames === from && prevSrcEnd === r.srcStartMs;
        prevSrcEnd = r.srcEndMs;
        if (prev && contiguous) {
          pieceRanges.at(-1)?.push(r);
          prev.durationInFrames = to - prev.from;
          prev.partial = partial(pieceSrcStart, r.srcEndMs);
          continue;
        }
        pieceSrcStart = r.srcStartMs;
        pieceRanges.push([r]);
        pieces.push({
          id: cap.id,
          part: pieces.length,
          trackId: track.id,
          z: ti,
          hidden: track.hidden,
          muted: track.muted,
          locked: track.locked,
          from,
          durationInFrames: to - from,
          text: cap.text,
          highlights: cap.highlights,
          style: cap.style ?? track.style ?? null,
          partial: partial(r.srcStartMs, r.srcEndMs),
          leadFrames: 0,
          charStartMs: null,
        });
      }
      if (cap.charStartMs) {
        pieces.forEach((p, pi) => {
          const rs = pieceRanges[pi] ?? [];
          const fromMs = frameToMs(p.from, fps);
          const endMs = frameToMs(p.from + p.durationInFrames, fps);
          p.charStartMs = (cap.charStartMs ?? []).map((src) => {
            const r = rs.find((x) => src >= x.srcStartMs && src < x.srcEndMs);
            if (r) {
              const k = (r.endMs - r.startMs) / (r.srcEndMs - r.srcStartMs);
              return Math.round(r.startMs + (src - r.srcStartMs) * k - fromMs);
            }
            return src < (rs[0]?.srcStartMs ?? 0) ? 0 : Math.round(endMs - fromMs);
          });
        });
      }
      if (pieces.length === 0) {
        warnings.push({
          code: "CAPTION_CUT",
          path: `tracks[${ti}].items[${ci}]`,
          message: `字幕 ${cap.id} 对应的画面已经全部剪掉，不会显示`,
        });
        return;
      }
      captionStart.set(cap.id, pieces[0]?.from ?? 0);
      const len = [...cap.text].length;
      captionChars.set(
        cap.id,
        Array.from({ length: len }, (_, k) => {
          // 没有逐字时间时按字数估算
          const src =
            cap.charStartMs?.[k] ??
            cap.startMs + ((cap.endMs - cap.startMs) * k) / Math.max(1, len);
          const r = ranges.find((x) => src >= x.srcStartMs && src < x.srcEndMs);
          if (!r) return null;
          return (
            r.startMs + ((src - r.srcStartMs) * (r.endMs - r.startMs)) / (r.srcEndMs - r.srcStartMs)
          );
        }),
      );
      trackCaptions.push(...pieces);
    });
    captions.push(...applyCaptionTiming(trackCaptions, project, fps, mainEndFrame));
  });

  // 3. 普通轨道：按锚点定位
  const resolveAnchor = (at: Anchor, path: string): number | null => {
    if ("ms" in at) return f(at.ms);
    if ("caption" in at) {
      const start = captionStart.get(at.caption);
      if (start === undefined) {
        warnings.push({
          code: "ANCHOR_CUT",
          path,
          message: `锚点字幕 ${at.caption} 不存在或已被剪掉，这个元素不会显示`,
        });
        return null;
      }
      if (at.char !== undefined) {
        const ms = captionChars.get(at.caption)?.[at.char];
        if (ms === undefined || ms === null) {
          warnings.push({
            code: "ANCHOR_CUT",
            path,
            message: `锚点字幕 ${at.caption} 的第 ${at.char + 1} 个字已被剪掉或不存在，这个元素不会显示`,
          });
          return null;
        }
        return Math.max(0, f(ms + at.offsetMs));
      }
      return Math.max(0, start + f(at.offsetMs));
    }
    const start = clipFrames.get(at.clip);
    if (start === undefined) {
      warnings.push({
        code: "ANCHOR_CUT",
        path,
        message: `锚点片段 ${at.clip} 不在主轨上，这个元素不会显示`,
      });
      return null;
    }
    return Math.max(0, start + f(at.offsetMs));
  };

  const images: ResolvedImage[] = [];
  const overlays: ResolvedOverlay[] = [];
  project.tracks.forEach((track, ti) => {
    const flags = {
      trackId: track.id,
      z: ti,
      hidden: track.hidden,
      muted: track.muted,
      locked: track.locked,
    };
    if (track.kind === "video" || track.kind === "audio") {
      track.items.forEach((item, ii) => {
        if (track.kind === "video" && isMainClip(item)) return;
        const path = `tracks[${ti}].items[${ii}]`;
        if (item.type === "image") {
          const from = resolveAnchor(item.at, `${path}.at`);
          if (from === null) return;
          const t = full(item.transform, item.slot);
          images.push({
            ...flags,
            id: item.id,
            asset: item.asset,
            from,
            durationInFrames: Math.max(1, f(item.durationMs)),
            transform: t,
            keyframes: keyframes(t, item.keyframes),
            animIn: item.animIn ?? null,
            animOut: item.animOut ?? null,
            animLoop: item.animLoop ?? null,
          });
          return;
        }
        const clip = item as FloatClip;
        const from = resolveAnchor(clip.at, `${path}.at`);
        if (from === null) return;
        const t = full(clip.transform, clip.slot);
        videos.push({
          ...flags,
          id: clip.id,
          kind: track.kind,
          main: false,
          asset: clip.asset,
          from,
          durationInFrames: Math.max(1, f(clipTimelineMs(clip))),
          trimBeforeFrames: f(clip.inMs),
          speed: clip.speed,
          gainDb: clip.gainDb,
          transform: t,
          keyframes: keyframes(t, clip.keyframes),
          transitionIn: null,
          animIn: clip.animIn ?? null,
          animOut: clip.animOut ?? null,
          animLoop: clip.animLoop ?? null,
          cutBefore: null,
        });
      });
    }
    if (track.kind === "overlay") {
      track.items.forEach((item, ii) => {
        const path = `tracks[${ti}].items[${ii}]`;
        const from = resolveAnchor(item.at, `${path}.at`);
        if (from === null) return;
        const durationInFrames =
          item.durationMs === "toEnd" ? mainEndFrame - from : f(item.durationMs);
        if (durationInFrames <= 0) {
          warnings.push({
            code: "OVERLAY_EMPTY",
            path,
            message: `叠加层 ${item.id} 的显示时长为 0，不会显示`,
          });
          return;
        }
        overlays.push({
          ...flags,
          id: item.id,
          template: item.template,
          from,
          durationInFrames,
          style: item.style ?? null,
          transform: full(item.transform, item.slot),
          props: item.props,
        });
      });
    }
  });

  const chapters: ResolvedChapter[] = project.chapters
    .flatMap((c, i) => {
      const from = resolveAnchor(c.at, `chapters[${i}].at`);
      return from === null ? [] : [{ title: c.title, from }];
    })
    .sort((a, b) => a.from - b.from);

  // 4. 片尾：接在主轨最后，不受主轨编辑影响
  let outro: ResolvedOutro | null = null;
  if (project.outro) {
    const asset = project.assets[project.outro.asset];
    const durationMs = asset?.probe?.durationMs;
    if (durationMs === undefined) {
      warnings.push({
        code: "OUTRO_UNPROBED",
        path: "outro.asset",
        message: `片尾素材 ${project.outro.asset} 缺少时长信息，先导入素材`,
      });
    } else {
      const trans = transition(project.outro.transitionIn);
      const overlap = mainEndFrame > 0 ? (trans?.durationInFrames ?? 0) : 0;
      outro = {
        asset: project.outro.asset,
        from: mainEndFrame - overlap,
        durationInFrames: f(durationMs),
        gainDb: project.outro.gainDb,
        transitionIn: overlap > 0 ? trans : null,
      };
    }
  }

  const ends = [
    mainEndFrame,
    outro ? outro.from + outro.durationInFrames : 0,
    ...videos.map((v) => v.from + v.durationInFrames),
    ...images.map((v) => v.from + v.durationInFrames),
    ...overlays.map((v) => v.from + v.durationInFrames),
  ];

  return {
    width,
    height,
    fps,
    background,
    durationInFrames: Math.max(1, ...ends),
    mainEndFrame,
    videos,
    images,
    captions,
    overlays,
    outro,
    chapters,
    warnings,
  };
}

/**
 * 字幕样式里的显示时间（TextStyle.timing）：提前出现、延后消失；
 * handoff 为 cut 时，后一句出现的那一帧前一句就消失，两句不会同时在画面上。
 * 只改显示范围，不影响锚点（锚点用字幕原本的开始位置）。
 */
function applyCaptionTiming(
  pieces: ResolvedCaption[],
  project: Project,
  fps: number,
  mainEndFrame: number,
): ResolvedCaption[] {
  const sorted = pieces.toSorted((a, b) => a.from - b.from);
  const out = sorted.map((c) => {
    const timing = c.style ? project.styles[c.style]?.timing : undefined;
    if (!timing) return { ...c, leadFrames: 0 };
    const lead = Math.min(c.from, msToFrame(timing.leadMs, fps));
    const end = Math.min(mainEndFrame, c.from + c.durationInFrames + msToFrame(timing.tailMs, fps));
    return { ...c, from: c.from - lead, durationInFrames: end - (c.from - lead), leadFrames: lead };
  });
  out.forEach((c, i) => {
    const next = out[i + 1];
    const handoff = c.style ? project.styles[c.style]?.timing.handoff : "cut";
    if (next && handoff !== "overlap" && c.from + c.durationInFrames > next.from) {
      c.durationInFrames = Math.max(1, next.from - c.from);
    }
  });
  return out;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
