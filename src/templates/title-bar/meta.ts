import type { TemplateMeta } from "../types";
import type { TitleBarProps } from "./schema";

export const meta: TemplateMeta<TitleBarProps> = {
  name: "title-bar",
  label: "顶部标题条",
  description:
    '画面顶部一条半透明横条，上面 1–3 行大字标题，通常整条视频一直显示（durationMs: "toEnd"）',
  defaultStyle: "title-bar-yellow",
  sizes: ["small"],
  mood: ["沉稳"],
  useFor: "整条视频的主题，开头就出现，一直显示",
  example: {
    lines: ["普通人如何", "用 AI 剪口播"],
    bar: { color: "#000000A6", top: 96, height: 259 },
  },
};
