import { containBox, cropForAspect, croppedSize, isFullCrop, type Size } from "./crop";
import type { Op } from "./ops";
import { BUILTIN_STYLES } from "./presets";
import { captionLine, safeAreaFor } from "./safe-area";
import type { CropRect, Keyframe, Project, Transform } from "./schema";
import type { TextStyle } from "./text-style";

// 切换画幅 9:16 ⇄ 16:9（问题 18，docs/decisions/0030）。工程里的位置、字号都是画布像素，
// 只改画布宽高的话字幕会跑出画面，所以这里一次算出整套 ops：画布、样式、元素位置、关键帧、主轨裁切。
// 短边保持不变（1080×1920 ⇄ 1920×1080），全屏看时字和人一样大。

export const ASPECTS = ["9:16", "16:9"] as const;
export type AspectName = (typeof ASPECTS)[number];

const RATIO: Record<AspectName, number> = { "9:16": 9 / 16, "16:9": 16 / 9 };

/** 画布是哪种画幅；都不是时返回 null */
export function aspectOf(canvas: Size): AspectName | null {
  const r = canvas.width / canvas.height;
  return ASPECTS.find((a) => Math.abs(RATIO[a] - r) < 0.01) ?? null;
}

/** 新画幅的尺寸：短边沿用当前画布（720 的工程换完还是 720） */
export function aspectSize(target: AspectName, canvas: Size): Size {
  const short = Math.min(canvas.width, canvas.height);
  const long = Math.round((short * 16) / 9 / 2) * 2;
  return target === "9:16" ? { width: short, height: long } : { width: long, height: short };
}

/** 内置样式、旧的模板库样式是按这个画布定的数值 */
export const STYLE_REFERENCE: Size = { width: 1080, height: 1920 };

type CanvasLike = Size & { safeArea: Project["canvas"]["safeArea"] };

/** 把按 from 画布定的样式换算到 canvas 上（和切换画幅同一套规则）；尺寸相同时原样返回 */
export function fitStyle(style: TextStyle, from: Size, canvas: CanvasLike): TextStyle {
  if (from.width === canvas.width && from.height === canvas.height) return style;
  return mapper(from, canvas, canvas.safeArea.preset).style(style);
}

const builtinCache = new Map<string, Record<string, TextStyle>>();

/** 按画布换算好的内置样式。工程里没有某个样式时退回的就是它，横屏、720 的工程也对得上 */
export function builtinStyles(canvas: CanvasLike): Record<string, TextStyle> {
  const key = `${canvas.width}x${canvas.height}:${canvas.safeArea.preset}`;
  let out = builtinCache.get(key);
  if (!out) {
    out = Object.fromEntries(
      Object.entries(BUILTIN_STYLES).map(([id, st]) => [id, fitStyle(st, STYLE_REFERENCE, canvas)]),
    );
    builtinCache.set(key, out);
  }
  return out;
}

export type AspectPlan = {
  ops: Op[];
  size: Size;
  /** 锁定轨道上的元素不动，列出来让用户自己调 */
  skipped: { id: string; reason: string }[];
};

/** 算出切换画幅要提交的 ops。已经是这个画幅时 ops 为空 */
export function planAspect(project: Project, target: AspectName): AspectPlan {
  const from: Size = { width: project.canvas.width, height: project.canvas.height };
  const size = aspectSize(target, from);
  if (size.width === from.width && size.height === from.height)
    return { ops: [], size, skipped: [] };
  const m = mapper(from, size, project.canvas.safeArea.preset);
  const ops: Op[] = [{ op: "canvas.update", set: { width: size.width, height: size.height } }];

  for (const [id, style] of Object.entries(project.styles)) {
    ops.push({ op: "style.update", id, set: m.style(style) });
  }
  // 工程里没有的内置样式按新画布写进去，以后套用时直接是对的数值
  const builtins = builtinStyles({ ...size, safeArea: project.canvas.safeArea });
  for (const [id, style] of Object.entries(builtins)) {
    if (!project.styles[id]) ops.push({ op: "style.add", id, style });
  }

  const skipped: AspectPlan["skipped"] = [];
  for (const track of project.tracks) {
    if (track.kind === "caption") continue;
    for (const item of track.items) {
      const set = itemSet(project, track, item, m);
      if (!set) continue;
      if (track.locked) {
        skipped.push({ id: item.id, reason: "轨道锁定，位置没有换算" });
        continue;
      }
      ops.push({ op: "item.update", id: item.id, set });
    }
  }
  return { ops, size, skipped };
}

type Track = Project["tracks"][number];
type Item = Track["items"][number];
type Mapper = ReturnType<typeof mapper>;

