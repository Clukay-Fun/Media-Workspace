import { describe, expect, it } from "vitest";
import { BUILTIN_STYLES } from "../../core/presets";
import { bounds } from "./bounds";
import { TitleBarProps } from "./schema";

describe("标题条占的区域", () => {
  const style = BUILTIN_STYLES["title-bar-yellow"];

  it("文字在横条里垂直居中，横条占满宽度", () => {
    const b = bounds(TitleBarProps.parse({ lines: ["一二三四"] }), style, 1080);
    expect(b.shapes).toEqual([{ x0: 0, y0: 96, x1: 1080, y1: 355 }]);
    const [t] = b.text;
    if (!t) throw new Error("没有文字区域");
    // 4 × 92 = 368 宽，1 行高 92 × 1.05
    expect(t.x1 - t.x0).toBeCloseTo(368);
    expect((t.y0 + t.y1) / 2).toBeCloseTo(225.5);
  });

  it("不画横条时按样式的位置", () => {
    const b = bounds(TitleBarProps.parse({ lines: ["一", "二"], bar: null }), style, 1080);
    expect(b.shapes).toEqual([]);
    expect(((b.text[0]?.y0 ?? 0) + (b.text[0]?.y1 ?? 0)) / 2).toBeCloseTo(236);
  });
});
