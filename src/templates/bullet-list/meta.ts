import type { TemplateMeta } from "../types";
import type { BulletListProps } from "./schema";

export const meta: TemplateMeta<BulletListProps> = {
  name: "bullet-list",
  label: "要点列表卡",
  description: "半屏要点卡，标题和 2–3 条短要点逐条淡入；出现时间可单独指定",
  defaultStyle: "card-white",
  sizes: ["half"],
  mood: ["清晰", "信息型"],
  useFor: "适合 2–3 个并列要点；每条最多 14 字，可带最多 18 字标题；用 half 尺寸呈现",
  example: {
    title: "存钱从这三步开始",
    items: [
      { text: "记录支出" },
      { text: "先存一部分收入", atMs: 1200 },
      { text: "等待期后再决定" },
    ],
  },
};