function itemSet(project: Project, track: Track, item: Item, m: Mapper) {
  const transform = "transform" in item ? (item.transform as Transform | undefined) : undefined;
  const keyframes = "keyframes" in item ? (item.keyframes as Keyframe[]) : [];
  if (track.kind === "overlay") {
    if (!transform && keyframes.length === 0) return null;
    return withKeyframes(transform, keyframes, (t) => m.text(t));
  }
  if (track.kind !== "video" || !("asset" in item)) return null;
  const probe = project.assets[item.asset]?.probe;
  const source = probe?.width && probe.height ? { width: probe.width, height: probe.height } : null;
  const crop = "crop" in item ? (item.crop as CropRect | undefined) : undefined;

  if (track.main) {
    // 主轨按画布比例裁过的（铺满画面），换成新画布的比例，中心不变
    // 新比例正好是整张素材时去掉裁切（null），不存全尺寸的矩形
    let nextCrop: CropRect | null | undefined;
    if (source && crop && Math.abs(pxAspect(source, crop) - m.fromRatio) < 0.01) {
      const c = cropForAspect(source, m.toRatio, {
        x: crop.x + crop.width / 2,
        y: crop.y + crop.height / 2,
      });
      nextCrop = isFullCrop(c) ? null : c;
    }
    const before = source ? croppedSize(source, crop) : null;
    const after = source
      ? croppedSize(source, nextCrop === undefined ? crop : (nextCrop ?? undefined))
      : null;
    const set = withKeyframes(transform, keyframes, (t) => m.main(t, before, after)) ?? {};
    if (nextCrop !== undefined) return { ...set, crop: nextCrop };
    return Object.keys(set).length ? set : null;
  }
  if (!transform && keyframes.length === 0) return null;
  const shown = source ? croppedSize(source, crop) : null;
  return withKeyframes(transform, keyframes, (t) => m.visual(t, shown));
}

/** 基础 transform 和每个关键帧用同一个换算；关键帧只写回它自己原来有的字段 */
function withKeyframes(
  transform: Transform | undefined,
  keyframes: Keyframe[],
  map: (t: Transform) => Transform,
): { transform?: Transform; keyframes?: Keyframe[] } | null {
  const out: { transform?: Transform; keyframes?: Keyframe[] } = {};
  const base = transform ?? {};
  const mapped = map(base);
  if (!sameTransform(mapped, base)) out.transform = mapped;
  if (keyframes.length > 0) {
    out.keyframes = keyframes.map((k) => {
      const full = map({ ...base, ...k.transform });
      const t: Transform = { ...k.transform };
      for (const key of Object.keys(k.transform) as (keyof Transform)[]) {
        if (full[key] !== undefined) t[key] = full[key];
      }
      return { ...k, transform: t };
    });
  }
  return out.transform || out.keyframes ? out : null;
}

const sameTransform = (a: Transform, b: Transform) =>
  (Object.keys({ ...a, ...b }) as (keyof Transform)[]).every((k) => a[k] === b[k]);

const pxAspect = (source: Size, crop: CropRect) =>
  (crop.width * source.width) / (crop.height * source.height);

