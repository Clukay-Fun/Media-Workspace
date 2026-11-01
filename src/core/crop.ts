import type { CropRect } from "./schema";

export type Size = { width: number; height: number };
export type Rect = { x0: number; y0: number; x1: number; y1: number };

export type CropLayout = {
  /** 裁切后内容按 contain 放进画布的位置。 */
  box: Rect;
  /** 完整素材相对裁切窗口的位置和尺寸。 */
  media: { x: number; y: number; width: number; height: number };
};

/** 把源素材人脸框裁到可见区域，并换算成裁切素材自己的 0–1 坐标。 */
export function faceInCrop(
  face: { x: number; y: number; w: number; h: number },
  crop?: CropRect,
): { x: number; y: number; w: number; h: number } | null {
  if (!crop) return face;
  const x0 = Math.max(face.x, crop.x);
  const y0 = Math.max(face.y, crop.y);
  const x1 = Math.min(face.x + face.w, crop.x + crop.width);
  const y1 = Math.min(face.y + face.h, crop.y + crop.height);
  if (x1 <= x0 || y1 <= y0) return null;
  const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
  return {
    x: round((x0 - crop.x) / crop.width),
    y: round((y0 - crop.y) / crop.height),
    w: round((x1 - x0) / crop.width),
    h: round((y1 - y0) / crop.height),
  };
}

export function croppedSize(source: Size, crop?: CropRect): Size {
  return crop ? { width: source.width * crop.width, height: source.height * crop.height } : source;
}

/**
 * 渲染和几何计算共用：先裁切源素材，再将裁切后的画面按 contain 居中；外层 transform 随后应用。
 * media 的坐标以裁切窗口左上角为原点，供合成组件通过 overflow:hidden 显示。
 */
export function cropLayout(canvas: Size, source: Size, crop: CropRect): CropLayout {
  const cropped = croppedSize(source, crop);
  const scale = Math.min(canvas.width / cropped.width, canvas.height / cropped.height);
  const width = cropped.width * scale;
  const height = cropped.height * scale;
  const mediaWidth = source.width * scale;
  const mediaHeight = source.height * scale;
  return {
    box: {
      x0: (canvas.width - width) / 2,
      y0: (canvas.height - height) / 2,
      x1: (canvas.width + width) / 2,
      y1: (canvas.height + height) / 2,
    },
    media: {
      x: crop.x === 0 ? 0 : -crop.x * mediaWidth,
      y: crop.y === 0 ? 0 : -crop.y * mediaHeight,
      width: mediaWidth,
      height: mediaHeight,
    },
  };
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
): Rect {
  if (!sourceWidth || !sourceHeight || sourceWidth <= 0 || sourceHeight <= 0)
    return { x0: 0, y0: 0, x1: width, y1: height };
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const w = sourceWidth * scale;
  const h = sourceHeight * scale;
  return { x0: (width - w) / 2, y0: (height - h) / 2, x1: (width + w) / 2, y1: (height + h) / 2 };
}

/** 素材在画布上看得到的框（还没套 transform）：有裁切按裁切后的画面算，没有就是整张素材 */
export function contentBox(
  canvas: Size,
  source: { width?: number; height?: number } | undefined,
  crop?: CropRect,
): Rect {
  if (crop && source?.width && source.height)
    return cropLayout(canvas, { width: source.width, height: source.height }, crop).box;
  return containBox(canvas.width, canvas.height, source?.width, source?.height);
}

// ---- 界面上拖裁切框用的纯计算。坐标都是素材的 0–1 坐标 ----

export const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };

/** 和完整画面差不到千分之一就当没裁（存 null，不写一个全尺寸矩形） */
export function isFullCrop(c: CropRect): boolean {
  const e = 0.001;
  return c.x < e && c.y < e && c.width > 1 - e && c.height > 1 - e;
}

