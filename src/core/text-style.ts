import { z } from "zod";

// 文本样式引擎（PLAN 5.4）：字幕、标题、卡片文字共用。样式是纯 JSON，用户和 AI 都能直接编排。

export const Color = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "颜色格式应为 #RRGGBB 或 #RRGGBBAA");

export const Easing = z.enum(["linear", "ease-in", "ease-out", "ease-in-out", "spring"]);

export const AnimPresetName = z.enum([
  "none",
  "fade",
  "fade-up",
  "slide",
  "pop",
  "bounce",
  "typewriter",
  "blur-in",
  "zoom-in",
  "zoom-out",
  "color-sweep",
  "shake",
  "breathe",
]);

export const Direction = z.enum(["up", "down", "left", "right"]);

/** 声明式动画：文字、图片、画中画的入场 / 出场 / 循环都用它 */
export const Anim = z.object({
  preset: AnimPresetName,
  durationMs: z.number().int().positive().max(10_000),
  easing: Easing.default("ease-out"),
  direction: Direction.optional(),
  /** 位移、缩放之类的幅度，含义由预设决定 */
  intensity: z.number().positive().max(10).optional(),
});

export const TextStyle = z.object({
  font: z.object({
    family: z.string().min(1),
    weight: z.number().int().min(100).max(900).default(700),
    size: z.number().positive().max(400),
    letterSpacing: z.number().default(0),
    lineHeight: z.number().positive().default(1.25),
  }),
  fill: Color,
  stroke: z
    .object({ color: Color, width: z.number().nonnegative().max(40) })
    .nullable()
    .default(null),
  shadow: z
    .object({ color: Color, blur: z.number().nonnegative(), x: z.number(), y: z.number() })
    .nullable()
    .default(null),
  box: z
    .object({
      color: Color,
      radius: z.number().nonnegative().default(0),
      padding: z.tuple([z.number().nonnegative(), z.number().nonnegative()]).default([0, 0]),
    })
    .nullable()
    .default(null),
  layout: z.object({
    x: z.number(),
    y: z.number(),
    anchor: z.enum(["center", "top", "bottom", "left", "right"]).default("center"),
    maxWidth: z.number().positive(),
    maxLines: z.number().int().positive().max(10).default(2),
    align: z.enum(["left", "center", "right"]).default("center"),
  }),
  highlight: z
    .object({
      fill: Color,
      stroke: z.object({ color: Color, width: z.number().nonnegative() }).nullable().default(null),
      scale: z.number().positive().max(3).default(1),
      anim: AnimPresetName.default("none"),
    })
    .nullable()
    .default(null),
  animation: z
    .object({
      in: Anim.nullable().default(null),
      unit: z.enum(["char", "word", "line"]).default("line"),
      /** spread = 在字幕时长内均分（不代表真实发音时间）；数字 = 每个单位固定间隔的毫秒数 */
      stagger: z.union([z.literal("spread"), z.number().int().nonnegative()]).default("spread"),
      out: Anim.nullable().default(null),
      loop: Anim.nullable().default(null),
    })
    .default({ in: null, unit: "line", stagger: "spread", out: null, loop: null }),
});
export type TextStyle = z.infer<typeof TextStyle>;
export type Anim = z.infer<typeof Anim>;
export type Easing = z.infer<typeof Easing>;
