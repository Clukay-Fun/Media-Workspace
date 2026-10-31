import { describe, expect, it } from "vitest";
import { detectSilence, edgeCutRanges, edgeSilences, silenceCutRanges } from "./silence";

const tone = (seconds: number, rate = 8000) =>
  Float32Array.from(
    { length: seconds * rate },
    (_, i) => Math.sin((i / rate) * Math.PI * 2 * 220) * 0.2,
  );
const silent = (seconds: number, rate = 8000) => new Float32Array(seconds * rate);
const join = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

describe("detectSilence", () => {
  it("finds a silence from PCM samples without any caption data", () => {
    const spans = detectSilence(join(tone(1), silent(0.8), tone(1)), 8000, { minPauseMs: 500 });
    expect(spans).toHaveLength(1);
    expect(spans[0]?.startMs).toBe(1000);
    expect(spans[0]?.endMs).toBe(1800);
  });

  it("ignores pauses below minPauseMs and treats all-silent input as unclassifiable", () => {
    expect(detectSilence(join(tone(1), silent(0.2), tone(1)), 8000, { minPauseMs: 400 })).toEqual(
      [],
    );
    expect(detectSilence(silent(2), 8000)).toEqual([]);
  });

  it("retains the configured margin at both ends", () => {
    expect(silenceCutRanges([{ startMs: 1000, endMs: 1800 }], 120)).toEqual([
      { startMs: 1120, endMs: 1680 },
    ]);
    expect(silenceCutRanges([{ startMs: 100, endMs: 300 }], 120)).toEqual([]);
  });

  it("merges silence split by a brief transient", () => {
    const samples = join(tone(1), silent(0.35), tone(0.02), silent(0.35), tone(1));
    expect(detectSilence(samples, 8000, { minPauseMs: 500, mergeGapMs: 40 })).toEqual([
      { startMs: 1000, endMs: 1720 },
    ]);
  });
});

describe("头尾空白", () => {
  it("只留贴着开头和结尾的静音，句中停顿不动", () => {
    const spans = [
      { startMs: 0, endMs: 2800 },
      { startMs: 6200, endMs: 6700 },
      { startMs: 32_100, endMs: 33_880 },
    ];
    expect(edgeSilences(spans, 33_880)).toEqual([spans[0], spans[2]]);
    expect(edgeSilences([spans[1] as (typeof spans)[number]], 33_880)).toEqual([]);
    expect(edgeSilences([{ startMs: 30_000, endMs: 33_870 }], 33_880)).toHaveLength(1);
    // 只在靠说话的一侧留余量
    expect(edgeCutRanges([spans[0], spans[2]] as typeof spans, 33_880, 120)).toEqual([
      { startMs: 0, endMs: 2680 },
      { startMs: 32_220, endMs: 33_880 },
    ]);
  });
});
