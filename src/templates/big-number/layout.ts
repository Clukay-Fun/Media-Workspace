import { ease } from "../../core/animate";
import { type Box, estimateLines } from "../../core/lint";
import type { CardSize } from "../../core/schema";
import type { TextStyle } from "../../core/text-style";
import { msToFrame } from "../../core/time";
import { cardBox, cardPadding, cardScale } from "../card";
import type { BigNumberProps } from "./schema";

const EXIT_MS = 200;
const NUMBER_SIZE = 120;
const UNIT_SIZE = 36;
const LABEL_SIZE = 40;

export type BigNumberLayout = {
  box: Box;
  number: TextStyle;
  suffix: TextStyle | null;
  label: TextStyle;
};

/** 保留前缀、千分位和小数位；单位单独排版，和数字共用一行。 */
export function formatBigNumber(value: number, props: BigNumberProps): string {
  const number = new Intl.NumberFormat("en-US", {
    useGrouping: props.thousandsSeparator,
    minimumFractionDigits: props.decimals,
    maximumFractionDigits: props.decimals,
  }).format(value);
  return `${props.prefix ?? ""}${number}`;
}

/** 数字在退场前的最后一帧到达终值，逐帧计算以保证预览和导出一致。 */
export function bigNumberAt(
  props: BigNumberProps,
  frame: number,
  durationInFrames: number,
  fps: number,
): number {
  const countFrames = Math.max(1, durationInFrames - msToFrame(EXIT_MS, fps));
  const countFrame = Math.max(0, Math.min(frame, countFrames - 1));
  const progress = countFrames === 1 ? 1 : countFrame / (countFrames - 1);
  return props.from + (props.to - props.from) * ease("ease-out", progress);
}

export function bigNumberText(props: BigNumberProps): string {
  const candidates = [formatBigNumber(props.from, props), formatBigNumber(props.to, props)];
  return candidates.reduce((longest, current) =>
    [...current].length > [...longest].length ? current : longest,
  );
}

function naturalWidth(text: string, style: TextStyle): number {
  return estimateLines(text, {
    ...style,
    layout: { ...style.layout, maxWidth: 1_000_000 },
  }).width;
}

function textStyle(
  style: TextStyle,
  size: number,
  x: number,
  y: number,
  maxWidth: number,
  align: "left" | "right" | "center",
): TextStyle {
  return {
    ...style,
    font: { ...style.font, size },
    layout: {
      ...style.layout,
      x,
      y,
      anchor: "center",
      maxWidth: Math.max(1, maxWidth),
      maxLines: 1,
      align,
    },
  };
}

/** 组件和 bounds 共用排版。1080×1920 时采用 120 / 36 / 40px；受小卡高度或超长数字限制时等比收紧。 */
export function bigNumberLayout(
  props: BigNumberProps,
  style: TextStyle,
  width: number,
  height: number,
  size: CardSize,
): BigNumberLayout {
  const box = cardBox(size, width, height);
  const boxWidth = box.x1 - box.x0;
  const boxHeight = box.y1 - box.y0;
  const widthScale = cardScale(width, height);
  const lineHeight = style.font.lineHeight;
  const verticalPadding = Math.min(boxHeight * 0.08, cardPadding(width) * 0.35);
  const availableHeight = Math.max(1, boxHeight - 2 * verticalPadding);
  const desiredHeight = (NUMBER_SIZE + LABEL_SIZE) * widthScale * lineHeight + 12 * widthScale;
  const heightFit = Math.min(1, availableHeight / desiredHeight);
  const numberSize = NUMBER_SIZE * widthScale * heightFit;
  const unitSize = UNIT_SIZE * widthScale * heightFit;
  const labelSize = LABEL_SIZE * widthScale * heightFit;
  const padX = Math.min(cardPadding(width), boxWidth * 0.08);
  const availableWidth = Math.max(1, boxWidth - 2 * padX);

  const numberText = bigNumberText(props);
  const numberProbe = textStyle(style, numberSize, 0, 0, availableWidth, "right");
  const rawNumberWidth = naturalWidth(numberText, numberProbe);
  const unitText = props.suffix ?? "";
  const unitProbe = textStyle(style, unitSize, 0, 0, availableWidth, "left");
  const rawUnitWidth = unitText ? naturalWidth(unitText, unitProbe) : 0;
  const rawGap = unitText ? 12 * widthScale * heightFit : 0;
  const groupWidth = rawNumberWidth + rawUnitWidth + rawGap;
  const widthFit = Math.min(1, availableWidth / Math.max(1, groupWidth));
  const numberWidth = rawNumberWidth * widthFit;
  const unitWidth = rawUnitWidth * widthFit;
  const gap = rawGap * widthFit;
  const fittedGroupWidth = numberWidth + unitWidth + gap;
  const groupX = (box.x0 + box.x1 - fittedGroupWidth) / 2;

  const fittedNumberSize = numberSize * widthFit;
  const fittedUnitSize = unitSize * widthFit;
  const fittedLabelSize = labelSize;
  const labelProbe = textStyle(style, fittedLabelSize, 0, 0, availableWidth, "center");
  const labelNaturalWidth = naturalWidth(props.label, labelProbe);
  const labelWidthFit = Math.min(1, availableWidth / Math.max(1, labelNaturalWidth));
  const finalLabelSize = fittedLabelSize * labelWidthFit;
  const finalLabelWidth = labelNaturalWidth * labelWidthFit;

  const numberHeight = fittedNumberSize * lineHeight;
  const labelHeight = finalLabelSize * lineHeight;
  const contentGap = 12 * widthScale * heightFit;
  const contentHeight = numberHeight + contentGap + labelHeight;
  const contentTop = box.y0 + (boxHeight - contentHeight) / 2;
  const numberY = contentTop + numberHeight / 2;
  const labelY = contentTop + numberHeight + contentGap + labelHeight / 2;

  const number = textStyle(
    style,
    fittedNumberSize,
    groupX + numberWidth,
    numberY,
    numberWidth,
    "right",
  );
  const suffix = unitText
    ? textStyle(style, fittedUnitSize, groupX + numberWidth + gap, numberY, unitWidth, "left")
    : null;
  const label = textStyle(
    style,
    finalLabelSize,
    (box.x0 + box.x1) / 2,
    labelY,
    finalLabelWidth,
    "center",
  );

  return { box, number, suffix, label };
}