const r0 = (v: number) => Math.round(v);
const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function mapper(from: Size, to: Size, preset: Project["canvas"]["safeArea"]["preset"]) {
  const W = from.width;
  const H = from.height;
  const W2 = to.width;
  const H2 = to.height;
  /** 字号、描边这类大小按短边换算 */
  const k = Math.min(W2, H2) / Math.min(W, H);
  const fromRatio = W / H;
  const toRatio = W2 / H2;

  // 文字的纵向位置分段换算：顶部安全区、画面中线、字幕线各自对上，标题还在上面、字幕还在下面
  const knots = (s: Size) => [
    0,
    safeAreaFor(preset, s.width, s.height).top / s.height,
    0.5,
    captionLine(s.width, s.height),
    1,
  ];
  const ka = knots(from);
  const kb = knots(to);
  const textY = (y: number) => {
    const f = y / H;
    let i = 0;
    while (i < ka.length - 2 && f > (ka[i + 1] ?? 1)) i++;
    const a0 = ka[i] ?? 0;
    const a1 = ka[i + 1] ?? 1;
    const b0 = kb[i] ?? 0;
    const b1 = kb[i + 1] ?? 1;
    return (b0 + ((f - a0) / (a1 - a0)) * (b1 - b0)) * H2;
  };
  const textX = (x: number) => (x / W) * W2;

  /**
   * 一条轴上的位置。贴着边的（离边不到短边的 5%）保持离那条边的距离（按短边缩放）；
   * 其余按它在能移动的范围里所处的比例换算，居中的还居中。两种都能反推，来回切不会跑位
   */
  const near = Math.min(W, H) * 0.05;
  const edge = (pos: number, size0: number, size1: number, extent0: number, extent1: number) => {
    const g0 = pos - size0 / 2;
    const g1 = extent0 - (pos + size0 / 2);
    const gap = Math.min(g0, g1);
    if (gap >= 0 && gap < near) return g0 <= g1 ? g0 * k + size1 / 2 : extent1 - g1 * k - size1 / 2;
    const travel0 = extent0 - size0;
    if (Math.abs(travel0) < 1e-6) return extent1 / 2;
    return size1 / 2 + (g0 / travel0) * (extent1 - size1);
  };

  return {
    fromRatio,
    toRatio,

    style(s: TextStyle): TextStyle {
      const px = (v: number) => r1(v * k);
      const pad = (p: [number, number]): [number, number] => [px(p[0]), px(p[1])];
      return {
        ...s,
        font: { ...s.font, size: px(s.font.size), letterSpacing: px(s.font.letterSpacing) },
        glow: s.glow && { ...s.glow, blur: Math.min(100, px(s.glow.blur)) },
        stroke: s.stroke && { ...s.stroke, width: Math.min(40, px(s.stroke.width)) },
        shadow: s.shadow && {
          ...s.shadow,
          blur: px(s.shadow.blur),
          x: px(s.shadow.x),
          y: px(s.shadow.y),
        },
        box: s.box && { ...s.box, radius: px(s.box.radius), padding: pad(s.box.padding) },
        layout: {
          ...s.layout,
          x: r0(textX(s.layout.x)),
          y: r0(textY(s.layout.y)),
          maxWidth: r0(Math.min((s.layout.maxWidth / W) * W2, W2 * 0.9)),
        },
        highlight: s.highlight && {
          ...s.highlight,
          stroke: s.highlight.stroke && {
            ...s.highlight.stroke,
            width: px(s.highlight.stroke.width),
          },
          activeBox: s.highlight.activeBox && {
            ...s.highlight.activeBox,
            radius: px(s.highlight.activeBox.radius),
            padding: pad(s.highlight.activeBox.padding),
          },
          glow: s.highlight.glow && {
            ...s.highlight.glow,
            blur: Math.min(100, px(s.highlight.glow.blur)),
          },
        },
      };
    },

    /** 标题、卡片拖过的位置：和文字样式一样换算 */
    text(t: Transform): Transform {
      return {
        ...t,
        ...(t.x !== undefined && { x: r0(textX(t.x)) }),
        ...(t.y !== undefined && { y: r0(textY(t.y)) }),
      };
    },

    /** 图片、画中画：看起来一样大（按短边），贴边的还贴着同一边 */
    visual(t: Transform, source: Size | null): Transform {
      const a = boxSize(W, H, source);
      const b = boxSize(W2, H2, source);
      const s0 = t.scale ?? 1;
      const s1 = Math.min(20, (s0 * k * a.width) / b.width);
      const out: Transform = { ...t };
      if (t.scale !== undefined || Math.abs(s1 - 1) > 0.001) out.scale = r3(s1);
      if (t.radius !== undefined) out.radius = r1(t.radius * k);
      if (t.x !== undefined) out.x = r0(edge(t.x, a.width * s0, b.width * s1, W, W2));
      if (t.y !== undefined) out.y = r0(edge(t.y, a.height * s0, b.height * s1, H, H2));
      return out;
    },

    /**
     * 主轨：保持露出的素材高度（口播人像主要看头到胸这一段）。原来整个高度都露出来的，
     * 换完也整个露出，能铺满就铺满；画面中心对着的素材位置不变
     */
    main(t: Transform, before: Size | null, after: Size | null): Transform {
      const a = boxSize(W, H, before);
      const b = boxSize(W2, H2, after);
      const s0 = t.scale ?? 1;
      const shown = Math.min(1, H / (a.height * s0));
      const cover = Math.max(W2 / b.width, H2 / b.height);
      const s1 = shown < 1 ? H2 / (b.height * shown) : Math.min(cover, H2 / b.height);
      // 画面中心对着的素材点（0–1）
      const u = 0.5 + (W / 2 - (t.x ?? W / 2)) / (a.width * s0);
      const v = 0.5 + (H / 2 - (t.y ?? H / 2)) / (a.height * s0);
      // 比画面大时不露边，比画面小时不出画面
      const place = (c: number, size: number, extent: number) => {
        const pos = extent / 2 - (c - 0.5) * size;
        const a = size / 2;
        const b = extent - size / 2;
        return Math.min(Math.max(a, b), Math.max(Math.min(a, b), pos));
      };
      const x = place(u, b.width * s1, W2);
      const y = place(v, b.height * s1, H2);
      const out: Transform = { ...t };
      if (t.scale !== undefined || Math.abs(s1 - 1) > 0.001) out.scale = r3(Math.min(20, s1));
      if (t.x !== undefined || Math.abs(x - W2 / 2) > 0.5) out.x = r0(x);
      if (t.y !== undefined || Math.abs(y - H2 / 2) > 0.5) out.y = r0(y);
      if (t.radius !== undefined) out.radius = r1(t.radius * k);
      return out;
    },
  };
}

/** 素材 contain 到画布后的大小（还没缩放）；没有素材尺寸时是整幅画布 */
function boxSize(width: number, height: number, source: Size | null): Size {
  const b = containBox(width, height, source?.width, source?.height);
  return { width: b.x1 - b.x0, height: b.y1 - b.y0 };
}

/** 编辑器里的参考线（像素）按比例挪到新画布上 */
export function scaleGuides<T extends { axis: "h" | "v"; pos: number }>(
  guides: T[],
  from: Size,
  to: Size,
): T[] {
  return guides.map((g) => ({
    ...g,
    pos: Math.round(
      g.axis === "h" ? (g.pos / from.height) * to.height : (g.pos / from.width) * to.width,
    ),
  }));
}
