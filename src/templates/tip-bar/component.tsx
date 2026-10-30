import type React from "react";
import { AbsoluteFill } from "remotion";
import { TextBlock } from "../../composition/TextBlock";
import { ease } from "../../core/animate";
import { CardFrame } from "../card-frame";
import type { TemplateProps } from "../types";
import { tipBarLayout } from "./layout";
import type { TipBarProps } from "./schema";

/** 提示条：一行 44px 提示语，最多 16 字，从左侧滑入 */
export const TipBar: React.FC<TemplateProps<TipBarProps>> = ({
  props,
  style,
  size,
  frame,
  durationInFrames,
  fps,
  width,
  height,
}) => {
  const l = tipBarLayout(props, style, width, height, size);
  const ms = (frame * 1000) / fps;
  const enter = ease("ease-out", Math.min(1, ms / 400));
  const offset = -(l.box.x1 - l.box.x0) * 0.6 * (1 - enter);
  return (
    <CardFrame
      box={l.box}
      frame={frame}
      durationInFrames={durationInFrames}
      fps={fps}
      radius={Math.round(width * 0.03)}
    >
      <AbsoluteFill style={{ transform: `translateX(${offset}px)` }}>
        <TextBlock
          text={props.text}
          style={l.text}
          frame={frame}
          durationInFrames={durationInFrames}
          fps={fps}
        />
      </AbsoluteFill>
    </CardFrame>
  );
};
