import { type Box, textBox } from "../../core/lint";
import type { CardSize } from "../../core/schema";
import type { TextStyle } from "../../core/text-style";
import { textCardLayout } from "./layout";
import type { TextCardProps } from "./schema";

export function bounds(
  props: TextCardProps,
  style: TextStyle,
  width: number,
  height: number,
  size: CardSize,
): { text: Box[]; shapes: Box[] } {
  const l = textCardLayout(props, style, width, height, size);
  return {
    text: [
      ...(l.title && props.title ? [textBox(props.title, l.title)] : []),
      textBox(props.body, l.body),
    ],
    shapes: props.background === null ? [] : [l.box],
  };
}
