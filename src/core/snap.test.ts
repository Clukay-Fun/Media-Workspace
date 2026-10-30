import { describe, expect, it } from "vitest";
import { canvasTargets, snapRange, snapValue } from "./snap";

describe("snap", () => {
  const targets = [
    { at: 0, kind: "start" },
    { at: 30, kind: "clip" },
    { at: 100, kind: "caption" },
  ];
  it("在阈值内吸附到最近的点，超出阈值不动", () => {
    expect(snapValue(33, targets, 5)).toMatchObject({ value: 30, target: { kind: "clip" } });
    expect(snapValue(40, targets, 5)).toEqual({ value: 40, target: null });
  });
  it("拖动区间时开头和结尾都能吸附，时长不变", () => {
    expect(snapRange(28, 50, targets, 5)).toMatchObject({ start: 30, edge: "start" });
    expect(snapRange(52, 50, targets, 5)).toMatchObject({ start: 50, edge: "end" });
    expect(snapRange(60, 10, targets, 5)).toEqual({ start: 60, target: null, edge: null });
  });
  it("画面吸附包含中线和参考线", () => {
    const t = canvasTargets(1080, 1920, [{ axis: "h", pos: 1167, kind: "guide" }]);
    expect(snapValue(1163, t.y, 8).value).toBe(1167);
    expect(snapValue(536, t.x, 8).value).toBe(540);
  });
});
