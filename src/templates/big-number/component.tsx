import type React from "react";
import { TextBlock } from "../../composition/TextBlock";
import { CardFrame } from "../card-frame";
import type { TemplateProps } from "../types";
import { bigNumberAt, bigNumberLayout, formatBigNumber } from "./layout";
import type { BigNumberProps } from "./schema";

export const BigNumber: React.FC<TemplateProps<BigNumberProps>> = ({
  props,
  style,
  size,
  frame,
  durationInFrames,
  fps,
  width,
  height,
}) => {
  const layout = bigNumberLayout(props, style, width, height, size);
  const value = formatBigNumber(bigNumberAt(props, frame, durationInFrames, fps), props);
  return (
    <CardFrame
      box={layout.box}
      frame={frame}
      durationInFrames={durationInFrames}
      fps={fps}
      radius={Math.round(width * 0.03)}
    >
      <TextBlock
        text={value}
        style={layout.number}
        frame={frame}
        durationInFrames={durationInFrames}
        fps={fps}
      />
      {props.suffix && layout.suffix ? (
        <TextBlock
          text={props.suffix}
          style={layout.suffix}
          frame={frame}
          durationInFrames={durationInFrames}
          fps={fps}
        />
      ) : null}
      <TextBlock
        text={props.label}
        style={layout.label}
        frame={frame}
        durationInFrames={durationInFrames}
        fps={fps}
      />
    </CardFrame>
  );
};
