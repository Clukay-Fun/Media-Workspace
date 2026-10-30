import type { CardSize } from "../core/schema";
import type { TextStyle } from "../core/text-style";

/** 模板组件的统一输入：纯函数，只由 props 和帧号驱动（AGENTS.md 规则 4） */
export type TemplateProps<P> = {
  props: P;
  style: TextStyle;
  /** 卡片尺寸（叠加层的 size）；不是卡片的模板（标题条）固定传 small，用不上 */
  size: CardSize;
  /** 本地帧号：从叠加层出现开始算 */
  frame: number;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  /** 素材 ID → 可以直接放进 <Img> 的地址；模板要先在 assets() 里声明用到的素材 */
  src: (assetId: string) => string | undefined;
};

/** 模板说明：给 AI 选卡片用（mw guide / mw templates 原样输出） */
export type TemplateMeta<P = unknown> = {
  name: string;
  label: string;
  description: string;
  defaultStyle: string;
  /** 支持的卡片尺寸；空 = 不是卡片（标题条），不能写 size。卡片的叠加层必须写 size（0022） */
  sizes: readonly CardSize[];
  /** 适合的气质，如「沉稳」「活泼」「强调」 */
  mood: readonly string[];
  /** 什么内容用这张卡，一句话 */
  useFor: string;
  /** 一份能直接用的 props，测试会用它检查 schema 和占位 */
  example: P;
};
