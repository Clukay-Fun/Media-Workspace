import type { Box } from "../core/lint";
import type { CardSize } from "../core/schema";
import type { TextStyle } from "../core/text-style";

// 卡片的占位（docs/decisions/0022）。竖屏、横屏各一套比例（横屏见 docs/decisions/0030）；
// 字号、内边距都按短边算，两种画幅全屏看时一样大。
// 小卡、半屏卡的文字要在「全平台」安全区里（下沿 440、右边 170，1080×1920），阶段 E 验收时四个工程都超出了下沿。
// 有卡时字幕隐藏（core/compile 的 cardSpans）。半屏卡在下半屏，出现时主画面上移 HALF_CARD_SHIFT；
// 全屏卡盖住整个画面和标题条，底板要不透明。

const BOXES: Record<CardSize, [number, number, number, number]> = {
  small: [0.1, 0.6, 0.9, 0.77],
  half: [0.1, 0.47, 0.9, 0.79],
  full: [0, 0, 1, 1],
};

/**
 * 横屏：字幕隐藏时卡片占下方字幕那一带，下沿在横屏「三平台」安全区（下 160 / 1080）以内；
 * 小卡和竖屏小卡一样高（按短边），宽一些；半屏卡仍在下半部，主画面照样上移
 */
const LANDSCAPE_BOXES: Record<CardSize, [number, number, number, number]> = {
  small: [0.2, 0.55, 0.8, 0.85],
  half: [0.1, 0.47, 0.9, 0.85],
  full: [0, 0, 1, 1],
};

/** 某个尺寸的卡片在画布上占的区域（像素） */
export function cardBox(size: CardSize, width: number, height: number): Box {
  const [x0, y0, x1, y1] = (width > height ? LANDSCAPE_BOXES : BOXES)[size];
  return { x0: x0 * width, y0: y0 * height, x1: x1 * width, y1: y1 * height };
}

/**
 * 卡片字号放大倍数：各模板按调研写 1080 宽时的字号（金句 48、要点 48…），在手机上看偏小，
 * 和字幕（84）、标题条（92）放在一起太弱，统一乘这个倍数（docs/decisions/0022）
 */
export const CARD_TEXT_SCALE = 1.5;

/**
 * 调研字号（1080×1920 时的像素）→ 实际像素的倍数：按短边算（1920×1080 横屏和竖屏一样大），
 * 再乘 CARD_TEXT_SCALE
 */
export const cardScale = (width: number, height: number) =>
  (Math.min(width, height) / 1080) * CARD_TEXT_SCALE;

export const cardPx = (px: number, width: number, height: number) => px * cardScale(width, height);

/** 卡片内边距：传画布短边（竖屏就是宽度） */
export const cardPadding = (short: number) => Math.round(short * 0.05);

/**
 * 把文字样式放进卡片里的某个位置：at 是卡片内的纵向比例（0 顶、0.5 中、1 底），
 * 横向居中，最大宽度扣掉内边距。bounds 和组件用同一个函数，质检和画面一致
 */
export function inCard(style: TextStyle, box: Box, short: number, at = 0.5): TextStyle {
  const pad = cardPadding(short);
  return {
    ...style,
    layout: {
      ...style.layout,
      x: (box.x0 + box.x1) / 2,
      y: box.y0 + pad + (box.y1 - box.y0 - 2 * pad) * at,
      anchor: "center",
      maxWidth: Math.max(1, box.x1 - box.x0 - 2 * pad),
    },
  };
}
