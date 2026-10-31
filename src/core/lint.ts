import { transformAt } from "./animate";
import {
  compile,
  type FrameSpan,
  layoutMainTrack,
  mainLiftTransform,
  mainShiftAt,
  mapTimelineMs,
  type ResolvedOverlay,
} from "./compile";
import { typicalFace } from "./frame";
import type { Layout } from "./layout";
import { safeAreaFor } from "./safe-area";
import type { Project } from "./schema";
import type { TextStyle } from "./text-style";
import { frameToMs } from "./time";

// 成片质检（docs/decisions/0007，借鉴 Remotion Koubo 的几何断言和 Ghost Editor 的人脸避让）：
// 不看像素，按工程数据估算每个元素在画面上占的区域，找出字太小、出安全区、放不下、互相遮挡、挡脸。
// 都是警告，不阻止导出；AI 提交后跑一遍，人在界面上也能看到。

export type Box = { x0: number; y0: number; x1: number; y1: number };

export type LintIssue = {
  code:
    | "TEXT_TOO_SMALL"
    | "TEXT_OUTSIDE_SAFE_AREA"
    | "CAPTION_OVERFLOW"
    | "OVERLAP"
    | "FACE_COVERED"
    | "TOO_MANY_CARDS"
    | "FACE_OFF_LAYOUT"
    | "STYLE_NOT_LAYOUT"
    | "SPEED_NOT_LAYOUT";
  /** hint = 只是提示（有账号版式时，通用安全区以版式为准）；不写 = 警告 */
  level?: "hint";
  /** 有问题的条目 */
  id: string;
  /** 遮挡时，另一方的条目 ID */
  other?: string;
  /** 时间线毫秒：问题第一次出现的时刻，方便直接 preview --at 查看 */
  atMs: number;
  message: string;
};

/** 人脸采样（素材源时间），坐标是 0–1 的比例，原点在左上角 */
export type FaceTrack = {
  intervalMs: number;
  frames: { ms: number; boxes: { x: number; y: number; w: number; h: number }[] }[];
};

/** 模板画出来占的区域：text 用于安全区和字号检查，shapes（底条、卡片）只用于遮挡检查 */
export type OverlayBounds = (
  o: ResolvedOverlay,
  style: TextStyle,
) => { text: Box[]; shapes: Box[] };

export type LintOptions = {
  styles: Record<string, TextStyle>;
  overlayBounds?: OverlayBounds;
  /** 叠加层没写样式时用的样式 ID（模板的 meta.defaultStyle）；不传时按标题条 */
  overlayStyle?: (template: string) => string | undefined;
  faces?: Record<string, FaceTrack>;
  /** 1080 宽画面上的最小字号，其他宽度按比例 */
  minFontSize?: number;
  /** 账号版式（docs/decisions/0027）：有的话检查人物位置和样式是否和版式一致，通用安全区降为提示 */
  layout?: (Pick<Layout, "face" | "captionStyle" | "titleStyle"> & { speed?: number }) | null;
};

/** 人脸偏离版式多少算偏（占画面比例）：约 27px 横向、48px 纵向；人脸大小差 10% 以上 */
const FACE_POS_TOLERANCE = 0.025;
const FACE_SIZE_TOLERANCE = 0.1;

const CJK = /[⺀-鿿가-힯豈-﫿＀-￯　-〿]/;

/** 估算一段文字排版后的行数和最宽一行的宽度（不测字体，中文按一个字号宽，其他按 0.55 个） */
export function estimateLines(text: string, style: TextStyle): { lines: number; width: number } {
  const { size, letterSpacing } = style.font;
  const max = style.layout.maxWidth;
  let lines = 0;
  let widest = 0;
  for (const para of text.split("\n")) {
    const w = [...para].reduce(
      (n, c) => n + (CJK.test(c) ? size : c === " " ? size * 0.3 : size * 0.55) + letterSpacing,
      0,
    );
    lines += Math.max(1, Math.ceil(w / max - 1e-6));
    widest = Math.max(widest, Math.min(w, max));
  }
  return { lines, width: widest };
}

/** 文字块在画面上的区域（和 TextBlock 的排版规则一致） */
export function textBox(text: string, style: TextStyle): Box {
  const { layout, font } = style;
  const { lines, width } = estimateLines(text, style);
  const shown = Math.min(lines, layout.maxLines);
  const h = shown * font.size * font.lineHeight;
  const x0 =
    layout.align === "left"
      ? layout.x
      : layout.align === "right"
        ? layout.x - width
        : layout.x - width / 2;
  const y0 =
    layout.anchor === "top"
      ? layout.y
      : layout.anchor === "bottom"
        ? layout.y - h
        : layout.y - h / 2;
  return { x0, y0, x1: x0 + width, y1: y0 + h };
}

