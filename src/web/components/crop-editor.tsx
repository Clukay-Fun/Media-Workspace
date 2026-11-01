import type React from "react";
import { useEffect, useRef } from "react";
import { transformAt } from "../../core/animate";
import { compile, type ResolvedTimeline } from "../../core/compile";
import {
  type CropHandle,
  containBox,
  cropForAspect,
  dragCrop,
  FULL_CROP,
  isFullCrop,
  roundCrop,
  type Size,
} from "../../core/crop";
import { applyOps, type Op } from "../../core/ops";
import type { CropRect, Project } from "../../core/schema";
import { transformBox } from "../lib/geometry";
import { findItem } from "../lib/project";
import { itemFrames } from "../lib/timeline";
import { useStore } from "../store";

// 预览里调整裁切（问题 20）。调整时预览临时去掉这个元素的裁切，显示整张素材，
// 框外压暗；拖动只改界面状态，按「完成」才提交一次 item.update。

/** 常用比例（像素宽高比）；「画布」按当前画布算，主轨选它就是铺满画面 */
export function cropAspects(canvas: Size): { label: string; value: number | null }[] {
  return [
    { label: "自由", value: null },
    { label: "画布", value: canvas.width / canvas.height },
    { label: "9:16", value: 9 / 16 },
    { label: "1:1", value: 1 },
    { label: "4:3", value: 4 / 3 },
    { label: "16:9", value: 16 / 9 },
  ];
}

/** 元素在当前时间线里解析后的样子（主轨、画中画、图片） */
function resolvedVisual(tl: ResolvedTimeline, id: string) {
  return (
    tl.videos.find((v) => v.id === id && v.kind === "video") ?? tl.images.find((i) => i.id === id)
  );
}

/** 素材像素尺寸；没探测到时不能裁切（校验会报 CROP_DIMENSIONS） */
export function cropSource(project: Project, id: string): Size | null {
  const ref = findItem(project, id);
  const asset = ref && "asset" in ref.item ? project.assets[String(ref.item.asset)] : undefined;
  const probe = asset?.probe;
  return probe?.width && probe.height ? { width: probe.width, height: probe.height } : null;
}

/** 进入裁切：暂停，播放头不在元素上时跳到元素开头，免得框着一片空白 */
export function startCrop(id: string) {
  const s = useStore.getState();
  const tl = s.preview?.timeline;
  if (!s.project || !tl) return;
  const ref = findItem(s.project, id);
  const crop = ref && "crop" in ref.item ? (ref.item.crop as CropRect | undefined) : undefined;
  const range = itemFrames(tl, id);
  s.setPlaying(false);
  if (range && (s.frame < range.from || s.frame >= range.to)) s.seek(range.from);
  s.select(id, { reveal: false });
  s.setCropEditing({ id, crop: crop ?? FULL_CROP, aspect: null });
}

export async function finishCrop() {
  const s = useStore.getState();
  const e = s.cropEditing;
  if (!e || !s.project) return;
  const crop = isFullCrop(e.crop) ? null : roundCrop(e.crop);
  const ops: Op[] = [{ op: "item.update", id: e.id, set: { crop } }];
  // 等服务端写完再撤掉草稿，中间先显示裁好的样子，免得闪回旧画面
  try {
    s.setDraft({ timeline: compile(applyOps(s.project, ops).project), guides: [] });
  } catch {
    s.setDraft(null);
  }
  s.setCropEditing(null);
  await s.submit(ops, crop ? "裁切已更新" : "已去掉裁切");
  useStore.getState().setDraft(null);
}

function cancelCrop() {
  const s = useStore.getState();
  s.setCropEditing(null);
  s.setDraft(null);
}

const stop = (e: React.PointerEvent) => e.stopPropagation();

