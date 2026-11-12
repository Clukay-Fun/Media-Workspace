import { describe, expect, it } from "vitest";
import { estimateNaturalLines } from "./natural-wrap";
import { BUILTIN_STYLES } from "./presets";
import { TextStyle } from "./text-style";

const base = BUILTIN_STYLES["caption-word-yellow"];
const withWidth = (maxWidth: number) =>
  TextStyle.parse({ ...base, layout: { ...base.layout, maxWidth } });

describe("固定框宽自然换行估算", () => {
  it("框宽变窄时行数增加，拉宽恢复，字号不变", () => {
    const text = "一二三四五六七八九十一二三四五";
    const wide = withWidth(840);
    const narrow = withWidth(420);
    expect(estimateNaturalLines(text, wide).map((line) => line.text)).toEqual([
      "一二三四五六七八九十",
      "一二三四五",
    ]);
    expect(estimateNaturalLines(text, narrow)).toHaveLength(3);
    expect(wide.font.size).toBe(narrow.font.size);
    expect(estimateNaturalLines(text, withWidth(840))).toEqual(estimateNaturalLines(text, wide));
  });
  it("保留手动换行，不拆英文单词和连续数字", () => {
    const rows = estimateNaturalLines("甲乙\nABC123456", withWidth(420));
    expect(rows[0]?.text).toBe("甲乙");
    expect(rows.map((r) => r.text).join("")).toBe("甲乙ABC123456");
    expect(rows.some((r) => r.text.includes("123456"))).toBe(true);
  });
});
