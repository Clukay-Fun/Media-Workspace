import type React from "react";
import { TextBlock } from "../../composition/TextBlock";
import { frameToMs } from "../../core/time";
import { CardFrame } from "../card-frame";
import type { TemplateProps } from "../types";
import { bulletListLayout, bulletListStartFrames } from "./layout";
import type { BulletListProps } from "./schema";

const ITEM_ENTER_MS = 240;

export const BulletList: React.FC<TemplateProps<BulletListProps>> = ({
  props,
  style,
  size,
  frame,
  durationInFrames,
  fps,
  width,
  height,
}) => {
  const layout = bulletListLayout(props, style, width, height, size);
  const starts = bulletListStartFrames(props.items, durationInFrames, fps);
  return (
    <CardFrame
      box={layout.box}
      frame={frame}
      durationInFrames={durationInFrames}
      fps={fps}
      radius={Math.round(width * 0.03)}
    >
      {props.title && layout.title ? (
        <TextBlock
          text={props.title}
          style={layout.title}
          frame={frame}
          durationInFrames={durationInFrames}
          fps={fps}
        />
      ) : null}
      {props.items.map((item, index) => {
        const start = starts[index] ?? 0;
        if (frame < start) return null;
        const remainingFrames = Math.max(1, durationInFrames - start);
        const introFrames = Math.max(0, remainingFrames - 1);
        const introMs = Math.min(ITEM_ENTER_MS, frameToMs(introFrames, fps));
        const itemStyle = layout.items[index];
        if (!itemStyle) return null;
        return (
          <TextBlock
            key={`${item.text}-${index}`}
            text={`• ${item.text}`}
            style={{
              ...itemStyle,
              animation: {
                ...itemStyle.animation,
                in:
                  introMs > 0
                    ? {
                        preset: "fade-up",
                        durationMs: Math.max(1, Math.round(introMs)),
                        easing: "ease-out",
                      }
                    : null,
                unit: "line",
                stagger: "spread",
                inSlot: null,
              },
            }}
            frame={frame - start}
            durationInFrames={remainingFrames}
            fps={fps}
          />
        );
      })}
    </CardFrame>
  );
};
