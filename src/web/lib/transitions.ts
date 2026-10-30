import type { ResolvedTransition, ResolvedVideo } from "../../core/compile";
import { isMainClip, type MainClip, type Project, type Transition } from "../../core/schema";
import { clipTimelineMs } from "../../core/time";

const MAX_TRANSITION_MS = 5000;
const DEFAULT_TRANSITION_MS = 300;

export type TransitionCut = {
  outgoingId: string;
  incomingId: string;
  /** 硬切取片段交界；有转场时取重叠区中心。 */
  frame: number;
  transition: ResolvedTransition | null;
};

type MainVideo = Pick<ResolvedVideo, "id" | "main" | "from" | "durationInFrames" | "transitionIn">;

/** 主轨每两个相邻片段生成一个可编辑剪辑点；浮层视频、图片和片尾不参与。 */
export function transitionCutMarkers(videos: readonly MainVideo[]): TransitionCut[] {
  const main = videos.filter((video) => video.main);
  const cuts: TransitionCut[] = [];

  for (let index = 1; index < main.length; index += 1) {
    const outgoing = main[index - 1];
    const incoming = main[index];
    if (!outgoing || !incoming) continue;

    const outgoingEnd = outgoing.from + outgoing.durationInFrames;
    const configuredOverlap = Math.max(0, incoming.transitionIn?.durationInFrames ?? 0);
    const overlap = Math.max(0, Math.min(configuredOverlap, outgoingEnd - incoming.from));
    cuts.push({
      outgoingId: outgoing.id,
      incomingId: incoming.id,
      frame: overlap > 0 ? Math.round(incoming.from + overlap / 2) : outgoingEnd,
      transition: incoming.transitionIn,
    });
  }

  return cuts;
}

export type TransitionPair = {
  outgoing: MainClip;
  incoming: MainClip;
  maxDurationMs: number;
};

/** 转场时长不能超过前后任一片段的时间线长度，也不超过工程格式上限。 */
export function maxTransitionDurationMs(outgoing: MainClip, incoming: MainClip): number {
  return Math.max(
    1,
    Math.floor(Math.min(MAX_TRANSITION_MS, clipTimelineMs(outgoing), clipTimelineMs(incoming))),
  );
}

/** 转场挂在入场片段上；查找它前面的主轨片段作为配对边界。 */
export function transitionPairFor(project: Project, incomingId: string): TransitionPair | null {
  const track = project.tracks.find((candidate) => candidate.kind === "video" && candidate.main);
  if (!track || track.kind !== "video") return null;

  const clips = track.items.filter(isMainClip);
  const index = clips.findIndex((clip) => clip.id === incomingId);
  const outgoing = index > 0 ? clips[index - 1] : undefined;
  const incoming = clips[index];
  if (!outgoing || !incoming) return null;

  return {
    outgoing,
    incoming,
    maxDurationMs: maxTransitionDurationMs(outgoing, incoming),
  };
}

/** 新增剪辑点时使用叠化；短片段按可重叠时长缩短默认值。 */
export function defaultTransition(maxDurationMs: number): Transition {
  return { type: "fade", durationMs: Math.min(DEFAULT_TRANSITION_MS, maxDurationMs) };
}
