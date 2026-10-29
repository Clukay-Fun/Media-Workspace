import type { FullTransform, ResolvedTimeline } from "../../core/compile";
import { type Box, textBox } from "../../core/lint";
import { BUILTIN_STYLES } from "../../core/presets";
import type { TextStyle } from "../../core/text-style";
import { TEMPLATES } from "../../templates";

// 预览画面上的点选：算出当前帧每个可见元素在画布上占的区域（画布像素）。
// 文字区域和质检（core/lint）用同一套估算，模板通过 bounds 声明自己占的区域。

export type ElementKind = "caption" | "overlay" | "image" | "video";

export type HitBox = { id: string; kind: ElementKind; box: Box; z: number; locked: boolean };

const PAD = 14;

const grow = (b: Box, d: number): Box => ({
  x0: b.x0 - d,
  y0: b.y0 - d,
  x1: b.x1 + d,
  y1: b.y1 + d,
});

const union = (bs: Box[]): Box | null =>
  bs.length === 0
    ? null
    : {
        x0: Math.min(...bs.map((b) => b.x0)),
        y0: Math.min(...bs.map((b) => b.y0)),
        x1: Math.max(...bs.map((b) => b.x1)),
        y1: Math.max(...bs.map((b) => b.y1)),
      };

/** 合成组件里元素先按画布铺满，再以画布中心为原点平移、缩放（composition/Main 的 cssTransform） */
export function transformBox(b: Box, t: FullTransform, width: number, height: number): Box {
  const map = (x: number, y: number) => ({
    x: t.x + t.scale * (x - width / 2),
    y: t.y + t.scale * (y - height / 2),
  });
  const a = map(b.x0, b.y0);
  const c = map(b.x1, b.y1);
  return { x0: a.x, y0: a.y, x1: c.x, y1: c.y };
}

const showing = (from: number, duration: number, frame: number) =>
  frame >= from && frame < from + duration;

export function styleFor(
  styles: Record<string, TextStyle>,
  id: string | null,
  fallback: string,
): TextStyle {
  return (
    styles[id ?? fallback] ??
    styles[fallback] ??
    (BUILTIN_STYLES as Record<string, TextStyle>)[fallback] ??
    BUILTIN_STYLES["caption-word-yellow"]
  );
}

/** 当前帧可以点选的元素，最上层的排在前面 */
export function hitBoxes(
  tl: ResolvedTimeline,
  styles: Record<string, TextStyle>,
  frame: number,
): HitBox[] {
  const { width, height } = tl;
  const canvas: Box = { x0: 0, y0: 0, x1: width, y1: height };
  const out: HitBox[] = [];
  const top = 1000;
  for (const c of tl.captions) {
    if (c.hidden || !showing(c.from, c.durationInFrames, frame)) continue;
    const st = styleFor(styles, c.style, "caption-word-yellow");
    out.push({
      id: c.id,
      kind: "caption",
      box: grow(textBox(c.text, st), PAD),
      z: top + c.z,
      locked: c.locked,
    });
  }
  for (const o of tl.overlays) {
    if (o.hidden || !showing(o.from, o.durationInFrames, frame)) continue;
    const tpl = TEMPLATES[o.template];
    const st = styleFor(styles, o.style, tpl?.meta.defaultStyle ?? "title-bar-yellow");
    const parsed = tpl?.schema.safeParse(o.props);
    const b = tpl?.bounds && parsed?.success ? tpl.bounds(parsed.data, st, width, height) : null;
    const box = union(b ? [...b.text, ...b.shapes] : []) ?? canvas;
    out.push({
      id: o.id,
      kind: "overlay",
      box: grow(transformBox(box, o.transform, width, height), PAD / 2),
      z: top + o.z,
      locked: o.locked,
    });
  }
  for (const img of tl.images) {
    if (img.hidden || !showing(img.from, img.durationInFrames, frame)) continue;
    out.push({
      id: img.id,
      kind: "image",
      box: transformBox(canvas, img.transform, width, height),
      z: img.z,
      locked: img.locked,
    });
  }
  for (const v of tl.videos) {
    if (v.kind !== "video" || v.hidden || !showing(v.from, v.durationInFrames, frame)) continue;
    // 主轨铺满画面，放在最下面：点到空白处就选中当前这段画面
    out.push({
      id: v.id,
      kind: "video",
      box: v.main ? canvas : transformBox(canvas, v.transform, width, height),
      z: v.main ? -1 : v.z,
      locked: v.locked,
    });
  }
  return out.toSorted((a, b) => b.z - a.z);
}

export function pick(boxes: HitBox[], x: number, y: number): HitBox | null {
  return (
    boxes.find((h) => x >= h.box.x0 && x <= h.box.x1 && y >= h.box.y0 && y <= h.box.y1) ?? null
  );
}
