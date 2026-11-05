// 用户主动定位元素时播放头跳到哪里。

/** 字幕跳到 80% 处：逐字入场动画放完、字都出来了，开头那一帧可能一个字都还没出现 */
export function captionSeekFrame(from: number, durationInFrames: number): number {
  return from + Math.floor(Math.max(0, durationInFrames) * 0.8);
}

/** 字幕跳到文字已显示的地方，其他元素跳到开头 */
export function blockSeekFrame(from: number, to: number, kind?: string): number {
  return kind === "caption" ? captionSeekFrame(from, to - from) : from;
}

/** 总时长缩短时，把播放头夹到最后一帧；选择或修剪不改仍有效的位置。 */
export function clampPlayheadFrame(frame: number, totalFrames: number): number {
  return Math.max(0, Math.min(Math.round(frame), Math.max(0, Math.floor(totalFrames) - 1)));
}
