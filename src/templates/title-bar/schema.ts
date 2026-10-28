import { z } from "zod";
import { Color } from "../../core/text-style";

export const TitleBarProps = z.strictObject({
  /** 每行一句，最多 3 行 */
  lines: z.array(z.string().min(1)).min(1).max(3),
  /** 底色横条；null = 不画横条，只有文字 */
  bar: z
    .strictObject({
      color: Color.default("#000000A6"),
      top: z.number().default(96),
      height: z.number().positive().default(259),
    })
    .nullable()
    .default({ color: "#000000A6", top: 96, height: 259 }),
});
export type TitleBarProps = z.infer<typeof TitleBarProps>;
