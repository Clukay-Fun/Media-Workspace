import { z } from "zod";
import { Id } from "./schema";

// 账号版式（阶段 F，docs/decisions/0025）：~/MediaWorkspace/library/layout.json，所有工程共用。
// 位置一律是占画面宽 / 高的比例（0–1），横屏竖屏、1080 / 720 都能用同一份。
// 标题条、字幕的位置由样式决定，这里只记用哪个样式，不另存一份坐标。
// 也记账号级的剪辑习惯（主轨倍速），AI 出片时默认照用。

const Frac = z.number().min(0).max(1);

export const LayoutGuide = z.strictObject({
  id: Id,
  /** h = 横线（pos 是 y），v = 竖线（pos 是 x） */
  axis: z.enum(["h", "v"]),
  pos: Frac,
  label: z.string().max(20).default(""),
});
export type LayoutGuide = z.infer<typeof LayoutGuide>;

/** 人脸框（识别出的脸，不含头发）落在画面上的位置；mw frame 按它算主画面的缩放和位置 */
export const LayoutFace = z
  .strictObject({ cx: Frac, top: Frac, bottom: Frac })
  .refine((f) => f.top < f.bottom, "人脸框的上沿要在下沿上面");
export type LayoutFace = z.infer<typeof LayoutFace>;

export const Layout = z.strictObject({
  version: z.literal(1).default(1),
  guides: z.array(LayoutGuide).default([]),
  face: LayoutFace.nullable().default(null),
  /** 顶部标题条用的样式（工程或模板库里的名字），null = 用模板默认 */
  titleStyle: Id.nullable().default(null),
  /** 字幕用的样式，null = 用默认 */
  captionStyle: Id.nullable().default(null),
  /**
   * 一条字幕最多几个字（mw transcribe 断句用）。比一行放得下的多时，这条字幕折成两行显示（按词换行）；
   * null = 按字幕样式一行放得下的字数，每条只占一行
   */
  captionMaxChars: z.number().int().min(4).max(40).nullable().default(null),
  /** 主轨口播的倍速（用户习惯整体加速、不剪句中停顿），1 = 原速 */
  speed: z.number().min(0.5).max(2).default(1),
  savedAt: z.string().default(""),
});
export type Layout = z.infer<typeof Layout>;
export type LayoutInput = z.input<typeof Layout>;

/** 参考线换成画面上的像素位置（工作台显示、导出参考线叠加图时用） */
export function guidesInPx(
  layout: Pick<Layout, "guides">,
  width: number,
  height: number,
): { id: string; axis: "h" | "v"; pos: number; label: string }[] {
  return layout.guides.map((g) => ({
    ...g,
    pos: Math.round(g.pos * (g.axis === "h" ? height : width)),
  }));
}
