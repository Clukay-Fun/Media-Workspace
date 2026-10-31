import { describe, expect, it } from "vitest";
import { planFrame, typicalFace } from "./frame";

const portrait = { width: 1080, height: 1920 };
const target = { cx: 0.5, top: 0.36, bottom: 0.5 };

describe("人脸代表位置", () => {
  it("只看片段范围内的采样，每帧取最大的脸，取中位数（不怕偶尔误检）", () => {
    const face = (x: number, y: number) => ({ x, y, w: 0.2, h: 0.12 });
    const track = {
      intervalMs: 500,
      frames: [
        { ms: 250, boxes: [face(0.4, 0.38)] },
        { ms: 750, boxes: [face(0.4, 0.39), { x: 0.9, y: 0.9, w: 0.01, h: 0.01 }] },
        { ms: 1250, boxes: [face(0.1, 0.1)] },
        { ms: 1750, boxes: [face(0.42, 0.4)] },
        { ms: 2250, boxes: [] },
        { ms: 9000, boxes: [face(0, 0)] },
      ],
    };
    const b = typicalFace(track, [{ fromMs: 0, toMs: 2500 }]);
    expect(b?.y).toBeCloseTo(0.38);
    expect((b?.x ?? 0) + (b?.w ?? 0) / 2).toBeCloseTo(0.5);
    expect(typicalFace(track, [{ fromMs: 3000, toMs: 4000 }])).toBeNull();
  });
});

describe("按版式摆人物", () => {
  it("放大并移动，让人脸框落在目标位置", () => {
    const plan = planFrame({ x: 0.45, y: 0.4, w: 0.1, h: 0.1 }, portrait, portrait, target);
    expect(plan.transform.scale).toBeCloseTo(1.4, 3);
    expect(plan.face).toEqual(target);
    expect(plan.clamped).toBe(false);
  });

  it("不露黑边：要缩小时停在刚好盖满，要挪出边时停在边上", () => {
    const small = planFrame({ x: 0.4, y: 0.3, w: 0.2, h: 0.3 }, portrait, portrait, target);
    expect(small.transform).toEqual({ x: 540, y: 960, scale: 1 });
    expect(small.clamped).toBe(true);
    // 脸在素材最左边：放大后也不能把画面左边挪进来
    const edge = planFrame({ x: 0, y: 0.4, w: 0.1, h: 0.1 }, portrait, portrait, target);
    const half = (edge.transform.scale * 1080) / 2;
    expect(edge.transform.x).toBeCloseTo(half, 0);
    expect(edge.clamped).toBe(true);
    expect(edge.face.cx).toBeLessThan(target.cx);
  });

  it("横屏素材放进竖屏：至少放大到盖满画面", () => {
    const plan = planFrame(
      { x: 0.45, y: 0.3, w: 0.1, h: 0.2 },
      { width: 1920, height: 1080 },
      portrait,
      target,
    );
    // contain 之后高 607.5，要盖满 1920 高至少放大 3.16 倍
    expect(plan.transform.scale).toBeGreaterThanOrEqual(3.16);
  });
});
