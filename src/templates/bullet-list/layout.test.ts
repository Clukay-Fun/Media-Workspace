import { describe, expect, it } from "vitest";
import { textBox } from "../../core/lint";
import { BUILTIN_STYLES } from "../../core/presets";
import { bulletListLayout, bulletListStartFrames } from "./layout";
import { meta } from "./meta";

const props = meta.example;
const style = BUILTIN_STYLES["card-white"];

describe("bulletListLayout", () => {
  it.each([
    [1080, 1920],
    [1920, 1080],
  ])("keeps the title and all rows inside each card at %i×%i", (width, height) => {
    for (const size of ["half"] as const) {
      const layout = bulletListLayout(props, style, width, height, size);
      const boxes = [
        ...(props.title && layout.title ? [textBox(props.title, layout.title)] : []),
        ...props.items.map((item, index) => {
          const itemStyle = layout.items[index];
          return textBox(`• ${item.text}`, itemStyle ?? style);
        }),
      ];
      for (const box of boxes) {
        expect(box.x0).toBeGreaterThanOrEqual(layout.box.x0);
        expect(box.y0).toBeGreaterThanOrEqual(layout.box.y0);
        expect(box.x1).toBeLessThanOrEqual(layout.box.x1);
        expect(box.y1).toBeLessThanOrEqual(layout.box.y1);
      }
      if (width === 1080) {
        expect(layout.title?.font.size).toBe(44);
        expect(layout.items[0]?.font.size).toBe(48);
      }
    }
  });

  it("spreads unspecified rows over the first 60 percent and uses explicit times", () => {
    expect(bulletListStartFrames([{}, {}, {}], 301, 30)).toEqual([0, 90, 180]);
    expect(bulletListStartFrames([{}, { atMs: 500 }, {}], 301, 30)).toEqual([0, 15, 180]);
  });
});
