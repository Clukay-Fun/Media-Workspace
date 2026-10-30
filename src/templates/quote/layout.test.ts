import { describe, expect, it } from "vitest";
import { textBox } from "../../core/lint";
import { BUILTIN_STYLES } from "../../core/presets";
import { quoteLayout, quoteText } from "./layout";
import { meta } from "./meta";

const props = meta.example;
const style = BUILTIN_STYLES["card-white"];

describe("quoteLayout", () => {
  it.each([
    [1080, 1920],
    [1920, 1080],
  ])("keeps the quote and source inside each card at %i×%i", (width, height) => {
    for (const size of ["small", "half"] as const) {
      const layout = quoteLayout(props, style, width, height, size);
      const quote = textBox(quoteText(props), layout.quote);
      const source = layout.source && textBox(props.source ?? "", layout.source);
      for (const box of [quote, ...(source ? [source] : [])]) {
        expect(box.x0).toBeGreaterThanOrEqual(layout.box.x0);
        expect(box.y0).toBeGreaterThanOrEqual(layout.box.y0);
        expect(box.x1).toBeLessThanOrEqual(layout.box.x1);
        expect(box.y1).toBeLessThanOrEqual(layout.box.y1);
      }
    }
  });

  it("flags a quote that exceeds the small-card limit instead of shrinking it", () => {
    const tooLong = { ...props, text: "普通人需要先学会这件事再开始认真地存钱" };
    const small = quoteLayout(tooLong, style, 1080, 1920, "small");
    const half = quoteLayout(tooLong, style, 1080, 1920, "half");
    expect(small.fits).toBe(false);
    expect(small.quote.font.size).toBe(48);
    expect(half.fits).toBe(true);
    expect(half.quote.layout.maxLines).toBe(4);
  });

  it("fits the 18-character small-card limit in a landscape canvas", () => {
    const atLimit = {
      ...props,
      text: "普通人想存钱要先记录再决定再复盘一下",
    };
    expect([...atLimit.text]).toHaveLength(18);
    const layout = quoteLayout(atLimit, style, 1920, 1080, "small");
    const quote = textBox(quoteText(atLimit), layout.quote);
    expect(layout.fits).toBe(true);
    expect(quote.y0).toBeGreaterThanOrEqual(layout.box.y0);
    expect(quote.y1).toBeLessThanOrEqual(layout.box.y1);
    expect(layout.quote.font.size).toBeLessThan((48 * 1920) / 1080);
  });
});
