import { Player, type PlayerRef } from "@remotion/player";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Main } from "../../composition/Main";
import { transformAt } from "../../core/animate";
import type { EditorState } from "../../core/api";
import { compile } from "../../core/compile";
import { planTransform } from "../../core/edit";
import { applyOps, type Op } from "../../core/ops";
import type { Project } from "../../core/schema";
import { type HitBox, hitBoxes, pick } from "../lib/geometry";

import { findItem } from "../lib/project";
import { frameOfMs, msOfFrame, timecode } from "../lib/timeline";
import { useStore } from "../store";
import { addGuide, CanvasGuides, RULER_BAND } from "./canvas-guides";
import { CropOverlay, CropToolbar } from "./crop-editor";
import { Icon } from "./icons";
import { PlayerChromeV7 } from "./player-chrome-v7";

const KIND: Record<HitBox["kind"], string> = {
  caption: "字幕",
  overlay: "标题",
  image: "图片",
  video: "画面",
};

type Drag = {
  mode: "move" | "resize";
  id: string;
  pointerId: number;
  x0: number;
  y0: number;
  bx: number;
  by: number;
  /** 元素有关键帧时，播放头相对元素开始的毫秒数 */
  atMs: number | undefined;
  ops: Op[] | null;
  /** 拖边缩放：开始时的选中框（画布像素）、拖的边、当时的缩放 */
  edge?: "top" | "right" | "bottom" | "left";
  box?: HitBox["box"];
  scale0?: number;
};
type AnnotationDraft = {
  target: string;
  point: { x: number; y: number };
  atMs: number;
  left: number;
  top: number;
};

