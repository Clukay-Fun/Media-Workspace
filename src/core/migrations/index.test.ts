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
    expect(migrate(v5)).toEqual({ ...v5, version: PROJECT_FORMAT_VERSION });
  });

  it("v6 → v7：封面标题从叠加层 ID 改成直接写模板、样式和内容", () => {
    const ov = {
      id: "t",
      template: "title-bar",
      style: "s",
      at: { ms: 0 },
      durationMs: 1000,
      props: { lines: ["标题"] },
    };
    const v6 = {
      version: 6,
      revision: 1,
      tracks: [{ id: "o", kind: "overlay", items: [ov] }],
      cover: { atMs: 500, title: "t" },
    };
    expect(migrate(v6)).toEqual({
      ...v6,
      version: PROJECT_FORMAT_VERSION,
      cover: {
        atMs: 500,
        title: { template: "title-bar", style: "s", props: { lines: ["标题"] } },
      },
    });
    // 引用的叠加层不存在时去掉标题；没有封面标题时 cover 原样不动
    expect(migrate({ ...v6, cover: { atMs: 0, title: "x" } })).toMatchObject({
      cover: { atMs: 0 },
    });
    expect(migrate({ ...v6, cover: { atMs: 0, title: "x" } })).not.toHaveProperty("cover.title");
    expect(migrate({ version: 6, cover: null })).toEqual({
      version: PROJECT_FORMAT_VERSION,
      cover: null,
    });
  });

  it("当前版本原样返回", () => {
    const p = { version: PROJECT_FORMAT_VERSION, revision: 0 };
    expect(migrate(p)).toBe(p);
  });

  it("比程序新的版本报错", () => {
    expect(() => migrate({ version: PROJECT_FORMAT_VERSION + 1 })).toThrow(MwError);
  });
});
