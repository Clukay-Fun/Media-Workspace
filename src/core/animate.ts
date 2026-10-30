import type { FullTransform, ResolvedKeyframe } from "./compile";
import type { Anim, Direction, Easing } from "./text-style";

// 动画的纯计算：缓动、关键帧插值、动画预设、文字逐字 / 逐词的状态。
// 模板组件只把这里算出的数值写进 style，保证预览和导出一致，也方便单元测试。

export function ease(kind: Easing, t: number): number {
  const x = Math.min(1, Math.max(0, t));
  switch (kind) {
    case "linear":
      return x;
    case "ease-in":
      return x * x * x;
    case "ease-out":
      return 1 - (1 - x) ** 3;
    case "ease-in-out":
      return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
    case "spring": {
      // 欠阻尼回弹的近似：略微冲过头再回到 1
      if (x === 0 || x === 1) return x;
      return 1 - Math.exp(-6 * x) * Math.cos(10 * x);
    }
  }
}

/**
 * 关键帧插值。没有关键帧时就是基础变换；
 * 第一个关键帧之前取第一个的值，最后一个之后取最后一个的值（和剪映一致）。
 * 两个关键帧之间的缓动取后一个关键帧的 easing。
 */
export function transformAt(
  base: FullTransform,
  kfs: ResolvedKeyframe[],
  frame: number,
): FullTransform {
  const first = kfs[0];
  if (!first) return base;
  if (frame <= first.frame) return first.transform;
  for (let i = 1; i < kfs.length; i++) {
    const a = kfs[i - 1];
    const b = kfs[i];
    if (!a || !b || frame > b.frame) continue;
    const t = ease(b.easing, (frame - a.frame) / Math.max(1, b.frame - a.frame));
    const mix = (p: number, q: number) => p + (q - p) * t;
    return {
      x: mix(a.transform.x, b.transform.x),
      y: mix(a.transform.y, b.transform.y),
      scale: mix(a.transform.scale, b.transform.scale),
      rotation: mix(a.transform.rotation, b.transform.rotation),
      opacity: mix(a.transform.opacity, b.transform.opacity),
      radius: mix(a.transform.radius, b.transform.radius),
    };
  }
  return kfs.at(-1)?.transform ?? base;
}

/** 动画在某一时刻对元素的影响，叠加到元素自身的变换上 */
export type AnimState = {
  opacity: number;
  dx: number;
  dy: number;
  scale: number;
  rotation: number;
  blur: number;
  /** 0–1：颜色扫过、变色类预设的进度，由使用方决定混合成什么颜色 */
  tint: number;
  /** 0–1：发光强度 */
  glow: number;
  /** 0–1：下划线划过的进度 */
  underline: number;
};

export const IDLE: AnimState = {
  opacity: 1,
  dx: 0,
  dy: 0,
  scale: 1,
  rotation: 0,
  blur: 0,
  tint: 0,
  glow: 0,
  underline: 0,
};

/**
 * 入场动画在进度 p（0 = 刚开始，1 = 结束）时的状态。出场动画用 1 - p 反着播放。
 * size 是元素的参考尺寸（文字用字号），位移幅度按它换算，换字号时动画观感不变。
 * reach 给出时，slide 从画面外滑进来：位移取 reach(方向)（图片、画中画用画面宽高），不再按 size 只挪一小段。
 */
