import type { AsrToken } from "./align";

// 从原片识音出字幕（阶段 F，docs/decisions/0025）：
// 1. 按响度找出说话的段落（speechRegions），长音频按停顿切成小段送去识音；
// 2. 有文稿时把识别出的字和文稿对齐（alignScript）：字以文稿为准，时间用识音的，对不上的地方列出来；
// 3. 按标点、停顿和词边界断成一行一句的字幕（segmentLines）。
// 这里全是纯函数，识音本身在 node/asr。

export type Region = { startMs: number; endMs: number };

/** 一个发音的字：c 是显示的字，startMs 是开始念的源时间；punct 是紧跟在后面的标点（来自文稿或识音） */
export type Spoken = { c: string; startMs: number; punct: string };

const SILENT = /^[\p{P}\p{S}\p{Z}\s]$/u;
const norm = (c: string) => c.toLowerCase();

/**
 * 按响度找出说话的段落（源时间，毫秒）。20ms 一窗的 RMS，阈值取全段第 95 百分位的 10%（不低于 0.004），
 * 短于 minSilenceMs 的静音不算断开，两头各留 padMs。
 */
export function speechRegions(
  samples: Float32Array,
  sampleRate: number,
  o: { offsetMs?: number; minSilenceMs?: number; padMs?: number } = {},
): Region[] {
  const offset = o.offsetMs ?? 0;
  const minSilence = o.minSilenceMs ?? 200;
  const pad = o.padMs ?? 0;
  const win = Math.max(1, Math.round(sampleRate * 0.02));
  const winMs = (win / sampleRate) * 1000;
  const rms: number[] = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += (samples[j] ?? 0) ** 2;
    rms.push(Math.sqrt(sum / win));
  }
  if (rms.length === 0) return [];
  // 用分位数不用峰值：一声咳嗽、拍桌子不会把阈值抬上去
  const sorted = rms.toSorted((a, b) => a - b);
  const p95 = sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0;
  const threshold = Math.max(p95 * 0.1, 0.004);
  const raw: Region[] = [];
  let from = -1;
  rms.forEach((v, k) => {
    if (v >= threshold && from < 0) from = k;
    if (v < threshold && from >= 0) {
      raw.push({ startMs: from * winMs, endMs: k * winMs });
      from = -1;
    }
  });
  if (from >= 0) raw.push({ startMs: from * winMs, endMs: rms.length * winMs });
  const merged: Region[] = [];
  for (const r of raw) {
    const last = merged.at(-1);
    if (last && r.startMs - last.endMs < minSilence) last.endMs = r.endMs;
    else merged.push({ ...r });
  }
  const total = rms.length * winMs;
  return merged.map((r) => ({
    startMs: Math.round(offset + Math.max(0, r.startMs - pad)),
    endMs: Math.round(offset + Math.min(total, r.endMs + pad)),
  }));
}

/** 把说话段落拼成不超过 maxMs 的识音小段，只在静音处切开（一段话本身超过 maxMs 时单独成段） */
export function chunkRegions(regions: Region[], maxMs = 20_000): Region[] {
  const out: Region[] = [];
  for (const r of regions) {
    const last = out.at(-1);
    if (last && r.endMs - last.startMs <= maxMs) last.endMs = r.endMs;
    else out.push({ ...r });
  }
  return out;
}

/** 识音结果展开成一个个字；一个 token 有几个字时（英文词片）平均分到下一个 token 开始之前 */
export function heardChars(tokens: AsrToken[], endMs: number): Spoken[] {
  const out: Spoken[] = [];
  tokens.forEach((t, i) => {
    const cs = [...t.text.trim()];
    const next = tokens[i + 1]?.startMs ?? Math.max(t.startMs, endMs);
    const voiced = cs.filter((c) => !SILENT.test(c));
    const step = voiced.length > 0 ? Math.max(0, next - t.startMs) / voiced.length : 0;
    let k = 0;
    for (const c of cs) {
      const last = out.at(-1);
      if (SILENT.test(c)) {
        if (last) last.punct += c;
        continue;
      }
      out.push({ c, startMs: Math.round(t.startMs + step * k), punct: "" });
      k++;
    }
  });
  return out;
}

