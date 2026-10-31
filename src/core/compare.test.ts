import { describe, expect, it } from "vitest";
import {
  captionBandLines,
  compareCaptionWrap,
  compareCutPoints,
  faceCenterDelta,
  fitTiming,
  matchCaptionLines,
  transformFaceBoxToCanvas,
} from "./compare";

describe("compare helpers", () => {
  it("matches cut points one to one within tolerance", () => {
    expect(compareCutPoints([5000, 1000, 9000], [1100, 5100, 15_000], 250)).toEqual({
      matches: [
        { projectMs: 1000, referenceMs: 1100, deltaMs: 100 },
        { projectMs: 5000, referenceMs: 5100, deltaMs: 100 },
      ],
      projectOnly: [9000],
      referenceOnly: [15_000],
    });
  });

  it("maps a portrait face box through contain and a centered identity transform", () => {
    const transform = {
      x: 540,
      y: 960,
      scale: 1,
      rotation: 0,
      opacity: 1,
      radius: 0,
    };
    expect(
      transformFaceBoxToCanvas(
        { x: 0.25, y: 0.3, w: 0.2, h: 0.1 },
        { width: 1080, height: 1920 },
        { width: 1080, height: 1920 },
        transform,
      ),
    ).toEqual({ x: 0.25, y: 0.3, w: 0.2, h: 0.1 });
    const delta = faceCenterDelta(
      { x: 0.2, y: 0.3, w: 0.2, h: 0.2 },
      { x: 0.3, y: 0.2, w: 0.2, h: 0.2 },
    );
    expect(delta?.dx).toBeCloseTo(-0.1);
    expect(delta?.dy).toBeCloseTo(0.1);
    expect(delta?.distance).toBeCloseTo(Math.hypot(0.1, 0.1));
  });

  it("distinguishes identical caption text with different line breaks", () => {
    expect(compareCaptionWrap(["先存一部分", "再去消费"], ["先存一部", "分再去消费"])).toEqual({
      sameText: true,
      sameWrap: false,
      projectBreaks: [5],
      referenceBreaks: [4],
    });
    expect(compareCaptionWrap(["第一行", "第二行"], ["第一行第二行"])).toMatchObject({
      sameText: true,
      sameWrap: false,
    });
  });

  it("matches OCR line wraps while ignoring nearby card text and labels", () => {
    const lines = [
      { text: "王伟艺", x: 0.4, y: 0.56, w: 0.2, h: 0.03 },
      { text: "房产取得时间", x: 0.3, y: 0.59, w: 0.4, h: 0.03 },
      { text: "• 移民身份情况", x: 0.3, y: 0.64, w: 0.4, h: 0.03 },
      { text: "房产取得时间、身份", x: 0.3, y: 0.57, w: 0.4, h: 0.03 },
      { text: "情况", x: 0.45, y: 0.61, w: 0.1, h: 0.03 },
    ];
    expect(matchCaptionLines(lines, "房产取得时间、身份情况", 0.6)).toEqual([
      "房产取得时间、身份",
      "情况",
    ]);
  });

  it("allows a small OCR substitution but declines unrelated partial matches", () => {
    expect(
      matchCaptionLines(
        [{ text: "境肉房子卖出去了", x: 0.2, y: 0.5, w: 0.6, h: 0.04 }],
        "境内房子卖出去了",
      ),
    ).toEqual(["境肉房子卖出去了"]);
    expect(
      matchCaptionLines(
        [
          { text: "房产取得时间", x: 0.2, y: 0.5, w: 0.6, h: 0.04 },
          { text: "移民身份情况", x: 0.2, y: 0.56, w: 0.6, h: 0.04 },
          { text: "王伟艺", x: 0.2, y: 0.61, w: 0.6, h: 0.04 },
        ],
        "房产取得时间、身份情况",
      ),
    ).toEqual([]);
  });
});

describe("音频对齐估起点和倍速", () => {
  it("成片 = 原片从 1.2 秒开始、1.1 倍速：估出来一致", () => {
    // 原片响度包络：随机的说话 / 停顿块
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const source = new Float64Array(3000);
    for (let i = 0; i < source.length; i += 20) {
      const v = rand() > 0.4 ? 1 : -1;
      for (let j = i; j < i + 20; j++) source[j] = v + (rand() - 0.5) * 0.2;
    }
    const edited = new Float64Array(2000);
    for (let i = 0; i < edited.length; i++) edited[i] = source[120 + Math.round(i * 1.1)] ?? 0;
    const fit = fitTiming(source, edited, { maxStartMs: 3000 });
    expect(fit).toMatchObject({ sourceStartMs: 1200, speed: 1.1 });
    expect(fit?.score).toBeGreaterThan(0.9);
  });

  it("参考成片断句不同时，按字幕位置取那一带的文字", () => {
    const rows = [
      { text: "标题", x: 0.3, y: 0.05, w: 0.4, h: 0.04 },
      { text: "第二行", x: 0.35, y: 0.62, w: 0.3, h: 0.03 },
      { text: "第一行字", x: 0.3, y: 0.58, w: 0.4, h: 0.03 },
    ];
    expect(captionBandLines(rows, 0.6)).toEqual(["第一行字", "第二行"]);
  });
});