export function enterState(
  anim: Anim,
  p: number,
  size: number,
  reach?: (dir: Direction) => number,
): AnimState {
  const k = anim.intensity ?? 1;
  const e = ease(anim.easing, p);
  const dir = anim.direction ?? "up";
  const off = (1 - e) * (reach ? reach(dir) : size * 0.6 * k);
  const slide = {
    dx: dir === "left" ? off : dir === "right" ? -off : 0,
    dy: dir === "up" ? off : dir === "down" ? -off : 0,
  };
  switch (anim.preset) {
    case "none":
      return IDLE;
    case "fade":
      return { ...IDLE, opacity: e };
    case "fade-up":
      return { ...IDLE, opacity: e, dy: (1 - e) * size * 0.4 * k };
    case "slide":
      return { ...IDLE, opacity: reach ? 1 : Math.min(1, e * 2), ...slide };
    case "pop":
      return { ...IDLE, opacity: Math.min(1, p * 3), scale: 0.6 + 0.4 * ease("spring", p) };
    case "scale-punch":
      return { ...IDLE, opacity: Math.min(1, p * 4), scale: 1 + (1 - ease("spring", p)) * 0.5 * k };
    case "bounce":
      return {
        ...IDLE,
        opacity: Math.min(1, p * 3),
        dy: -(1 - ease("spring", p)) * size * 0.8 * k,
      };
    case "slam":
      return { ...IDLE, opacity: Math.min(1, p * 4), dy: -(1 - ease("ease-in", p)) * size * 2 * k };
    case "wave":
      return { ...IDLE, opacity: e, dy: Math.sin(p * Math.PI) * -size * 0.3 * k };
    case "typewriter":
      return { ...IDLE, opacity: p > 0 ? 1 : 0 };
    case "blur-in":
      return { ...IDLE, opacity: e, blur: (1 - e) * 12 * k };
    case "zoom-in":
      return { ...IDLE, opacity: e, scale: 0.5 + 0.5 * e };
    case "zoom-out":
      return { ...IDLE, opacity: e, scale: 1.5 - 0.5 * e };
    case "scale-out":
      return { ...IDLE, opacity: e, scale: 1.06 - 0.06 * e };
    case "color-sweep":
      return { ...IDLE, tint: 1 - e };
    // 强调类：在时间点上播放一次，开头和结尾都回到原状
    case "pulse":
      return { ...IDLE, scale: 1 + Math.sin(p * Math.PI) * 0.12 * k };
    case "glow":
      return { ...IDLE, glow: Math.sin(p * Math.PI) };
    case "color-shift":
      return { ...IDLE, tint: e };
    case "shake":
      return { ...IDLE, dx: Math.sin(p * Math.PI * 6) * (1 - p) * size * 0.12 * k };
    case "underline-sweep":
      return { ...IDLE, underline: e };
    case "breathe":
      return { ...IDLE, scale: 1 + Math.sin(p * Math.PI * 2) * 0.03 * k };
  }
}

export function combine(a: AnimState, b: AnimState): AnimState {
  return {
    opacity: a.opacity * b.opacity,
    dx: a.dx + b.dx,
    dy: a.dy + b.dy,
    scale: a.scale * b.scale,
    rotation: a.rotation + b.rotation,
    blur: a.blur + b.blur,
    tint: Math.max(a.tint, b.tint),
    glow: Math.max(a.glow, b.glow),
    underline: Math.max(a.underline, b.underline),
  };
}

/**
 * 元素在本地时间 ms（从出现开始算）的入场 / 出场 / 循环叠加状态。
 * 入场和出场重叠（元素很短）时，两者同时生效。
 */
export function elementState(
  anims: { in: Anim | null; out: Anim | null; loop: Anim | null },
  ms: number,
  durationMs: number,
  size: number,
  reach?: (dir: Direction) => number,
): AnimState {
  let s = IDLE;
  if (anims.in) s = combine(s, enterState(anims.in, ms / anims.in.durationMs, size, reach));
  if (anims.out) {
    const left = durationMs - ms;
    if (left < anims.out.durationMs)
      s = combine(s, enterState(anims.out, left / anims.out.durationMs, size, reach));
  }
  if (anims.loop) {
    const p = (ms % anims.loop.durationMs) / anims.loop.durationMs;
    s = combine(s, enterState(anims.loop, p, size));
  }
  return s;
}

/**
 * 画面元素没写滑动方向时，从离它最近的画面边缘进出：右上角的小窗从右边滑进来、往右边滑出去。
 * 返回的是运动方向（从右边进来 = 往左走）。
 */
