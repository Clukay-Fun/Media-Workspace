import type { TemplateMeta } from "../types";
import type { QuoteProps } from "./schema";

export const meta: TemplateMeta<QuoteProps> = {
  name: "quote",
  label: "金句卡",
  description: "用大字突出一句结论或原话，可加出处；关键词可用文字样式高亮",
  defaultStyle: "card-white",
  sizes: ["small", "half"],
  mood: ["强调", "坚定"],
  useFor: "突出一句值得记住的话；正文不超过 18 字用 small，19–36 字改用 half；出处最多 18 字",
  example: {
    text: "先存下来的钱，才真正属于你",
    source: "理财的第一课",
    highlights: [{ text: "先存" }],
  },
};
