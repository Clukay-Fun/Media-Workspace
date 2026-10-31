import { z } from "zod";

export const ScreenshotProps = z.strictObject({
  /** 图片素材 ID（必须是 image） */
  image: z.string().min(1),
  /** 图片下面的一行说明 */
  caption: z.string().min(1).max(16).optional(),
});
export type ScreenshotProps = z.infer<typeof ScreenshotProps>;
