import type { Box } from "../../core/lint";
import type { CardSize } from "../../core/schema";
import type { TextStyle } from "../../core/text-style";
import { cardBox, cardPadding, cardScale, inCard } from "../card";
import type { NameBarProps } from "./schema";

/** 人名条高度（1080 宽）：调研值 120px；横屏时不能超过 small 区域 */
const BAR_HEIGHT = 120;

/** 人名条的文字样式：组件和 bounds 共用 */
export function nameBarLayout(
  props: NameBarProps,
  style: TextStyle,
  width: number,
  height: number,
  size: CardSize,
): { box: Box; name: TextStyle; title: TextStyle | null } {
  const area = cardBox(size, width, height);
  const k = cardScale(width, height);
  const barHeight = Math.min(area.y1 - area.y0, BAR_HEIGHT * k);
  const fontScale = barHeight / BAR_HEIGHT;
  const box: Box = { x0: area.x0, y0: area.y0, x1: area.x1, y1: area.y0 + barHeight };
  const pad = cardPadding(width);

  const at = (y: number, px: number): TextStyle => {
    const s = inCard(style, box, width, 0.5);
    return {
      ...s,
      font: { ...s.font, size: px * fontScale },
      layout: {
        ...s.layout,
        y: box.y0 + barHeight * y,
        maxLines: 1,
        align: props.align,
        ...(props.align === "left" ? { x: box.x0 + pad, anchor: "left" as const } : {}),
      },
    };
  };

  return props.title
    ? { box, name: at(0.36, 48), title: at(0.75, 32) }
    : { box, name: at(0.5, 48), title: null };
}
