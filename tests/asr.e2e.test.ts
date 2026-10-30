import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Project } from "../src/core/schema";
import { alignCaptions, asrModelDir, hasAsrModel } from "../src/node/asr";

// 需要识音模型（mw models --fetch）；没有模型时跳过。音频用模型自带的普通话示例
const wav = join(asrModelDir(), "test_wavs", "zh.wav");
const ready = hasAsrModel() && existsSync(wav);

describe.skipIf(!ready)("识音对齐", () => {
  it("给字幕写入单调递增、落在句子范围内的逐字时间", async () => {
    const text = "开放时间早上九点至下午五点。";
    const project = Project.parse({
      version: 6,
      revision: 0,
      canvas: {},
      assets: { a: { kind: "audio", path: wav, probe: { durationMs: 5600 } } },
      tracks: [
        {
          id: "cap",
          kind: "caption",
          items: [{ id: "s1", asset: "a", startMs: 0, endMs: 5600, text }],
        },
      ],
    });
    const { ops, report } = await alignCaptions("/", project);
    expect(report[0]?.match).toBeGreaterThanOrEqual(0.8);
    const op = ops[0] as { op: string; set: { charStartMs: number[] } };
    expect(op.op).toBe("caption.update");
    const t = op.set.charStartMs;
    expect(t).toHaveLength([...text].length);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThanOrEqual(t[i - 1] ?? 0);
    // 不是均分：真实语速有快有慢，相邻字的间隔不会全都一样
    const gaps = new Set(t.slice(1, -1).map((v, i) => v - (t[i] ?? 0)));
    expect(gaps.size).toBeGreaterThan(2);
    expect(Math.max(...t)).toBeLessThan(5600);
  });
});
