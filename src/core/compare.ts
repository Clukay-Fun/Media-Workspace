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
