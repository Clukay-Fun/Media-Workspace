import type { Slot } from "./schema";

export type Insets = { top: number; bottom: number; left: number; right: number };

/** 竖屏按 1080×1920 估计的边距（PLAN 5.5），其他尺寸按比例缩放。阶段 B 用平台截图校准 */
export const SAFE_AREAS = {
  douyin: { top: 160, bottom: 420, left: 60, right: 160 },
  channels: { top: 170, bottom: 400, left: 60, right: 150 },
  xiaohongshu: { top: 180, bottom: 360, left: 60, right: 150 },
  all: { top: 180, bottom: 440, left: 60, right: 170 },
} as const satisfies Record<string, Insets>;

export type SafeAreaName = keyof typeof SAFE_AREAS;

/**
 * 横屏（16:9）全屏播放时按 1920×1080 估计的边距（docs/decisions/0030）：上面是标题栏，下面是进度条和按钮，
 * 两侧比竖屏宽松。各平台差不多，还没用截图校准
 */
export const SAFE_AREAS_LANDSCAPE = {
  douyin: { top: 60, bottom: 150, left: 90, right: 90 },
  channels: { top: 60, bottom: 140, left: 90, right: 90 },
  xiaohongshu: { top: 60, bottom: 140, left: 90, right: 90 },
  all: { top: 70, bottom: 160, left: 100, right: 100 },
} as const satisfies Record<SafeAreaName, Insets>;

export const isLandscape = (width: number, height: number) => width > height;

/**
 * 字幕中心线占画面高度的比例：竖屏按样片测得的 y≈1167（docs/decisions/0001）；
 * 横屏放在下方安全区上面一点，两行字幕也不压进度条
 */
export const captionLine = (width: number, height: number) =>
  isLandscape(width, height) ? 0.82 : 1167 / 1920;

/** 给人看的名字（lint 提示里用） */
export const SAFE_AREA_LABEL: Record<SafeAreaName, string> = {
  all: "三平台",
  douyin: "抖音",
  channels: "视频号",
  xiaohongshu: "小红书",
};

export function safeAreaFor(name: SafeAreaName, width: number, height: number): Insets {
  const landscape = isLandscape(width, height);
  const base = (landscape ? SAFE_AREAS_LANDSCAPE : SAFE_AREAS)[name];
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
    caption: height * captionLine(width, height),
  };
  return { x: width / 2, y: ys[slot] };
}
