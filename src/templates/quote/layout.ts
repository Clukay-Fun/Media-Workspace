import { type Box, estimateLines, textBox } from "../../core/lint";
import type { CardSize } from "../../core/schema";
import type { TextStyle } from "../../core/text-style";
import { cardBox, cardPadding, inCard } from "../card";
import type { QuoteProps } from "./schema";

export type QuoteLayout = {
  box: Box;
  quote: TextStyle;
  source: TextStyle | null;
  /** 小卡最多 18 字 / 2 行；超出时建议改用半屏，不自动缩小字号。 */
  fits: boolean;
  lineCount: number;
};

export function quoteText(props: QuoteProps): string {
  return `“${props.text}”`;
}

function place(
  style: TextStyle,
  box: Box,
  width: number,
  y: number,
  size: number,
  maxLines: number,
  align: "left" | "center" | "right" = "center",
): TextStyle {
  const placed = inCard(style, box, width, y);
  const padX = Math.min(cardPadding(width), (box.x1 - box.x0) * 0.08);
  const x =
    align === "left" ? box.x0 + padX : align === "right" ? box.x1 - padX : (box.x0 + box.x1) / 2;
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

/** 金句和出处使用同一份尺寸计算，bounds 与画面保持一致。 */
export function quoteLayout(
  props: QuoteProps,
  style: TextStyle,
  width: number,
  height: number,
  size: CardSize,
): QuoteLayout {
  const box = cardBox(size, width, height);
  const boxHeight = box.y1 - box.y0;
  const maxLines = size === "small" ? 2 : 4;
  const maxChars = size === "small" ? 18 : 36;
  const sourceSize = props.source ? Math.min((28 * width) / 1080, boxHeight * 0.12) : 0;
  const verticalPadding = Math.min(boxHeight * 0.12, cardPadding(width) * 0.5);
  const sourceHeight = sourceSize * 1.2;
  const sourceGap = props.source ? Math.min((12 * width) / 1080, boxHeight * 0.06) : 0;
  const textTop = box.y0 + verticalPadding;
  const textBottom = box.y1 - verticalPadding - sourceHeight - sourceGap;
  const textHeight = Math.max(1, textBottom - textTop);
  const targetFontSize = (48 * width) / 1080;
  const allowedTextLength = [...props.text].length <= maxChars;
  let fontSize = targetFontSize;
  let quote = place(style, box, width, 0.5, fontSize, maxLines);
  let lineCount = estimateLines(quoteText(props), quote).lines;

  // 按宽度缩放字号；如果合法字数在横屏小卡里受高度限制，就等比收紧以免裁切。
  // 超过尺寸字数上限时保留设计字号，并通过 fits 明确标出不适合该尺寸。
  if (allowedTextLength) {
    for (let i = 0; i < 40; i += 1) {
      const textFitsHeight = lineCount * fontSize * quote.font.lineHeight <= textHeight;
      if (lineCount <= maxLines && textFitsHeight) break;
      fontSize *= 0.92;
      quote = place(style, box, width, 0.5, fontSize, maxLines);
      lineCount = estimateLines(quoteText(props), quote).lines;
    }
  }

  const quoteY = textTop + textHeight / 2;
  quote = place(style, box, width, (quoteY - box.y0) / boxHeight, fontSize, maxLines);
  const quoteBox = textBox(quoteText(props), quote);
  const quoteInside =
    quoteBox.x0 >= box.x0 &&
    quoteBox.x1 <= box.x1 &&
    quoteBox.y0 >= textTop - 0.5 &&
    quoteBox.y1 <= textBottom + 0.5;

  if (!props.source) {
    return {
      box,
      quote,
      source: null,
      fits: allowedTextLength && lineCount <= maxLines && quoteInside,
      lineCount,
    };
  }

  const sourceY = box.y1 - verticalPadding - sourceHeight / 2;
  const sourceBase = place(
    style,
    box,
    width,
    (sourceY - box.y0) / boxHeight,
    sourceSize,
    1,
    "right",
  );
  const source = {
    ...sourceBase,
    font: {
      ...sourceBase.font,
      weight: Math.min(sourceBase.font.weight, 500),
    },
    fill: "#D8D4CB",
  };
  const sourceBox = textBox(props.source, source);
  const sourceInside =
    sourceBox.x0 >= box.x0 &&
    sourceBox.x1 <= box.x1 &&
    sourceBox.y0 >= box.y0 &&
    sourceBox.y1 <= box.y1;
  return {
    box,
    quote,
    source,
    fits: allowedTextLength && lineCount <= maxLines && quoteInside && sourceInside,
    lineCount,
  };
}