/**
 * 素材在画布上按 objectFit: contain 显示后的内容框（画布像素）。
 * 渲染时图片和视频都铺满画布再 contain，所以宽高比不同时会上下或左右留黑边。
 * 没有素材尺寸（或数据不合法）时退回整幅画布。
 */
export function containBox(
  width: number,
  height: number,
  sourceWidth?: number,
  sourceHeight?: number,
): Box {
  if (!sourceWidth || !sourceHeight || sourceWidth <= 0 || sourceHeight <= 0)
    return { x0: 0, y0: 0, x1: width, y1: height };
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const w = sourceWidth * scale;
  const h = sourceHeight * scale;
  return { x0: (width - w) / 2, y0: (height - h) / 2, x1: (width + w) / 2, y1: (height + h) / 2 };
}

const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const intersect = (a: Box, b: Box): Box => ({
  x0: Math.max(a.x0, b.x0),
  y0: Math.max(a.y0, b.y0),
  x1: Math.min(a.x1, b.x1),
  y1: Math.min(a.y1, b.y1),
});

type Placed = {
  id: string;
  kind: "caption" | "overlay";
  styleId: string;
  from: number;
  to: number;
  style: TextStyle;
  text: Box[];
  shapes: Box[];
  /** 全屏卡：本来就要盖住画面，不算遮挡、挡脸 */
  full?: boolean;
  /** 半屏卡：主画面上移到位之后才算挡脸（上移的 400ms 里卡片还在淡入） */
  half?: boolean;
};

