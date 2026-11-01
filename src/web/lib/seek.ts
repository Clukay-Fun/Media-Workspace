/**
 * 描述: 播放头定位与时间线/字幕选中跳转规则
 * 主要功能:
 *   - 计算选中字幕/时间线块时播放头应跳转的目标帧
 *   - 判定播放头不在区间内时跳转，且字幕跳转到 80% 处确保文字显示完整
 */

//#region 选中元素跳转帧计算

/**
 * 字幕展示时间点（帧）：取字幕区间的 80% 位置，避开入场动画，确保文字已完整显示出来。
 *
 * 用处，参数:
 *   - from: 字幕起始帧
 *   - durationInFrames: 字幕持续帧数
 *
 * 功能:
 *   - 计算字幕显示完整的帧位置（from + Math.floor(durationInFrames * 0.8)）
 */
export function captionSeekFrame(from: number, durationInFrames: number): number {
  return from + Math.floor(Math.max(0, durationInFrames) * 0.8);
}

/**
 * 选中块或元素时的跳转目标帧：
 *
 * 用处，参数:
 *   - from: 起始帧
 *   - to: 结束帧
 *   - kind: 元素类型（如 "caption"、"clip"、"overlay" 等）
 *
 * 功能:
 *   - 字幕类型跳到 80% 位置；其他类型跳到起始帧 from
 */
export function blockSeekFrame(from: number, to: number, kind?: string): number {
  return kind === "caption" ? captionSeekFrame(from, to - from) : from;
}

/**
 * 选中元素时应跳转的目标帧（和时间线 onSelect 使用同一规则）：
 * 播放头不在该区间内时（now < from || now >= to），跳到对应目标帧；
 * 若已在该区间内，则返回 null（无需重复跳转）。
 *
 * 用处，参数:
 *   - currentFrame: 当前播放头所在帧
 *   - from: 元素起始帧
 *   - to: 元素结束帧
 *   - kind: 元素类型
 *
 * 功能:
 *   - 判定是否需要跳转并返回目标帧
 */
export function seekFrameOnSelect(
  currentFrame: number,
  from: number,
  to: number,
  kind?: string,
): number | null {
  if (currentFrame < from || currentFrame >= to) {
    return blockSeekFrame(from, to, kind);
  }
  return null;
}

//#endregion
