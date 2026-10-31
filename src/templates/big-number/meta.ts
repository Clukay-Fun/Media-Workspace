import type { TemplateMeta } from "../types";
import type { BigNumberProps } from "./schema";

export const meta: TemplateMeta<BigNumberProps> = {
  name: "big-number",
  label: "大数字卡",
  description: "小卡数字按帧缓动滚动，可设置前后缀、小数位和千分位",
  defaultStyle: "card-white",
  sizes: ["small"],
  mood: ["强调", "数据型"],
  useFor:
    "用 small 展示一组醒目的数字；单位最多 6 字，说明最多 12 字。超长数字会按卡片宽度收紧字号",
  example: {
    from: 0,
    to: 12800,
    prefix: "¥",
    suffix: "元",
    decimals: 0,
    thousandsSeparator: true,
    label: "年度储蓄目标",
  },
};
