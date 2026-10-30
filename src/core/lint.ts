import { transformAt } from "./animate";
import { compile, layoutMainTrack, mapTimelineMs, type ResolvedOverlay } from "./compile";
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
    | "FACE_COVERED";
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
  faces?: Record<string, FaceTrack>;
  /** 1080 宽画面上的最小字号，其他宽度按比例 */
  minFontSize?: number;
};

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
    placed.push({
      id: c.id,
      kind: "caption",
      styleId,
      from: c.from,
      to: c.from + c.durationInFrames,
      style: st,
      text: [textBox(c.text, st)],
      shapes: [],
    });
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
    const st = styleOf(o.style, "title-bar-yellow");
    if (!st) continue;
    const b = opts.overlayBounds?.(o, st) ?? { text: [], shapes: [] };
    placed.push({
      id: o.id,
      kind: "overlay",
      styleId: o.style ?? "title-bar-yellow",
      from: o.from,
      to: o.from + o.durationInFrames,
      style: st,
      ...b,
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
        message: `文字超出了「${project.canvas.safeArea.preset}」安全区（${out.join("、")}），可能被平台的按钮或标题挡住`,
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
      i.message += `；用样式「${styleId}」的字幕共 ${g.count} 条有同样的问题，建议调整样式的 maxWidth 或位置`;
  }

  // 3. 同时出现的元素互相遮挡（文字压文字、文字压卡片）
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i] as Placed;
      const b = placed[j] as Placed;
      if (a.id === b.id) continue;
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

  // 4. 挡脸：按人脸采样，把素材坐标换算到画面上（主轨片段的缩放和位移）
  if (opts.faces) {
    const segs = layoutMainTrack(project);
    const mains = tl.videos.filter((v) => v.main);
    for (const p of placed) {
      const boxes = [...p.text, ...p.shapes];
      const step = Math.max(1, Math.round((fps * 500) / 1000));
      for (let f = p.from; f < p.to; f += step) {
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
        const toCanvas = (nx: number, ny: number) => ({
          x: t.x + t.scale * (ox + nx * sw * k - width / 2),
          y: t.y + t.scale * (oy + ny * sh * k - height / 2),
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