export function Stage() {
  const name = useStore((s) => s.name);
  const project = useStore((s) => s.project);
  const editor = useStore((s) => s.editor);
  const preview = useStore((s) => s.preview);
  const draft = useStore((s) => s.draft);
  const frame = useStore((s) => s.frame);
  const seekNonce = useStore((s) => s.seekNonce);
  const playing = useStore((s) => s.playing);
  const annotating = useStore((s) => s.annotating);
  const selected = useStore((s) => s.selected);
  const cropping = useStore((s) => s.cropEditing !== null);
  const flash = useStore((s) => s.flash);
  const review = useStore((s) => s.review);
  const lint = useStore((s) => s.lint);
  const pin = useStore((s) => s.pin);
  const loadError = useStore((s) => s.loadError);
  const st = useStore.getState();

  const player = useRef<PlayerRef>(null);
  const shell = useRef<HTMLElement>(null);
  const [loop, setLoop] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const hitLayer = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationDraft | null>(null);
  const [commentText, setCommentText] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const commentInput = useRef<HTMLInputElement>(null);
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    if (annotationDraft) commentInput.current?.focus();
  }, [annotationDraft]);

  // 在时间线、列表里改选了别的元素，浮动批注框就收起
  useEffect(() => {
    if (annotationDraft && selected !== annotationDraft.target) {
      setAnnotationDraft(null);
      setCommentText("");
      st.setCommentDraft(null);
    }
  }, [selected, annotationDraft]);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const timeline = draft?.timeline ?? preview?.timeline ?? null;
  const W = timeline?.width ?? 1080;
  const H = timeline?.height ?? 1920;
  const fps = timeline?.fps ?? 30;
  const total = Math.max(1, timeline?.durationInFrames ?? 1);
  const rulerBand = editor?.rulers ? RULER_BAND : 0;
  const scale =
    size.w && size.h
      ? Math.min(Math.max(0, size.w - rulerBand) / W, Math.max(0, size.h - rulerBand) / H)
      : 0;
  // Player 的帧号同步回界面；界面跳转时再推给 Player（播放中的帧变化不回推，避免互相触发）
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => st.setFrame(e.detail.frame);
    const onPlay = () => st.setPlaying(true);
    const onPause = () => st.setPlaying(false);
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onPause);
    return () => {
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onPause);
    };
  }, [st, preview !== null]);
  useEffect(() => {
    player.current?.seekTo(Math.min(useStore.getState().frame, total - 1));
  }, [seekNonce, total]);
  useEffect(() => {
    const p = player.current;
    if (!p || p.isPlaying() === playing) return;
    if (playing) p.play();
    else p.pause();
  }, [playing]);

  const inputProps = useMemo(
    () => (preview && draft ? { ...preview, timeline: draft.timeline } : preview),
    [preview, draft],
  );
  const boxes = useMemo(
    () => (timeline && preview ? hitBoxes(timeline, preview.styles, frame, project?.assets) : []),
    [timeline, preview, frame, project],
  );
  const selBox = boxes.find((b) => b.id === selected);

  // 缩放手柄的 pointerdown 目标是按钮，不能拿它自己的 rect 换算，统一用点选层
  const toCanvas = (clientX: number, clientY: number) => {
    const r = hitLayer.current?.getBoundingClientRect();
    return r ? { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale } : { x: 0, y: 0 };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!project || e.button !== 0) return;
    // 上一次 pointerup 丢失时不要把旧 drag 带进新的一次点选
    if (drag.current) {
      drag.current = null;
      st.setDraft(null);
    }
    const p = toCanvas(e.clientX, e.clientY);
    const hit = pick(boxes, p.x, p.y);
    if (useStore.getState().annotating) {
      // 不让按下鼠标把焦点从批注输入框抢走
      e.preventDefault();
      if (!hit) {
        st.toast("点选画面中的元素来添加批注", "info");
        return;
      }
      const bounds = area.current?.getBoundingClientRect();
      if (!bounds) return;
      const popupWidth = Math.max(1, Math.min(280, bounds.width - 24));
      const left = Math.max(
        12,
        Math.min(bounds.width - popupWidth - 12, e.clientX - bounds.left - popupWidth / 2),
      );
      // 输入框放在被点元素的上方，上面放不下就放下方，不盖住要批注的东西
      const popupHeight = 36;
      const layer = e.currentTarget.getBoundingClientRect();
      const boxTop = layer.top - bounds.top + hit.box.y0 * scale;
      const boxBottom = layer.top - bounds.top + hit.box.y1 * scale;
      const above = boxTop - popupHeight - 8;
      const top = Math.max(
        12,
        Math.min(bounds.height - popupHeight - 12, above >= 12 ? above : boxBottom + 8),
      );
      const point = { x: Math.round(p.x), y: Math.round(p.y) };
      st.select(hit.id);
      st.setPin(point);
      st.setAnnotating(false);
      setCommentText("");
      const nextDraft = {
        target: hit.id,
        point,
        atMs: msOfFrame(useStore.getState().frame, fps),
        left,
        top,
      };
      setAnnotationDraft(nextDraft);
      st.setCommentDraft({ text: "", atMs: nextDraft.atMs, target: nextDraft.target, point });
      return;
    }
    st.select(hit?.id ?? null);
    // 字幕的位置由样式决定；主轨铺满画面（z < 0），都不能拖
    if (!hit || hit.locked || hit.kind === "caption" || hit.z < 0) return;
    const ref = findItem(project, hit.id);
    const t = ref && "transform" in ref.item ? ref.item.transform : undefined;
    // 有关键帧的元素从此刻插值后的位置开始拖，改动写进播放头处的关键帧
    const tl = useStore.getState().preview?.timeline;
    const v = tl && [...tl.videos, ...tl.images].find((x) => x.id === hit.id);
    const local = v ? useStore.getState().frame - v.from : 0;
    const now = v?.keyframes.length ? transformAt(v.transform, v.keyframes, local) : undefined;
    drag.current = {
      mode: "move",
      id: hit.id,
      pointerId: e.pointerId,
      x0: p.x,
      y0: p.y,
      bx: now?.x ?? t?.x ?? W / 2,
      by: now?.y ?? t?.y ?? H / 2,
      atMs: now ? msOfFrame(local, fps) : undefined,
      ops: null,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  /** 从四条边的中心开始缩放：对边中点固定，拖动中只更新本地预览，松手提交一次 */
  const startResize = (
    e: React.PointerEvent<HTMLButtonElement>,
    edge: "top" | "right" | "bottom" | "left",
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!project || !selBox || !timeline) return;
    const v = [...timeline.videos, ...timeline.images].find((x) => x.id === selBox.id);
    if (!v) return;
    const local = frame - v.from;
    const t = v.keyframes.length ? transformAt(v.transform, v.keyframes, local) : v.transform;
    const atMs = v.keyframes.length
      ? msOfFrame(Math.max(0, Math.min(local, v.durationInFrames - 1)), fps)
      : undefined;
    drag.current = {
      mode: "resize",
      id: selBox.id,
      pointerId: e.pointerId,
      x0: 0,
      y0: 0,
      bx: t.x,
      by: t.y,
      atMs,
      ops: null,
      edge,
      box: selBox.box,
      scale0: t.scale,
    };
    hitLayer.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = toCanvas(e.clientX, e.clientY);
    const d = drag.current;
    if (!d || !project) {
      setHover(pick(boxes, p.x, p.y)?.id ?? null);
      return;
    }
    if (d.mode === "resize") {
      if (!d.box || !d.edge || d.scale0 === undefined) return;
      const r = resizeFromEdge({ box: d.box, edge: d.edge, pointer: p, scale: d.scale0 });
      if (!r) return;
      try {
        const plan = planTransform(project, {
          id: d.id,
          transform: { scale: r.scale, x: r.x, y: r.y },
          snap: false,
          atMs: d.atMs,
        });
        d.ops = plan.ops;
        st.setDraft({
          timeline: compile(applyOps(project, plan.ops).project),
          guides: plan.guides,
        });
      } catch (err) {
        drag.current = null;
        st.setDraft(null);
        st.toast(err instanceof Error ? err.message : String(err), "error");
      }
      return;
    }
    if (Math.hypot(p.x - d.x0, p.y - d.y0) < 3 / scale && !d.ops) return;
    try {
      // 按住 ⌘ 暂时关闭吸附（和时间线一致）
      const plan = planTransform(project, {
        id: d.id,
        transform: { x: d.bx + p.x - d.x0, y: d.by + p.y - d.y0 },
        snap: !e.metaKey,
        guides: visibleGuides(useStore.getState().editor),
        atMs: d.atMs,
      });
      d.ops = plan.ops;
      st.setDraft({ timeline: compile(applyOps(project, plan.ops).project), guides: plan.guides });
    } catch (err) {
      drag.current = null;
      st.setDraft(null);
      st.toast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const onPointerUp = async (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (hitLayer.current?.hasPointerCapture(e.pointerId)) {
      hitLayer.current.releasePointerCapture(e.pointerId);
    }
    if (d?.ops) await st.submit(d.ops);
    // 提交期间用户可能已经开始拖另一个元素，不能把新拖动的草稿清掉
    if (shouldClearDragDraft(drag.current)) st.setDraft(null);
  };

  // 指针被浏览器收回（例如系统弹窗、触控取消）时清掉拖动草稿，避免下一次拖动卡在旧状态
  const cancelDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointerId !== e.pointerId) return;
    drag.current = null;
    st.setDraft(null);
  };

  const dismissAnnotation = () => {
    setAnnotationDraft(null);
    setCommentText("");
    st.setCommentDraft(null);
    st.setPin(null);
  };

  const addAnnotation = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const draft = annotationDraft;
    const text = commentText.trim();
    if (!draft || !text || commentBusy) return;
    setCommentBusy(true);
    const saved = await st.addComment({
      text,
      atMs: draft.atMs,
      target: draft.target,
      point: draft.point,
    });
    setCommentBusy(false);
    if (!saved) return;
    setAnnotationDraft(null);
    setCommentText("");
    st.setCommentDraft(null);
  };

  const nowMs = msOfFrame(frame, fps);
  const pins = (review?.comments ?? []).filter(
    (c) =>
      c.status === "open" && c.point && c.atMs !== undefined && Math.abs(c.atMs - nowMs) < 1500,
  );
  const flashing = flash && Date.now() - flash.at < 2400 ? flash : null;
  const selectedHasIssue = selBox && (lint?.issues ?? []).some((issue) => issue.id === selBox.id);
  const selectedTagLabel =
    selBox?.kind === "image" || selBox?.kind === "video" ? KIND[selBox.kind] : "";
  const showSelectedTag = Boolean(
    selBox && (selectedTagLabel || selectedHasIssue || selBox.locked),
  );
  const hoverBox = hover && hover !== selected ? boxes.find((b) => b.id === hover) : undefined;

  const rect = (b: HitBox["box"]): React.CSSProperties => ({
    left: b.x0 * scale,
    top: b.y0 * scale,
    width: (b.x1 - b.x0) * scale,
    height: (b.y1 - b.y0) * scale,
  });

  return (
    <main className="stage panel mw-player-v7" aria-label={name || "预览"} ref={shell}>
      <div className="stage-area" ref={area}>
        <PreviewSettings width={W} height={H} />
        {inputProps && scale > 0 ? (
          <div
            className="preview-frame"
            style={{ width: W * scale + rulerBand, height: H * scale + rulerBand }}
          >
            <div
              className="canvas"
              style={{
                width: W * scale,
                height: H * scale,
                left: rulerBand,
                top: rulerBand,
              }}
            >
              <Player
                ref={player}
                component={Main}
                inputProps={inputProps}
                durationInFrames={total}
                compositionWidth={W}
                compositionHeight={H}
                fps={fps}
                loop={loop}
                style={{ width: "100%", height: "100%" }}
                clickToPlay={false}
                doubleClickToFullscreen={false}
                spaceKeyToPlayOrPause={false}
                moveToBeginningWhenEnded={false}
              />
              <div
                ref={hitLayer}
                className={
                  annotating
                    ? "hit-layer annotating"
                    : drag.current
                      ? "hit-layer dragging"
                      : "hit-layer"
                }
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={(e) => void onPointerUp(e)}
                onPointerCancel={cancelDrag}
                onLostPointerCapture={cancelDrag}
                onPointerLeave={() => setHover(null)}
              >
                {draft?.guides.map((g) => (
                  <div
                    key={`${g.axis}-${g.pos}`}
                    className={`snap-guide ${g.axis}`}
                    style={g.axis === "h" ? { top: g.pos * scale } : { left: g.pos * scale }}
                  />
                ))}
                {hoverBox && (hoverBox.kind !== "video" || !hoverBox.main) && (
                  <div className="box hover" style={rect(hoverBox.box)} />
                )}
                {flashing &&
                  boxes
                    .filter((b) => flashing.ids.includes(b.id) && b.kind !== "video")
                    .map((b) => (
                      <div
                        key={`${b.id}-${flashing.at}`}
                        className="box flash"
                        style={rect(b.box)}
                      />
                    ))}
                {selBox && !cropping && (selBox.kind !== "video" || !selBox.main) && (
                  <div
                    className={[
                      "box selected",
                      selBox.locked ? "locked" : "",
                      // 贴着画面顶边时，标签放进框里，免得被裁掉
                      selBox.box.y0 * scale < 24 ? "tag-inside" : "",
                    ].join(" ")}
                    style={rect(selBox.box)}
                  >
                    {showSelectedTag && (
                      <span className="box-tag">
                        {selectedHasIssue && <Icon name="warn" size={11} className="box-warning" />}
                        {selBox.locked && <Icon name="lock" size={11} />}
                        {selectedTagLabel}
                      </span>
                    )}
                    {!selBox.locked && (selBox.kind === "image" || selBox.kind === "video") && (
                      <ResizeHandles onStart={startResize} />
                    )}
                  </div>
                )}
                {pins.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    className="pin"
                    title={c.text}
                    style={{ left: (c.point?.x ?? 0) * scale, top: (c.point?.y ?? 0) * scale }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => {
                      if (c.target) st.select(c.target, { reveal: false });
                      st.setSideTab("comments");
                    }}
                  >
                    <span>{c.id.replace(/^k/, "")}</span>
                  </button>
                ))}
                {pin && (
                  <span className="pin draft" style={{ left: pin.x * scale, top: pin.y * scale }} />
                )}
                <CropOverlay width={W} height={H} scale={scale} />
              </div>
            </div>
          </div>
        ) : (
          <div className="canvas skeleton" style={{ aspectRatio: `${W} / ${H}` }}>
            {loadError && (
              <div className="load-error" role="alert">
                <Icon name="warn" size={18} />
                <p>预览加载失败</p>
                <span>{loadError}</span>
                <button type="button" className="chip" onClick={() => void st.refresh()}>
                  重试
                </button>
              </div>
            )}
          </div>
        )}
        {inputProps && scale > 0 && (
          <div
            className="guides-frame"
            style={{ width: W * scale + rulerBand, height: H * scale + rulerBand }}
          >
            <CanvasGuides width={W} height={H} scale={scale} band={rulerBand} />
          </div>
        )}
        <CropToolbar />
        {annotating && (
          <div className="annotation-hint" role="status">
            点选画面元素添加批注 <kbd>Esc</kbd>
          </div>
        )}
        {annotationDraft && (
          <form
            className="floating-comment"
            aria-label="添加批注"
            style={{ left: annotationDraft.left, top: annotationDraft.top }}
            onPointerDown={(e) => e.stopPropagation()}
            onSubmit={(e) => void addAnnotation(e)}
          >
            <span className="floating-comment-context">
              <Icon name="target" size={12} />
              <span className="mono">{timecode(frameOfMs(annotationDraft.atMs, fps), fps)}</span>
              <span className="floating-comment-target">{annotationDraft.target}</span>
            </span>
            <input
              ref={commentInput}
              value={commentText}
              placeholder="添加批注…"
              aria-label="批注内容"
              onChange={(e) => {
                const text = e.target.value;
                setCommentText(text);
                if (annotationDraft)
                  st.setCommentDraft({
                    text,
                    atMs: annotationDraft.atMs,
                    target: annotationDraft.target,
                    point: annotationDraft.point,
                  });
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  dismissAnnotation();
                }
              }}
            />
            <button
              type="button"
              className="floating-comment-close"
              aria-label="取消批注"
              onClick={dismissAnnotation}
            >
              <Icon name="close" size={11} />
            </button>
            <button
              type="submit"
              className="floating-comment-submit"
              aria-label="确定批注"
              title="确定"
              disabled={!commentText.trim() || commentBusy}
            >
              <Icon name="check" size={12} />
            </button>
          </form>
        )}
      </div>
      <PlayerChromeV7
        frame={frame}
        fps={fps}
        total={total}
        width={W}
        height={H}
        playing={playing}
        loop={loop}
        comments={review?.comments ?? []}
        onLoopChange={setLoop}
        onFullscreen={() => {
          const el = shell.current;
          if (!el) return;
          if (document.fullscreenElement === el) void document.exitFullscreen();
          else void el.requestFullscreen();
        }}
      />
    </main>
  );
}