const HANDLES: CropHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** 画在点选层上面：整张素材的范围、裁切框、八个手柄 */
export function CropOverlay({
  width: W,
  height: H,
  scale,
}: {
  width: number;
  height: number;
  scale: number;
}) {
  const editing = useStore((s) => s.cropEditing);
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selected);
  const frame = useStore((s) => s.frame);
  const draftTl = useStore((s) => s.draft?.timeline);
  const drag = useRef<{ handle: CropHandle; x0: number; y0: number; start: CropRect } | null>(null);
  const id = editing?.id ?? null;

  // 预览用去掉了这个元素裁切的草稿；工程有更新时跟着重算。退出时由 finishCrop / cancelCrop 清掉
  useEffect(() => {
    if (!project || !id) return;
    const p = structuredClone(project);
    const ref = findItem(p, id);
    if (ref && "crop" in ref.item) delete ref.item.crop;
    useStore.getState().setDraft({ timeline: compile(p), guides: [] });
  }, [project, id]);

  // 选了别的元素、元素被删掉就退出
  useEffect(() => {
    if (id && (selected !== id || (project && !findItem(project, id)))) cancelCrop();
  }, [id, selected, project]);

  // Esc 取消、回车完成；全局快捷键在裁切时不响应（app.tsx、timeline.tsx）
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        cancelCrop();
      } else if (e.key === "Enter") {
        e.preventDefault();
        void finishCrop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id]);

  if (!editing || !project || !draftTl) return null;
  const v = resolvedVisual(draftTl, editing.id);
  const source = cropSource(project, editing.id);
  if (!v || !source) return null;
  const t = transformAt(v.transform, v.keyframes, frame - v.from);
  const full = transformBox(containBox(W, H, source.width, source.height), t, W, H);
  const fw = full.x1 - full.x0;
  const fh = full.y1 - full.y0;
  const c = editing.crop;
  const px = (r: { x0: number; y0: number; x1: number; y1: number }): React.CSSProperties => ({
    left: r.x0 * scale,
    top: r.y0 * scale,
    width: (r.x1 - r.x0) * scale,
    height: (r.y1 - r.y0) * scale,
  });
  const cropBox = {
    x0: full.x0 + c.x * fw,
    y0: full.y0 + c.y * fh,
    x1: full.x0 + (c.x + c.width) * fw,
    y1: full.y0 + (c.y + c.height) * fh,
  };

  const onDown = (e: React.PointerEvent<HTMLElement>, handle: CropHandle) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = { handle, x0: e.clientX, y0: e.clientY, start: c };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x0) / scale / fw;
    const dy = (e.clientY - d.y0) / scale / fh;
    const crop = dragCrop(d.start, d.handle, dx, dy, source, editing.aspect);
    useStore.getState().setCropEditing({ ...editing, crop });
  };
  const onUp = () => {
    drag.current = null;
  };
  const bind = (handle: CropHandle) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => onDown(e, handle),
    onPointerMove: onMove,
    onPointerUp: onUp,
    onPointerCancel: onUp,
  });

  return (
    // 盖住整个画面；按下、移动、松手都不往下传，免得点选层选中别的元素或在松手时清掉草稿
    <div className="crop-layer" onPointerDown={stop} onPointerMove={stop} onPointerUp={stop}>
      <div className="crop-source" style={px(full)} />
      <div className="crop-box" style={px(cropBox)} {...bind("move")}>
        <span className="crop-thirds" aria-hidden />
        {HANDLES.map((h) => (
          <span key={h} className={`crop-handle ${h}`} {...bind(h)} />
        ))}
        <span className="crop-size mono">
          {Math.round(c.width * source.width)} × {Math.round(c.height * source.height)}
        </span>
      </div>
    </div>
  );
}

/** 预览下方的工具栏：比例、还原、取消、完成 */
export function CropToolbar() {
  const editing = useStore((s) => s.cropEditing);
  const project = useStore((s) => s.project);
  if (!editing || !project) return null;
  const source = cropSource(project, editing.id);
  if (!source) return null;
  const c = editing.crop;
  const setAspect = (aspect: number | null) => {
    const crop =
      aspect === null
        ? c
        : cropForAspect(source, aspect, { x: c.x + c.width / 2, y: c.y + c.height / 2 });
    useStore.getState().setCropEditing({ ...editing, crop, aspect });
  };
  return (
    <div className="crop-toolbar" role="toolbar" aria-label="裁切">
      <div className="segmented" role="radiogroup" aria-label="裁切比例">
        {cropAspects(project.canvas).map((a) => (
          <button
            key={a.label}
            type="button"
            role="radio"
            aria-checked={sameAspect(editing.aspect, a.value)}
            className={sameAspect(editing.aspect, a.value) ? "on" : undefined}
            onClick={() => setAspect(a.value)}
          >
            {a.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="mini-btn"
        disabled={isFullCrop(c)}
        onClick={() =>
          useStore.getState().setCropEditing({ ...editing, crop: FULL_CROP, aspect: null })
        }
      >
        还原
      </button>
      <span className="crop-toolbar-gap" />
      <button type="button" className="mini-btn" onClick={cancelCrop} title="Esc">
        取消
      </button>
      <button
        type="button"
        className="mini-btn primary"
        onClick={() => void finishCrop()}
        title="回车"
      >
        完成
      </button>
    </div>
  );
}

// 「画布」和 9:16 在竖屏工程里是同一个比例，两个都亮
const sameAspect = (a: number | null, b: number | null) =>
  a === null || b === null ? a === b : Math.abs(a - b) < 0.001;