/** 存进工程前取 4 位小数，并保证不越界（x + width ≤ 1） */
export function roundCrop(c: CropRect): CropRect {
  const r = (v: number) => Math.round(v * 10_000) / 10_000;
  const width = r(Math.min(1, Math.max(0.0001, c.width)));
  const height = r(Math.min(1, Math.max(0.0001, c.height)));
  return {
    x: r(Math.min(1 - width, Math.max(0, c.x))),
    y: r(Math.min(1 - height, Math.max(0, c.y))),
    width,
    height,
  };
}

/** 在素材里取宽高比为 aspect（按像素算）的最大裁切，中心尽量对准 center */
export function cropForAspect(
  source: Size,
  aspect: number,
  center: { x: number; y: number } = { x: 0.5, y: 0.5 },
): CropRect {
  const k = normAspect(source, aspect);
  const width = k <= 1 ? k : 1;
  const height = k <= 1 ? 1 : 1 / k;
  return roundCrop({
    x: clamp(center.x - width / 2, 0, 1 - width),
    y: clamp(center.y - height / 2, 0, 1 - height),
    width,
    height,
  });
}

export type CropHandle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * 拖裁切框：从 start 开始，handle 拖了 (dx, dy)（素材 0–1 坐标）。
 * aspect 有值时按像素宽高比锁定：拖角以宽度为准，拖边保持另一方向居中。不会拖出素材，也不会小于 min
 */
export function dragCrop(
  start: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  source: Size,
  aspect: number | null,
  min = 0.05,
): CropRect {
  if (handle === "move") {
    return {
      ...start,
      x: clamp(start.x + dx, 0, 1 - start.width),
      y: clamp(start.y + dy, 0, 1 - start.height),
    };
  }
  let l = start.x;
  let t = start.y;
  let r = start.x + start.width;
  let b = start.y + start.height;
  if (handle.includes("w")) l = clamp(l + dx, 0, r - min);
  if (handle.includes("e")) r = clamp(r + dx, l + min, 1);
  if (handle.includes("n")) t = clamp(t + dy, 0, b - min);
  if (handle.includes("s")) b = clamp(b + dy, t + min, 1);
  if (aspect === null) return { x: l, y: t, width: r - l, height: b - t };

  const k = normAspect(source, aspect);
  const horizontal = handle === "e" || handle === "w";
  const vertical = handle === "n" || handle === "s";
  if (vertical) {
    // 拖上下边：高度为准，宽度跟着变，左右居中；左右放不下时反过来按宽度收
    const cx = (l + r) / 2;
    let h = b - t;
    let w = h * k;
    const maxW = 2 * Math.min(cx, 1 - cx);
    if (w > maxW) {
      w = maxW;
      h = w / k;
      if (handle === "n") t = b - h;
      else b = t + h;
    }
    return { x: cx - w / 2, y: t, width: w, height: h };
  }
  if (horizontal) {
    const cy = (t + b) / 2;
    let w = r - l;
    let h = w / k;
    const maxH = 2 * Math.min(cy, 1 - cy);
    if (h > maxH) {
      h = maxH;
      w = h * k;
      if (handle === "w") l = r - w;
      else r = l + w;
    }
    return { x: l, y: cy - h / 2, width: w, height: h };
  }
  // 拖角：对角固定，宽度为准，高度跟着变；上下放不下时按高度收
  const fixedX = handle.includes("w") ? r : l;
  const fixedY = handle.includes("n") ? b : t;
  const roomX = handle.includes("w") ? fixedX : 1 - fixedX;
  const roomY = handle.includes("n") ? fixedY : 1 - fixedY;
  let w = Math.min(r - l, roomX);
  let h = w / k;
  if (h > roomY) {
    h = roomY;
    w = h * k;
  }
  return {
    x: handle.includes("w") ? fixedX - w : fixedX,
    y: handle.includes("n") ? fixedY - h : fixedY,
    width: w,
    height: h,
  };
}

/** 像素宽高比换成素材 0–1 坐标里的宽高比 */
function normAspect(source: Size, aspect: number): number {
  return (aspect * source.height) / source.width;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
