import { TextStyle } from "./text-style";

// 内置样式：新建工程时复制进 project.styles（PLAN 5.1：模板复制进工程，以后模板库改了旧工程也不变）。
// 参数按样片 1029 实测（docs/decisions/0001）：字幕字号约 84、中心 y≈1165、字幕对准线宽 859；
// 标题条 y 96–355，黄字黑描边。

export const BUILTIN_STYLES = {
  /** 白字黑描边，逐词出现约 0.6 秒，正在出现的词变黄 */
  "caption-word-yellow": TextStyle.parse({
    font: {
      family: "alibaba-puhuiti-3",
      fallback: ["noto-sans-sc"],
      weight: 600,
      size: 84,
      lineHeight: 1.2,
    },
    fill: "#FFFFFF",
    stroke: { color: "#000000", width: 4 },
    shadow: { color: "#00000080", blur: 6, x: 0, y: 2 },
    layout: { x: 540, y: 1165, anchor: "center", maxWidth: 859, maxLines: 2, align: "center" },
    highlight: { mode: "current", fill: "#F5FA00" },
    animation: {
      in: { preset: "fade", durationMs: 120, easing: "ease-out" },
      unit: "word",
      stagger: { totalMs: 600 },
    },
  }),
  /** 顶部标题：粗黄字、黑描边、阴影。底色横条由 title-bar 模板画 */
  "title-bar-yellow": TextStyle.parse({
    font: {
      family: "alibaba-puhuiti-3",
      fallback: ["noto-sans-sc"],
      weight: 900,
      size: 92,
      lineHeight: 1.05,
    },
    fill: "#F8D800",
    stroke: { color: "#000000", width: 6 },
    shadow: { color: "#000000B3", blur: 10, x: 0, y: 4 },
    layout: { x: 540, y: 236, anchor: "center", maxWidth: 960, maxLines: 2, align: "center" },
  }),
} satisfies Record<string, TextStyle>;
