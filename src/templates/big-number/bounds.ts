import { type Box, textBox } from "../../core/lint";
import type { CardSize } from "../../core/schema";
import type { TextStyle } from "../../core/text-style";
import { bigNumberLayout, bigNumberText } from "./layout";
import type { BigNumberProps } from "./schema";

export function bounds(
  props: BigNumberProps,
  style: TextStyle,
  width: number,
  height: number,
  size: CardSize,
): { text: Box[]; shapes: Box[] } {
  const layout = bigNumberLayout(props, style, width, height, size);
  return {
    text: [
      textBox(bigNumberText(props), layout.number),
      ...(props.suffix && layout.suffix ? [textBox(props.suffix, layout.suffix)] : []),
      textBox(props.label, layout.label),
    ],
    shapes: [layout.box],
  };
}
