import { describe, expect, it } from "vitest";
import { blockSeekFrame, captionSeekFrame, clampPlayheadFrame } from "./seek";

describe("seek 目标帧计算", () => {
  it("captionSeekFrame 计算字幕 80% 处的帧位置", () => {
    // 持续 10 帧，80% 为 8 帧 => from + 8
    expect(captionSeekFrame(100, 10)).toBe(108);
    // 持续 30 帧，80% 为 24 帧 => from + 24
    expect(captionSeekFrame(0, 30)).toBe(24);
    // 持续 0 帧时退回起始帧
    expect(captionSeekFrame(50, 0)).toBe(50);
  });

  it("blockSeekFrame：字幕类型跳到 80%，其他类型跳到起始帧", () => {
    expect(blockSeekFrame(100, 110, "caption")).toBe(108);
    expect(blockSeekFrame(100, 110, "clip")).toBe(100);
    expect(blockSeekFrame(100, 110, undefined)).toBe(100);
  });

  it("总时长缩短时只夹取越界播放头，保留仍有效的位置", () => {
    expect(clampPlayheadFrame(300, 301)).toBe(300);
    expect(clampPlayheadFrame(300, 240)).toBe(239);
    expect(clampPlayheadFrame(0, 0)).toBe(0);
  });
});
