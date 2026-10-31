import { type Box, textBox } from "../../core/lint";
import type { CardSize } from "../../core/schema";
import type { TextStyle } from "../../core/text-style";
import { nameBarLayout } from "./layout";
import type { NameBarProps } from "./schema";

export function bounds(
  props: NameBarProps,
  style: TextStyle,
  width: number,
  height: number,
  size: CardSize,
): { text: Box[]; shapes: Box[] } {
  const l = nameBarLayout(props, style, width, height, size);
  return {
    text: [
      textBox(props.name, l.name),
      ...(props.title && l.title ? [textBox(props.title, l.title)] : []),
    ],
    shapes: [l.box],
  };
}