export function outwardDirection(x: number, y: number, width: number, height: number): Direction {
  const edges: [number, Direction][] = [
    [x, "right"],
    [width - x, "left"],
    [y, "down"],
    [height - y, "up"],
  ];
  return edges.reduce((a, b) => (b[0] < a[0] ? b : a))[1];
}

// ---------- 文字单位 ----------

export type TextUnit = {
  text: string;
  /** 在原文中的字符（码点）位置，用来匹配高亮 */
  start: number;
  end: number;
  /** 强制换行（原文里的换行符） */
  breakBefore: boolean;
  /** 标点、空白：不单独占一个出现的节拍，跟着前一个单位一起出现 */
  silent: boolean;
};

const PUNCT = /^[\s\p{P}\p{S}]+$/u;

/** 把字幕拆成逐字 / 逐词 / 整行的单位。中文分词用 Intl.Segmenter（Node 和 Chrome 都自带） */
export function splitUnits(
  text: string,
  unit: "char" | "word" | "line",
  locale = "zh",
): TextUnit[] {
  const units: TextUnit[] = [];
  let pos = 0;
  text.split("\n").forEach((line, li) => {
    const pieces =
      unit === "line"
        ? [line]
        : [
            ...new Intl.Segmenter(locale, {
              granularity: unit === "char" ? "grapheme" : "word",
            }).segment(line),
          ].map((s) => s.segment);
    pieces.forEach((piece, pi) => {
      const len = [...piece].length;
      if (len === 0) return;
      units.push({
        text: piece,
        start: pos,
        end: pos + len,
        breakBefore: li > 0 && pi === 0,
        silent: unit !== "line" && PUNCT.test(piece),
      });
      pos += len;
    });
    pos += 1; // 换行符本身
  });
  return units;
}

/**
 * 每个单位开始出现的时间（毫秒，相对字幕开始）。标点跟着前一个单位，不占时间。
 * spread：没有逐字的发音时间，按字数分配整句的时长——中文基本一个字一个音节，
 * SRT 每句的起止又是跟着语音的，所以这样大致能跟上念的速度（长词出现得慢一点）。
 * 有识音得到的逐字时间（charStartMs，按码点下标）时，每个单位从它第一个字开始念的时候出现，
 * 这时 stagger 不起作用。
 */
export function unitStarts(
  units: TextUnit[],
  stagger: "spread" | { eachMs: number } | { totalMs: number } | { fraction: number },
  durationMs: number,
  inMs: number,
  charStartMs?: number[] | null,
): number[] {
  const voiced = units.filter((u) => !u.silent);
  if (typeof stagger === "object" && "fraction" in stagger) {
    // 剪映的节奏：出现进度按二次缓出走（前快后慢），第 k 个单位在进度到 k/n 时出现。
    // 样片 1029 三句话逐帧量过，和这条曲线的误差在 1 帧以内
    const total = durationMs * stagger.fraction;
    let k = -1;
    return units.map((u) => {
      if (!u.silent || k < 0) k += 1;
      return voiced.length > 0 ? total * (1 - Math.sqrt(1 - Math.max(0, k) / voiced.length)) : 0;
    });
  }
  if (charStartMs) {
    let prev = 0;
    return units.map((u) => {
      if (!u.silent) prev = Math.max(prev, charStartMs[u.start] ?? prev);
      return prev;
    });
  }
  if (stagger === "spread") {
    const weight = (u: TextUnit) => (u.silent ? 0 : [...u.text].length);
    const total = voiced.reduce((n, u) => n + weight(u), 0);
    const span = Math.max(0, durationMs - inMs);
    let before = 0;
    let prev = 0;
    return units.map((u) => {
      // 标点和前一个词同时出现
      const at = u.silent ? prev : total > 0 ? (before / total) * span : 0;
      before += weight(u);
      prev = at;
      return at;
    });
  }
  const step =
    voiced.length <= 1
      ? 0
      : "eachMs" in stagger
        ? stagger.eachMs
        : "totalMs" in stagger
          ? stagger.totalMs / voiced.length
          : 0;
  let beat = -1;
  return units.map((u) => {
    if (!u.silent || beat < 0) beat += 1;
    return Math.max(0, beat) * step;
  });
}

