import { describe, expect, it } from "vitest";
import { changedTransformFields, keyframeMarkerPositions, orderedKeyframes } from "./keyframes";

describe("关键帧界面辅助函数", () => {
  it("按时间顺序整理关键帧", () => {
    expect(orderedKeyframes([{ atMs: 900 }, { atMs: 100 }, { atMs: 500 }])).toEqual([
      { atMs: 100 },
      { atMs: 500 },
      { atMs: 900 },
    ]);
  });

  it("只返回片段范围内去重后的菱形位置", () => {
    expect(keyframeMarkerPositions([45, 12, 12, -1, 60], 60)).toEqual([
      { frame: 12, leftPercent: 20 },
      { frame: 45, leftPercent: 75 },
    ]);
    expect(keyframeMarkerPositions([0], 0)).toEqual([]);
  });

  it("列出相对上一变换确实变化的字段", () => {
    expect(
      changedTransformFields({ x: 120, y: 300, scale: 1.5 }, { x: 100, y: 300, scale: 1 }),
    ).toEqual(["x", "scale"]);
  });
});
