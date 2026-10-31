import type { FullTransform } from "./compile";

export type FaceBox = { x: number; y: number; w: number; h: number };
export type CutMatch = { projectMs: number; referenceMs: number; deltaMs: number };
export type CaptionOCRLine = { text: string; x: number; y: number; w: number; h: number };

/** 从 OCR 行里挑出与目标字幕相符的行；低置信度时返回空，避免把卡片或人物名当成字幕。 */
export function matchCaptionLines(
  lines: CaptionOCRLine[],
  target: string,
  expectedY?: number,
): string[] {
  const normalize = (value: string) =>
    value
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[\s\p{P}\p{S}]/gu, "");
  const targetText = normalize(target);
  if (!targetText) return [];
  const rows = lines
    .map((line) => ({ ...line, normalized: normalize(line.text), centerY: line.y + line.h / 2 }))
    .filter(
      (line) =>
        line.normalized.length >= 2 &&
        (expectedY === undefined || Math.abs(line.centerY - expectedY) <= 0.18),
    )
    .toSorted((a, b) =>
      Math.abs(a.centerY - b.centerY) > 0.015 ? a.centerY - b.centerY : a.x - b.x,
    );
  const candidates = rows.filter(
    (row) =>
      longestCommonSubstring(row.normalized, targetText) /
        Math.min(row.normalized.length, targetText.length) >=
      0.45,
  );

  let bestRows: typeof rows = [];
  let bestScore = 0;
  for (let start = 0; start < candidates.length; start++) {
    const group: (typeof rows)[number][] = [];
    const search = (next: number, text: string) => {
      if (group.length > 0) {
        const score = 1 - editDistance(text, targetText) / Math.max(text.length, targetText.length);
        if (score > bestScore || (score === bestScore && group.length < bestRows.length)) {
          bestScore = score;
          bestRows = [...group];
        }
      }
      if (group.length >= 3) return;
      for (let index = next; index < candidates.length; index++) {
        const row = candidates[index];
        if (!row) continue;
        const previous = group.at(-1);
        if (previous && row.centerY - previous.centerY > 0.14) break;
        group.push(row);
        search(index + 1, text + row.normalized);
        group.pop();
      }
    };
    const first = candidates[start];
    if (first) {
      group.push(first);
      search(start + 1, first.normalized);
    }
  }

  return bestScore >= 0.85 ? bestRows.map((line) => line.text.trim()) : [];
}

function longestCommonSubstring(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  let previous = new Array(b.length + 1).fill(0) as number[];
  let longest = 0;
  for (let row = 1; row <= a.length; row++) {
    const current = new Array(b.length + 1).fill(0) as number[];
    for (let column = 1; column <= b.length; column++) {
      if (a[row - 1] === b[column - 1]) {
        current[column] = (previous[column - 1] ?? 0) + 1;
        longest = Math.max(longest, current[column] ?? 0);
      }
    }
    previous = current;
  }
  return longest;
}

