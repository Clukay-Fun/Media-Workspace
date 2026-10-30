import { z } from "zod";

export const BulletListProps = z.strictObject({
  /** 可选标题 */
  title: z.string().min(1).max(18).optional(),
  /** 2–3 条要点；每条最多 14 字，atMs 相对卡片开始时间 */
  items: z
    .array(
      z.strictObject({
        text: z.string().min(1).max(14),
        atMs: z.number().int().nonnegative().optional(),
      }),
    )
    .min(2)
    .max(3),
});

export type BulletListProps = z.infer<typeof BulletListProps>;
