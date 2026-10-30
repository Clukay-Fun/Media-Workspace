import type { TemplateMeta } from "../types";
import type { NameBarProps } from "./schema";

export const meta: TemplateMeta<NameBarProps> = {
  name: "name-bar",
  label: "人名条",
  description:
    "一条 120px 高的小卡，名字 48px（最多 8 字），可选身份 32px（最多 12 字）；左对齐像人名条，从左侧滑入",
  defaultStyle: "card-white",
  sizes: ["small"],
  mood: ["沉稳", "亲和"],
  useFor: "介绍人物、身份或来源；超过 8 字的提示语用 tip-bar",
  example: { name: "张三", title: "移民顾问", align: "left" },
};
