import type React from "react";
import { AbsoluteFill } from "remotion";
import { TextBlock } from "../../composition/TextBlock";
import type { TemplateProps } from "../types";
import type { TitleBarProps } from "./schema";

/** 顶部标题条：横条铺满画面宽度，文字在横条里垂直居中 */
export const TitleBar: React.FC<TemplateProps<TitleBarProps>> = ({
  props,
  style,
  frame,
  durationInFrames,
  fps,
}) => {
  const bar = props.bar;
  const textStyle = bar
    ? {
        ...style,
        layout: { ...style.layout, y: bar.top + bar.height / 2, anchor: "center" as const },
      }
    : style;
  return (
    <AbsoluteFill>
      {bar ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: bar.top,
            height: bar.height,
            background: bar.color,
          }}
        />
      ) : null}
      <TextBlock
        text={props.lines.join("\n")}
        style={textStyle}
        frame={frame}
        durationInFrames={durationInFrames}
        fps={fps}
      />
    </AbsoluteFill>
  );
};
