import { describe, expect, it } from "vitest";
import { diffProjects } from "./diff";
import { applyOps } from "./ops";
import { Project } from "./schema";
import { PROJECT_FORMAT_VERSION } from "./version";

const project = () =>
  Project.parse({
    version: PROJECT_FORMAT_VERSION,
    revision: 3,
    canvas: {},
    assets: { a1: { kind: "video", path: "/素材/原片.mov", probe: { durationMs: 20_000 } } },
    tracks: [
      {
        id: "main",
        kind: "video",
        main: true,
        items: [{ id: "c1", type: "clip", asset: "a1", inMs: 0, outMs: 10_000 }],
      },
      {
        id: "cap",
        kind: "caption",
        items: [
          { id: "s1", asset: "a1", startMs: 1000, endMs: 2000, text: "今天天气真好" },
          { id: "s2", asset: "a1", startMs: 2100, endMs: 3000, text: "我们出去走走" },
        ],
      },
      {
        id: "ov",
        kind: "overlay",
        items: [
          {
            id: "o1",
            template: "bullet-list",
            at: { caption: "s1" },
            durationMs: 2000,
            props: { items: [{ text: "带伞" }, { text: "带水" }] },
          },
        ],
      },
    ],
  });

describe("diffProjects", () => {
  it("没改动时返回空", () => {
    const p = project();
    expect(diffProjects(p, structuredClone(p))).toEqual([]);
  });

  it("改字幕文字和时间：列出前后值，时间按秒显示", () => {
    const a = project();
    const b = applyOps(a, [
      { op: "item.update", id: "s1", set: { text: "今天天气不错", endMs: 2500 } },
    ]).project;
    const [c] = diffProjects(a, b);
    expect(c).toMatchObject({ id: "s1", kind: "字幕", name: "今天天气不错", status: "updated" });
    expect(c?.fields).toEqual([
      { field: "endMs", label: "结束", before: "2 秒", after: "2.5 秒" },
      { field: "text", label: "文字", before: "今天天气真好", after: "今天天气不错" },
    ]);
  });

  it("删除和新增：删掉的用旧版本里的名字", () => {
    const a = project();
    const b = applyOps(a, [{ op: "caption.remove", ids: ["s2"] }]).project;
    expect(diffProjects(a, b)).toEqual([
      {
        id: "s2",
        entity: "item",
        kind: "字幕",
        name: "我们出去走走",
        status: "removed",
        fields: [],
      },
    ]);
    expect(diffProjects(b, a)[0]).toMatchObject({ id: "s2", status: "added" });
  });

  it("卡片内容按 props 字段分开列；锚点显示字幕文字", () => {
    const a = project();
    const b = structuredClone(a);
    const o = b.tracks[2]?.items[0];
    if (!o || !("props" in o)) throw new Error("fixture");
    o.props = { items: [{ text: "带伞" }, { text: "带外套" }] };
    o.at = { caption: "s2", char: 2, offsetMs: 0 };
    const [c] = diffProjects(a, b);
    expect(c).toMatchObject({ id: "o1", kind: "标题 / 卡片", name: "带伞 带外套" });
    expect(c?.fields).toEqual([
      {
        field: "at",
        label: "出现时间",
        before: "跟随字幕「今天天气真好」",
        after: "跟随字幕「我们出去走走」 第 3 个字",
      },
      {
        field: "props.items",
        label: "内容 · 要点",
        before: "带伞 / 带水",
        after: "带伞 / 带外套",
      },
    ]);
  });

  it("主轨片段倍速、位置：带单位", () => {
    const a = project();
    const b = applyOps(a, [
      { op: "item.update", id: "c1", set: { speed: 1.1, transform: { scale: 1.2, y: -40 } } },
    ]).project;
    const [c] = diffProjects(a, b);
    expect(c).toMatchObject({ id: "c1", kind: "主轨片段", name: "原片.mov" });
    expect(c?.fields).toEqual([
      { field: "speed", label: "倍速", before: "1×", after: "1.1×" },
      { field: "transform", label: "位置 / 缩放", before: "无", after: "y -40 · 缩放 1.2" },
    ]);
  });

  it("逐字时间只说字数，不列数字", () => {
    const a = project();
    const b = structuredClone(a);
    const s = b.tracks[1]?.items[0];
    if (!s || !("charStartMs" in s || "text" in s)) throw new Error("fixture");
    (s as { charStartMs?: number[] }).charStartMs = [1000, 1100, 1200, 1400, 1600, 1800];
    expect(diffProjects(a, b)[0]?.fields).toEqual([
      { field: "charStartMs", label: "逐字时间", before: "按字数估算", after: "6 个字" },
    ]);
  });

  it("封面从无到有、轨道锁定：工程设置和轨道排在元素前面", () => {
    const a = project();
    const b = applyOps(a, [
      { op: "item.update", id: "s1", set: { text: "今天天气不错" } },
      { op: "track.update", id: "cap", set: { locked: true } },
    ]).project;
    b.cover = { atMs: 1500 };
    const out = diffProjects(a, b);
    expect(out.map((c) => c.id)).toEqual(["cover", "cap", "s1"]);
    expect(out[0]?.fields).toEqual([
      { field: "atMs", label: "时间点", before: "无", after: "1.5 秒" },
    ]);
    expect(out[1]?.fields).toEqual([{ field: "locked", label: "锁定", before: "否", after: "是" }]);
  });
});
