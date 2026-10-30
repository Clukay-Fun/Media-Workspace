import { describe, expect, it } from "vitest";
import { compile } from "../../core/compile";
import { Project } from "../../core/schema";
import { tickStep, timecode, timelineRows, waveform } from "./timeline";

const project = Project.parse({
  version: 6,
  revision: 0,
  canvas: {},
  assets: {
    a1: { kind: "video", path: "/raw.mov", probe: { durationMs: 10_000 } },
    end: { kind: "video", path: "/end.mp4", probe: { durationMs: 1000 } },
  },
  tracks: [
    {
      id: "main",
      kind: "video",
      main: true,
      items: [
        {
          id: "c1",
          type: "clip",
          asset: "a1",
          inMs: 2000,
          outMs: 6000,
          speed: 2,
          keyframes: [
            { atMs: 500, transform: { x: 200 } },
            { atMs: 1000, transform: { x: 400 }, easing: "ease-out" },
          ],
        },
      ],
    },
    {
      id: "cap",
      name: "字幕",
      kind: "caption",
      items: [{ id: "s1", asset: "a1", startMs: 3000, endMs: 4000, text: "一句" }],
    },
  ],
  outro: { asset: "end" },
});

describe("时间线概览", () => {
  const tl = compile(project);

  it("上层轨道在上，主轨在最下面，片尾接在主轨后", () => {
    const rows = timelineRows(project, tl);
    expect(rows.map((r) => r.label)).toEqual(["字幕", "主视频"]);
    expect(rows[1]?.blocks.map((b) => [b.id, b.from, b.to])).toEqual([
      ["c1", 0, 60],
      ["outro", 60, 90],
    ]);
    expect(rows[1]?.blocks[0]?.keyframeFrames).toEqual([15, 30]);
    // 字幕源 3000 → (3000 − 2000) / 2 = 500ms → 第 15 帧
    expect(rows[0]?.blocks[0]).toMatchObject({ id: "s1", from: 15, label: "一句" });
  });

  it("图片块也带出关键帧位置", () => {
    const withImage = Project.parse({
      ...project,
      assets: { ...project.assets, still: { kind: "image", path: "/still.png" } },
      tracks: [
        ...project.tracks,
        {
          id: "images",
          kind: "video",
          items: [
            {
              id: "i1",
              type: "image",
              asset: "still",
              at: { ms: 0 },
              durationMs: 2000,
              keyframes: [{ atMs: 1000, transform: { y: 240 } }],
            },
          ],
        },
      ],
    });
    const imageRow = timelineRows(withImage, compile(withImage)).find(
      (row) => row.track.id === "images",
    );
    expect(imageRow?.blocks[0]).toMatchObject({ id: "i1", kind: "image", keyframeFrames: [30] });
  });

  it("波形按倍速取素材里对应的那一段", () => {
    const block = timelineRows(project, tl)[1]?.blocks[0];
    if (!block) throw new Error("没有主轨片段");
    // 素材 0–2000ms 安静，2000–6000ms 有声音，之后又安静
    const peaks = Array.from({ length: 1000 }, (_, i) => (i >= 200 && i < 600 ? 1 : 0));
    const w = waveform(block, { msPerPeak: 10, peaks }, 30, 4);
    expect(w).toEqual([1, 1, 1, 1]);
  });

  it("时间码和刻度", () => {
    expect(timecode(0, 30)).toBe("00:00.0");
    expect(timecode(30 * 75 + 15, 30)).toBe("01:15.5");
    expect(tickStep(100)).toBe(1);
    expect(tickStep(10)).toBe(10);
  });
});
