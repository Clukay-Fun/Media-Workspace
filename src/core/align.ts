// 字幕逐字对齐（docs/decisions/0005）：字幕文字已知，识音只用来找每个字是什么时候念的。
// 把识别出的字和字幕的字做编辑距离对齐：对上的（包括识别错的同音字）取识别的时间，
// 对不上的按前后已知时间插值。标点不发音，跟前一个字同时出现。

export type AsrToken = {
  text: string;
  /** 源时间（毫秒） */
  startMs: number;
};

const SILENT = /^[\p{P}\p{S}\p{Z}\s]$/u;
const norm = (c: string) => c.toLowerCase();

/**
 * 返回和 text 每个字（码点）一一对应的开始时间（源时间，毫秒），
 * 单调不减、落在 [startMs, endMs) 里。
 */
export function alignChars(
  text: string,
  tokens: AsrToken[],
  startMs: number,
  endMs: number,
): number[] {
  const chars = [...text];
  const { voiced, known } = matchHeard(chars, tokens, endMs);
  return finish(chars, voiced, known, startMs, endMs);
}

/**
 * 这句话第一个字实际开始念的时间（没对上时为 null）。不限制在字幕范围里：
 * 字幕的开始时间常常比真正开口晚一点，删前一句时会把这句的第一个字剪掉一半（0013 验收发现）
 */
export function speechOnsetMs(text: string, tokens: AsrToken[], endMs: number): number | null {
  const { known } = matchHeard([...text], tokens, endMs);
  return known[0] ?? null;
}

/** 把识别出的字和字幕的字对齐，返回每个发音字识别到的时间（没对上为 null） */
function matchHeard(chars: string[], tokens: AsrToken[], endMs: number) {
  // 识别结果按字展开；一个 token 有多个字时（英文词片），平均分到下一个 token 开始之前
  const heard: { c: string; ms: number }[] = [];
  tokens.forEach((t, i) => {
    const cs = [...t.text.trim()].filter((c) => !SILENT.test(c));
    const next = tokens[i + 1]?.startMs ?? Math.max(t.startMs, endMs);
    const step = cs.length > 0 ? Math.max(0, next - t.startMs) / cs.length : 0;
    cs.forEach((c, j) => {
      heard.push({ c: norm(c), ms: t.startMs + step * j });
    });
  });

  const voiced = chars.flatMap((c, i) => (SILENT.test(c) ? [] : [i]));
  const want = voiced.map((i) => norm(chars[i] ?? ""));
  const n = want.length;
  const m = heard.length;

  // 编辑距离 DP；替换也算对上（识别常把字认成同音字，但位置是对的）
  const cost: number[][] = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  const at = (i: number, j: number) => cost[i]?.[j] ?? Number.POSITIVE_INFINITY;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sub = at(i - 1, j - 1) + (want[i - 1] === heard[j - 1]?.c ? 0 : 1);
      (cost[i] as number[])[j] = Math.min(sub, at(i - 1, j) + 1, at(i, j - 1) + 1);
    }
  }
  const known: (number | null)[] = new Array(n).fill(null);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const same = want[i - 1] === heard[j - 1]?.c ? 0 : 1;
    if (at(i, j) === at(i - 1, j - 1) + same) {
      known[i - 1] = heard[j - 1]?.ms ?? null;
      i--;
      j--;
    } else if (at(i, j) === at(i - 1, j) + 1) i--;
    else j--;
  }
  return { voiced, known };
}

function finish(
  chars: string[],
  voiced: number[],
  known: (number | null)[],
  startMs: number,
  endMs: number,
): number[] {
  const n = known.length;
  // 插值没对上的字；时间倒退的（识别乱序）当作没对上
  const last = Math.max(startMs, endMs - 1);
  const clamp = (v: number) => Math.min(last, Math.max(startMs, v));
  let floor = startMs;
  for (let k = 0; k < n; k++) {
    const v = known[k];
    if (v === null || v === undefined) continue;
    if (v < floor) known[k] = null;
    else floor = clamp(v);
  }
  const times = known.map((v) => (v === null || v === undefined ? null : clamp(v)));
  for (let k = 0; k < n; k++) {
    if (times[k] !== null) continue;
    let a = k - 1;
    while (a >= 0 && times[a] === null) a--;
    let b = k + 1;
    while (b < n && times[b] === null) b++;
    const ta = a >= 0 ? (times[a] as number) : startMs;
    const tb = b < n ? (times[b] as number) : endMs;
    // 句首没对上：第一个字从句首开始；句尾没对上：分到句末之前
    const ia = a >= 0 ? a : 0;
    const ib = b < n ? b : n;
    times[k] = ta + ((tb - ta) * (k - ia)) / (ib - ia);
  }

  const out: number[] = [];
  let prev = startMs;
  let v = 0;
  chars.forEach((c, idx) => {
    if (!SILENT.test(c) && voiced[v] === idx) {
      prev = Math.round(clamp(times[v] ?? prev));
      v++;
    }
    out.push(prev);
  });
  return out;
}
