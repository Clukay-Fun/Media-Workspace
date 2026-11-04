import { describe, expect, it } from "vitest";
import { resizeFromEdge } from "./stage";

// 画布像素里的选中框；宽 360、高 640
const box = { x0: 360, y0: 640, x1: 720, y1: 1280 };
const base = { box, scale: 0.333 };

describe("拖边等比缩放", () => {
  it("对边中点固定，只沿垂直边方向算缩放", () => {
    const r = resizeFromEdge({ ...base, edge: "left", pointer: { x: 300, y: 1000 } });
    expect(r).toEqual({ scale: 0.389, x: 510, y: 960 });
    // 拖左边时对边中点 (720, 960) 不动
    const k = 0.389 / 0.333;
    expect(Math.abs(720 + (540 - 720) * k - 510)).toBeLessThan(1);
  });

  it("拖上边只改竖直方向；缩到最小/最大不翻转", () => {
    const up = resizeFromEdge({ ...base, edge: "top", pointer: { x: 999, y: 500 } });
    expect(up).toMatchObject({ scale: 0.406, x: 540 });
    expect(resizeFromEdge({ ...base, edge: "bottom", pointer: { x: 0, y: 640 } })?.scale).toBe(
      0.02,
    );
    expect(resizeFromEdge({ ...base, edge: "right", pointer: { x: 100_000, y: 0 } })?.scale).toBe(
      20,
    );
  });

  it("选中框没有宽或高时返回 null，避免除零", () => {
    expect(
      resizeFromEdge({
        box: { x0: 10, y0: 10, x1: 10, y1: 10 },
        edge: "left",
        pointer: { x: 0, y: 0 },
        scale: 1,
      }),
    ).toBeNull();
  });
});
