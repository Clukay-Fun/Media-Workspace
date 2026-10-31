import { describe, expect, it } from "vitest";
import { Project } from "./schema";
import { cuesToCaptions, formatSrt, parseSrt, SrtError } from "./srt";

describe("parseSrt", () => {
  it("容忍 BOM、CRLF、缺序号、多余空行和时间轴后的位置参数", () => {
    const text =
      "﻿1\r\n00:00:00,333 --> 00:00:01,366\r\n今天天气真好\r\n\r\n\r\n" +
      "00:00:01.400 --> 00:00:02,000 X1:0 Y1:0\n第二句\n第二行\n";
    expect(parseSrt(text)).toEqual([
      { index: 1, startMs: 333, endMs: 1366, text: "今天天气真好" },
      { index: 2, startMs: 1400, endMs: 2000, text: "第二句\n第二行" },
    ]);
  });

  it("时间格式错误时报出行号", () => {
    expect(() => parseSrt("1\n00:00:01 --> 00:00:02,000\n文字")).toThrowError(SrtError);
    try {
      parseSrt("1\n00:00:01,000 --> 00:00:02,000\n文字\n\n2\n0:0:3 --> 00:00:04,000\nx");
    } catch (e) {
      expect((e as SrtError).line).toBe(6);
    }
  });

  it("format 和 parse 互逆", () => {
    const cues = [
      { startMs: 0, endMs: 1000, text: "a" },
      { startMs: 3_723_045, endMs: 3_723_999, text: "b" },
    ];
    expect(parseSrt(formatSrt(cues)).map(({ index: _, ...c }) => c)).toEqual(cues);
  });
});

describe("cuesToCaptions", () => {
  const project = Project.parse({
    version: 7,
    revision: 0,
    canvas: {},
    assets: { a1: { kind: "video", path: "/raw.mov" } },
    tracks: [
      {
        id: "main",
        kind: "video",
        main: true,
        items: [
          { id: "c1", type: "clip", asset: "a1", inMs: 2607, outMs: 4807, speed: 1.1 },
          { id: "c2", type: "clip", asset: "a1", inMs: 10_000, outMs: 11_000 },
        ],
      },
    ],
  });

  it("timeline 时间基准按主轨映射反算回源时间", () => {
    const cues = parseSrt(
      "1\n00:00:00,000 --> 00:00:01,000\n一\n\n" +
        "2\n00:00:01,500 --> 00:00:02,000\n到片段末尾\n\n" +
        "3\n00:00:02,500 --> 00:00:02,900\n二\n\n" +
        "4\n00:00:05,000 --> 00:00:06,000\n片尾\n",
    );
    const { captions, skipped } = cuesToCaptions(project, cues, { timebase: "timeline" });
    expect(captions.map((c) => [c.startMs, c.endMs, c.text])).toEqual([
      [2607, 3707, "一"],
      [4257, 4807, "到片段末尾"],
      [10_500, 10_900, "二"],
    ]);
    expect(skipped.map((c) => c.text)).toEqual(["片尾"]);
  });

  it("source 时间基准直接绑定", () => {
    const cues = parseSrt("1\n00:00:03,000 --> 00:00:04,000\n一\n");
    expect(cuesToCaptions(project, cues, { timebase: "source", asset: "a1" }).captions).toEqual([
      { asset: "a1", startMs: 3000, endMs: 4000, text: "一", highlights: [] },
    ]);
  });
});
