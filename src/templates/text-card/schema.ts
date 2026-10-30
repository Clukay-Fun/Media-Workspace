import { z } from "zod";
import { Color } from "../../core/text-style";

export const TextCardProps = z.strictObject({
  /** 大字标题，可以不写 */
  title: z.string().min(1).optional(),
  /** 正文，用 \n 换行 */
  body: z.string().min(1),
  /** 底板颜色；不写时全屏卡用不透明深色、其它尺寸用半透明黑；null = 不画底板 */
  background: Color.nullable().optional(),
});
export type TextCardProps = z.infer<typeof TextCardProps>;
