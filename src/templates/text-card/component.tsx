import type React from "react";
import { TextBlock } from "../../composition/TextBlock";
import { CardFrame } from "../card-frame";
import type { TemplateProps } from "../types";
import { textCardLayout } from "./layout";
import type { TextCardProps } from "./schema";

/** 通用文字卡：标题 + 正文；也是写新卡片模板的参考（docs/template-guide.md） */
export const TextCard: React.FC<TemplateProps<TextCardProps>> = ({
  props,
  style,
  size,
  frame,
  durationInFrames,
  fps,
  width,
  height,
}) => {
  const l = textCardLayout(props, style, width, height, size);
  return (
    <CardFrame
      box={l.box}
      frame={frame}
      durationInFrames={durationInFrames}
      fps={fps}
      background={
        props.background === undefined
          ? size === "full"
            ? "#111111"
            : "#000000B3"
          : props.background
      }
      radius={size === "full" ? 0 : Math.round(width * 0.03)}
    >
      {l.title && props.title ? (
        <TextBlock
          text={props.title}
          style={l.title}
          frame={frame}
          durationInFrames={durationInFrames}
          fps={fps}
        />
      ) : null}
      <TextBlock
        text={props.body}
        style={l.body}
        frame={frame}
        durationInFrames={durationInFrames}
        fps={fps}
      />
    </CardFrame>
  );
};
