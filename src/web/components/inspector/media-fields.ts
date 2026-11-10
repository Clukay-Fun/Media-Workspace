import { FULL_CROP, isFullCrop, roundCrop } from "../../../core/crop";
import type { Op } from "../../../core/ops";
import type { CropRect } from "../../../core/schema";

/**
 * 视频和项目面板里和工程字段对齐的纯计算。
 * 打开面板只读这些结果，不改工程；用户确认时才走 commit*。
 */

/** 变速后的秒数：(outMs − inMs) / speed。超出 0.1–10 的旧值也按原倍速算。 */
export function speedDurationSeconds(sourceMs: number, speed: number): number | null {
  if (!Number.isFinite(sourceMs) || sourceMs < 0) return null;
  if (!Number.isFinite(speed) || speed <= 0) return null;
  return sourceMs / 1000 / speed;
}

/** 面板上的「变速后 N 秒」。null 表示倍速不能用来算时长。 */
export function speedDurationLabel(sourceMs: number, speed: number): string | null {
  const seconds = speedDurationSeconds(sourceMs, speed);
  return seconds === null ? null : seconds.toFixed(1);
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

/**
 * 用户确认的新倍速。非有限或非正数返回 null，调用方恢复原值、不提交。
 * 合法输入四舍五入到两位，再收进 schema 的 0.1–10。不要拿它改写打开时读到的旧值。
 */
export function commitSpeed(raw: number): number | null {
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return clamp(Math.round(raw * 100) / 100, 0.1, 10);
}

export const GAIN_DB_MIN = -20;
export const GAIN_DB_MAX = 20;

/** 新输入的音量取整并收进工作台范围。滑杆拖动中不要调用。 */
export function commitGainDb(raw: number): number | null {
  if (!Number.isFinite(raw)) return null;
  return clamp(Math.round(raw), GAIN_DB_MIN, GAIN_DB_MAX);
}

/** 滑杆只钳显示位置。数字框继续显示草稿原文，包括还没确认的超范围值。 */
export function gainSliderValue(raw: number, fallback: number): number {
  return clamp(Number.isFinite(raw) ? raw : fallback, GAIN_DB_MIN, GAIN_DB_MAX);
}

/** 任一素材写了 cache.proxy 才算有代理缓存。没有这个字段就是没有。 */
export function hasProxyCache(project: {
  assets: Record<string, { cache?: { proxy?: string } | undefined }>;
}): boolean {
  return Object.values(project.assets).some((asset) => Boolean(asset.cache?.proxy));
}

/** 设计稿里有、工程里没有字段或没有操作的项。全部禁用，不写入。 */
export const UNSUPPORTED_PROJECT_CONTROLS = [
  { id: "rename", label: "工程重命名", reason: "未支持" },
  { id: "move", label: "工程搬迁", reason: "未支持" },
  { id: "hdr", label: "HLG / PQ / HDR", reason: "未支持" },
  { id: "float-link", label: "浮点链接", reason: "未支持" },
  { id: "free-layers", label: "自由层级", reason: "未支持" },
  { id: "global-proxy", label: "全局代理模式", reason: "未支持" },
  { id: "timeline-name", label: "时间线名称", reason: "当前只读" },
  { id: "aspect-1-1", label: "画幅 1:1", reason: "需要单独扩展" },
  { id: "aspect-4-3", label: "画幅 4:3", reason: "需要单独扩展" },
  { id: "resolution", label: "任意分辨率", reason: "需要单独扩展" },
  { id: "fps", label: "任意帧率", reason: "需要单独扩展" },
] as const;

export type CropEditPhase = "drag" | "finish";

/**
 * 拖动只留下一份草稿，不产生 op。完成时提交一次 item.update。
 * 和整张素材几乎重合时存 crop: null，不写一个全尺寸矩形。
 */
export function cropEditDecision(
  phase: CropEditPhase,
  id: string,
  crop: CropRect,
): { draft: CropRect; stored: CropRect | null; ops: Op[] } {
  if (phase === "drag") return { draft: crop, stored: null, ops: [] };
  const stored = isFullCrop(crop) ? null : roundCrop(crop);
  return {
    draft: stored ?? FULL_CROP,
    stored,
    ops: [{ op: "item.update", id, set: { crop: stored } }],
  };
}