export type ScriptDiff = {
  /** fixed = 识音认错的字，已按文稿改；missing = 文稿有、没识别到（漏读或没认出来）；extra = 念了、文稿没有（多读、改口） */
  kind: "fixed" | "missing" | "extra";
  script: string;
  heard: string;
  /** 大概在原片的什么时候（源时间） */
  atMs: number;
};

/**
 * 文稿校字：把识别出的字和文稿的字做编辑距离对齐。字以文稿为准（标点也用文稿的），
 * 时间用识音的；没对上的字按前后插值。对不上的地方列在 diffs 里给用户确认，不自己猜。
 */
export function alignScript(
  script: string,
  heard: Spoken[],
): { spoken: Spoken[]; diffs: ScriptDiff[] } {
  // 文稿拆成发音字 + 后面跟的标点；换行当作句号
  const want: Spoken[] = [];
  for (const c of script.replace(/\s*\n\s*/g, "。")) {
    if (/\s/.test(c)) continue;
    const last = want.at(-1);
    if (SILENT.test(c)) {
      if (last) last.punct += c;
      continue;
    }
    want.push({ c, startMs: -1, punct: "" });
  }
  const n = want.length;
  const m = heard.length;
  const cost: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = 0; i <= n; i++) (cost[i] as Uint32Array)[0] = i;
  for (let j = 0; j <= m; j++) (cost[0] as Uint32Array)[j] = j;
  const same = (i: number, j: number) => norm(want[i]?.c ?? "") === norm(heard[j]?.c ?? "");
  for (let i = 1; i <= n; i++) {
    const row = cost[i] as Uint32Array;
    const up = cost[i - 1] as Uint32Array;
    for (let j = 1; j <= m; j++) {
      row[j] = Math.min(
        (up[j - 1] ?? 0) + (same(i - 1, j - 1) ? 0 : 1),
        (up[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
      );
    }
  }
  // 回溯成一串步骤：= 对上，~ 认错，- 文稿有没听到，+ 听到文稿没有
  type Step = { t: "=" | "~" | "-" | "+"; i: number; j: number };
  const steps: Step[] = [];
  let i = n;
  let j = m;
  const at = (a: number, b: number) => cost[a]?.[b] ?? Number.POSITIVE_INFINITY;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && at(i, j) === at(i - 1, j - 1) + (same(i - 1, j - 1) ? 0 : 1)) {
      steps.push({ t: same(i - 1, j - 1) ? "=" : "~", i: i - 1, j: j - 1 });
      i--;
      j--;
    } else if (i > 0 && at(i, j) === at(i - 1, j) + 1) {
      steps.push({ t: "-", i: i - 1, j });
      i--;
    } else {
      steps.push({ t: "+", i, j: j - 1 });
      j--;
    }
  }
  steps.reverse();

  const known: (number | null)[] = new Array(n).fill(null);
  for (const s of steps) if (s.t === "=" || s.t === "~") known[s.i] = heard[s.j]?.startMs ?? null;
  // 连续的同类步骤合成一条差异
  const diffs: ScriptDiff[] = [];
  let k = 0;
  while (k < steps.length) {
    const s = steps[k] as Step;
    if (s.t === "=") {
      k++;
      continue;
    }
    let e = k;
    while (e < steps.length && steps[e]?.t !== "=") e++;
    const run = steps.slice(k, e);
    const scriptText = run
      .flatMap((x) => (x.t === "~" || x.t === "-" ? [want[x.i]?.c] : []))
      .join("");
    const heardText = run
      .flatMap((x) => (x.t === "~" || x.t === "+" ? [heard[x.j]?.c] : []))
      .join("");
    const firstHeard = run.find((x) => x.t !== "-");
    const atMs =
      (firstHeard ? heard[firstHeard.j]?.startMs : heard[Math.min(s.j, m - 1)]?.startMs) ?? 0;
    const kind = run.every((x) => x.t === "~")
      ? "fixed"
      : scriptText.length >= heardText.length
        ? "missing"
        : "extra";
    diffs.push({ kind, script: scriptText, heard: heardText, atMs });
    k = e;
  }

  // 插值没对上的字；时间倒退的当作没对上
  let floor = 0;
  for (let x = 0; x < n; x++) {
    const v = known[x];
    if (v === null || v === undefined) continue;
    if (v < floor) known[x] = null;
    else floor = v;
  }
  const first = heard[0]?.startMs ?? 0;
  const last = heard.at(-1)?.startMs ?? first;
  const spoken = want.map((w, x) => {
    const v = known[x];
    if (v !== null && v !== undefined) return { ...w, startMs: v };
    let a = x - 1;
    while (a >= 0 && known[a] == null) a--;
    let b = x + 1;
    while (b < n && known[b] == null) b++;
    const ta = a >= 0 ? (known[a] as number) : first;
    const tb = b < n ? (known[b] as number) : last;
    const ia = a >= 0 ? a : x - 1;
    return { ...w, startMs: Math.round(ta + ((tb - ta) * (x - ia)) / (b - ia)) };
  });
  return { spoken, diffs };
}

