import type { Box } from "../../core/lint";
import type { CardSize } from "../../core/schema";
import type { TextStyle } from "../../core/text-style";
import { cardBox, cardPadding, cardScale, inCard } from "../card";
import type { TipBarProps } from "./schema";

/** 提示条高度（1080 宽）：和人名条一样 120px；横屏不超过 small 区域 */
const BAR_HEIGHT = 120;

export function tipBarLayout(
  props: TipBarProps,
  style: TextStyle,
  width: number,
  height: number,
  size: CardSize,
): { box: Box; text: TextStyle } {
  const area = cardBox(size, width, height);
  const k = cardScale(width, height);
  const barHeight = Math.min(area.y1 - area.y0, BAR_HEIGHT * k);
  const box: Box = { x0: area.x0, y0: area.y0, x1: area.x1, y1: area.y0 + barHeight };
  const pad = cardPadding(width);
  const base = inCard(style, box, width, 0.5);
  return {
    box,
    text: {
      ...base,
      font: { ...base.font, size: 44 * (barHeight / BAR_HEIGHT) },
      layout: {
        ...base.layout,
        y: (box.y0 + box.y1) / 2,
        maxLines: 1,
        align: props.align,
        ...(props.align === "left" ? { x: box.x0 + pad, anchor: "left" as const } : {}),
      },
    },
  };
}
