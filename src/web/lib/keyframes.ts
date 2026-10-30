import type { Transform } from "../../core/schema";

export const TRANSFORM_FIELDS = ["x", "y", "scale", "rotation", "opacity", "radius"] as const;

export type TransformField = (typeof TRANSFORM_FIELDS)[number];

export function orderedKeyframes<T extends { atMs: number }>(keyframes: readonly T[]): T[] {
  return [...keyframes].sort((a, b) => a.atMs - b.atMs);
}

export function changedTransformFields(current: Transform, previous: Transform): TransformField[] {
  return TRANSFORM_FIELDS.filter(
    (field) => current[field] !== undefined && current[field] !== previous[field],
  );
}

export type KeyframeMarkerPosition = { frame: number; leftPercent: number };

/** 返回片段内关键帧的本地帧位置，忽略重复帧和片段范围外的帧。 */
export function keyframeMarkerPositions(
  frames: readonly number[],
  durationFrames: number,
): KeyframeMarkerPosition[] {
  if (!Number.isFinite(durationFrames) || durationFrames <= 0) return [];
  return [
    ...new Set(
      frames.filter((frame) => Number.isInteger(frame) && frame >= 0 && frame < durationFrames),
    ),
  ]
    .sort((a, b) => a - b)
    .map((frame) => ({ frame, leftPercent: (frame / durationFrames) * 100 }));
}
