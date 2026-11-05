import { describe, expect, it } from "vitest";
import { RESIZE_HANDLE_EDGES, resizeFromEdge, shouldClearDragDraft } from "./stage";

// 画布像素里的选中框；宽 360、高 640
const box = { x0: 360, y0: 640, x1: 720, y1: 1280 };
const base = { box, scale: 0.333 };

describe("拖边等比缩放", () => {
  it("提供四个边中心命中区域", () => {
    expect(RESIZE_HANDLE_EDGES).toEqual(["top", "right", "bottom", "left"]);
  });

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

  it("四条边都固定对应的对边中点", () => {
    const cases = [
      { edge: "left" as const, pointer: { x: 300, y: 700 }, anchor: { x: 720, y: 960 } },
      { edge: "right" as const, pointer: { x: 780, y: 700 }, anchor: { x: 360, y: 960 } },
      { edge: "top" as const, pointer: { x: 700, y: 500 }, anchor: { x: 540, y: 1280 } },
      { edge: "bottom" as const, pointer: { x: 700, y: 1420 }, anchor: { x: 540, y: 640 } },
    ];

    for (const c of cases) {
      const r = resizeFromEdge({ ...base, edge: c.edge, pointer: c.pointer });
      expect(r).not.toBeNull();
      const k = (r?.scale ?? 0) / base.scale;
      const center = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
      expect(Math.abs(c.anchor.x + (center.x - c.anchor.x) * k - (r?.x ?? 0))).toBeLessThan(1);
      expect(Math.abs(c.anchor.y + (center.y - c.anchor.y) * k - (r?.y ?? 0))).toBeLessThan(1);
    }
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

describe("拖动提交后的草稿清理", () => {
  it("新拖动已经接管时保留草稿", () => {
    expect(shouldClearDragDraft({ pointerId: 2 })).toBe(false);
    expect(shouldClearDragDraft(null)).toBe(true);
  });
});
