import type { TemplateMeta } from "../types";
import type { TipBarProps } from "./schema";

export const meta: TemplateMeta<TipBarProps> = {
  name: "tip-bar",
  label: "提示条",
  description: "一条 120px 高的小卡，一行 44px 提示语（最多 16 字），默认居中，从左侧滑入",
  defaultStyle: "card-white",
  sizes: ["small"],
  mood: ["亲和", "提示"],
  useFor: "一句提醒、注意事项或引导语；人名和身份用 name-bar",
  example: { text: "记得点赞关注哦", align: "center" },
};
