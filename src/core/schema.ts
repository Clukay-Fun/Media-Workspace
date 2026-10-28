import { z } from "zod";
import { Anim, Color, Direction, Easing, TextStyle } from "./text-style";
import { PROJECT_FORMAT_VERSION } from "./version";

// project.json 的结构（PLAN 5.2）。类型一律从这里推导，不另写一份。
// 全部用 strictObject：出现不认识的字段直接报错（D25），AI 拼错字段名时能立刻发现。

export const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "ID 只能包含字母、数字、- 和 _");
const Ms = z.number().int().nonnegative();

export const SafeAreaPreset = z.enum(["all", "douyin", "channels", "xiaohongshu"]);

export const Canvas = z.strictObject({
  width: z.number().int().positive().default(1080),
  height: z.number().int().positive().default(1920),
  fps: z.number().int().positive().max(120).default(30),
  background: Color.default("#000000"),
  safeArea: z.strictObject({ preset: SafeAreaPreset }).default({ preset: "all" }),
});

export const Theme = z.strictObject({
  accent: Color.default("#FFD400"),
  font: z.string().min(1).default("alibaba-puhuiti-3"),
});

export const Probe = z.strictObject({
  durationMs: Ms,
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fps: z.number().positive().optional(),
  hasAudio: z.boolean().optional(),
});

export const Asset = z.strictObject({
  kind: z.enum(["video", "audio", "image"]),
  /** 用户的原始文件，只读 */
  path: z.string().min(1),
  fingerprint: z.string().optional(),
  probe: Probe.optional(),
  /** 相对工程目录的缓存文件 */
  cache: z
    .strictObject({
      mez: z.string().optional(),
      proxy: z.string().optional(),
      peaks: z.string().optional(),
    })
    .optional(),
});

/** 中心点坐标；不写的字段取默认值（画布中心、100%、不旋转、不透明） */
export const Transform = z.strictObject({
  x: z.number().optional(),
  y: z.number().optional(),
  scale: z.number().positive().max(20).optional(),
  rotation: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  radius: z.number().nonnegative().optional(),
});

export const Keyframe = z.strictObject({
  /** 相对条目在时间线上开始位置的毫秒数 */
  atMs: Ms,
  transform: Transform,
  easing: Easing.default("ease-in-out"),
});

export const Transition = z.strictObject({
  type: z.enum(["slide", "push", "fade"]),
  direction: Direction.optional(),
  durationMs: z.number().int().positive().max(5000),
});

export const Anchor = z.union([
  z.strictObject({ caption: Id, offsetMs: z.number().int().default(0) }),
  z.strictObject({ clip: Id, offsetMs: z.number().int().default(0) }),
  z.strictObject({ ms: Ms }),
]);

export const Slot = z.enum(["top", "upper-third", "center", "lower-third", "caption"]);

const Visual = {
  transform: Transform.optional(),
  keyframes: z.array(Keyframe).default([]),
  animIn: Anim.optional(),
  animOut: Anim.optional(),
};

/** 主轨片段：首尾相连，不写 at */
export const MainClip = z.strictObject({
  id: Id,
  type: z.literal("clip"),
  asset: Id,
  inMs: Ms,
  outMs: Ms,
  speed: z.number().min(0.1).max(10).default(1),
  gainDb: z.number().min(-60).max(20).default(0),
  transitionIn: Transition.optional(),
  ...Visual,
});

/** 普通轨道上的视频 / 音频片段 */
export const FloatClip = z.strictObject({
  id: Id,
  type: z.literal("clip"),
  asset: Id,
  at: Anchor,
  inMs: Ms,
  outMs: Ms,
  speed: z.number().min(0.1).max(10).default(1),
  gainDb: z.number().min(-60).max(20).default(0),
  slot: Slot.optional(),
  ...Visual,
});

