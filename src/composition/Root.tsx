import type React from "react";
import { Composition } from "remotion";
import { Main, type MainProps } from "./Main";

const empty: MainProps = {
  timeline: {
    width: 1080,
    height: 1920,
    fps: 30,
    background: "#000000",
    durationInFrames: 30,
    mainEndFrame: 0,
    videos: [],
    images: [],
    captions: [],
    overlays: [],
    mainShifts: [],
    cardSpans: [],
    outro: null,
    chapters: [],
    warnings: [],
  },
  styles: {},
  srcs: {},
  fonts: [],
};

export const Root: React.FC = () => (
  <Composition
    id="Main"
    component={Main}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={30}
    defaultProps={empty}
    calculateMetadata={({ props }) => ({
      width: props.timeline.width,
      height: props.timeline.height,
      fps: props.timeline.fps,
      durationInFrames: props.timeline.durationInFrames,
    })}
  />
);
