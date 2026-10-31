import { Player, type PlayerRef } from "@remotion/player";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Main } from "../../composition/Main";
import { transformAt } from "../../core/animate";
import { compile } from "../../core/compile";
import { planTransform } from "../../core/edit";
import { applyOps, type Op } from "../../core/ops";
import { safeAreaFor } from "../../core/safe-area";
import type { Project } from "../../core/schema";
import { type HitBox, hitBoxes, pick } from "../lib/geometry";
import { type Corner, resizeFromCorner } from "../lib/pip";
import { findItem } from "../lib/project";
import { frameOfMs, msOfFrame, timecode } from "../lib/timeline";
import { useStore } from "../store";
import { Icon } from "./icons";
import { AccountGuides, LayoutPanel } from "./layout-editor";

const KIND: Record<HitBox["kind"], string> = {
  caption: "字幕",
  overlay: "标题",
  image: "图片",
  video: "画面",
};

type Drag = {
  mode: "move" | "resize";
  id: string;
  x0: number;
  y0: number;
  bx: number;
  by: number;
  /** 元素有关键帧时，播放头相对元素开始的毫秒数 */
  atMs: number | undefined;
  ops: Op[] | null;
  /** 拖角缩放：开始时的选中框（画布像素）、拖的角、当时的缩放 */
  corner?: Corner;
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
  const preview = useStore((s) => s.preview);
  const draft = useStore((s) => s.draft);
  const frame = useStore((s) => s.frame);
  const seekNonce = useStore((s) => s.seekNonce);
  const playing = useStore((s) => s.playing);
  const annotating = useStore((s) => s.annotating);
  const selected = useStore((s) => s.selected);
  const safeArea = useStore((s) => s.safeArea);
  const referenceGuides = useStore((s) => s.referenceGuides);
  const flash = useStore((s) => s.flash);
  const review = useStore((s) => s.review);
  const lint = useStore((s) => s.lint);
  const pin = useStore((s) => s.pin);
  const loadError = useStore((s) => s.loadError);
  const st = useStore.getState();

  const player = useRef<PlayerRef>(null);
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
  const scale = size.w && size.h ? Math.min(size.w / W, size.h / H) : 0;
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
      setAnnotationDraft({
        target: hit.id,
        point,
        atMs: msOfFrame(useStore.getState().frame, fps),
        left,
        top,
      });
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
      x0: p.x,
      y0: p.y,
      bx: now?.x ?? t?.x ?? W / 2,
      by: now?.y ?? t?.y ?? H / 2,
      atMs: now ? msOfFrame(local, fps) : undefined,
      ops: null,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  /** 从四个角开始缩放：对角固定，拖动中只更新本地预览，松手提交一次 */
  const startResize = (e: React.PointerEvent<HTMLButtonElement>, corner: Corner) => {
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
      x0: 0,
      y0: 0,
      bx: t.x,
      by: t.y,
      atMs,
      ops: null,
      corner,
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
      if (!d.box || !d.corner || d.scale0 === undefined) return;
      const r = resizeFromCorner({
        box: d.box,
        corner: d.corner,
        pointer: p,
        scale: d.scale0,
      });
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

  const onPointerUp = async () => {
    const d = drag.current;
    drag.current = null;
    if (d?.ops) await st.submit(d.ops);
    st.setDraft(null);
  };

  const dismissAnnotation = () => {
    setAnnotationDraft(null);
    setCommentText("");
    st.setPin(null);
  };

  const addAnnotation = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const draft = annotationDraft;
    const text = commentText.trim();
    if (!draft || !text || commentBusy) return;
    setCommentBusy(true);
    await st.addComment({ text, atMs: draft.atMs, target: draft.target, point: draft.point });
    setCommentBusy(false);
    setAnnotationDraft(null);
    setCommentText("");
  };

  const nowMs = msOfFrame(frame, fps);
  const pins = (review?.comments ?? []).filter(
    (c) =>
      c.status === "open" && c.point && c.atMs !== undefined && Math.abs(c.atMs - nowMs) < 1500,
  );
  const safe = project ? safeAreaFor(project.canvas.safeArea.preset, W, H) : null;
  const flashing = flash && Date.now() - flash.at < 2400 ? flash : null;
  const selectedHasIssue = selBox && (lint?.issues ?? []).some((issue) => issue.id === selBox.id);
  const hoverBox = hover && hover !== selected ? boxes.find((b) => b.id === hover) : undefined;

  const rect = (b: HitBox["box"]): React.CSSProperties => ({
    left: b.x0 * scale,
    top: b.y0 * scale,
    width: (b.x1 - b.x0) * scale,
    height: (b.y1 - b.y0) * scale,
  });

  return (
    <main className="stage panel" aria-label={name || "预览"}>
      <div className="stage-area" ref={area}>
        {inputProps && scale > 0 ? (
          <div className="canvas" style={{ width: W * scale, height: H * scale }}>
            <Player
              ref={player}
              component={Main}
              inputProps={inputProps}
              durationInFrames={total}
              compositionWidth={W}
              compositionHeight={H}
              fps={fps}
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
              onPointerUp={() => void onPointerUp()}
              onPointerLeave={() => setHover(null)}
            >
              {referenceGuides.horizontal && <div className="center-guide horizontal" />}
              {referenceGuides.vertical && <div className="center-guide vertical" />}
              <AccountGuides width={W} height={H} />
              {safeArea && safe && (
                <div
                  className="safe-area"
                  style={{
                    left: safe.left * scale,
                    top: safe.top * scale,
                    right: safe.right * scale,
                    bottom: safe.bottom * scale,
                  }}
                >
                  <span>
                    {project?.canvas.safeArea.preset === "all" ? "三平台安全区" : "安全区"}
                  </span>
                </div>
              )}
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
                    <div key={`${b.id}-${flashing.at}`} className="box flash" style={rect(b.box)} />
                  ))}
              {selBox && (selBox.kind !== "video" || !selBox.main) && (
                <div
                  className={[
                    "box selected",
                    selBox.locked ? "locked" : "",
                    // 贴着画面顶边时，标签放进框里，免得被裁掉
                    selBox.box.y0 * scale < 24 ? "tag-inside" : "",
                  ].join(" ")}
                  style={rect(selBox.box)}
                >
                  <span className="box-tag">
                    {selectedHasIssue && <Icon name="warn" size={11} className="box-warning" />}
                    {selBox.locked && <Icon name="lock" size={11} />}
                    {KIND[selBox.kind]} · {boxName(project, selBox.id)}
                  </span>
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
              onChange={(e) => setCommentText(e.target.value)}
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
      <PlayerFooter frame={frame} fps={fps} total={total} width={W} height={H} playing={playing} />
    </main>
  );
}

const RESIZE_HANDLES: { corner: Corner; className: string; label: string }[] = [
  { corner: "top-left", className: "nw", label: "左上" },
  { corner: "top-right", className: "ne", label: "右上" },
  { corner: "bottom-left", className: "sw", label: "左下" },
  { corner: "bottom-right", className: "se", label: "右下" },
];

/** 选中框四角的缩放手柄；对角固定，等比缩放 */
function ResizeHandles({
  onStart,
}: {
  onStart: (e: React.PointerEvent<HTMLButtonElement>, corner: Corner) => void;
}) {
  return (
    <>
      {RESIZE_HANDLES.map((h) => (
        <button
          key={h.corner}
          type="button"
          className={`box-handle ${h.className}`}
          aria-label={`拖角缩放（${h.label}）`}
          title="拖动缩放，对角固定"
          onPointerDown={(e) => onStart(e, h.corner)}
        />
      ))}
    </>
  );
}

function PlayerFooter({
  frame,
  fps,
  total,
  width,
  height,
  playing,
}: {
  frame: number;
  fps: number;
  total: number;
  width: number;
  height: number;
  playing: boolean;
}) {
  const st = useStore.getState();
  return (
    <footer className="player-footer" aria-label="播放器控制">
      <div className="player-time mono">
        {timecode(frame, fps)}
        <span className="timecode-total"> / {timecode(total, fps)}</span>
      </div>
      <div className="player-transport">
        <button
          type="button"
          className="icon-btn player-step"
          aria-label="上一帧（←）"
          title="上一帧（←）"
          onClick={() => st.seek(Math.max(0, frame - 1))}
        >
          <Icon name="prev" />
        </button>
        <button
          type="button"
          className="play-btn"
          aria-label={playing ? "暂停" : "播放"}
          title={playing ? "暂停（空格）" : "播放（空格）"}
          onClick={() => st.setPlaying(!playing)}
        >
          <Icon name={playing ? "pause" : "play"} size={14} />
        </button>
        <button
          type="button"
          className="icon-btn player-step"
          aria-label="下一帧（→）"
          title="下一帧（→）"
          onClick={() => st.seek(Math.min(total - 1, frame + 1))}
        >
          <Icon name="next" />
        </button>
      </div>
      <div className="player-status">
        <PreviewSettings />
        <span
          className="player-resolution mono"
          aria-label={`播放速度 1 倍，画布 ${width}×${height}`}
        >
          1× · {width}×{height}
        </span>
      </div>
    </footer>
  );
}

/** 选中框上的名字：字幕取前几个字，标题 / 卡片取文字，片段取素材文件名；都没有时用 ID */
function boxName(project: Project | null, id: string): string {
  const ref = project ? findItem(project, id) : null;
  if (!ref) return id;
  const short = (t: string) => ([...t].length > 10 ? `${[...t].slice(0, 10).join("")}…` : t);
  const it = ref.item as Record<string, unknown>;
  if (typeof it.text === "string") return short(it.text);
  const props = it.props as Record<string, unknown> | undefined;
  const lines = props?.lines ?? props?.text ?? props?.title;
  if (Array.isArray(lines)) return short(lines.join(" "));
  if (typeof lines === "string") return short(lines);
  if (typeof it.asset === "string")
    return short(project?.assets[it.asset]?.path.split("/").pop() ?? it.asset);
  return id;
}

function PreviewSettings() {
  const safeArea = useStore((s) => s.safeArea);
  const referenceGuides = useStore((s) => s.referenceGuides);
  const { toggleSafeArea, toggleReferenceGuide } = useStore.getState();
  const box = useRef<HTMLDetailsElement>(null);
  // 点菜单外面或按 Esc 收起（details 本身不会自己关）
  useEffect(() => {
    const close = (e: Event) => {
      const el = box.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node))
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
    <details className="preview-settings" ref={box}>
      <summary className="icon-btn preview-settings-trigger" aria-label="预览设置" title="预览设置">
        <Icon name="menu" />
      </summary>
      <div className="preview-settings-panel">
        <strong>参考线</strong>
        <label className="preview-setting">
          <input
            type="checkbox"
            aria-label="平台安全区"
            checked={safeArea}
            onChange={toggleSafeArea}
          />
          <span>平台安全区</span>
        </label>
        <label className="preview-setting">
          <input
            type="checkbox"
            aria-label="水平参考线"
            checked={referenceGuides.horizontal}
            onChange={() => toggleReferenceGuide("horizontal")}
          />
          <span>水平参考线</span>
        </label>
        <label className="preview-setting">
          <input
            type="checkbox"
            aria-label="垂直参考线"
            checked={referenceGuides.vertical}
            onChange={() => toggleReferenceGuide("vertical")}
          />
          <span>垂直参考线</span>
        </label>
        <LayoutPanel />
      </div>
    </details>
  );
}
