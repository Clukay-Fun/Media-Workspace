import { describe, expect, it } from "vitest";
import { compile } from "../../core/compile";
import { Project } from "../../core/schema";
import { PROJECT_FORMAT_VERSION } from "../../core/version";
import {
  filmstripTiles,
  rulerLabel,
  tickStep,
  timecode,
  timelineRows,
  trackInsertIndex,
  waveform,
} from "./timeline";

const project = Project.parse({
  version: PROJECT_FORMAT_VERSION,
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

  it("轨道有名字时显示名字，主视频仍叫主视频", () => {
    const named = Project.parse({
      ...project,
      tracks: [...project.tracks, { id: "still", kind: "video", name: "图片", items: [] }],
    });
    expect(timelineRows(named, compile(named)).map((row) => row.label)).toEqual([
      "图片",
      "字幕",
      "主视频",
    ]);
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

  it("胶片格按素材比例排，不拉成 16:9", () => {
    const portrait = filmstripTiles(200, 40, 9 / 16, 100);
    expect(portrait.tileHeight).toBe(40);
    expect(portrait.tileWidth).toBe(23);
    expect(portrait.count).toBe(8);
    const wide = filmstripTiles(100, 40, 16 / 9, 100);
    expect(wide.tileWidth).toBe(71);
    expect(wide.count).toBe(1);
  });

  it("胶片格不超过帧数和 24 格，比例无效时退回 16:9", () => {
    expect(filmstripTiles(10_000, 40, 1, 3).count).toBe(3);
    expect(filmstripTiles(10_000, 40, 1, 100).count).toBe(24);
    const fallback = filmstripTiles(10, 40, 0, 10);
    expect(fallback.tileWidth).toBe(71);
    expect(fallback.count).toBe(1);
  });

  it("拖轨道时主视频下面插不进去", () => {
    const rows = [
      { id: "main", top: 300, height: 40, index: 0 },
      { id: "a", top: 200, height: 40, index: 1 },
      { id: "b", top: 100, height: 40, index: 2 },
      { id: "c", top: 40, height: 40, index: 3 },
    ];
    expect(trackInsertIndex(rows, "b", 20, 1)).toEqual({ index: 3, line: 40 });
    expect(trackInsertIndex(rows, "b", 80, 1)).toEqual({ index: 2, line: 80 });
    expect(trackInsertIndex(rows, "b", 250, 1)).toEqual({ index: 1, line: 240 });
    expect(trackInsertIndex(rows, "b", 400, 1)).toEqual({ index: 1, line: 300 });
    expect(trackInsertIndex(rows, "missing", 20, 1)).toBeNull();
  });

  it("时间码和刻度", () => {
    expect(timecode(0, 30)).toBe("00:00.0");
    expect(timecode(30 * 75 + 15, 30)).toBe("01:15.5");
    expect(tickStep(130)).toBe(0.5);
    expect(tickStep(100)).toBe(1);
    expect(tickStep(10)).toBe(10);
  });

  it("放大后每秒及半秒刻度标签保留十分秒", () => {
    expect([60, 75, 90].map((frame) => rulerLabel(frame, 30, 0.5))).toEqual([
      "00:02.0",
      "00:02.5",
      "00:03.0",
    ]);
    expect([60, 90].map((frame) => rulerLabel(frame, 30, 1))).toEqual(["00:02.0", "00:03.0"]);
    expect(rulerLabel(600, 30, 2)).toBe("00:20");
  });
});
