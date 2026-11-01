// 选中元素时播放头跳到哪里。时间线和属性栏的字幕列表共用这一条规则。

/** 字幕跳到 80% 处：逐字入场动画放完、字都出来了，开头那一帧可能一个字都还没出现 */
export function captionSeekFrame(from: number, durationInFrames: number): number {
  return from + Math.floor(Math.max(0, durationInFrames) * 0.8);
}

/** 字幕跳到文字已显示的地方，其他元素跳到开头 */
export function blockSeekFrame(from: number, to: number, kind?: string): number {
  return kind === "caption" ? captionSeekFrame(from, to - from) : from;
}

/** 播放头已经在元素区间里就不动（返回 null），免得打断正在看的位置 */
export function seekFrameOnSelect(
  currentFrame: number,
  from: number,
  to: number,
  kind?: string,
): number | null {
  if (currentFrame < from || currentFrame >= to) return blockSeekFrame(from, to, kind);
  return null;
}