/**
 * 提交一次拖动时，只有在期间没有新的拖动接管指针，才能清掉草稿。
 * 这条判断单独保留，避免旧拖动的异步提交把新选中素材的草稿清掉。
 */
export function shouldClearDragDraft(activeDrag: object | null): boolean {
  return activeDrag === null;
}

export const RESIZE_HANDLE_EDGES = ["top", "right", "bottom", "left"] as const;
type ResizeEdge = (typeof RESIZE_HANDLE_EDGES)[number];

const RESIZE_HANDLES: {
  edge: ResizeEdge;
  label: string;
  style: React.CSSProperties;
}[] = [
  {
    edge: "top",
    label: "上边",
    style: {
      left: "50%",
      top: 0,
      transform: "translate(-50%, -50%)",
      cursor: "ns-resize",
      zIndex: 2,
    },
  },
  {
    edge: "right",
    label: "右边",
    style: {
      right: 0,
      top: "50%",
      transform: "translate(50%, -50%)",
      cursor: "ew-resize",
      zIndex: 2,
    },
  },
  {
    edge: "bottom",
    label: "下边",
    style: {
      left: "50%",
      bottom: 0,
      transform: "translate(-50%, 50%)",
      cursor: "ns-resize",
      zIndex: 2,
    },
  },
  {
    edge: "left",
    label: "左边",
    style: {
      left: 0,
      top: "50%",
      transform: "translate(-50%, -50%)",
      cursor: "ew-resize",
      zIndex: 2,
    },
  },
];

