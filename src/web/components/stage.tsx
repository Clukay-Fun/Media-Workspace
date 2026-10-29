import { Player, type PlayerRef } from "@remotion/player";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Main } from "../../composition/Main";
import { compile } from "../../core/compile";
import { planTransform } from "../../core/edit";
import { applyOps, type Op } from "../../core/ops";
import { safeAreaFor } from "../../core/safe-area";
import { type HitBox, hitBoxes, pick } from "../lib/geometry";
import { findItem } from "../lib/project";
import { msOfFrame, timecode } from "../lib/timeline";
import { useStore } from "../store";
import { Icon } from "./icons";

const KIND: Record<HitBox["kind"], string> = {
  caption: "字幕",
  overlay: "标题",
  image: "图片",
  video: "画面",
};

type Drag = { id: string; x0: number; y0: number; bx: number; by: number; ops: Op[] | null };

export function Stage() {
  const project = useStore((s) => s.project);
  const preview = useStore((s) => s.preview);
  const draft = useStore((s) => s.draft);
  const frame = useStore((s) => s.frame);
  const seekNonce = useStore((s) => s.seekNonce);
  const playing = useStore((s) => s.playing);
  const selected = useStore((s) => s.selected);
  const safeArea = useStore((s) => s.safeArea);
  const flash = useStore((s) => s.flash);
  const review = useStore((s) => s.review);
  const pin = useStore((s) => s.pin);
  const loadError = useStore((s) => s.loadError);
  const st = useStore.getState();

  const player = useRef<PlayerRef>(null);
  const area = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);

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
    () => (timeline && preview ? hitBoxes(timeline, preview.styles, frame) : []),
    [timeline, preview, frame],
  );

  const toCanvas = (e: React.PointerEvent | React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!project || e.button !== 0) return;
    const p = toCanvas(e);
    const hit = pick(boxes, p.x, p.y);
    st.select(hit?.id ?? null);
    // 字幕的位置由样式决定；主轨铺满画面（z < 0），都不能拖
    if (!hit || hit.locked || hit.kind === "caption" || hit.z < 0) return;
    const ref = findItem(project, hit.id);
    const t = ref && "transform" in ref.item ? ref.item.transform : undefined;
    drag.current = {
      id: hit.id,
      x0: p.x,
      y0: p.y,
      bx: t?.x ?? W / 2,
      by: t?.y ?? H / 2,
      ops: null,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = toCanvas(e);
    const d = drag.current;
    if (!d || !project) {
      setHover(pick(boxes, p.x, p.y)?.id ?? null);
      return;
    }
    if (Math.hypot(p.x - d.x0, p.y - d.y0) < 3 / scale && !d.ops) return;
    try {
      // 按住 ⌘ 暂时关闭吸附（和时间线一致）
      const plan = planTransform(project, {
        id: d.id,
        transform: { x: d.bx + p.x - d.x0, y: d.by + p.y - d.y0 },
        snap: !e.metaKey,
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

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const p = toCanvas(e);
    st.setPin({ x: Math.round(p.x), y: Math.round(p.y) });
    st.focusComposer();
  };

  const nowMs = msOfFrame(frame, fps);
  const pins = (review?.comments ?? []).filter(
    (c) =>
      c.status === "open" && c.point && c.atMs !== undefined && Math.abs(c.atMs - nowMs) < 1500,
  );
  const safe = project ? safeAreaFor(project.canvas.safeArea.preset, W, H) : null;
  const flashing = flash && Date.now() - flash.at < 2400 ? flash : null;
  const selBox = boxes.find((b) => b.id === selected);
  const hoverBox = hover && hover !== selected ? boxes.find((b) => b.id === hover) : undefined;

  const rect = (b: HitBox["box"]): React.CSSProperties => ({
    left: b.x0 * scale,
    top: b.y0 * scale,
    width: (b.x1 - b.x0) * scale,
    height: (b.y1 - b.y0) * scale,
  });

  return (
    <main className="stage">
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
              className={drag.current ? "hit-layer dragging" : "hit-layer"}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => void onPointerUp()}
              onPointerLeave={() => setHover(null)}
              onDoubleClick={onDoubleClick}
            >
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
              {hoverBox && hoverBox.kind !== "video" && (
                <div className="box hover" style={rect(hoverBox.box)} />
              )}
              {flashing &&
                boxes
                  .filter((b) => flashing.ids.includes(b.id) && b.kind !== "video")
                  .map((b) => (
                    <div key={`${b.id}-${flashing.at}`} className="box flash" style={rect(b.box)} />
                  ))}
              {selBox && selBox.kind !== "video" && (
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
                    {selBox.locked && <Icon name="lock" size={11} />}
                    {KIND[selBox.kind]} · {selBox.id}
                  </span>
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
                    st.setPanelTab("comments");
                    if (c.target) st.select(c.target);
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
      </div>

      <div className="transport">
        <div className="transport-left">
          <button
            type="button"
            className={safeArea ? "chip on" : "chip"}
            onClick={st.toggleSafeArea}
            title="显示平台安全区"
          >
            <Icon name="safe" size={14} />
            安全区
          </button>
        </div>
        <div className="transport-center">
          <button
            type="button"
            className="icon-btn"
            aria-label="上一帧"
            onClick={() => st.seek(Math.max(0, frame - 1))}
          >
            <Icon name="prev" />
          </button>
          <button
            type="button"
            className="play-btn"
            aria-label={playing ? "暂停" : "播放"}
            onClick={() => st.setPlaying(!playing)}
          >
            <Icon name={playing ? "pause" : "play"} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="下一帧"
            onClick={() => st.seek(Math.min(total - 1, frame + 1))}
          >
            <Icon name="next" />
          </button>
        </div>
        <div className="transport-right">
          <span className="timecode">
            {timecode(frame, fps)}
            <span className="timecode-total"> / {timecode(total, fps)}</span>
          </span>
        </div>
      </div>
    </main>
  );
}
