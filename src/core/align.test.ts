import { describe, expect, it } from "vitest";
import { alignChars, speechOnsetMs } from "./align";

const tok = (s: string, times: number[]) =>
  [...s].map((text, i) => ({ text, startMs: times[i] ?? 0 }));

describe("alignChars", () => {
  it("识别完全一致时直接用识别的时间", () => {
    expect(alignChars("今天天气", tok("今天天气", [100, 300, 700, 800]), 0, 1000)).toEqual([
      100, 300, 700, 800,
    ]);
  });

  it("同音字识别错了也按位置对上", () => {
    expect(alignChars("在这里", tok("再这里", [10, 200, 400]), 0, 600)).toEqual([10, 200, 400]);
  });

  it("漏识别的字按前后插值，标点跟前一个字", () => {
    expect(alignChars("你好，世界", tok("你世界", [0, 400, 600]), 0, 1000)).toEqual([
      0, 200, 200, 400, 600,
    ]);
  });

  it("多识别出的字被跳过", () => {
    expect(alignChars("好的", tok("嗯好的", [0, 300, 500]), 0, 800)).toEqual([300, 500]);
  });

  it("时间单调不减，并限制在字幕范围内", () => {
    const t = alignChars("一二三", tok("一二三", [-50, 900, 400]), 0, 600);
    expect(t[0]).toBe(0);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThanOrEqual(t[i - 1] ?? 0);
    expect(Math.max(...t)).toBeLessThan(600);
  });

  it("什么都没识别出来时按字均分", () => {
    expect(alignChars("一二三四", [], 0, 400)).toEqual([0, 100, 200, 300]);
  });

  it("英文词片按字母分配，大小写不敏感", () => {
    const t = alignChars(
      "AI好",
      [
        { text: "a", startMs: 0 },
        { text: "i", startMs: 100 },
        { text: "好", startMs: 300 },
      ],
      0,
      500,
    );
    expect(t).toEqual([0, 100, 300]);
  });
});

describe("speechOnsetMs", () => {
  it("第一个字实际开口的时间，可以早于字幕开始；前面多识别出的上一句的字不算", () => {
    // 字幕从 1000 开始，「涉」在 880 就念了；「呢」是上一句的尾巴
    const heard = tok("呢涉及取得", [700, 880, 1040, 1200, 1350]);
    expect(speechOnsetMs("涉及取得", heard, 2000)).toBe(880);
    expect(alignChars("涉及取得", heard, 1000, 2000)[0]).toBe(1000);
  });

  it("什么都没对上时为 null", () => {
    expect(speechOnsetMs("涉及", [], 2000)).toBeNull();
  });
});