export type Line = {
  startMs: number;
  endMs: number;
  text: string;
  charStartMs: number[];
  /** 一句话太长、按字数切成了几行中的一行：切点是按词边界估的，值得看一眼读起来顺不顺 */
  split: boolean;
};

/** 断句的标点：顿号不断（「出发日期、集合地点」是一句） */
const BREAK = /[，。！？；：,.!?;:…—]/;

/** 连词、副词：在它前面断开读起来最顺 */
const LINE_START = /^(和|或|与|及|以及|并且|但是|而且|还有|才|就|也|都|还|再|又|却)/;

const segmenter = new Intl.Segmenter("zh", { granularity: "word" });

/** 词边界：返回可以断开的位置（在第 k 个字之后断开，0 < k < 字数） */
function wordBreaks(text: string): Set<number> {
  const out = new Set<number>();
  let k = 0;
  for (const s of segmenter.segment(text)) {
    k += [...s.segment].length;
    out.add(k);
  }
  return out;
}

/** 分词结果里单独成词的字（下标） */
function singleCharWords(text: string): Set<number> {
  const out = new Set<number>();
  let k = 0;
  for (const s of segmenter.segment(text)) {
    const n = [...s.segment].length;
    if (n === 1) out.add(k);
    k += n;
  }
  return out;
}

/**
 * 断成一行一句的字幕：有标点（来自文稿）时在断句标点处断开，停顿只用来挑切点；
 * 没有标点（只有识音）时在停顿处断开。一句超过 maxChars 时在词边界上再切，优先切在两边字数接近、
 * 前短后长、有停顿的地方（样片里用户自己断的字幕多是前一行短、后一行长）。
 * 行尾的标点不显示，句中的顿号、问号保留在原处。regions 是说话段落，用来算停顿和每行念完的时刻。
 */
