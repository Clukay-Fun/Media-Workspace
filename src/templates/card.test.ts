import { describe, expect, it } from "vitest";
import { safeAreaFor } from "../core/safe-area";
import { cardBox, cardPadding, cardScale } from "./card";

describe("卡片占位", () => {
  it("竖屏数值不变", () => {
    expect(cardBox("small", 1080, 1920)).toEqual({ x0: 108, y0: 1152, x1: 972, y1: 1478.4 });
    expect(cardScale(1080, 1920)).toBe(1.5);
    expect(cardPadding(1080)).toBe(54);
  });

  it("横屏：字号和内边距按短边，和竖屏一样大；小卡、半屏卡在横屏安全区里", () => {
    expect(cardScale(1920, 1080)).toBe(cardScale(1080, 1920));
    const safe = safeAreaFor(1920, 1080);
    for (const size of ["small", "half"] as const) {
      const b = cardBox(size, 1920, 1080);
      expect(b.y1, size).toBeLessThanOrEqual(1080 - safe.bottom);
      expect(b.x0, size).toBeGreaterThanOrEqual(safe.left);
      expect(1920 - b.x1, size).toBeGreaterThanOrEqual(safe.right);
    }
    // 小卡和竖屏小卡差不多高
    const small = cardBox("small", 1920, 1080);
    const tall = cardBox("small", 1080, 1920);
    expect(Math.abs(small.y1 - small.y0 - (tall.y1 - tall.y0))).toBeLessThan(10);
  });
});