export function lintProject(project: Project, opts: LintOptions): LintIssue[] {
  const tl = compile(project);
  const { width, height, fps } = tl;
  const ms = (frame: number) => Math.round(frameToMs(frame, fps));
  const styleOf = (id: string | null, fallback: string) =>
    opts.styles[id ?? fallback] ?? opts.styles[fallback];
  const issues: LintIssue[] = [];
  const seen = new Set<string>();
  const add = (i: LintIssue) => {
    const key = `${i.code}|${i.id}|${i.other ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(i);
  };

  // 1. 每个元素占的区域
  const placed: Placed[] = [];
  for (const c of tl.captions) {
    if (c.hidden) continue;
    const styleId = c.style ?? "caption-word-yellow";
    const st = styleOf(c.style, "caption-word-yellow");
    if (!st) continue;
    // 有卡片时字幕不显示（v7）：只检查没有卡片的那几段
    const box = textBox(c.text, st);
    for (const s of spansOutside(c.from, c.from + c.durationInFrames, tl.cardSpans)) {
      placed.push({
        id: c.id,
        kind: "caption",
        styleId,
        from: s.from,
        to: s.to,
        style: st,
        text: [box],
        shapes: [],
      });
    }
    const { lines } = estimateLines(c.text, st);
    if (lines > st.layout.maxLines) {
      add({
        code: "CAPTION_OVERFLOW",
        id: c.id,
        atMs: ms(c.from),
        message: `字幕「${c.text}」估计要排 ${lines} 行，超过样式允许的 ${st.layout.maxLines} 行`,
      });
    }
  }
  for (const o of tl.overlays) {
    if (o.hidden) continue;
    const styleId = o.style ?? opts.overlayStyle?.(o.template) ?? "title-bar-yellow";
    const st = styleOf(styleId, "title-bar-yellow");
    if (!st) continue;
    const b = opts.overlayBounds?.(o, st) ?? { text: [], shapes: [] };
    placed.push({
      id: o.id,
      kind: "overlay",
      styleId,
      from: o.from,
      to: o.from + o.durationInFrames,
      style: st,
      ...b,
      full: o.size === "full",
      half: o.size === "half",
    });
  }

  // 卡片太多：30 秒以内最多 2 张，之后每 15 秒多 1 张（Grok 的口播卡片调研）
  const cards = tl.overlays.filter((o) => o.size !== null && !o.hidden);
  const maxCards = Math.max(2, Math.floor(frameToMs(tl.mainEndFrame, fps) / 15_000));
  const extra = cards.toSorted((a, b) => a.from - b.from)[maxCards];
  if (extra) {
    add({
      code: "TOO_MANY_CARDS",
      id: extra.id,
      atMs: ms(extra.from),
      message: `卡片有 ${cards.length} 张，这么长的视频最多 ${maxCards} 张，挑最要紧的留下`,
    });
  }

  // 2. 字号和安全区
  const min = (opts.minFontSize ?? 40) * (width / 1080);
  const safe = safeAreaFor(project.canvas.safeArea.preset, width, height);
  const outside = new Map<string, { count: number; out: string }>();
  const inner: Box = {
    x0: safe.left,
    y0: safe.top,
    x1: width - safe.right,
    y1: height - safe.bottom,
  };
  for (const p of placed) {
    if (p.style.font.size < min && p.text.length > 0) {
      add({
        code: "TEXT_TOO_SMALL",
        id: p.id,
        atMs: ms(p.from),
        message: `字号 ${p.style.font.size} 偏小，手机上看不清（建议不小于 ${Math.round(min)}）`,
      });
    }
    for (const b of p.text) {
      const out = [
        b.x0 < inner.x0 - 1 && `左边 ${Math.round(inner.x0 - b.x0)}px`,
        b.x1 > inner.x1 + 1 && `右边 ${Math.round(b.x1 - inner.x1)}px`,
        b.y0 < inner.y0 - 1 && `上边 ${Math.round(inner.y0 - b.y0)}px`,
        b.y1 > inner.y1 + 1 && `下边 ${Math.round(b.y1 - inner.y1)}px`,
      ].filter(Boolean);
      if (out.length === 0) continue;
      // 字幕出界通常是样式（maxWidth、位置）的问题，同一样式只报第一条，免得每句都报一遍
      if (p.kind === "caption") {
        const g = outside.get(p.styleId);
        if (g) {
          g.count++;
          continue;
        }
        outside.set(p.styleId, { count: 1, out: out.join("、") });
      }
      add({
        code: "TEXT_OUTSIDE_SAFE_AREA",
        id: p.id,
        atMs: ms(p.from),
        message: opts.layout
          ? `文字超出了通用「${project.canvas.safeArea.preset}」安全区（${out.join("、")}）；位置按账号版式，只作参考，不用改`
          : `文字超出了「${project.canvas.safeArea.preset}」安全区（${out.join("、")}），可能被平台的按钮或标题挡住`,
        // 有账号版式时位置以版式为准，通用安全区只作参考（0025）
        ...(opts.layout ? { level: "hint" as const } : {}),
      });
    }
  }
  for (const [styleId, g] of outside) {
    if (g.count < 2) continue;
    const i = issues.find(
      (x) =>
        x.code === "TEXT_OUTSIDE_SAFE_AREA" &&
        placed.find((p) => p.id === x.id)?.styleId === styleId,
    );
    if (i)
      i.message += opts.layout
        ? `；用样式「${styleId}」的字幕共 ${g.count} 条`
        : `；用样式「${styleId}」的字幕共 ${g.count} 条有同样的问题，建议调整样式的 maxWidth 或位置`;
  }

  // 画面元素（图片、画中画）：按 contain 后的真实画面区域算，带关键帧的会动
  const step = Math.max(1, Math.round((fps * 500) / 1000));
  const visuals: { id: string; from: number; to: number; box: Box }[] = [];
  for (const v of [...tl.images, ...tl.videos.filter((x) => !x.main && x.kind === "video")]) {
    if (v.hidden) continue;
    const probe = project.assets[v.asset]?.probe;
    const content = containBox(width, height, probe?.width, probe?.height);
    const end = v.from + v.durationInFrames;
    // 每 0.5 秒一次，再加上每个关键帧的时刻和最后一帧，停在关键帧上的位置不会漏掉
    const frames = new Set<number>([end - 1]);
    for (let f = v.from; f < end; f += step) frames.add(f);
    for (const k of v.keyframes) if (k.frame < v.durationInFrames) frames.add(v.from + k.frame);
    for (const f of [...frames].sort((a, b) => a - b)) {
      const t = transformAt(v.transform, v.keyframes, f - v.from);
      const map = (x: number, y: number) => ({
        x: t.x + t.scale * (x - width / 2),
        y: t.y + t.scale * (y - height / 2),
      });
      const a0 = map(content.x0, content.y0);
      const a1 = map(content.x1, content.y1);
      visuals.push({
        id: v.id,
        from: f,
        to: f + 1,
        box: { x0: a0.x, y0: a0.y, x1: a1.x, y1: a1.y },
      });
    }
  }

  // 3. 同时出现的元素互相遮挡（文字压文字、文字压卡片）
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i] as Placed;
      const b = placed[j] as Placed;
      if (a.id === b.id || a.full || b.full) continue;
      const from = Math.max(a.from, b.from);
      if (from >= Math.min(a.to, b.to)) continue;
      const hit = [...a.text, ...a.shapes].some((x) =>
        [...b.text, ...b.shapes].some((y) => area(intersect(x, y)) > 0),
      );
      // 只有至少一方有文字被压住才算（两个底条叠在一起不一定是问题）
      const textHit =
        a.text.some((x) => [...b.text, ...b.shapes].some((y) => area(intersect(x, y)) > 0)) ||
        b.text.some((x) => [...a.text, ...a.shapes].some((y) => area(intersect(x, y)) > 0));
      if (hit && textHit) {
        add({
          code: "OVERLAP",
          id: b.id,
          other: a.id,
          atMs: ms(from),
          message: `「${b.id}」和「${a.id}」同时出现时位置重叠`,
        });
      }
    }
  }

  // 图片、画中画压住字幕或标题的文字（画面元素之间、压住卡片底条不算）
  for (const v of visuals) {
    for (const p of placed) {
      if (Math.max(v.from, p.from) >= Math.min(v.to, p.to)) continue;
      if (p.text.some((x) => area(intersect(x, v.box)) > 0)) {
        add({
          code: "OVERLAP",
          id: v.id,
          other: p.id,
          atMs: ms(Math.max(v.from, p.from)),
          message: `「${v.id}」挡住了「${p.id}」的文字`,
        });
      }
    }
  }

  // 4. 挡脸：按人脸采样，把素材坐标换算到画面上（主轨片段的缩放和位移）
  if (opts.faces) {
    const segs = layoutMainTrack(project);
    const mains = tl.videos.filter((v) => v.main);
    const covering = [
      ...placed
        .filter((p) => !p.full)
        .map((p) => ({
          id: p.id,
          from: p.from,
          to: p.to,
          half: p.half === true,
          boxes: [...p.text, ...p.shapes],
        })),
      ...visuals.map((v) => ({ id: v.id, from: v.from, to: v.to, half: false, boxes: [v.box] })),
    ];
    for (const p of covering) {
      const boxes = p.boxes;
      for (let f = p.from; f < p.to; f += step) {
        if (p.half && mainShiftAt(tl.mainShifts, f) < 1) continue;
        const src = mapTimelineMs(segs, frameToMs(f, fps));
        if (!src) continue;
        const track = opts.faces[src.asset];
        const v = mains.find((x) => x.id === src.clip);
        if (!track || !v) continue;
        const sample = nearest(track, src.srcMs);
        if (!sample) continue;
        const a = project.assets[src.asset];
        const sw = a?.probe?.width ?? width;
        const sh = a?.probe?.height ?? height;
        const t = transformAt(v.transform, v.keyframes, f - v.from);
        const k = Math.min(width / sw, height / sh);
        const ox = (width - sw * k) / 2;
        const oy = (height - sh * k) / 2;
        // 半屏卡出现时主画面整体上移并略放大（v7，见 mainLiftTransform）
        const m = mainLiftTransform(tl, f);
        const toCanvas = (nx: number, ny: number) => ({
          x: width / 2 + m.scale * (t.x + t.scale * (ox + nx * sw * k - width / 2) - width / 2),
          y: m.scale * (t.y + t.scale * (oy + ny * sh * k - height / 2)) - m.lift,
        });
        for (const fb of sample.boxes) {
          const a0 = toCanvas(fb.x, fb.y);
          const a1 = toCanvas(fb.x + fb.w, fb.y + fb.h);
          const face: Box = { x0: a0.x, y0: a0.y, x1: a1.x, y1: a1.y };
          const covered = boxes.reduce((n, b) => n + area(intersect(face, b)), 0);
          if (area(face) > 0 && covered / area(face) > 0.25) {
            add({
              code: "FACE_COVERED",
              id: p.id,
              atMs: ms(f),
              message: `「${p.id}」挡住了人脸（约 ${Math.round((covered / area(face)) * 100)}%）`,
            });
          }
        }
      }
    }
  }
  // 5. 账号版式：人物位置、标题和字幕样式
  const layout = opts.layout;
  if (layout?.face && opts.faces) {
    const target = layout.face;
    const mains = tl.videos.filter((v) => v.main);
    for (const seg of layoutMainTrack(project)) {
      const clip = seg.clip;
      if (clip.type !== "clip") continue;
      const track = opts.faces[clip.asset];
      const v = mains.find((x) => x.id === clip.id);
      const a = project.assets[clip.asset];
      if (!track || !v || !a?.probe?.width || !a.probe.height) continue;
      const face = typicalFace(track, [{ fromMs: clip.inMs, toMs: clip.outMs }]);
      if (!face) continue;
      const sw = a.probe.width;
      const sh = a.probe.height;
      const t = transformAt(v.transform, v.keyframes, Math.round(v.durationInFrames / 2));
      const k = Math.min(width / sw, height / sh);
      const ox = (width - sw * k) / 2;
      const oy = (height - sh * k) / 2;
      const cx = (t.x + t.scale * (ox + (face.x + face.w / 2) * sw * k - width / 2)) / width;
      const top = (t.y + t.scale * (oy + face.y * sh * k - height / 2)) / height;
      const h = (t.scale * face.h * sh * k) / height;
      const want = target.bottom - target.top;
      const off = [
        Math.abs(cx - target.cx) > FACE_POS_TOLERANCE &&
          `${cx < target.cx ? "偏左" : "偏右"} ${Math.round(Math.abs(cx - target.cx) * width)}px`,
        Math.abs(top - target.top) > FACE_POS_TOLERANCE &&
          `${top < target.top ? "偏上" : "偏下"} ${Math.round(Math.abs(top - target.top) * height)}px`,
        Math.abs(h / want - 1) > FACE_SIZE_TOLERANCE &&
          `脸${h > want ? "大" : "小"}了 ${Math.round(Math.abs(h / want - 1) * 100)}%`,
      ].filter(Boolean);
      if (off.length === 0) continue;
      add({
        code: "FACE_OFF_LAYOUT",
        id: clip.id,
        atMs: ms(v.from),
        message: `人物位置和账号版式不一致（${off.join("、")}），用 mw frame 按版式重新摆`,
      });
    }
  }
  if (layout?.speed !== undefined) {
    const want = layout.speed;
    const clip = layoutMainTrack(project)
      .map((s) => s.clip)
      .find((c) => c.type === "clip" && Math.abs(c.speed - want) > 0.001);
    if (clip && clip.type === "clip") {
      add({
        code: "SPEED_NOT_LAYOUT",
        id: clip.id,
        atMs: 0,
        message: `主轨片段的倍速是 ${clip.speed}，账号设置是 ${want}（人没特别要求时用账号设置）`,
        level: "hint",
      });
    }
  }
  if (layout?.captionStyle) {
    const c = tl.captions.find(
      (x) => !x.hidden && (x.style ?? "caption-word-yellow") !== layout.captionStyle,
    );
    if (c) {
      add({
        code: "STYLE_NOT_LAYOUT",
        id: c.id,
        atMs: ms(c.from),
        message: `字幕用的样式「${c.style ?? "caption-word-yellow"}」不是账号版式规定的「${layout.captionStyle}」`,
        level: "hint",
      });
    }
  }
  if (layout?.titleStyle) {
    const o = tl.overlays.find(
      (x) =>
        !x.hidden &&
        x.template === "title-bar" &&
        (x.style ?? "title-bar-yellow") !== layout.titleStyle,
    );
    if (o) {
      add({
        code: "STYLE_NOT_LAYOUT",
        id: o.id,
        atMs: ms(o.from),
        message: `标题条用的样式「${o.style ?? "title-bar-yellow"}」不是账号版式规定的「${layout.titleStyle}」`,
        level: "hint",
      });
    }
  }

  return issues.toSorted((a, b) => a.atMs - b.atMs);
}

function nearest(track: FaceTrack, ms: number): FaceTrack["frames"][number] | null {
  let best: FaceTrack["frames"][number] | null = null;
  for (const f of track.frames) {
    if (Math.abs(f.ms - ms) > track.intervalMs) continue;
    if (!best || Math.abs(f.ms - ms) < Math.abs(best.ms - ms)) best = f;
  }
  return best;
}

/** [from, to) 去掉 spans 之后剩下的几段（spans 已排序、不重叠） */
function spansOutside(from: number, to: number, spans: FrameSpan[]): FrameSpan[] {
  const out: FrameSpan[] = [];
  let cur = from;
  for (const s of spans) {
    if (s.to <= cur || s.from >= to) continue;
    if (s.from > cur) out.push({ from: cur, to: s.from });
    cur = Math.max(cur, s.to);
  }
  if (cur < to) out.push({ from: cur, to });
  return out;
}
