import { transformAt } from "../../core/animate";
import { cardShownAt, type FullTransform, type ResolvedTimeline } from "../../core/compile";
import { type Box, textBox } from "../../core/lint";
import { BUILTIN_STYLES } from "../../core/presets";
import type { Project } from "../../core/schema";
import type { TextStyle } from "../../core/text-style";
import { overlayBounds, TEMPLATES } from "../../templates";
import { containBox } from "./pip";

// 预览画面上的点选：算出当前帧每个可见元素在画布上占的区域（画布像素）。
// 文字区域和质检（core/lint）用同一套估算，模板通过 bounds 声明自己占的区域。

export type ElementKind = "caption" | "overlay" | "image" | "video";

export type HitBox = {
  id: string;
  kind: ElementKind;
  box: Box;
  z: number;
  locked: boolean;
  /** 视频片段：主轨铺满画面，不显示选中框和缩放手柄 */
  main?: boolean;
};

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
  assets?: Project["assets"],
): HitBox[] {
  const { width, height } = tl;
  const canvas: Box = { x0: 0, y0: 0, x1: width, y1: height };
  // 图片和画中画按 objectFit: contain 后的真实画面区域算，不能按整幅画布
  const content = (assetId: string): Box => {
    const probe = assets?.[assetId]?.probe;
    return containBox(width, height, probe?.width, probe?.height);
  };
  const out: HitBox[] = [];
  const top = 1000;
  // 有卡片时字幕不显示，也点不到
  const captionsOff = cardShownAt(tl.cardSpans, frame);
  for (const c of tl.captions) {
    if (c.hidden || captionsOff || !showing(c.from, c.durationInFrames, frame)) continue;
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
    const b = overlayBounds(o, st, width, height);
    const box = union([...b.text, ...b.shapes]) ?? canvas;
    out.push({
      id: o.id,
      kind: "overlay",
      box: grow(transformBox(box, o.transform, width, height), PAD / 2),
      z: top + o.z + (o.size === "full" ? 0.5 : 0),
      locked: o.locked,
    });
  }
  for (const img of tl.images) {
    if (img.hidden || !showing(img.from, img.durationInFrames, frame)) continue;
    out.push({
      id: img.id,
      kind: "image",
      // 有关键帧时按此刻插值后的位置算，和画面一致
      box: transformBox(
        content(img.asset),
        transformAt(img.transform, img.keyframes, frame - img.from),
        width,
        height,
      ),
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
      box: v.main
        ? canvas
        : transformBox(
            content(v.asset),
            transformAt(v.transform, v.keyframes, frame - v.from),
            width,
            height,
          ),
      z: v.main ? -1 : v.z,
      locked: v.locked,
      main: v.main,
    });
  }
  return out.toSorted((a, b) => b.z - a.z);
}

export function pick(boxes: HitBox[], x: number, y: number): HitBox | null {
  return (
    boxes.find((h) => x >= h.box.x0 && x <= h.box.x1 && y >= h.box.y0 && y <= h.box.y1) ?? null
  );
}
