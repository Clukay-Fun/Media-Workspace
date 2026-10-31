export type SilenceSpan = { startMs: number; endMs: number };
export type SilenceRange = { startMs: number; endMs: number };

export type SilenceOptions = {
  /** 静音检测窗口；20ms 可过滤瞬时峰值，同时不会把停顿边界拖得太远。 */
  windowMs?: number;
  /** 最短静音时长，低于此值的间隙不会被当作停顿。 */
  minPauseMs?: number;
  /** 小于此间隔的说话峰值会并入同一段静音，避免短促底噪切碎停顿。 */
  mergeGapMs?: number;
  /** 静音阈值 = 本段峰值 RMS × ratio 与 floor 的较大值。 */
  thresholdRatio?: number;
  thresholdFloor?: number;
};

const DEFAULTS = {
  windowMs: 20,
  minPauseMs: 400,
  mergeGapMs: 40,
  thresholdRatio: 0.12,
  thresholdFloor: 0.004,
} as const;

/**
 * 从单声道、归一化到 [-1, 1] 的 PCM 样本中找静音段。
 * 时间相对这段音频的开头，单位为毫秒；纯函数，不依赖媒体解码器或字幕。
 */
export function detectSilence(
  samples: Float32Array,
  sampleRate: number,
  options: SilenceOptions = {},
): SilenceSpan[] {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || samples.length === 0) return [];
  const windowMs = options.windowMs ?? DEFAULTS.windowMs;
  const minPauseMs = options.minPauseMs ?? DEFAULTS.minPauseMs;
  const mergeGapMs = options.mergeGapMs ?? DEFAULTS.mergeGapMs;
  const thresholdRatio = options.thresholdRatio ?? DEFAULTS.thresholdRatio;
  const thresholdFloor = options.thresholdFloor ?? DEFAULTS.thresholdFloor;
  if (
    !Number.isFinite(windowMs) ||
    windowMs <= 0 ||
    !Number.isFinite(minPauseMs) ||
    minPauseMs < 0 ||
    !Number.isFinite(mergeGapMs) ||
    mergeGapMs < 0 ||
    !Number.isFinite(thresholdRatio) ||
    thresholdRatio < 0 ||
    !Number.isFinite(thresholdFloor) ||
    thresholdFloor < 0
  ) {
    return [];
  }

  const windowSamples = Math.max(1, Math.round((sampleRate * windowMs) / 1000));
  const levels: { start: number; end: number; rms: number }[] = [];
  for (let start = 0; start < samples.length; start += windowSamples) {
    const end = Math.min(samples.length, start + windowSamples);
    let sum = 0;
    for (let i = start; i < end; i++) sum += (samples[i] ?? 0) ** 2;
    levels.push({ start, end, rms: Math.sqrt(sum / (end - start)) });
  }

  const peak = levels.reduce((max, level) => Math.max(max, level.rms), 0);
  // 没有可辨认的语音 / 声音时不把整条素材当成一段可删除的停顿。
  if (peak < thresholdFloor) return [];
  const threshold = Math.max(peak * thresholdRatio, thresholdFloor);
  const spans: SilenceSpan[] = [];
  let silenceStart: number | null = null;
  let lastSilentEnd = 0;
  for (const level of levels) {
    if (level.rms < threshold) {
      silenceStart ??= level.start;
      lastSilentEnd = level.end;
      continue;
    }
    if (silenceStart !== null) {
      const gapMs = ((level.start - lastSilentEnd) / sampleRate) * 1000;
      if (mergeGapMs === 0 || gapMs > mergeGapMs) {
        addSpan(spans, silenceStart, lastSilentEnd, sampleRate);
        silenceStart = null;
      }
    }
  }
  if (silenceStart !== null) addSpan(spans, silenceStart, lastSilentEnd, sampleRate);
  return spans.filter((span) => span.endMs - span.startMs >= minPauseMs);
}

/**
 * 只留开头和结尾的静音（录制前后的空白）：句中停顿是说话节奏，用户自己剪的时候不删（阶段 F，0025 / Grok 测量）。
 * totalMs 是这段音频的总时长；windowMs 内的误差算贴着头尾
 */
export function edgeSilences(spans: SilenceSpan[], totalMs: number, windowMs = 40): SilenceSpan[] {
  const head = spans.find((s) => s.startMs <= windowMs);
  const tail = spans.findLast((s) => s.endMs >= totalMs - windowMs);
  return [head, tail === head ? undefined : tail].filter((s): s is SilenceSpan => s !== undefined);
}

/** 头尾空白的剪切区间：只在靠说话的一侧留 keepMs，贴着文件头尾的一侧剪到底 */
export function edgeCutRanges(
  spans: SilenceSpan[],
  totalMs: number,
  keepMs: number,
): SilenceRange[] {
  return spans
    .map(({ startMs, endMs }) => {
      const head = startMs <= 40;
      return {
        startMs: head ? 0 : Math.ceil(startMs + keepMs),
        endMs: head ? Math.floor(endMs - keepMs) : Math.floor(totalMs),
      };
    })
    .filter((r) => r.endMs > r.startMs);
}

/** 静音两端各保留 keepMs 后，得到实际从源素材剪掉的区间。 */
export function silenceCutRanges(spans: SilenceSpan[], keepMs: number): SilenceRange[] {
  if (!Number.isFinite(keepMs) || keepMs < 0) return [];
  return spans
    .map(({ startMs, endMs }) => ({
      startMs: Math.ceil(startMs + keepMs),
      endMs: Math.floor(endMs - keepMs),
    }))
    .filter((range) => range.endMs > range.startMs);
}

function addSpan(spans: SilenceSpan[], startSample: number, endSample: number, sampleRate: number) {
  const startMs = (startSample / sampleRate) * 1000;
  const endMs = (endSample / sampleRate) * 1000;
  spans.push({ startMs, endMs });
}
