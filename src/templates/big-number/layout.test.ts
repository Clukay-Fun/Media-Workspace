import { describe, expect, it } from "vitest";
import { textBox } from "../../core/lint";
import { BUILTIN_STYLES } from "../../core/presets";
import { bigNumberAt, bigNumberLayout, bigNumberText, formatBigNumber } from "./layout";
import { meta } from "./meta";
import { BigNumberProps as Schema } from "./schema";

const props = meta.example;
const style = BUILTIN_STYLES["card-white"];

describe("bigNumberLayout", () => {
  it.each([
    [1080, 1920],
    [1920, 1080],
  ])("keeps the number, unit, and label inside the small card at %i×%i", (width, height) => {
    const longValue = {
      ...props,
      from: 0,
      to: 1_000_000_000_000_000,
      prefix: "¥",
      suffix: "人民币",
      label: "储蓄目标已完成",
    };
    const layout = bigNumberLayout(longValue, style, width, height, "small");
    const boxes = [
      textBox(bigNumberText(longValue), layout.number),
      ...(layout.suffix ? [textBox(longValue.suffix ?? "", layout.suffix)] : []),
      textBox(longValue.label, layout.label),
    ];

    for (const box of boxes) {
      expect(box.x0).toBeGreaterThanOrEqual(layout.box.x0);
      expect(box.y0).toBeGreaterThanOrEqual(layout.box.y0);
      expect(box.x1).toBeLessThanOrEqual(layout.box.x1);
      expect(box.y1).toBeLessThanOrEqual(layout.box.y1);
    }
  });

  it("uses the researched 1080px type sizes when the small card has room", () => {
    const short = { ...props, from: 0, to: 98, prefix: undefined };
    const layout = bigNumberLayout(short, style, 1080, 1920, "small");
    // 调研字号 × CARD_TEXT_SCALE（1.5）= 180 / 54 / 60；小卡放不下时三者等比收紧
    const n = layout.number.font.size;
    expect(n).toBeGreaterThan(150);
    expect(n).toBeLessThanOrEqual(180);
    expect(layout.suffix?.font.size).toBeCloseTo((n * 36) / 120);
    expect(layout.label.font.size).toBeCloseTo((n * 40) / 120);
  });

  it("enforces unit and description character limits in the schema", () => {
    expect(Schema.safeParse({ ...props, suffix: "人民币单位计量" }).success).toBe(false);
    expect(Schema.safeParse({ ...props, label: "这是超过十二个字的说明文案" }).success).toBe(false);
  });

  it("formats separators and decimals", () => {
    expect(formatBigNumber(12345.6, { ...props, decimals: 2 })).toBe("¥12,345.60");
    expect(formatBigNumber(12345.6, { ...props, decimals: 1, thousandsSeparator: false })).toBe(
      "¥12345.6",
    );
  });

  it("eases from the start value to the target before the outro", () => {
    const countFrames = 301 - 6;
    expect(bigNumberAt(props, 0, 301, 30)).toBe(props.from);
    expect(bigNumberAt(props, 100, 301, 30)).toBeGreaterThan(props.from);
    expect(bigNumberAt(props, countFrames - 1, 301, 30)).toBe(props.to);
    expect(bigNumberAt(props, 300, 301, 30)).toBe(props.to);
  });
});
