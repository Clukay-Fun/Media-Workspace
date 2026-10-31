import { type Box, textBox } from "../../core/lint";
import type { CardSize } from "../../core/schema";
import type { TextStyle } from "../../core/text-style";
import { bulletListLayout } from "./layout";
import type { BulletListProps } from "./schema";

export function bounds(
  props: BulletListProps,
  style: TextStyle,
  width: number,
  height: number,
  size: CardSize,
): { text: Box[]; shapes: Box[] } {
  const layout = bulletListLayout(props, style, width, height, size);
  return {
    text: [
      ...(props.title && layout.title ? [textBox(props.title, layout.title)] : []),
      ...props.items.map((item, index) => {
        const itemStyle = layout.items[index];
        return textBox(`• ${item.text}`, itemStyle ?? style);
      }),
    ],
    shapes: [layout.box],
  };
}
