import { z } from "zod";

// 文本样式引擎（PLAN 5.4）：字幕、标题、卡片文字共用。样式是纯 JSON，用户和 AI 都能直接编排。

export const Color = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "颜色格式应为 #RRGGBB 或 #RRGGBBAA");

export const Easing = z.enum(["linear", "ease-in", "ease-out", "ease-in-out", "spring"]);

export const AnimPresetName = z.enum([
  "none",
  // 入场
  "fade",
  "fade-up",
  "slide",
  "pop",
  "scale-punch",
  "bounce",
  "slam",
  "wave",
  "typewriter",
  "blur-in",
  "zoom-in",
  "color-sweep",
  // 强调：在某个时间点播放一次
  "pulse",
  "glow",
  "color-shift",
  "shake",
  "underline-sweep",
  // 出场
  "zoom-out",
  "scale-out",
  // 循环
  "breathe",
]);

export const Direction = z.enum(["up", "down", "left", "right"]);

/** 声明式动画：文字、图片、画中画的入场 / 出场 / 循环都用它 */
export const Anim = z.strictObject({
  preset: AnimPresetName,
  durationMs: z.number().int().positive().max(10_000),
  easing: Easing.default("ease-out"),
  direction: Direction.optional(),
  /** 位移、缩放之类的幅度，含义由预设决定 */
  intensity: z.number().positive().max(10).optional(),
});

export const TextStyle = z.strictObject({
  font: z.strictObject({
    family: z.string().min(1),
    /** 主字体缺字时按顺序使用的后备字体（D26），不退回系统字体 */
    fallback: z.array(z.string().min(1)).default([]),
    weight: z.number().int().min(100).max(900).default(700),
    size: z.number().positive().max(400),
    letterSpacing: z.number().default(0),
    lineHeight: z.number().positive().default(1.25),
  }),
  fill: Color,
  stroke: z
    .strictObject({ color: Color, width: z.number().nonnegative().max(40) })
    .nullable()
    .default(null),
  shadow: z
    .strictObject({ color: Color, blur: z.number().nonnegative(), x: z.number(), y: z.number() })
    .nullable()
    .default(null),
  box: z
    .strictObject({
      color: Color,
      radius: z.number().nonnegative().default(0),
      padding: z.tuple([z.number().nonnegative(), z.number().nonnegative()]).default([0, 0]),
    })
    .nullable()
    .default(null),
  layout: z.strictObject({
    x: z.number(),
    y: z.number(),
    anchor: z.enum(["center", "top", "bottom", "left", "right"]).default("center"),
    maxWidth: z.number().positive(),
    maxLines: z.number().int().positive().max(10).default(2),
    align: z.enum(["left", "center", "right"]).default("center"),
  }),
  highlight: z
    .strictObject({
      /**
       * keyword = 只亮字幕里标出的关键词；current = 只亮正在出现的那个字 / 词（样片 1029 的效果）；
       * trail = 出现过的都留亮。三种方式下，标出的关键词都会高亮
       */
      mode: z.enum(["keyword", "current", "trail"]).default("keyword"),
      fill: Color,
      stroke: z
        .strictObject({ color: Color, width: z.number().nonnegative() })
        .nullable()
        .default(null),
      scale: z.number().positive().max(3).default(1),
      anim: AnimPresetName.default("none"),
    })
    .nullable()
    .default(null),
  /** 字幕的显示时间：提前出现、延后消失；相邻两句 cut = 后一句出现时前一句立即消失，overlap = 允许重叠 */
  timing: z
    .strictObject({
      leadMs: z.number().int().nonnegative().max(2000).default(0),
      tailMs: z.number().int().nonnegative().max(2000).default(0),
      handoff: z.enum(["cut", "overlap"]).default("cut"),
    })
    .default({ leadMs: 0, tailMs: 0, handoff: "cut" }),
  animation: z
    .strictObject({
      in: Anim.nullable().default(null),
      unit: z.enum(["char", "word", "line"]).default("line"),
      /**
       * 逐字 / 逐词出现的节奏（没有真实发音时间，都是估算）：
       * spread = 在字幕时长内均分；{ eachMs } = 每个单位固定间隔；{ totalMs } = 在这段时间内全部出现（剪映入场动画的做法）
       */
      stagger: z
        .union([
          z.literal("spread"),
          z.strictObject({ eachMs: z.number().int().nonnegative() }),
          z.strictObject({ totalMs: z.number().int().nonnegative() }),
        ])
        .default("spread"),
      out: Anim.nullable().default(null),
      loop: Anim.nullable().default(null),
    })
    .default({ in: null, unit: "line", stagger: "spread", out: null, loop: null }),
});
export type TextStyle = z.infer<typeof TextStyle>;
export type Anim = z.infer<typeof Anim>;
export type Easing = z.infer<typeof Easing>;
