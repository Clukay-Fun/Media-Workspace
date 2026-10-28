import type { Slot } from "./schema";

export type Insets = { top: number; bottom: number; left: number; right: number };

/** 按 1080×1920 估计的边距（PLAN 5.5），其他尺寸按比例缩放。阶段 B 用平台截图校准 */
export const SAFE_AREAS = {
  douyin: { top: 160, bottom: 420, left: 60, right: 160 },
  channels: { top: 170, bottom: 400, left: 60, right: 150 },
  xiaohongshu: { top: 180, bottom: 360, left: 60, right: 150 },
  all: { top: 180, bottom: 440, left: 60, right: 170 },
} as const satisfies Record<string, Insets>;

export type SafeAreaName = keyof typeof SAFE_AREAS;

export function safeAreaFor(name: SafeAreaName, width: number, height: number): Insets {
  const base = SAFE_AREAS[name];
  const sx = width / 1080;
  const sy = height / 1920;
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
 * caption 槽位取样片测得的字幕中心 y≈1167（docs/decisions/0001）。
 */
export function slotCenter(
  slot: Slot,
  name: SafeAreaName,
  width: number,
  height: number,
): { x: number; y: number } {
  const s = safeAreaFor(name, width, height);
  const ys: Record<Slot, number> = {
    top: s.top + height * 0.07,
    "upper-third": height * 0.3,
    center: height / 2,
    "lower-third": Math.min(height * 0.7, height - s.bottom - height * 0.04),
    caption: height * (1167 / 1920),
  };
  return { x: width / 2, y: ys[slot] };
}
