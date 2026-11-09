import { describe, expect, it } from "vitest";
import { applyOps } from "../../../core/ops";
import { BUILTIN_STYLES } from "../../../core/presets";
import { Project } from "../../../core/schema";
import { PROJECT_FORMAT_VERSION } from "../../../core/version";
import {
  allTitleStyleOps,
  overlayPropOp,
  overlayPropPatch,
  titleLookPatch,
} from "./overlay-fields";

const project = () =>
  Project.parse({
    version: PROJECT_FORMAT_VERSION,
    revision: 1,
    canvas: {},
    assets: { a1: { kind: "video", path: "/raw.mov", probe: { durationMs: 8000 } } },
    styles: {
      cap: BUILTIN_STYLES["caption-word-yellow"],
      title: BUILTIN_STYLES["title-bar-yellow"],
    },
    tracks: [
      {
        id: "main",
        kind: "video",
        main: true,
        items: [{ id: "c1", type: "clip", asset: "a1", inMs: 0, outMs: 8000 }],
      },
      {
        id: "captions",
        kind: "caption",
        style: "cap",
        items: [{ id: "s1", asset: "a1", startMs: 0, endMs: 1000, text: "字幕" }],
      },
      {
        id: "titles",
        kind: "overlay",
        items: [
          {
            id: "o1",
            template: "quote",
            style: "title",
            at: { ms: 0 },
            durationMs: 1000,
            props: { text: "原来的金句", source: "原来的出处", highlights: [{ text: "金句" }] },
          },
          {
            id: "o2",
            template: "text-card",
            style: "title",
            at: { ms: 1000 },
            durationMs: 1000,
            props: { title: "卡片标题", body: "卡片正文", background: "#111111" },
          },
        ],
      },
      {
        id: "locked-titles",
        kind: "overlay",
        locked: true,
        items: [
          {
            id: "o3",
            template: "title-bar",
            style: "title",
            at: { ms: 0 },
            durationMs: 1000,
            props: { lines: ["锁定"], bar: null },
          },
        ],
      },
    ],
  });

describe("标题字段", () => {
  it("只替换目标字段，其余 props 原样留下", () => {
    const quote = { text: "原来的金句", source: "原来的出处", highlights: [{ text: "金句" }] };
    const op = overlayPropOp("o1", "quote", quote, "text", "新金句");
    expect(op.op).toBe("item.update");
    if (op.op !== "item.update") throw new Error("不是 item.update");
    expect(Object.keys(op.set)).toEqual(["props"]);
    expect(op.set.props).toMatchObject({
      text: "新金句",
      source: quote.source,
      highlights: quote.highlights,
    });

    const card = { title: "卡片标题", body: "卡片正文", background: "#111111" };
    const nextCard = overlayPropPatch("text-card", card, "title", "新标题");
    expect(nextCard.body).toBe(card.body);
    expect(nextCard.background).toBe(card.background);

    const lines = overlayPropPatch(
      "title-bar",
      { lines: ["第一行"], bar: { color: "#112233", top: 12, height: 40 } },
      "lines",
      ["一行", "两行"],
    );
    expect(lines.lines).toEqual(["一行", "两行"]);
    expect(lines.bar).toEqual({ color: "#112233", top: 12, height: 40 });

    const bullets = overlayPropPatch(
      "bullet-list",
      {
        title: "要点",
        items: [
          { text: "甲", atMs: 100 },
          { text: "乙", atMs: 200 },
        ],
      },
      "title",
      "新要点",
    );
    expect(bullets.items).toEqual([
      { text: "甲", atMs: 100 },
      { text: "乙", atMs: 200 },
    ]);

    const number = overlayPropPatch(
      "big-number",
      { from: 0, to: 12, prefix: "约", suffix: "万", label: "说明" },
      "prefix",
      "共",
    );
    expect(number.to).toBe(12);
    expect(number.label).toBe("说明");
    expect(number.prefix).toBe("共");

    const name = overlayPropPatch("name-bar", { name: "甲", title: "作者" }, "name", "乙");
    expect(name.title).toBe("作者");
    const tip = overlayPropPatch("tip-bar", { text: "原来", align: "left" }, "text", "新提示");
    expect(tip.align).toBe("left");
    const shot = overlayPropPatch(
      "screenshot",
      { image: "pic", caption: "旧说明" },
      "caption",
      "新说明",
    );
    expect(shot.image).toBe("pic");
  });

  it("不合法的字段不会生成 op", () => {
    expect(() => overlayPropPatch("title-bar", { lines: ["一行"] }, "lines", [])).toThrow();
    expect(() =>
      overlayPropPatch("tip-bar", { text: "好" }, "text", "这是一句明显超过十六个字的提示语啊"),
    ).toThrow();
  });

  it("外观预设只指向样式，未登记的不返回补丁", () => {
    expect(titleLookPatch("title-bar-yellow")).toEqual({ styleId: "title-bar-yellow" });
    expect(titleLookPatch("card-white")).toEqual({ styleId: "card-white" });
    expect(titleLookPatch("warm-title")).toBeNull();
  });
});

describe("全部标题", () => {
  it("跳过锁定标题，不改字幕样式", () => {
    const before = project();
    const beforeCaption = before.styles.cap;
    const planned = allTitleStyleOps(before, { fill: "#112233" }, "title-bar-yellow");
    expect(planned.count).toBe(2);
    expect(planned.skipped).toBe(1);
    const serialized = JSON.stringify(planned.ops);
    expect(serialized.includes("s1")).toBe(false);
    expect(serialized.includes("o3")).toBe(false);
    const after = applyOps(before, planned.ops).project;
    expect(after.styles.cap).toEqual(beforeCaption);
    expect(after.styles.title?.fill).toBe(before.styles.title?.fill);
    const open = after.tracks.find((track) => track.id === "titles");
    const locked = after.tracks.find((track) => track.id === "locked-titles");
    if (open?.kind !== "overlay" || locked?.kind !== "overlay") throw new Error("标题轨缺失");
    for (const item of open.items) {
      expect(item.style).toBeTruthy();
      expect(item.style).not.toBe("title");
      expect(after.styles[item.style ?? ""]?.fill).toBe("#112233");
    }
    expect(locked.items[0]?.style).toBe("title");
    const beforeOpen = before.tracks.find((track) => track.id === "titles");
    if (beforeOpen?.kind !== "overlay") throw new Error("标题轨缺失");
    expect(open.items[0]?.props).toEqual(beforeOpen.items[0]?.props);
    expect(open.items[1]?.props).toEqual(beforeOpen.items[1]?.props);
  });
});
