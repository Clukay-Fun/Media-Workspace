import { type Box, textBox } from "../../core/lint";
import type { CardSize } from "../../core/schema";
import type { TextStyle } from "../../core/text-style";
import { quoteLayout, quoteText } from "./layout";
import type { QuoteProps } from "./schema";

export function bounds(
  props: QuoteProps,
  style: TextStyle,
  width: number,
  height: number,
  size: CardSize,
): { text: Box[]; shapes: Box[] } {
  const layout = quoteLayout(props, style, width, height, size);
  return {
    text: [
      textBox(quoteText(props), layout.quote),
      ...(props.source && layout.source ? [textBox(props.source, layout.source)] : []),
    ],
    shapes: [layout.box],
  };
}
