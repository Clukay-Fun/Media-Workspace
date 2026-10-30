import { type Box, textBox } from "../../core/lint";
import type { CardSize } from "../../core/schema";
import type { TextStyle } from "../../core/text-style";
import { screenshotLayout } from "./layout";
import type { ScreenshotProps } from "./schema";

export function bounds(
  props: ScreenshotProps,
  style: TextStyle,
  width: number,
  height: number,
  size: CardSize,
): { text: Box[]; shapes: Box[] } {
  const l = screenshotLayout(props, style, width, height, size);
  return {
    text: props.caption && l.caption ? [textBox(props.caption, l.caption)] : [],
    // 底板和图片区都在卡片范围里；底板已经覆盖图片区，质检按底板算就够
    shapes: [l.box],
  };
}
