import { describe, expect, it } from "vitest";
import { cropLayout, croppedSize, faceInCrop } from "./crop";

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