export function segmentLines(
  spoken: Spoken[],
  regions: Region[],
  o: { maxChars?: number; pauseMs?: number; leadMs?: number; tailMs?: number } = {},
): Line[] {
  const maxChars = o.maxChars ?? 14;
  const hasPunct = spoken.some((s) => BREAK.test(s.punct));
  // 有文稿时说话人在句中换气不另起一行（并列的几项之间常有停顿）
  const pauseMs = o.pauseMs ?? (hasPunct ? 1000 : 250);
  const lead = o.leadMs ?? 60;
  const tail = o.tailMs ?? 150;
  // 第 k 个字念完的时刻：所在说话段落的结尾和下一个字开始取早的那个
  const regionEnd = (ms: number) =>
    regions.find((r) => r.startMs <= ms + 1 && ms < r.endMs)?.endMs ?? null;
  const endOf = (k: number) => {
    const s = spoken[k] as Spoken;
    const next = spoken[k + 1]?.startMs ?? Number.POSITIVE_INFINITY;
    const re = regionEnd(s.startMs);
    return Math.min(next, re ?? s.startMs + 300);
  };
  const pauseAfter = (k: number) => {
    const next = spoken[k + 1];
    return next ? Math.max(0, next.startMs - endOf(k)) : 0;
  };

  // 先按标点和长停顿分句
  const clauses: [number, number][] = [];
  let from = 0;
  spoken.forEach((s, k) => {
    if (k === spoken.length - 1 || BREAK.test(s.punct) || pauseAfter(k) >= pauseMs) {
      clauses.push([from, k + 1]);
      from = k + 1;
    }
  });

  // 显示出来的字数：句中保留的顿号、问号也占一格
  const shown = (k: number) => 1 + (spoken[k]?.punct.replace(/[^、？！?!]/g, "").length ?? 0);

  // 太长的句子切成几行：先求最少几行，再在词边界里挑一组切点，各行长短最均匀、切点最自然
  const split = (a: number, b: number): [number, number][] => {
    const width = (x: number, y: number) => {
      let w = 0;
      for (let k = x; k < y; k++) w += k === y - 1 ? 1 : shown(k);
      return w;
    };
    if (width(a, b) <= maxChars) return [[a, b]];
    const len = b - a;
    const text = spoken
      .slice(a, b)
      .map((s) => s.c)
      .join("");
    const words = wordBreaks(text);
    const singles = singleCharWords(text);
    const cands = [...words].filter((k) => k > 0 && k < len);
    /** 在第 k 个字之后断开的代价：停顿越长越好；顿号连起来的并列不拆开；连词、副词前面断最顺；
     * 两边都是单字的地方多半是分词没认出来的词，尽量不断 */
    const breakCost = (k: number) => {
      const pause = Math.min(pauseAfter(a + k - 1), 600) / 600;
      const list = spoken[a + k - 1]?.punct.includes("、") ? 0.3 : 0;
      const good = LINE_START.test([...text].slice(k).join("")) ? 0.08 : 0;
      const weak = singles.has(k - 1) && singles.has(k) ? 0.1 : 0;
      return -pause * 0.3 + list - good + weak;
    };
    let best: number[] | null = null;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let n = 2; n <= len && !best; n++) {
      const pick = (from: number, left: number, chosen: number[]) => {
        if (left === 0) {
          const cuts = [0, ...chosen, len];
          const ws = cuts.slice(1).map((c, i) => width(a + (cuts[i] ?? 0), a + c));
          if (ws.some((w) => w > maxChars)) return;
          const total = ws.reduce((x, y) => x + y, 0);
          // 各行和平均长度的差；前一行比后一行长时稍微扣分（参考样片：前短后长）
          let c = ws.reduce((x, w) => x + Math.abs(w - total / n), 0) / (2 * total);
          ws.forEach((w, i) => {
            if (i > 0 && (ws[i - 1] ?? 0) > w) c += 0.06;
          });
          for (const k of chosen) c += breakCost(k);
          if (c < bestCost) {
            bestCost = c;
            best = chosen;
          }
          return;
        }
        for (const k of cands) if (k > from) pick(k, left - 1, [...chosen, k]);
      };
      pick(0, n - 1, []);
    }
    // 没有词边界能切成放得下的几行时（一个词就超长），按字数硬切
    const cuts: number[] =
      best ?? Array.from({ length: Math.ceil(len / maxChars) - 1 }, (_, i) => (i + 1) * maxChars);
    return [0, ...cuts].map((c, i) => [a + c, a + (cuts[i] ?? len)] as [number, number]);
  };

  const lines: Line[] = [];
  const parts = clauses.flatMap(([a, b]) => {
    const p = split(a, b);
    return p.map(([x, y]) => ({ a: x, b: y, split: p.length > 1 }));
  });
  for (const { a, b, split: cut } of parts) {
    const chars = spoken.slice(a, b);
    const first = chars[0];
    if (!first) continue;
    // 行尾标点不显示；句中标点只留顿号、问号、感叹号
    const text = chars
      .map((s, k) => s.c + (k < chars.length - 1 ? s.punct.replace(/[^、？！?!]/g, "") : ""))
      .join("");
    const charStartMs: number[] = [];
    chars.forEach((s, k) => {
      charStartMs.push(s.startMs);
      if (k < chars.length - 1)
        for (const _ of s.punct.replace(/[^、？！?!]/g, "")) charStartMs.push(s.startMs);
    });
    const prevEnd = lines.at(-1)?.endMs ?? 0;
    const startMs = Math.max(prevEnd, first.startMs - lead);
    const nextStart = spoken[b]?.startMs;
    const endMs = Math.max(
      startMs + 1,
      Math.min(
        endOf(b - 1) + tail,
        nextStart === undefined ? Number.POSITIVE_INFINITY : nextStart - lead,
      ),
    );
    lines.push({
      startMs,
      endMs: Math.round(endMs),
      text,
      charStartMs: charStartMs.map((v) => Math.max(startMs, v)),
      split: cut,
    });
  }
  return lines;
}
