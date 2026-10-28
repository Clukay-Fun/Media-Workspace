import type { FullTransform, ResolvedKeyframe } from "./compile";
import type { Anim, Easing } from "./text-style";

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
 */
export function enterState(anim: Anim, p: number, size: number): AnimState {
  const k = anim.intensity ?? 1;
  const e = ease(anim.easing, p);
  const dir = anim.direction ?? "up";
  const off = (1 - e) * size * 0.6 * k;
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
      return { ...IDLE, opacity: Math.min(1, e * 2), ...slide };
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
): AnimState {
  let s = IDLE;
  if (anims.in) s = combine(s, enterState(anims.in, ms / anims.in.durationMs, size));
  if (anims.out) {
    const left = durationMs - ms;
    if (left < anims.out.durationMs)
      s = combine(s, enterState(anims.out, left / anims.out.durationMs, size));
  }
  if (anims.loop) {
    const p = (ms % anims.loop.durationMs) / anims.loop.durationMs;
    s = combine(s, enterState(anims.loop, p, size));
  }
  return s;
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

/** 每个单位开始出现的时间（毫秒，相对字幕开始）。标点跟着前一个单位 */
export function unitStarts(
  units: TextUnit[],
  stagger: "spread" | { eachMs: number } | { totalMs: number },
  durationMs: number,
  inMs: number,
): number[] {
  const beats = units.filter((u) => !u.silent).length;
  const step =
    beats <= 1
      ? 0
      : stagger === "spread"
        ? Math.max(0, durationMs - inMs) / beats
        : "eachMs" in stagger
          ? stagger.eachMs
          : stagger.totalMs / beats;
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
