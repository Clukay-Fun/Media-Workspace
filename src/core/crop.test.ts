import { describe, expect, it } from "vitest";
import {
  contentBox,
  cropForAspect,
  cropLayout,
  croppedSize,
  dragCrop,
  faceInCrop,
  isFullCrop,
  roundCrop,
} from "./crop";

describe("crop 几何", () => {
  const rightHalf = { x: 0.5, y: 0, width: 0.5, height: 1 };

  it("裁切后的可见框和完整素材偏移使用相同源坐标", () => {
    const layout = cropLayout({ width: 540, height: 960 }, { width: 540, height: 960 }, rightHalf);
    expect(layout.box).toEqual({ x0: 135, y0: 0, x1: 405, y1: 960 });
    expect(layout.media).toEqual({ x: -270, y: 0, width: 540, height: 960 });
    expect(croppedSize({ width: 540, height: 960 }, rightHalf)).toEqual({
      width: 270,
      height: 960,
    });
  });

  it("人脸框与裁切范围求交，再换算到裁切素材坐标", () => {
    expect(faceInCrop({ x: 0.4, y: 0.25, w: 0.2, h: 0.5 }, rightHalf)).toEqual({
      x: 0,
      y: 0.25,
      w: 0.2,
      h: 0.5,
    });
    expect(faceInCrop({ x: 0.1, y: 0.25, w: 0.2, h: 0.5 }, rightHalf)).toBeNull();
    expect(faceInCrop({ x: 0.1, y: 0.25, w: 0.2, h: 0.5 })).toEqual({
      x: 0.1,
      y: 0.25,
      w: 0.2,
      h: 0.5,
    });
  });
});

describe("裁切框编辑", () => {
  const landscape = { width: 1920, height: 1080 };
  const close = (a: Record<string, number>, b: Record<string, number>) => {
    for (const k of Object.keys(b)) expect(a[k]).toBeCloseTo(b[k] ?? Number.NaN, 4);
  };

  it("横屏素材取 9:16：保留中间一条，按像素比例算", () => {
    const c = cropForAspect(landscape, 9 / 16);
    // 1080 高 → 宽 607.5 像素，占 1920 的 0.3164
    close(c, { x: 0.3418, y: 0, width: 0.3164, height: 1 });
    expect((c.width * 1920) / (c.height * 1080)).toBeCloseTo(9 / 16, 3);
  });

  it("中心靠边时贴着边取，不越界", () => {
    const c = cropForAspect(landscape, 1, { x: 0.95, y: 0.5 });
    expect(c.x + c.width).toBeCloseTo(1, 4);
    expect(c.width).toBeCloseTo(1080 / 1920, 4);
  });

  it("自由拖边和整体移动：不拖出素材，不小于最小尺寸", () => {
    const start = { x: 0.2, y: 0.2, width: 0.5, height: 0.5 };
    close(dragCrop(start, "e", 0.6, 0, landscape, null), { x: 0.2, width: 0.8 });
    close(dragCrop(start, "w", 0.6, 0, landscape, null), { x: 0.65, width: 0.05 });
    close(dragCrop(start, "move", -0.5, 0.9, landscape, null), { x: 0, y: 0.5 });
  });

  it("锁比例拖角：对角固定，比例不变；放不下时按另一边收", () => {
    const start = cropForAspect(landscape, 1);
    const ratio = (c: { width: number; height: number }) => (c.width * 1920) / (c.height * 1080);
    const smaller = dragCrop(start, "se", -0.1, 0, landscape, 1);
    expect(ratio(smaller)).toBeCloseTo(1, 4);
    expect(smaller.x).toBeCloseTo(start.x, 4);
    expect(smaller.y).toBeCloseTo(0, 4);
    // 正方形已经占满高度，往右下拉不能再变大
    const bigger = dragCrop(start, "se", 0.2, 0.2, landscape, 1);
    expect(bigger.height).toBeCloseTo(1, 4);
    expect(ratio(bigger)).toBeCloseTo(1, 4);
  });

  it("锁比例拖边：另一方向居中跟着变", () => {
    const start = { x: 0.4, y: 0.25, width: 0.2, height: 0.5 };
    const c = dragCrop(start, "s", 0, -0.1, landscape, (0.2 * 1920) / (0.5 * 1080));
    expect(c.x + c.width / 2).toBeCloseTo(0.5, 4);
    expect((c.width * 1920) / (c.height * 1080)).toBeCloseTo((0.2 * 1920) / (0.5 * 1080), 4);
  });

  it("接近完整画面算没裁；存之前取整且不越界", () => {
    expect(isFullCrop({ x: 0.0004, y: 0, width: 0.9996, height: 1 })).toBe(true);
    expect(isFullCrop({ x: 0.1, y: 0, width: 0.9, height: 1 })).toBe(false);
    const r = roundCrop({ x: 0.123456, y: 0.5, width: 0.876549, height: 0.5 });
    expect(r.x + r.width).toBeLessThanOrEqual(1);
  });

  it("可见画面框：有裁切按裁切后的画面，没尺寸时退回整幅画布", () => {
    const canvas = { width: 1080, height: 1920 };
    expect(contentBox(canvas, landscape).y0).toBeCloseTo((1920 - 607.5) / 2, 3);
    const nine16 = cropForAspect(landscape, 9 / 16);
    const box = contentBox(canvas, landscape, nine16);
    expect(box.x0).toBeCloseTo(0, 0);
    expect(box.y1 - box.y0).toBeCloseTo(1920, 0);
    expect(contentBox(canvas, undefined, nine16)).toEqual({ x0: 0, y0: 0, x1: 1080, y1: 1920 });
  });
});
