import type { Slot } from "./schema";

export type Insets = { top: number; bottom: number; left: number; right: number };

// 只按视频号（用户只发视频号，2026-11-01，docs/decisions/0031）。两张表都用 2026-11-01 的实机截图核对过。

/**
 * 竖屏按 1080×1920 的边距（PLAN 5.5），其他尺寸按比例缩放。实测：顶部按钮到 y≈177、
 * 底部作者名从 y≈1574 起（留了余量）；竖屏右侧边界按当前规则取 x=960。
 */
export const SAFE_AREA: Insets = { top: 170, bottom: 400, left: 60, right: 120 };

/**
 * 横屏按 1920×1080 的边距（docs/decisions/0030）：全屏横看时按钮在画面外的黑边里、进度条在画面下沿以下，
 * 竖着刷到横屏视频时画面上也没有遮挡；只给没有黑边的 16:9 手机留出角上按钮的位置（左右 5%）
 */
export const SAFE_AREA_LANDSCAPE: Insets = { top: 60, bottom: 60, left: 96, right: 96 };

export const isLandscape = (width: number, height: number) => width > height;

/**
 * 字幕中心线占画面高度的比例：竖屏按样片测得的 y≈1167（docs/decisions/0001）；
 * 横屏放在下方，84 号字两行也在视频号安全区（下 60）以内
 */
export const captionLine = (width: number, height: number) =>
  isLandscape(width, height) ? 0.84 : 1167 / 1920;

export function safeAreaFor(width: number, height: number): Insets {
  const landscape = isLandscape(width, height);
  const base = landscape ? SAFE_AREA_LANDSCAPE : SAFE_AREA;
  const sx = width / (landscape ? 1920 : 1080);
  const sy = height / (landscape ? 1080 : 1920);
  return {
    top: base.top * sy,
    bottom: base.bottom * sy,
    left: base.left * sx,
    right: base.right * sx,
  };
}

/**
 * 槽位换算成中心点坐标。横向一律居中（样片的竖向参考线 x≈536，接近画面中线；
 * 安全区左右不对称，取它的中线会偏左），纵向按画面比例。
 * caption 槽位取字幕中心线（captionLine）。
 */
export function slotCenter(slot: Slot, width: number, height: number): { x: number; y: number } {
  const s = safeAreaFor(width, height);
  const ys: Record<Slot, number> = {
    top: s.top + height * 0.07,
    "upper-third": height * 0.3,
    center: height / 2,
    "lower-third": Math.min(height * 0.7, height - s.bottom - height * 0.04),
    caption: height * captionLine(width, height),
  };
  return { x: width / 2, y: ys[slot] };
}