/** 原文中被标为关键词的字符位置（nth 不写时匹配所有出现的位置） */
export function highlightMask(
  text: string,
  highlights: { text: string; nth?: number }[],
): boolean[] {
  const chars = [...text];
  const mask = chars.map(() => false);
  for (const h of highlights) {
    const needle = [...h.text];
    let seen = 0;
    for (let i = 0; i + needle.length <= chars.length; i++) {
      if (needle.every((c, j) => chars[i + j] === c)) {
        if (h.nth === undefined || h.nth === seen)
          for (let j = 0; j < needle.length; j++) mask[i + j] = true;
        seen++;
      }
    }
  }
  return mask;
}

/**
 * 把一句里选中的字（码点下标 [start, end)）变成一条高亮。这段文字在句子里只出现一次时不写 nth，
 * 出现多次时写上它是第几次（和 highlightMask 的计数方式一致），只标选中的那一处。
 */
export function highlightAt(
  text: string,
  start: number,
  end: number,
): { text: string; nth?: number } | null {
  const chars = [...text];
  const a = Math.max(0, start);
  const b = Math.min(chars.length, end);
  const needle = chars.slice(a, b);
  if (needle.length === 0 || needle.every((c) => /^\s$/u.test(c))) return null;
  let total = 0;
  let nth = 0;
  for (let i = 0; i + needle.length <= chars.length; i++) {
    if (needle.every((c, j) => chars[i + j] === c)) {
      if (i < a) nth++;
      total++;
    }
  }
  const h = needle.join("");
  return total > 1 ? { text: h, nth } : { text: h };
}

/**
 * 卡拉 OK 扫色的进度：每个字（码点下标）0–1。一个字从它开始念扫到下一个字开始念；
 * 一个单位里有多个字、又没有逐字时间时，平分这个单位的时长。
 */
export function sweepProgress(
  text: string,
  units: TextUnit[],
  starts: number[],
  revealMs: number,
  endMs: number,
  charStartMs?: number[] | null,
): number[] {
  const n = [...text].length;
  const begin: number[] = new Array(n).fill(Number.POSITIVE_INFINITY);
  units.forEach((u, i) => {
    if (u.silent) return;
    const s = starts[i] ?? 0;
    const next = starts.slice(i + 1).find((x) => x > s) ?? endMs;
    const len = u.end - u.start;
    for (let k = 0; k < len; k++) {
      begin[u.start + k] = charStartMs?.[u.start + k] ?? s + ((next - s) * k) / len;
    }
  });
  // 字的结束 = 后面第一个更晚开始的字；标点不扫
  return begin.map((b, k) => {
    if (!Number.isFinite(b)) return 0;
    const end = begin.slice(k + 1).find((x) => Number.isFinite(x) && x > b) ?? endMs;
    if (revealMs <= b) return 0;
    return Math.min(1, (revealMs - b) / Math.max(1, end - b));
  });
}

/**
 * 荧光笔的进度：每个字 0–1。连续的关键词字算一段，从这段第一个字出现开始，
 * 在 drawMs 内从左往右依次画完。
 */
export function markerProgress(
  mask: boolean[],
  units: TextUnit[],
  starts: number[],
  revealMs: number,
  drawMs: number,
): number[] {
  const unitStart: number[] = [];
  units.forEach((u, i) => {
    for (let k = u.start; k < u.end; k++) unitStart[k] = starts[i] ?? 0;
  });
  const out = mask.map(() => 0);
  let k = 0;
  while (k < mask.length) {
    if (!mask[k]) {
      k++;
      continue;
    }
    let e = k;
    while (e < mask.length && mask[e]) e++;
    const t0 = unitStart[k] ?? 0;
    const len = e - k;
    for (let j = k; j < e; j++) {
      const a = t0 + (drawMs * (j - k)) / len;
      out[j] = Math.min(1, Math.max(0, ((revealMs - a) * len) / drawMs));
    }
    k = e;
  }
  return out;
}
