import type { Box } from "../../core/lint";
import type { CardSize } from "../../core/schema";
import type { TextStyle } from "../../core/text-style";
import { cardBox, inCard } from "../card";
import type { TextCardProps } from "./schema";

/** 标题和正文的样式（位置、字号）：组件和 bounds 共用，质检和画面一致 */
export function textCardLayout(
  props: TextCardProps,
  style: TextStyle,
  width: number,
  height: number,
  size: CardSize,
): { box: Box; title: TextStyle | null; body: TextStyle } {
  const box = cardBox(size, width, height);
  // 小卡放不下大字：整体缩小
  const scale = size === "small" ? 0.75 : 1;
  const at = (k: number, y: number, maxLines: number): TextStyle => {
    const s = inCard(style, box, width, y);
    return {
      ...s,
      font: { ...s.font, size: s.font.size * scale * k },
      layout: { ...s.layout, maxLines },
    };
  };
  if (!props.title) return { box, title: null, body: at(0.85, 0.5, 4) };
  return size === "small"
    ? { box, title: at(1.1, 0.2, 1), body: at(0.8, 0.72, 2) }
    : { box, title: at(1.25, 0.2, 2), body: at(0.85, 0.6, 4) };
}