export const ImageItem = z.strictObject({
  id: Id,
  type: z.literal("image"),
  asset: Id,
  at: Anchor,
  durationMs: z.number().int().positive(),
  slot: Slot.optional(),
  ...Visual,
});

export const Highlight = z.strictObject({
  text: z.string().min(1),
  /** 同一句里出现多次时，第几次（从 0 开始）；不写表示全部 */
  nth: z.number().int().nonnegative().optional(),
});

/** 字幕绑定素材源时间（D19），不绑定片段 */
export const Caption = z.strictObject({
  id: Id,
  asset: Id,
  startMs: Ms,
  endMs: Ms,
  text: z.string(),
  highlights: z.array(Highlight).default([]),
  style: Id.optional(),
});

export const Overlay = z.strictObject({
  id: Id,
  template: z.string().min(1),
  at: Anchor,
  /** toEnd = 一直显示到主轨结束（不含片尾） */
  durationMs: z.union([z.number().int().positive(), z.literal("toEnd")]),
  style: Id.optional(),
  slot: Slot.optional(),
  transform: Transform.optional(),
  props: z.record(z.string(), z.unknown()).default({}),
});

const TrackBase = {
  id: Id,
  name: z.string().optional(),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  muted: z.boolean().default(false),
};

export const VideoTrack = z.strictObject({
  ...TrackBase,
  kind: z.literal("video"),
  /** 磁吸主轨：全工程只能有一条 */
  main: z.boolean().default(false),
  items: z.array(z.union([FloatClip, ImageItem, MainClip])),
});

export const CaptionTrack = z.strictObject({
  ...TrackBase,
  kind: z.literal("caption"),
  style: Id.optional(),
  items: z.array(Caption),
});

export const OverlayTrack = z.strictObject({
  ...TrackBase,
  kind: z.literal("overlay"),
  items: z.array(Overlay),
});

export const AudioTrack = z.strictObject({
  ...TrackBase,
  kind: z.literal("audio"),
  items: z.array(FloatClip),
});

export const Track = z.discriminatedUnion("kind", [
  VideoTrack,
  CaptionTrack,
  OverlayTrack,
  AudioTrack,
]);

export const Outro = z.strictObject({
  asset: Id,
  transitionIn: Transition.optional(),
  gainDb: z.number().min(-60).max(20).default(0),
});

export const Cover = z.strictObject({
  atMs: Ms,
  /** 封面上额外显示的叠加层 ID */
  title: Id.optional(),
});

export const Project = z.strictObject({
  version: z.literal(PROJECT_FORMAT_VERSION),
  revision: z.number().int().nonnegative(),
  canvas: Canvas,
  theme: Theme.default({ accent: "#FFD400", font: "alibaba-puhuiti-3" }),
  assets: z.record(Id, Asset).default({}),
  styles: z.record(Id, TextStyle).default({}),
  tracks: z.array(Track).default([]),
  outro: Outro.nullable().default(null),
  cover: Cover.nullable().default(null),
});

export type Project = z.infer<typeof Project>;
export type Asset = z.infer<typeof Asset>;
export type Track = z.infer<typeof Track>;
export type VideoTrack = z.infer<typeof VideoTrack>;
export type CaptionTrack = z.infer<typeof CaptionTrack>;
export type MainClip = z.infer<typeof MainClip>;
export type FloatClip = z.infer<typeof FloatClip>;
export type ImageItem = z.infer<typeof ImageItem>;
export type Caption = z.infer<typeof Caption>;
export type Highlight = z.infer<typeof Highlight>;
export type Overlay = z.infer<typeof Overlay>;
export type Transform = z.infer<typeof Transform>;
export type Keyframe = z.infer<typeof Keyframe>;
export type Transition = z.infer<typeof Transition>;
export type Anchor = z.infer<typeof Anchor>;
export type Slot = z.infer<typeof Slot>;

export function isMainClip(item: VideoTrack["items"][number]): item is MainClip {
  return item.type === "clip" && !("at" in item);
}
