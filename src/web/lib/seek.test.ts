import { describe, expect, it } from "vitest";
import { blockSeekFrame, captionSeekFrame, seekFrameOnSelect } from "./seek";

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

  it("seekFrameOnSelect：当前帧在区间外时跳转，在区间内时不跳转", () => {
    // 当前在区间前 (now = 50, from = 100, to = 150)
    expect(seekFrameOnSelect(50, 100, 150, "caption")).toBe(140);
    expect(seekFrameOnSelect(50, 100, 150, "clip")).toBe(100);

    // 当前在区间后 (now = 200, from = 100, to = 150)
    expect(seekFrameOnSelect(200, 100, 150, "caption")).toBe(140);

    // 当前刚好在区间起始处 (now = 100) -> 在区间内，不跳
    expect(seekFrameOnSelect(100, 100, 150, "caption")).toBeNull();

    // 当前在区间中 (now = 120) -> 在区间内，不跳
    expect(seekFrameOnSelect(120, 100, 150, "caption")).toBeNull();

    // 当前在区间结束边界 (now = 150) -> 已在区间外，跳
    expect(seekFrameOnSelect(150, 100, 150, "caption")).toBe(140);
  });
});
