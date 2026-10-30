import type React from "react";
import { TextBlock } from "../../composition/TextBlock";
import { CardFrame } from "../card-frame";
import type { TemplateProps } from "../types";
import { quoteLayout, quoteText } from "./layout";
import type { QuoteProps } from "./schema";

export const Quote: React.FC<TemplateProps<QuoteProps>> = ({
  props,
  style,
  size,
  frame,
  durationInFrames,
  fps,
  width,
  height,
}) => {
  const layout = quoteLayout(props, style, width, height, size);
  return (
    <CardFrame
      box={layout.box}
      frame={frame}
      durationInFrames={durationInFrames}
      fps={fps}
      radius={Math.round(width * 0.03)}
    >
      <TextBlock
        text={quoteText(props)}
        highlights={props.highlights}
        style={layout.quote}
        frame={frame}
        durationInFrames={durationInFrames}
        fps={fps}
      />
      {props.source && layout.source ? (
        <TextBlock
          text={props.source}
          style={layout.source}
          frame={frame}
          durationInFrames={durationInFrames}
          fps={fps}
        />
      ) : null}
    </CardFrame>
  );
};