/** 选中框四条边中心的缩放手柄；对边中点固定，等比缩放 */
function ResizeHandles({
  onStart,
}: {
  onStart: (e: React.PointerEvent<HTMLButtonElement>, edge: ResizeEdge) => void;
}) {
  return (
    <>
      {RESIZE_HANDLES.map((h) => (
        <button
          key={h.edge}
          type="button"
          className="box-handle"
          style={h.style}
          aria-label={`拖${h.label}缩放`}
          title={`拖动${h.label}缩放，对边中点固定`}
          onPointerDown={(e) => onStart(e, h.edge)}
        />
      ))}
    </>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 拖边等比缩放：对边中点固定，只用垂直于边的距离计算缩放 */
export function resizeFromEdge({
  box,
  edge,
  pointer,
  scale,
  minScale = 0.02,
  maxScale = 20,
}: {
  box: HitBox["box"];
  edge: ResizeEdge;
  pointer: { x: number; y: number };
  scale: number;
  minScale?: number;
  maxScale?: number;
}): { scale: number; x: number; y: number } | null {
  if (!(scale > 0)) return null;
  const horizontal = edge === "left" || edge === "right";
  const anchor = {
    x: edge === "left" ? box.x1 : edge === "right" ? box.x0 : (box.x0 + box.x1) / 2,
    y: edge === "top" ? box.y1 : edge === "bottom" ? box.y0 : (box.y0 + box.y1) / 2,
  };
  const dragged = {
    x: edge === "left" ? box.x0 : edge === "right" ? box.x1 : (box.x0 + box.x1) / 2,
    y: edge === "top" ? box.y0 : edge === "bottom" ? box.y1 : (box.y0 + box.y1) / 2,
  };
  const base = horizontal ? Math.abs(anchor.x - dragged.x) : Math.abs(anchor.y - dragged.y);
  if (base < 1e-6) return null;
  const distance = horizontal ? Math.abs(pointer.x - anchor.x) : Math.abs(pointer.y - anchor.y);
  const nextScale = Math.round(clamp(scale * (distance / base), minScale, maxScale) * 1000) / 1000;
  const k = nextScale / scale;
  const center = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
  return {
    scale: nextScale,
    x: Math.round(anchor.x + (center.x - anchor.x) * k),
    y: Math.round(anchor.y + (center.y - anchor.y) * k),
  };
}

/** 显示着的构图参考线，拖动元素时吸附到它们 */
function visibleGuides(editor: EditorState | null) {
  return editor && !editor.guides.hidden ? editor.guides.items : [];
}

/** 设计稿之外只保留参考线与标尺的入口。 */
function PreviewSettings({ width, height }: { width: number; height: number }) {
  const editor = useStore((s) => s.editor);
  const box = useRef<HTMLDetailsElement>(null);
  const guides = editor?.guides;
  const setGuides = (patch: Partial<EditorState["guides"]>) =>
    guides && useStore.getState().updateEditor({ guides: { ...guides, ...patch } });
  useEffect(() => {
    const close = (event: Event) => {
      const el = box.current;
      if (!el?.open) return;
      if (
        event instanceof KeyboardEvent ? event.key === "Escape" : !el.contains(event.target as Node)
      )
        el.open = false;
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details
      className={editor?.rulers ? "preview-settings has-rulers" : "preview-settings"}
      ref={box}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !event.currentTarget.open) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }}
    >
      <summary
        className="icon-btn preview-settings-trigger"
        aria-label="参考线与标尺"
        title="参考线与标尺"
      >
        <Icon name="menu" />
      </summary>
      <div className="preview-settings-panel" role="menu" aria-label="参考线与标尺">
        <strong>参考线与标尺</strong>
        <button
          type="button"
          className="preview-settings-entry"
          role="menuitem"
          disabled={!editor}
          onClick={() => addGuide("h", width, height)}
        >
          添加水平参考线
        </button>
        <button
          type="button"
          className="preview-settings-entry"
          role="menuitem"
          disabled={!editor}
          onClick={() => addGuide("v", width, height)}
        >
          添加垂直参考线
        </button>
        <div className="preview-settings-divider" />
        <button
          type="button"
          className="preview-settings-entry"
          role="menuitemcheckbox"
          aria-checked={!!guides?.locked}
          disabled={!guides}
          onClick={() => setGuides({ locked: !guides?.locked })}
        >
          {guides?.locked ? "取消锁定参考线" : "锁定参考线"}
        </button>
        <button
          type="button"
          className="preview-settings-entry"
          role="menuitemcheckbox"
          aria-checked={!!guides && !guides.hidden}
          disabled={!guides}
          onClick={() => setGuides({ hidden: !guides?.hidden })}
        >
          {guides?.hidden ? "显示参考线" : "隐藏参考线"}
        </button>
        <button
          type="button"
          className="preview-settings-entry"
          role="menuitem"
          disabled={!guides?.items.length}
          onClick={() => setGuides({ items: [] })}
        >
          清除参考线
        </button>
        <div className="preview-settings-divider" />
        <button
          type="button"
          className="preview-settings-entry"
          role="menuitemcheckbox"
          aria-checked={!!editor?.rulers}
          disabled={!editor}
          onClick={() => useStore.getState().updateEditor({ rulers: !editor?.rulers })}
        >
          {editor?.rulers ? "隐藏标尺" : "显示标尺"}
          <kbd>Ctrl Alt R</kbd>
        </button>
      </div>
    </details>
  );
}
