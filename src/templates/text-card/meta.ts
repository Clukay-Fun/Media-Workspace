import type { TemplateMeta } from "../types";
import type { TextCardProps } from "./schema";

export const meta: TemplateMeta<TextCardProps> = {
  name: "text-card",
  label: "文字卡",
  description:
    "深色底板上一个标题加一段正文；小卡在下三分之一，半屏卡在下半屏（主画面上移让位），全屏卡盖住画面",
  defaultStyle: "card-white",
  sizes: ["small", "half", "full"],
  mood: ["沉稳"],
  useFor: "没有更合适的专用卡片时，把一句结论或一小段说明做成卡片",
  example: { title: "三个要点", body: "先讲结论\n再给理由" },
};
