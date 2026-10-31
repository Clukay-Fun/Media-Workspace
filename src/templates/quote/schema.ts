import { z } from "zod";
import { Highlight } from "../../core/schema";

export const QuoteProps = z.strictObject({
  /** 金句正文 */
  text: z.string().min(1).max(36),
  /** 可选出处，按一行小字显示 */
  source: z.string().min(1).max(18).optional(),
  /** 关键词由文字样式的高亮设置渲染 */
  highlights: z.array(Highlight).default([]),
});

export type QuoteProps = z.infer<typeof QuoteProps>;
