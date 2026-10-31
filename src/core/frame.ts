import type { LayoutFace } from "./layout";
import type { FaceTrack } from "./lint";

// 按账号版式摆人物（阶段 F，docs/decisions/0025）：从人脸检测结果算主画面的缩放和位置，
// 让人脸框落在版式规定的位置上；画面不够大时宁可脸大一点、偏一点，也不露黑边。

export type FaceBox = { x: number; y: number; w: number; h: number };

/**
 * 一段时间里人脸的代表位置（素材坐标，0–1）：每个采样取最大的那张脸，各边取中位数。
 * 中位数不怕偶尔转头、低头或误检；没有任何采样检测到脸时返回 null
 */
export function typicalFace(
  track: FaceTrack,
  ranges: { fromMs: number; toMs: number }[],
): FaceBox | null {
  const boxes = track.frames.flatMap((f) => {
    if (!ranges.some((r) => f.ms >= r.fromMs && f.ms < r.toMs)) return [];
    const big = f.boxes.reduce<FaceBox | null>(
      (a, b) => (!a || b.w * b.h > a.w * a.h ? b : a),
      null,
    );
    return big ? [big] : [];
  });
  if (boxes.length === 0) return null;
  const med = (xs: number[]) => {
    const s = xs.toSorted((a, b) => a - b);
    return s[Math.floor((s.length - 1) / 2)] ?? 0;
  };
  const cx = med(boxes.map((b) => b.x + b.w / 2));
  const top = med(boxes.map((b) => b.y));
  const h = med(boxes.map((b) => b.h));
  const w = med(boxes.map((b) => b.w));
  return { x: cx - w / 2, y: top, w, h };
}

export type FramePlan = {
  /** 主轨片段的 transform：x / y 是画面中心的位置（像素），scale 以中心为原点 */
  transform: { x: number; y: number; scale: number };
  /** 摆好之后人脸框实际在画面上的位置（占画面比例），和目标的差 */
  face: LayoutFace;
  /** 为了不露黑边放大或挪动过：脸会比目标大或偏 */
  clamped: boolean;
};

/**
 * 算主画面的变换，让素材里的人脸框 face（素材坐标 0–1）落到 target（画面比例）上。
 * 和渲染一致：素材先等比缩放到能完整放进画面（contain）并居中，再按 transform 以中心缩放、移动
 */
export function planFrame(
  face: FaceBox,
  source: { width: number; height: number },
  canvas: { width: number; height: number },
  target: LayoutFace,
): FramePlan {
  const W = canvas.width;
  const H = canvas.height;
  const k = Math.min(W / source.width, H / source.height);
  const vw = source.width * k;
  const vh = source.height * k;
  const ox = (W - vw) / 2;
  const oy = (H - vh) / 2;
  // 人脸框在 contain 之后（变换之前）的位置，相对画面中心
  const fx = ox + (face.x + face.w / 2) * vw - W / 2;
  const fy = oy + face.y * vh - H / 2;
  const fh = face.h * vh;

  // 至少放大到盖满画面，不露黑边
  const cover = Math.max(W / vw, H / vh);
  let scale = Math.max(((target.bottom - target.top) * H) / fh, cover);
  let clamped = scale > ((target.bottom - target.top) * H) / fh + 1e-9;
  let x = target.cx * W - scale * fx;
  let y = target.top * H - scale * fy;
  // 挪到画面边缘不露出来：变换后素材的左右上下边要盖过画面
  const limit = (pos: number, size: number, extent: number) => {
    const half = (scale * size) / 2;
    return Math.min(half, Math.max(extent - half, pos));
  };
  const nx = limit(x, vw, W);
  const ny = limit(y, vh, H);
  if (Math.abs(nx - x) > 0.5 || Math.abs(ny - y) > 0.5) clamped = true;
  x = nx;
  y = ny;
  scale = Math.round(scale * 1000) / 1000;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return {
    transform: { x: Math.round(x), y: Math.round(y), scale },
    face: {
      cx: r((x + scale * fx) / W),
      top: r((y + scale * fy) / H),
      bottom: r((y + scale * (fy + fh)) / H),
    },
    clamped,
  };
}
