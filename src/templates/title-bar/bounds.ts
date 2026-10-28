import { type Box, textBox } from "../../core/lint";
import type { TextStyle } from "../../core/text-style";
import type { TitleBarProps } from "./schema";

/** 质检用：标题条占的区域（和组件的排版一致：文字在横条里垂直居中） */
export function bounds(
  props: TitleBarProps,
  style: TextStyle,
  width: number,
): { text: Box[]; shapes: Box[] } {
  const bar = props.bar;
  const st = bar
    ? {
        ...style,
        layout: { ...style.layout, y: bar.top + bar.height / 2, anchor: "center" as const },
      }
    : style;
  return {
    text: [textBox(props.lines.join("\n"), st)],
    shapes: bar ? [{ x0: 0, y0: bar.top, x1: width, y1: bar.top + bar.height }] : [],
  };
}
