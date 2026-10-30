import { describe, expect, it } from "vitest";
import type { ResolvedVideo } from "../../core/compile";
import { Project } from "../../core/schema";
import {
  defaultTransition,
  maxTransitionDurationMs,
  transitionCutMarkers,
  transitionPairFor,
} from "./transitions";

const video = (
  id: string,
  from: number,
  durationInFrames: number,
  main: boolean,
  transitionIn: ResolvedVideo["transitionIn"] = null,
): ResolvedVideo => ({
  id,
  kind: "video",
  main,
  trackId: main ? "main" : "pip",
  z: 0,
  hidden: false,
  muted: false,
  locked: false,
  asset: "a1",
  from,
  durationInFrames,
  trimBeforeFrames: 0,
  speed: 1,
  gainDb: 0,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, radius: 0 },
  keyframes: [],
  transitionIn,
  animIn: null,
  animOut: null,
  animLoop: null,
  cutBefore: null,
});

const projectWithMainClips = () =>
  Project.parse({
    version: 6,
    revision: 0,
    canvas: {},
    assets: {
      a1: { kind: "video", path: "/raw.mov", probe: { durationMs: 20_000 } },
    },
    tracks: [
      {
        id: "main",
        kind: "video",
        main: true,
        items: [
          { id: "c1", type: "clip", asset: "a1", inMs: 0, outMs: 1000, speed: 2 },
          { id: "c2", type: "clip", asset: "a1", inMs: 1000, outMs: 2000 },
          { id: "c3", type: "clip", asset: "a1", inMs: 2000, outMs: 12_000 },
        ],
      },
    ],
  });

describe("转场界面辅助函数", () => {
  it("在硬切位置和转场重叠区中心标记主轨剪辑点", () => {
    const cuts = transitionCutMarkers([
      video("c1", 0, 100, true),
      video("pip", 12, 300, false),
      video("c2", 91, 100, true, { type: "fade", direction: "left", durationInFrames: 9 }),
      video("c3", 191, 80, true),
    ]);

    expect(cuts).toEqual([
      {
        outgoingId: "c1",
        incomingId: "c2",
        frame: 96,
        transition: { type: "fade", direction: "left", durationInFrames: 9 },
      },
      { outgoingId: "c2", incomingId: "c3", frame: 191, transition: null },
    ]);
  });

  it("转场时长受前后片段和格式上限约束", () => {
    const project = projectWithMainClips();
    const pair = transitionPairFor(project, "c2");
    expect(pair?.maxDurationMs).toBe(500);
    expect(transitionPairFor(project, "c1")).toBeNull();
    expect(
      maxTransitionDurationMs(
        { ...pair!.outgoing, outMs: 12_000, speed: 1 },
        { ...pair!.incoming, outMs: 12_000, speed: 1 },
      ),
    ).toBe(5000);
  });

  it("新增转场默认叠化 300ms，短片段时按可用长度缩短", () => {
    expect(defaultTransition(900)).toEqual({ type: "fade", durationMs: 300 });
    expect(defaultTransition(120)).toEqual({ type: "fade", durationMs: 120 });
  });
});
