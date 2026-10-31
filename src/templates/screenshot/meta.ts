import type { TemplateMeta } from "../types";
import type { ScreenshotProps } from "./schema";

export const meta: TemplateMeta<ScreenshotProps> = {
  name: "screenshot",
  label: "截图卡片",
  description:
    "把一张截图 / 图片按比例放进卡片，圆角、contain，可选一行 40px 说明（最多 16 字）；半屏常用，整段原文才用全屏",
  defaultStyle: "card-white",
  sizes: ["half", "full"],
  mood: ["沉稳", "信息"],
  useFor: "展示聊天记录、网页截图、数据图或新闻截图；说明最多 16 字",
  example: { image: "shot1", caption: "截图来源：官网" },
};
