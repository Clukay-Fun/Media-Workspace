import { z } from "zod";

export const NameBarProps = z.strictObject({
  /** 一行主文字：人名（最多 8 字） */
  name: z.string().min(1).max(8),
  /** 可选的副文字：头衔 / 补充（最多 12 字） */
  title: z.string().min(1).max(12).optional(),
  /** 左对齐像人名条，居中像提示条 */
  align: z.enum(["left", "center"]).default("left"),
});
export type NameBarProps = z.infer<typeof NameBarProps>;
