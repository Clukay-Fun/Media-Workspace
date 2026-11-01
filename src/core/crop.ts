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
