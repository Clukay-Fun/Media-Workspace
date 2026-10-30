import { describe, expect, it } from "vitest";
import { MwError } from "../errors";
import { PROJECT_FORMAT_VERSION } from "../version";
import { migrate } from "./index";

describe("migrate", () => {
  it("v1 工程升到当前版本，内容不变", () => {
    const v1 = { version: 1, revision: 3, tracks: [{ id: "t", items: [] }] };
    expect(migrate(v1)).toEqual({ ...v1, version: PROJECT_FORMAT_VERSION });
  });

  it("v3 工程升到当前版本，内容不变（章节、剪辑理由都是可选的）", () => {
    const v3 = { version: 3, revision: 1, tracks: [] };
    expect(migrate(v3)).toEqual({ ...v3, version: PROJECT_FORMAT_VERSION });
  });

  it("v4 工程升到当前版本，样式原样保留（新字段都是可选的）", () => {
    const style = { font: { family: "X", size: 40 }, fill: "#FFFFFF" };
    const v4 = { version: 4, revision: 2, styles: { s: style } };
    expect(migrate(v4)).toEqual({ ...v4, version: PROJECT_FORMAT_VERSION });
  });

  it("v5 工程升到 v6，图片和片段原样保留（循环动画是可选的）", () => {
    const img = { id: "i", type: "image", asset: "a", at: { ms: 0 }, durationMs: 1000 };
    const v5 = { version: 5, revision: 4, tracks: [{ id: "v", kind: "video", items: [img] }] };
    expect(migrate(v5)).toEqual({ ...v5, version: 6 });
  });

  it("当前版本原样返回", () => {
    const p = { version: PROJECT_FORMAT_VERSION, revision: 0 };
    expect(migrate(p)).toBe(p);
  });

  it("比程序新的版本报错", () => {
    expect(() => migrate({ version: PROJECT_FORMAT_VERSION + 1 })).toThrow(MwError);
  });
});
