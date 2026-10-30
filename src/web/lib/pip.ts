import { MwError } from "../../core/errors";
import type { Box } from "../../core/lint";
import type { Op } from "../../core/ops";
import { safeAreaFor } from "../../core/safe-area";
import type { Project } from "../../core/schema";

// 画中画 / 图片放到画面上的纯计算（阶段 D）：四角小窗位置、拖角等比缩放、新条目的默认值。
// 界面只负责把这里的结果转成 ops，不自己算坐标。

export const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
export type Corner = (typeof CORNERS)[number];

export const CORNER_LABEL: Record<Corner, string> = {
  "top-left": "左上",
  "top-right": "右上",
  "bottom-left": "左下",
  "bottom-right": "右下",
};

/** 小窗宽度占画幅的比例；离安全区边缘再留画幅宽度的 2% */
const SMALL_SCALE = 1 / 3;
const MARGIN_RATIO = 0.02;

export type Placement = { scale: number; x: number; y: number };

const roundScale = (v: number) => Math.round(v * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 素材在画布上按 objectFit: contain 显示后的内容框（画布像素）。
 * 渲染时图片和视频都铺满画布再 contain，所以宽高比不同时会上下或左右留黑边。
 * 没有素材尺寸（或数据不合法）时退回整幅画布。
 */
export function containBox(
  width: number,
  height: number,
  sourceWidth?: number,
  sourceHeight?: number,
): Box {
  if (!sourceWidth || !sourceHeight || sourceWidth <= 0 || sourceHeight <= 0)
    return { x0: 0, y0: 0, x1: width, y1: height };
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const w = sourceWidth * scale;
  const h = sourceHeight * scale;
  return { x0: (width - w) / 2, y0: (height - h) / 2, x1: (width + w) / 2, y1: (height + h) / 2 };
}

/**
 * 四个角的小窗位置：内容宽度占画幅的 1/3，内容框边缘离安全区再留画幅宽度的 2%。
 * 用 safeArea 而不是画布边缘，是为了避开平台按钮和标题。
 */
export function cornerPlacement(
  corner: Corner,
  canvas: Project["canvas"],
  sourceWidth?: number,
  sourceHeight?: number,
): Placement {
  const area = safeAreaFor(canvas.safeArea.preset, canvas.width, canvas.height);
  const content = containBox(canvas.width, canvas.height, sourceWidth, sourceHeight);
  const scale = roundScale(SMALL_SCALE);
  // 内容框按 contain 居中，缩放时中心不动，所以 1/3 后的内容尺寸直接乘 scale
  const w = (content.x1 - content.x0) * scale;
  const h = (content.y1 - content.y0) * scale;
  const margin = Math.round(canvas.width * MARGIN_RATIO);
  const left = area.left + w / 2 + margin;
  const right = canvas.width - area.right - w / 2 - margin;
  const top = area.top + h / 2 + margin;
  const bottom = canvas.height - area.bottom - h / 2 - margin;
  return {
    scale,
    x: Math.round(corner === "top-left" || corner === "bottom-left" ? left : right),
    y: Math.round(corner === "top-left" || corner === "top-right" ? top : bottom),
  };
}

/**
 * 拖角缩放：对角固定，按鼠标到对角的距离等比缩放，再反算新的中心点。
 * 距离用绝对值，所以拖过对角也不会翻转，只会缩到最小。
 */
export function resizeFromCorner({
  box,
  corner,
  pointer,
  scale,
  minScale = 0.02,
  maxScale = 20,
}: {
  box: Box;
  corner: Corner;
  pointer: { x: number; y: number };
  scale: number;
  minScale?: number;
  maxScale?: number;
}): Placement | null {
  if (!(scale > 0)) return null;
  const left = corner === "top-left" || corner === "bottom-left";
  const top = corner === "top-left" || corner === "top-right";
  const anchor = { x: left ? box.x1 : box.x0, y: top ? box.y1 : box.y0 };
  const dragged = { x: left ? box.x0 : box.x1, y: top ? box.y0 : box.y1 };
  const center = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };

  const diagonal = Math.hypot(dragged.x - anchor.x, dragged.y - anchor.y);
  if (diagonal < 1e-6) return null;
  const distance = Math.hypot(pointer.x - anchor.x, pointer.y - anchor.y);
  const nextScale = roundScale(clamp(scale * (distance / diagonal), minScale, maxScale));
  const k = nextScale / scale;
  return {
    scale: nextScale,
    x: Math.round(anchor.x + (center.x - anchor.x) * k),
    y: Math.round(anchor.y + (center.y - anchor.y) * k),
  };
}

/** 图片默认 3 秒；视频没有实测时长时的兜底 */
const IMAGE_DURATION_MS = 3000;
const FALLBACK_VIDEO_MS = 5000;

/**
 * 把素材放到画面：图片给 ImageItem，视频给整段 FloatClip（默认右上角小窗）。
 * 工程里没有可用的非主轨视频轨道时，同一批 ops 先加一条。
 * 返回 itemId 给界面，提交成功后可以自动选中它。
 */
export function placeAsset(
  project: Project,
  assetId: string,
  atMs: number,
): { ops: Op[]; itemId: string; trackId: string } {
  const asset = project.assets[assetId];
  if (!asset) throw new MwError("NOT_FOUND", `素材「${assetId}」不存在`);
  if (asset.kind !== "image" && asset.kind !== "video")
    throw new MwError("INVALID_OP", "只有图片和视频能放到画面上");

  const ops: Op[] = [];
  // 优先用没锁的；都锁着时选第一条，让 item.add 按正常规则返回 TRACK_LOCKED
  const existing =
    project.tracks.find((t) => t.kind === "video" && !t.main && !t.locked) ??
    project.tracks.find((t) => t.kind === "video" && !t.main);
  const trackId = existing?.id ?? nextTrackId(project);
  if (!existing) {
    ops.push({
      op: "track.add",
      track: { id: trackId, name: "画中画", kind: "video", main: false, items: [] },
    });
  }

  const itemId = nextItemId(project, asset.kind === "image" ? "img" : "pip");
  const at = { ms: Math.max(0, Math.round(atMs)) };
  if (asset.kind === "image") {
    ops.push({
      op: "item.add",
      track: trackId,
      item: {
        id: itemId,
        type: "image",
        asset: assetId,
        at,
        durationMs: IMAGE_DURATION_MS,
      },
    });
  } else {
    const outMs = Math.max(1, Math.round(asset.probe?.durationMs ?? FALLBACK_VIDEO_MS));
    ops.push({
      op: "item.add",
      track: trackId,
      item: {
        id: itemId,
        type: "clip",
        asset: assetId,
        at,
        inMs: 0,
        outMs,
        // 画中画默认静音；属性面板的音量控件可以调回来
        gainDb: -60,
        transform: cornerPlacement(
          "top-right",
          project.canvas,
          asset.probe?.width,
          asset.probe?.height,
        ),
      },
    });
  }
  return { ops, itemId, trackId };
}

/** 视频轨 id：pip、pip-2、pip-3… */
function nextTrackId(project: Project): string {
  const ids = new Set(project.tracks.map((t) => t.id));
  if (!ids.has("pip")) return "pip";
  let n = 2;
  while (ids.has(`pip-${n}`)) n++;
  return `pip-${n}`;
}

function nextItemId(project: Project, prefix: string): string {
  const ids = new Set(project.tracks.flatMap((t) => t.items.map((i) => i.id)));
  let n = 1;
  while (ids.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}
