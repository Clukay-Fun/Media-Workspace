import { describe, expect, it } from "vitest";
import { detectSilence, silenceCutRanges } from "./silence";

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
