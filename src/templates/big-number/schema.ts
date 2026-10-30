import { z } from "zod";

export const BigNumberProps = z.strictObject({
  from: z.number().min(-1_000_000_000_000_000).max(1_000_000_000_000_000),
  to: z.number().min(-1_000_000_000_000_000).max(1_000_000_000_000_000),
  prefix: z.string().max(12).optional(),
  /** 单位最多 6 字 */
  suffix: z.string().min(1).max(6).optional(),
  decimals: z.number().int().min(0).max(6).default(0),
  thousandsSeparator: z.boolean().default(true),
  /** 一行说明最多 12 字 */
  label: z.string().min(1).max(12),
});

export type BigNumberProps = z.infer<typeof BigNumberProps>;
