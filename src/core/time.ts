// 毫秒和帧的换算只能在这里和 compile 里做（AGENTS.md 规则 2）。

export function msToFrame(ms: number, fps: number): number {
  return Math.round((ms * fps) / 1000);
}

export function frameToMs(frame: number, fps: number): number {
  return (frame * 1000) / fps;
}

/** 片段在时间线上占的毫秒数（变速后），不取整 */
export function clipTimelineMs(clip: { inMs: number; outMs: number; speed: number }): number {
  return (clip.outMs - clip.inMs) / clip.speed;
}

/**
 * 片段内第 n 帧输出的是源素材的第几帧。
 * 和 @remotion/media <Video> 的行为一致：trimBefore + floor(n × 倍速)（见 docs/decisions/0002）。
 */
export function sourceFrameAt(trimBeforeFrames: number, speed: number, n: number): number {
  // 加一个很小的余量，避免 1.1 × 10 = 11.000000000000002 之类的浮点误差把 floor 推错
  return trimBeforeFrames + Math.floor(n * speed + 1e-9);
}
