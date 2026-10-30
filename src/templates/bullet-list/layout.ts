import type { Box } from "../../core/lint";
import type { CardSize } from "../../core/schema";
import type { TextStyle } from "../../core/text-style";
import { msToFrame } from "../../core/time";
import { cardBox, cardPadding, inCard } from "../card";
import type { BulletListProps } from "./schema";

export type BulletListLayout = {
  box: Box;
  title: TextStyle | null;
  items: TextStyle[];
};

/** 未指定时间的要点按序均匀分布在卡片时长的前 60%；显式时间按毫秒换算。 */
export function bulletListStartFrames(
  items: readonly { atMs?: number }[],
  durationInFrames: number,
  fps: number,
): number[] {
  const lastDefaultFrame = Math.max(0, Math.round(Math.max(0, durationInFrames - 1) * 0.6));
  return items.map((item, index) => {
    if (item.atMs !== undefined) return msToFrame(item.atMs, fps);
    return items.length < 2 ? 0 : Math.round((lastDefaultFrame * index) / (items.length - 1));
  });
}

function place(
  style: TextStyle,
  box: Box,
  width: number,
  y: number,
  size: number,
  maxLines: number,
  align: "left" | "center" = "center",
): TextStyle {
  const placed = inCard(style, box, width, y);
  const padX = Math.min(cardPadding(width), (box.x1 - box.x0) * 0.08);
  const x = align === "left" ? box.x0 + padX : (box.x0 + box.x1) / 2;
  return {
    ...placed,
    font: { ...placed.font, size, lineHeight: 1.2 },
    layout: {
      ...placed.layout,
      x,
      y: box.y0 + (box.y1 - box.y0) * y,
      anchor: "center",
      maxWidth: Math.max(1, box.x1 - box.x0 - 2 * padX),
      maxLines,
      align,
    },
  };
}

/** 标题和要点的纵向槽位、字号由组件与 bounds 共用。 */
export function bulletListLayout(
  props: BulletListProps,
  style: TextStyle,
  width: number,
  height: number,
  size: CardSize,
): BulletListLayout {
  const box = cardBox(size, width, height);
  const boxHeight = box.y1 - box.y0;
  const hasTitle = Boolean(props.title);
  const itemSize = (48 * width) / 1080;
  const listStart = hasTitle ? (props.items.length === 2 ? 0.42 : 0.37) : 0.28;
  const listEnd = hasTitle ? (props.items.length === 2 ? 0.82 : 0.85) : 0.82;
  const items = props.items.map((item, index) => {
    const y = listStart + ((listEnd - listStart) * index) / Math.max(1, props.items.length - 1);
    return place(style, box, width, y, itemSize, 1, "left");
  });

  if (!props.title) return { box, title: null, items };
  const titleSize = (44 * width) / 1080;
  const title = place(style, box, width, 0.12, titleSize, 1);
  return { box, title, items };
}
