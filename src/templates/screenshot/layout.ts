import type { Box } from "../../core/lint";
import type { CardSize } from "../../core/schema";
import type { TextStyle } from "../../core/text-style";
import { cardBox, cardPadding, inCard } from "../card";
import type { ScreenshotProps } from "./schema";

/** 半屏时图片高度上限（1080 宽）：调研值 280px */
const HALF_IMAGE_HEIGHT = 280;

/** 截图卡：图片区、底板、说明文字；组件和 bounds 共用 */
export function screenshotLayout(
  props: ScreenshotProps,
  style: TextStyle,
  width: number,
  height: number,
  size: CardSize,
): { box: Box; imageBox: Box; caption: TextStyle | null; radius: number } {
  const box = cardBox(size, width, height);
  const pad = cardPadding(width);
  const k = width / 1080;
  const radius = size === "full" ? 0 : Math.round(width * 0.03);
  const captionSize = 40 * k;
  // 说明文字按一行留高度；半屏的图片再限制在 280px 以内
  const captionHeight = props.caption ? captionSize * style.font.lineHeight * 1.6 : 0;
  const available = box.y1 - box.y0 - 2 * pad - captionHeight;
  const imageHeight =
    size === "half" ? Math.min(available, HALF_IMAGE_HEIGHT * k) : Math.max(1, available);
  const imageY = box.y0 + pad + (available - imageHeight) / 2;
  const imageBox = {
    x0: box.x0 + pad,
    y0: imageY,
    x1: box.x1 - pad,
    y1: imageY + Math.max(1, imageHeight),
  };
  let caption: TextStyle | null = null;
  if (props.caption) {
    const base = inCard(style, box, width, 0.92);
    caption = {
      ...base,
      font: { ...base.font, size: captionSize },
      layout: { ...base.layout, maxLines: 1 },
    };
  }
  return { box, imageBox, caption, radius };
}
