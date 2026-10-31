import { z } from "zod";

export const TipBarProps = z.strictObject({
  /** 一行提示语（最多 16 字） */
  text: z.string().min(1).max(16),
  /** 默认居中；提示条通常居中 */
  align: z.enum(["left", "center"]).default("center"),
});
export type TipBarProps = z.infer<typeof TipBarProps>;
