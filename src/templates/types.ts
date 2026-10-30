import type { TextStyle } from "../core/text-style";

/** 模板组件的统一输入：纯函数，只由 props 和帧号驱动（AGENTS.md 规则 4） */
export type TemplateProps<P> = {
  props: P;
  style: TextStyle;
  /** 本地帧号：从叠加层出现开始算 */
  frame: number;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
};
