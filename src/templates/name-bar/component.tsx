import type React from "react";
import { AbsoluteFill } from "remotion";
import { TextBlock } from "../../composition/TextBlock";
import { ease } from "../../core/animate";
import { CardFrame } from "../card-frame";
import type { TemplateProps } from "../types";
import { nameBarLayout } from "./layout";
import type { NameBarProps } from "./schema";

/** 人名条：一行名字 + 可选身份，左对齐或居中，从左侧滑入 */
export const NameBar: React.FC<TemplateProps<NameBarProps>> = ({
  props,
  style,
  size,
  frame,
  durationInFrames,
  fps,
  width,
  height,
}) => {
  const l = nameBarLayout(props, style, width, height, size);
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
          text={props.name}
          style={l.name}
          frame={frame}
          durationInFrames={durationInFrames}
          fps={fps}
        />
        {props.title && l.title ? (
          <TextBlock
            text={props.title}
            style={l.title}
            frame={frame}
            durationInFrames={durationInFrames}
            fps={fps}
          />
        ) : null}
      </AbsoluteFill>
    </CardFrame>
  );
};
