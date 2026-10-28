import { describe, expect, it } from "vitest";
import { ease, highlightMask, splitUnits, transformAt, unitStarts } from "./animate";

describe("splitUnits", () => {
  it("中文按词拆分，标点不单独占节拍", () => {
    const u = splitUnits("房产取得时间、身份情况", "word");
    expect(u.map((x) => x.text)).toEqual(["房产", "取得", "时间", "、", "身份", "情况"]);
    expect(u.filter((x) => x.silent).map((x) => x.text)).toEqual(["、"]);
    expect(u.map((x) => [x.start, x.end])).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
      [6, 7],
      [7, 9],
      [9, 11],
    ]);
  });

  it("逐字和换行", () => {
    const u = splitUnits("你好\n世界", "char");
    expect(u.map((x) => x.text)).toEqual(["你", "好", "世", "界"]);
    expect(u.map((x) => x.breakBefore)).toEqual([false, false, true, false]);
    expect(u[2]?.start).toBe(3);
  });
});

describe("unitStarts", () => {
  const u = splitUnits("房产取得时间、身份情况", "word");
  it("totalMs：在给定时间内全部出现，标点跟着前一个词", () => {
    expect(unitStarts(u, { totalMs: 500 }, 1600, 100)).toEqual([0, 100, 200, 200, 300, 400]);
  });
  it("spread：在字幕时长内均分", () => {
    expect(unitStarts(u, "spread", 1100, 100)).toEqual([0, 200, 400, 400, 600, 800]);
  });
});

describe("highlightMask", () => {
  it("按文字匹配，nth 只匹配第几次出现", () => {
    expect(highlightMask("身份和身份", [{ text: "身份", nth: 1 }])).toEqual([
      false,
      false,
      false,
      true,
      true,
    ]);
    expect(highlightMask("身份和身份", [{ text: "身份" }]).filter(Boolean)).toHaveLength(4);
  });
});

describe("transformAt", () => {
  const base = { x: 540, y: 960, scale: 1, rotation: 0, opacity: 1, radius: 0 };
  const kfs = [
    { frame: 10, transform: { ...base, scale: 1 }, easing: "linear" as const },
    { frame: 20, transform: { ...base, scale: 2 }, easing: "linear" as const },
  ];
  it("关键帧之间插值，两端保持", () => {
    expect(transformAt(base, kfs, 0).scale).toBe(1);
    expect(transformAt(base, kfs, 15).scale).toBe(1.5);
    expect(transformAt(base, kfs, 30).scale).toBe(2);
    expect(transformAt(base, [], 15)).toBe(base);
  });
  it("缓动曲线两端固定", () => {
    for (const k of ["linear", "ease-in", "ease-out", "ease-in-out", "spring"] as const) {
      expect(ease(k, 0)).toBe(0);
      expect(ease(k, 1)).toBe(1);
    }
  });
});
