import type React from "react";
import { Img } from "remotion";
import { TextBlock } from "../../composition/TextBlock";
import { CardFrame } from "../card-frame";
import type { TemplateProps } from "../types";
import { screenshotLayout } from "./layout";
import type { ScreenshotProps } from "./schema";

/** 截图卡：图片按 contain 放进卡片，可选一行说明；拿不到素材地址时只画底板 */
export const Screenshot: React.FC<TemplateProps<ScreenshotProps>> = ({
  props,
  style,
  size,
  frame,
  durationInFrames,
  fps,
  width,
  height,
  src,
}) => {
  const l = screenshotLayout(props, style, width, height, size);
  const url = src(props.image);
  return (
    <CardFrame
      box={l.box}
      frame={frame}
      durationInFrames={durationInFrames}
      fps={fps}
      background={size === "full" ? "#111111" : "#000000CC"}
      radius={l.radius}
    >
      {url ? (
        <div
          style={{
            position: "absolute",
            left: l.imageBox.x0,
            top: l.imageBox.y0,
            width: l.imageBox.x1 - l.imageBox.x0,
            height: l.imageBox.y1 - l.imageBox.y0,
          }}
        >
          <Img
            src={url}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              borderRadius: Math.round(width * 0.015),
            }}
          />
        </div>
      ) : null}
      {props.caption && l.caption ? (
        <TextBlock
          text={props.caption}
          style={l.caption}
          frame={frame}
          durationInFrames={durationInFrames}
          fps={fps}
        />
      ) : null}
    </CardFrame>
  );
};
