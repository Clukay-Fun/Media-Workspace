import { type Box, textBox } from "../../core/lint";
import type { CardSize } from "../../core/schema";
import type { TextStyle } from "../../core/text-style";
import { tipBarLayout } from "./layout";
import type { TipBarProps } from "./schema";

export function bounds(
  props: TipBarProps,
  style: TextStyle,
  width: number,
  height: number,
  size: CardSize,
): { text: Box[]; shapes: Box[] } {
  const l = tipBarLayout(props, style, width, height, size);
  return { text: [textBox(props.text, l.text)], shapes: [l.box] };
}
