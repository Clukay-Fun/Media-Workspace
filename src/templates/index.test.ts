import { describe, expect, it } from "vitest";
import { BUILTIN_STYLES } from "../core/presets";
import { overlayBounds, TEMPLATES } from ".";

// 每个模板都要过的检查：新模板注册进来就自动覆盖（docs/template-guide.md）
describe.each(Object.entries(TEMPLATES))("模板 %s", (name, tpl) => {
  it("meta 写全", () => {
    expect(tpl.meta.name).toBe(name);
    expect(tpl.meta.useFor.length).toBeGreaterThan(0);
    expect(BUILTIN_STYLES[tpl.meta.defaultStyle as keyof typeof BUILTIN_STYLES]).toBeDefined();
  });

  it("示例参数能通过 schema", () => {
    expect(tpl.schema.safeParse(tpl.meta.example).success).toBe(true);
  });

  it.each([
    [1080, 1920],
    [1920, 1080],
  ])("每个尺寸的占位都在画布里（%i×%i）", (w, h) => {
    const style = BUILTIN_STYLES[tpl.meta.defaultStyle as keyof typeof BUILTIN_STYLES];
    for (const size of tpl.meta.sizes.length > 0 ? tpl.meta.sizes : [null]) {
      const b = overlayBounds(
        { template: name, props: tpl.meta.example as Record<string, unknown>, size },
        style,
        w,
        h,
      );
      expect(b.text.length + b.shapes.length).toBeGreaterThan(0);
      for (const box of [...b.text, ...b.shapes]) {
        expect(box.x0).toBeGreaterThanOrEqual(0);
        expect(box.y0).toBeGreaterThanOrEqual(0);
        expect(box.x1).toBeLessThanOrEqual(w);
        expect(box.y1).toBeLessThanOrEqual(h);
      }
    }
  });
});