function editDistance(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row++) {
    const current = [row];
    for (let column = 1; column <= b.length; column++) {
      current[column] = Math.min(
        (current[column - 1] ?? 0) + 1,
        (previous[column] ?? 0) + 1,
        (previous[column - 1] ?? 0) + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? Math.max(a.length, b.length);
}

/** 按最近时间一对一匹配剪切点，未匹配的两边会分别列出。 */
export function compareCutPoints(
  projectPoints: number[],
  referencePoints: number[],
  toleranceMs: number,
): { matches: CutMatch[]; projectOnly: number[]; referenceOnly: number[] } {
  const project = projectPoints.toSorted((a, b) => a - b);
  const reference = referencePoints.toSorted((a, b) => a - b);
  const used = new Set<number>();
  const matches: CutMatch[] = [];
  const projectOnly: number[] = [];
  for (const projectMs of project) {
    let nearest = -1;
    let delta = Number.POSITIVE_INFINITY;
    reference.forEach((referenceMs, index) => {
      const distance = Math.abs(projectMs - referenceMs);
      if (!used.has(index) && distance < delta) {
        nearest = index;
        delta = distance;
      }
    });
    if (nearest >= 0 && delta <= toleranceMs) {
      used.add(nearest);
      const referenceMs = reference[nearest];
      if (referenceMs !== undefined)
        matches.push({ projectMs, referenceMs, deltaMs: referenceMs - projectMs });
    } else {
      projectOnly.push(projectMs);
    }
  }
  return {
    matches,
    projectOnly,
    referenceOnly: reference.filter((_, index) => !used.has(index)),
  };
}

/** 把源素材坐标的人脸框映射到画布坐标，并应用该时刻的主轨变换。 */
export function transformFaceBoxToCanvas(
  box: FaceBox,
  source: { width: number; height: number },
  canvas: { width: number; height: number },
  transform: FullTransform,
): FaceBox {
  const { width: canvasWidth, height: canvasHeight } = canvas;
  const contain = Math.min(canvasWidth / source.width, canvasHeight / source.height);
  const left = (canvasWidth - source.width * contain) / 2;
  const top = (canvasHeight - source.height * contain) / 2;
  const sourceX = left + box.x * source.width * contain;
  const sourceY = top + box.y * source.height * contain;
  const boxWidth = box.w * source.width * contain;
  const boxHeight = box.h * source.height * contain;
  const radians = (transform.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const corners = [
    [sourceX, sourceY],
    [sourceX + boxWidth, sourceY],
    [sourceX, sourceY + boxHeight],
    [sourceX + boxWidth, sourceY + boxHeight],
  ].map(([x, y]) => {
    const dx = ((x ?? 0) - canvasWidth / 2) * transform.scale;
    const dy = ((y ?? 0) - canvasHeight / 2) * transform.scale;
    return {
      x: (transform.x + dx * cos - dy * sin) / canvasWidth,
      y: (transform.y + dx * sin + dy * cos) / canvasHeight,
    };
  });
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
  return {
    x: round(x),
    y: round(y),
    w: round(Math.max(...xs) - x),
    h: round(Math.max(...ys) - y),
  };
}

export function faceCenterDelta(
  project: FaceBox | null,
  reference: FaceBox | null,
): { dx: number; dy: number; distance: number } | null {
  if (!project || !reference) return null;
  const dx = project.x + project.w / 2 - (reference.x + reference.w / 2);
  const dy = project.y + project.h / 2 - (reference.y + reference.h / 2);
  return { dx, dy, distance: Math.hypot(dx, dy) };
}

export function compareCaptionWrap(
  projectLines: string[],
  referenceLines: string[],
): {
  sameText: boolean;
  sameWrap: boolean;
  projectBreaks: number[];
  referenceBreaks: number[];
} {
  const normalize = (line: string) => [...line.replace(/[\s.,，。!?！？:：;；'"“”‘’、]/g, "")];
  const project = projectLines.map(normalize);
  const reference = referenceLines.map(normalize);
  const joinedProject = project.flat();
  const joinedReference = reference.flat();
  const breaks = (lines: string[][]) => {
    let count = 0;
    return lines.slice(0, -1).map((line) => (count += line.length));
  };
  const projectBreaks = breaks(project);
  const referenceBreaks = breaks(reference);
  const sameText = joinedProject.join("") === joinedReference.join("");
  const sameWrap =
    sameText &&
    projectBreaks.length === referenceBreaks.length &&
    projectBreaks.every((point, index) => point === referenceBreaks[index]);
  return { sameText, sameWrap, projectBreaks, referenceBreaks };
}

/** 识别出的字幕区域里的文字（参考成片的断句和工程不同时，不按工程的字去挑行，直接看字幕那一带写了什么） */
export function captionBandLines(
  lines: CaptionOCRLine[],
  expectedY: number,
  band = 0.07,
): string[] {
  return lines
    .filter((line) => Math.abs(line.y + line.h / 2 - expectedY) <= band && line.text.trim())
    .toSorted((a, b) => (Math.abs(a.y - b.y) > 0.015 ? a.y - b.y : a.x - b.x))
    .map((line) => line.text.trim());
}

/** 音频响度包络：每 windowMs 一个值，取对数后减均值除以标准差，方便做相关 */
export function loudnessEnvelope(
  samples: Float32Array,
  sampleRate: number,
  windowMs = 10,
): Float64Array {
  const size = Math.max(1, Math.round((sampleRate * windowMs) / 1000));
  const n = Math.floor(samples.length / size);
  const env = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * size; j < (i + 1) * size; j++) sum += (samples[j] ?? 0) ** 2;
    env[i] = Math.log(Math.sqrt(sum / size) + 1e-4);
  }
  let mean = 0;
  for (const v of env) mean += v;
  mean /= n || 1;
  let sd = 0;
  for (const v of env) sd += (v - mean) ** 2;
  sd = Math.sqrt(sd / (n || 1)) || 1;
  for (let i = 0; i < n; i++) env[i] = ((env[i] ?? 0) - mean) / sd;
  return env;
}

export type TimingFit = {
  /** 成片第 0 毫秒对应原片的哪一毫秒 */
  sourceStartMs: number;
  /** 成片 1 毫秒走过原片几毫秒（倍速） */
  speed: number;
  /** 包络相关系数，0.5 以上比较可信 */
  score: number;
};

/**
 * 估计成片是从原片哪里开始、用了几倍速（假设中间没有剪）：原片时间 = sourceStartMs + speed × 成片时间。
 * 两边的响度包络做相关，倍速在 speeds 里搜，起点在 0 到 maxStartMs 里搜；只用成片的前 usedMs（避开片尾）
 */
export function fitTiming(
  source: Float64Array,
  edited: Float64Array,
  o: { windowMs?: number; speeds?: number[]; maxStartMs?: number; usedMs?: number } = {},
): TimingFit | null {
  const w = o.windowMs ?? 10;
  const speeds =
    o.speeds ?? Array.from({ length: 71 }, (_, i) => Math.round((0.8 + i * 0.01) * 100) / 100);
  const maxStart = Math.floor((o.maxStartMs ?? 10_000) / w);
  const used = Math.min(edited.length, Math.floor((o.usedMs ?? Number.POSITIVE_INFINITY) / w));
  if (used < 50) return null;
  let best: TimingFit | null = null;
  for (const speed of speeds) {
    for (let a = 0; a <= maxStart; a++) {
      let sum = 0;
      let count = 0;
      for (let i = 0; i < used; i += 2) {
        const v = source[a + Math.round(i * speed)];
        if (v === undefined) break;
        sum += v * (edited[i] ?? 0);
        count++;
      }
      if (count < used / 4) continue;
      const score = sum / count;
      if (!best || score > best.score) best = { sourceStartMs: a * w, speed, score };
    }
  }
  return best && { ...best, score: Math.round(best.score * 1000) / 1000 };
}
