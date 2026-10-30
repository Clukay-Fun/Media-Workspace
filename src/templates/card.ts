import type { Box } from "../core/lint";
import type { CardSize } from "../core/schema";
import type { TextStyle } from "../core/text-style";

// 卡片的占位（docs/decisions/0022）。比例按 9:16 竖屏定，横屏也按比例缩放。
// 有卡时字幕隐藏（core/compile 的 cardSpans）。半屏卡在下半屏，出现时主画面上移 HALF_CARD_SHIFT；
// 全屏卡盖住整个画面和标题条，底板要不透明。

const BOXES: Record<CardSize, [number, number, number, number]> = {
  small: [0.08, 0.68, 0.92, 0.82],
  half: [0.05, 0.52, 0.95, 0.92],
  full: [0, 0, 1, 1],
};

/** 某个尺寸的卡片在画布上占的区域（像素） */
export function cardBox(size: CardSize, width: number, height: number): Box {
  const [x0, y0, x1, y1] = BOXES[size];
  return { x0: x0 * width, y0: y0 * height, x1: x1 * width, y1: y1 * height };
}

/** 卡片内边距：按画布宽度算 */
export const cardPadding = (width: number) => Math.round(width * 0.05);

/**
 * 把文字样式放进卡片里的某个位置：at 是卡片内的纵向比例（0 顶、0.5 中、1 底），
 * 横向居中，最大宽度扣掉内边距。bounds 和组件用同一个函数，质检和画面一致
 */
export function inCard(style: TextStyle, box: Box, canvasWidth: number, at = 0.5): TextStyle {
  const pad = cardPadding(canvasWidth);
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
