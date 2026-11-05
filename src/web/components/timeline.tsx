import type React from "react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EditorState } from "../../core/api";
import {
  type DragMode,
  nudgeDeltaMs,
  planDrag,
  planTrackMove,
  trackInsertFloor,
} from "../../core/edit";
import type { Op } from "../../core/ops";
import type { Project, Track } from "../../core/schema";
import { frameToMs, sourceFrameAt } from "../../core/time";
import { aiChanges } from "../lib/changes";
import { keyframeMarkerPositions } from "../lib/keyframes";
import { findItem, type ItemRef, kindLabel } from "../lib/project";
import { clampPlayheadFrame } from "../lib/seek";
import {
  type Block,
  filmstripTiles,
  frameOfMs,
  itemFrames,
  msOfFrame,
  type Row,
  rulerLabel,
  type TrackRowBox,
  tickStep,
  timecode,
  timelineRows,
  trackInsertIndex,
  waveform,
} from "../lib/timeline";
import { type TransitionCut, transitionCutMarkers, transitionPairFor } from "../lib/transitions";
import { useStore } from "../store";
import { Icon, type IconName } from "./icons";
import { TransitionEditor } from "./transition-editor";

/** 轨道头宽度：图标、按用途起的名字、锁定 / 隐藏按钮 */
const HEAD = 150;
/** .tl-grid 的右内边距 */
const GUTTER = 12;

const ROW_ICON: Record<Row["kind"], IconName> = {
  main: "film",
  video: "image",
  caption: "text",
  overlay: "title",
  audio: "volume",
};

export function Timeline() {
  const project = useStore((s) => s.project);
  const name = useStore((s) => s.name);
  const api = useStore((s) => s.api);
  const preview = useStore((s) => s.preview);
  const frame = useStore((s) => s.frame);
  const selected = useStore((s) => s.selected);
  const review = useStore((s) => s.review);
  const lint = useStore((s) => s.lint);
  const flash = useStore((s) => s.flash);
  const peaks = useStore((s) => s.peaks);
  const { seek, select } = useStore.getState();
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [menu, setMenu] = useState<BlockMenu | null>(null);
  const [zoomPps, setZoomPps] = useState<number | null>(null);
  const [openTransitionId, setOpenTransitionId] = useState<string | null>(null);
  const [openMarkerCluster, setOpenMarkerCluster] = useState<string | null>(null);
  const [trackDrop, setTrackDrop] = useState<{ id: string; top: number } | null>(null);
  const history = useStore((s) => s.history);
  const reviewedRev = useStore((s) => s.reviewedRev);
  const dragSession = useRef<DragSession | null>(null);
  const editorRef = useRef<EditorState | null>(null);
  const zoomTouched = useRef(false);
  const zoomPpsRef = useRef<number | null>(null);
  const zoomWheelAction = useRef<(event: WheelEvent) => void>(() => {});

  // 量整个时间线区域（数据没到之前也在），轨道区宽度 = 总宽 − 轨道头 − 右边距
  const root = useRef<HTMLElement>(null);
  const [rootW, setRootW] = useState(0);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setRootW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => zoomWheelAction.current(event);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  // 捕获阶段先于页面的播放头快捷键。没选中时不拦截，方向键仍然移动播放头。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable='true']")
      )
        return;
      const { project, selected, preview, submit, toast, cropEditing } = useStore.getState();
      if (!project || !selected || !preview || cropEditing) return;
      const found = project.tracks.find((track) =>
        track.items.some((item) => item.id === selected),
      );
      if (!found) return;
      const item = found.items.find((it) => it.id === selected);
      event.preventDefault();
      event.stopImmediatePropagation();
      if (found.kind === "video" && found.main && item && "type" in item && item.type === "clip") {
        toast("主视频片段的位置跟着上一段");
        return;
      }
      const fps = preview.timeline.fps;
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      try {
        const plan = planDrag(project, {
          id: selected,
          mode: "move",
          deltaMs: nudgeDeltaMs(fps, event.shiftKey, direction),
          snap: false,
        });
        const range = itemFrames(preview.timeline, selected);
        const current = range ? msOfFrame(range.from, fps) : plan.preview.startMs;
        if (plan.ops.length === 0 || Math.abs(plan.preview.startMs - current) < 0.5) return;
        void submit(plan.ops, "微调了出现时间");
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  useEffect(
    () => () => {
      const session = dragSession.current;
      if (!session) return;
      session.controller.abort();
      if (session.target.hasPointerCapture(session.pointerId)) {
        session.target.releasePointerCapture(session.pointerId);
      }
    },
    [],
  );
  const viewportWidth = Math.max(0, rootW - HEAD - GUTTER);

  const tl = preview?.timeline;
  const fps = tl?.fps ?? 30;
  const total = Math.max(1, tl?.durationInFrames ?? 1);
  useEffect(() => {
    if (!tl) return;
    const current = useStore.getState().frame;
    const clamped = clampPlayheadFrame(current, total);
    if (clamped !== current) seek(clamped);
  }, [tl, total, seek]);
  const transitionCuts = useMemo(() => (tl ? transitionCutMarkers(tl.videos) : []), [tl]);
  const fitPps = viewportWidth > 0 ? (viewportWidth * fps) / total : 40;
  const pps = zoomPps ?? fitPps;
  const timelineWidth = Math.max(1, (total / fps) * pps);
  const minPps = Math.min(fitPps, Math.max(0.02, Math.min(8, fitPps * 0.2)));
  const maxPps = Math.max(320, fitPps * 6);
  const px = (f: number) => (f / fps) * pps;
  const rows = useMemo(() => (project && tl ? timelineRows(project, tl) : []), [project, tl]);

  useEffect(() => {
    zoomTouched.current = false;
    zoomPpsRef.current = null;
    editorRef.current = null;
    setZoomPps(null);
    if (!name) return;
    let cancelled = false;
    void api
      .editor()
      .then(({ editor }) => {
        if (cancelled) return;
        editorRef.current = editor;
        // 80px/s 是旧版 editor.json 的默认值，首次打开继续适配视口。
        if (!zoomTouched.current && editor.timeline.pxPerSecond !== 80) {
          const storedPps = Math.min(640, editor.timeline.pxPerSecond);
          zoomPpsRef.current = storedPps;
          setZoomPps(storedPps);
          requestAnimationFrame(() => {
            if (root.current && editor.timeline.scrollMs > 0) {
              root.current.scrollLeft = (editor.timeline.scrollMs * storedPps) / 1000;
            }
          });
        } else if (zoomTouched.current && zoomPpsRef.current !== null) {
          const next = {
            ...editor,
            timeline: { ...editor.timeline, pxPerSecond: zoomPpsRef.current },
          };
          editorRef.current = next;
          useStore.getState().updateEditor({ timeline: next.timeline });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api, name]);

  if (!project || !tl) return <section className="timeline panel" ref={root} />;
  const aiBands = aiChanges(history, reviewedRev)
    .pending.flatMap((e) => e.changed)
    .filter((id, i, a) => a.indexOf(id) === i)
    .flatMap((id) => {
      const r = itemFrames(tl, id);
      return r ? [{ id, ...r }] : [];
    });

  const totalSeconds = total / fps;
  let step = tickStep(pps);
  while (totalSeconds / step > 500) step *= 2;
  const subdivisions = Math.ceil(totalSeconds / (step / 4));
  const ticks: { frame: number; kind: string; label: string | null }[] = [];
  for (let index = 0; index <= subdivisions; index += 1) {
    const seconds = index * (step / 4);
    if (seconds > totalSeconds) break;
    const frame = Math.min(total - 1, Math.round(seconds * fps));
    if (ticks.at(-1)?.frame === frame) continue;
    const kind = index % 4 === 0 ? "major" : index % 2 === 0 ? "mid" : "minor";
    ticks.push({
      frame,
      kind,
      label: kind === "major" ? rulerLabel(frame, fps, step) : null,
    });
  }

  // 只存时间线这一段，参考线等其他设置由预览区写（同一个 editor.json）
  const scheduleEditorSave = (next: EditorState) => {
    editorRef.current = next;
    useStore.getState().updateEditor({ timeline: next.timeline });
  };

  const frameAt = (clientX: number) => {
    const r = root.current?.getBoundingClientRect();
    if (!r || pps <= 0) return 0;
    const contentX = clientX - r.left - HEAD + (root.current?.scrollLeft ?? 0);
    return Math.max(0, Math.min(total - 1, (contentX / pps) * fps));
  };
  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    seek(frameAt(e.clientX));
  };
  const dragPlayhead = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    seekPlayhead(e.clientX);
  };
  const movePlayhead = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons === 1) seekPlayhead(e.clientX);
  };

  const seekPlayhead = (clientX: number) => {
    const frame = frameAt(clientX);
    const intervalFrames = step * fps;
    const nearest = Math.min(total - 1, Math.round(frame / intervalFrames) * intervalFrames);
    const snapped = Math.abs(px(frame) - px(nearest)) <= 5;
    seek(snapped ? nearest : frame);
  };

  const zoomTo = (requestedPps: number, anchorClientX?: number) => {
    const element = root.current;
    if (!element) return;
    const nextPps = Math.max(minPps, Math.min(maxPps, requestedPps));
    const bounds = element.getBoundingClientRect();
    const anchorX =
      anchorClientX === undefined
        ? Math.max(HEAD, Math.min(bounds.width, HEAD + px(frame) - element.scrollLeft))
        : Math.max(HEAD, Math.min(bounds.width, anchorClientX - bounds.left));
    const contentX = element.scrollLeft + anchorX - HEAD;
    const nextScroll = Math.max(0, HEAD + contentX * (nextPps / pps) - anchorX);
    zoomTouched.current = true;
    zoomPpsRef.current = nextPps;
    setZoomPps(nextPps);
    requestAnimationFrame(() => {
      const current = root.current;
      if (!current) return;
      current.scrollLeft = nextScroll;
      const existing = editorRef.current;
      if (existing) {
        scheduleEditorSave({
          ...existing,
          timeline: {
            ...existing.timeline,
            pxPerSecond: nextPps,
            scrollMs: (current.scrollLeft / nextPps) * 1000,
          },
        });
      }
    });
  };

  zoomWheelAction.current = (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomTo(pps * Math.exp(-e.deltaY * 0.0015), e.clientX);
  };

  const onTimelineScroll = () => {
    setMenu(null);
    const current = root.current;
    const existing = editorRef.current;
    if (!current || !existing || pps <= 0) return;
    scheduleEditorSave({
      ...existing,
      timeline: {
        ...existing.timeline,
        pxPerSecond: pps,
        scrollMs: (current.scrollLeft / pps) * 1000,
      },
    });
  };

  const flashing = flash && Date.now() - flash.at < 2400 ? flash : null;
  const markers = [
    ...(review?.comments ?? [])
      .filter((c) => c.status === "open" && c.atMs !== undefined)
      .map((c) => ({
        key: c.id,
        kind: "comment" as const,
        frame: frameOfMs(c.atMs ?? 0, fps),
        title: c.text,
        target: c.target,
      })),
    ...(lint?.issues ?? [])
      .filter((i) => i.level !== "hint")
      .map((i, n) => ({
        key: `lint-${n}`,
        kind: "lint" as const,
        frame: frameOfMs(i.atMs, fps),
        title: i.message,
        target: i.id,
      })),
  ];
  const markerClusters: { id: string; frame: number; items: typeof markers }[] = [];
  for (const marker of [...markers].sort((a, b) => a.frame - b.frame)) {
    const last = markerClusters.at(-1);
    if (last && px(marker.frame) - px(last.items.at(-1)?.frame ?? last.frame) <= 24) {
      last.items.push(marker);
      last.frame = Math.round(
        last.items.reduce((sum, item) => sum + item.frame, 0) / last.items.length,
      );
    } else markerClusters.push({ id: marker.key, frame: marker.frame, items: [marker] });
  }

  /** 拖块：位移换算成毫秒交给 core 的 planDrag（吸附、主轨磁吸都在那里），松开时提交一次 */
  const startDrag = (e: React.PointerEvent, b: Block, mode: DragMode) => {
    const x0 = e.clientX;
    const target = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    const controller = new AbortController();
    const previous = dragSession.current;
    if (previous) {
      previous.controller.abort();
      if (previous.target.hasPointerCapture(previous.pointerId)) {
        previous.target.releasePointerCapture(previous.pointerId);
      }
      dragSession.current = null;
      setGhost(null);
    }
    target.setPointerCapture(pointerId);
    let plan: ReturnType<typeof planDrag> | null = null;
    let moved = false;
    let finished = false;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId || finished) return;
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      const s = useStore.getState();
      if (!s.project) return;
      try {
        plan = planDrag(s.project, {
          id: b.id,
          mode,
          deltaMs: msOfFrame((dx / timelineWidth) * total, fps),
          dropMs: msOfFrame(frameAt(ev.clientX), fps),
          snap: s.snap && !ev.metaKey,
          playheadMs: msOfFrame(s.frame, fps),
        });
        const from = frameOfMs(plan.preview.startMs, fps);
        // 移动时宽度锁住抓起来的那一块，避免取整或相邻字幕把块挤窄
        const to = mode === "move" ? from + (b.to - b.from) : frameOfMs(plan.preview.endMs, fps);
        setGhost({
          id: b.id,
          key: b.key,
          from,
          to,
          snapAt: plan.snappedTo ? frameOfMs(plan.snappedTo.at, fps) : null,
        });
      } catch {
        // 再往前会离开素材：停在上一个合法位置，松手时提交它
      }
    };
    const finish = (commit: boolean) => {
      if (finished) return;
      finished = true;
      controller.abort();
      target.removeEventListener("lostpointercapture", onLostPointerCapture);
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      if (dragSession.current?.controller === controller) dragSession.current = null;
      setGhost(null);
      if (commit && moved && plan?.ops.length) {
        const label = mode === "move" ? `移动了 ${b.id}` : `调整了 ${b.id} 的长度`;
        void useStore.getState().submit(plan.ops, label);
      }
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) finish(true);
    };
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) finish(false);
    };
    const onLostPointerCapture = () => finish(false);
    dragSession.current = { target, pointerId, controller };
    window.addEventListener("pointermove", move, { capture: true, signal: controller.signal });
    window.addEventListener("pointerup", up, { capture: true, signal: controller.signal });
    window.addEventListener("pointercancel", cancel, {
      capture: true,
      signal: controller.signal,
    });
    target.addEventListener("lostpointercapture", onLostPointerCapture, {
      once: true,
      signal: controller.signal,
    });
  };

  const openBlockMenu = (e: React.MouseEvent, b: Block) => {
    if (b.kind !== "outro") select(b.id);
    const width = 280;
    const height = 220;
    const pad = 8;
    setMenu({
      id: b.id,
      x: Math.max(pad, Math.min(e.clientX, window.innerWidth - width - pad)),
      y: Math.max(pad, Math.min(e.clientY, window.innerHeight - height - pad)),
    });
  };

  return (
    <section className="timeline panel" ref={root} onScroll={onTimelineScroll}>
      <Toolbar
        zoomPercent={Math.round((pps / fitPps) * 100)}
        canZoomOut={pps > minPps + 0.001}
        canZoomIn={pps < maxPps - 0.001}
        onZoomOut={() => zoomTo(pps / 1.2)}
        onZoomIn={() => zoomTo(pps * 1.2)}
        onZoomFit={() => zoomTo(fitPps)}
      />
      <div
        className="tl-grid"
        style={{
          gridTemplateColumns: `${HEAD}px ${timelineWidth}px`,
          width: `${HEAD + timelineWidth + 8}px`,
        }}
      >
        <div className="tl-corner" />
        <div
          className="tl-ruler"
          onPointerDown={scrub}
          onPointerMove={(e) => e.buttons === 1 && seek(frameAt(e.clientX))}
        >
          {ticks.map((tick) => (
            <Fragment key={tick.frame}>
              <span className={`ruler-mark ${tick.kind}`} style={{ left: px(tick.frame) }} />
              {tick.label && (
                <span className="tick" style={{ left: px(tick.frame) }}>
                  {tick.label}
                </span>
              )}
            </Fragment>
          ))}
        </div>

        <div className="tl-head marker-head">
          <span className="row-label">
            <Icon name="comment" size={13} />
            批注 · 质检
          </span>
        </div>
        <div className="tl-lane markers" onPointerDown={scrub}>
          {markerClusters.map((cluster) => (
            <div
              key={cluster.id}
              className="marker-cluster-wrap"
              style={{ left: px(cluster.frame) }}
            >
              <button
                type="button"
                className={`marker marker-cluster ${cluster.items.length > 1 ? "clustered" : cluster.items[0]!.kind}`}
                title={
                  cluster.items.length > 1
                    ? `${cluster.items.length} 条批注/质检，点击查看`
                    : cluster.items[0]!.title
                }
                aria-label={
                  cluster.items.length > 1
                    ? `${cluster.items.length} 条批注或质检`
                    : cluster.items[0]!.title
                }
                aria-expanded={openMarkerCluster === cluster.id}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  if (cluster.items.length > 1) {
                    setOpenMarkerCluster((current) => (current === cluster.id ? null : cluster.id));
                    return;
                  }
                  if (cluster.items[0]!.target) select(cluster.items[0]!.target);
                  seek(cluster.items[0]!.frame);
                }}
              >
                {cluster.items.length > 1 ? (
                  <span>{cluster.items.length}</span>
                ) : (
                  <Icon
                    name={cluster.items[0]!.kind === "comment" ? "comment" : "warn"}
                    size={11}
                  />
                )}
              </button>
              {openMarkerCluster === cluster.id && cluster.items.length > 1 && (
                <span className="marker-cluster-list" role="menu">
                  {cluster.items.map((item) => (
                    <span key={item.key} role="menuitem">
                      <span className="mono">{timecode(item.frame, fps)}</span>
                      <span>{item.title}</span>
                      <button
                        type="button"
                        className="marker-cluster-jump"
                        onClick={() => {
                          if (item.target) select(item.target);
                          seek(item.frame);
                          setOpenMarkerCluster(null);
                        }}
                      >
                        定位
                      </button>
                    </span>
                  ))}
                </span>
              )}
            </div>
          ))}
        </div>

        {aiBands.length > 0 && (
          <>
            <div className="tl-head ai-head">
              <span className="row-label">
                <Icon name="spark" size={13} />
                AI 改动
              </span>
            </div>
            <div className="tl-lane ai-lane" onPointerDown={scrub}>
              {aiBands.map((b) => (
                <button
                  type="button"
                  key={b.id}
                  className="ai-band"
                  style={{ left: px(b.from), width: Math.max(4, px(b.to) - px(b.from)) }}
                  title={`${b.id}：AI 改过，等你确认`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    select(b.id, { reveal: false });
                    seek(b.from);
                    useStore.getState().setSideTab("changes");
                  }}
                />
              ))}
            </div>
          </>
        )}

        {trackDrop && <div className="tl-drop" style={{ top: trackDrop.top }} />}
        {rows.map((row) => (
          <RowView
            key={row.track.id}
            row={row}
            project={project}
            px={px}
            fps={fps}
            selected={selected}
            flashIds={flashing?.ids ?? []}
            flashAt={flashing?.at ?? 0}
            peaks={peaks}
            videoSrcs={preview?.srcs ?? {}}
            onScrub={scrub}
            ghost={ghost}
            onDragStart={startDrag}
            onContextMenu={openBlockMenu}
            trackDragging={trackDrop?.id === row.track.id}
            onTrackPlace={setTrackDrop}
            transitionCuts={row.kind === "main" ? transitionCuts : []}
            openTransitionId={openTransitionId}
            setOpenTransitionId={setOpenTransitionId}
          />
        ))}
      </div>
      {viewportWidth > 0 && (
        <>
          <div className="playhead" style={{ left: HEAD + px(frame) }} aria-hidden="true" />
          <div
            className="playhead-grip"
            role="slider"
            aria-label="播放头"
            aria-valuemin={0}
            aria-valuemax={total - 1}
            aria-valuenow={frame}
            tabIndex={0}
            style={{ left: HEAD + px(frame) }}
            onPointerDown={dragPlayhead}
            onPointerMove={movePlayhead}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                e.stopPropagation();
                seek(Math.max(0, Math.min(total - 1, frame + (e.key === "ArrowLeft" ? -1 : 1))));
              }
            }}
          />
        </>
      )}
      {ghost?.snapAt != null && (
        <div className="snap-line" style={{ left: HEAD + px(ghost.snapAt) }} />
      )}
      {menu && <BlockMenuView menu={menu} onClose={() => setMenu(null)} />}
    </section>
  );
}

const ADD_TRACKS: { label: string; kind: Track["kind"]; name: string }[] = [
  { label: "画中画", kind: "video", name: "画中画" },
  { label: "图片", kind: "video", name: "图片" },
  { label: "标题", kind: "overlay", name: "标题" },
  { label: "字幕", kind: "caption", name: "字幕" },
  { label: "音频", kind: "audio", name: "音频" },
];

/** 先选类型，再在最上层加一条空轨道 */
function AddTrack() {
  const root = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && root.current?.contains(target)) return;
      setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  return (
    <>
      <div className="tl-add-toolbar" ref={root}>
        <button
          type="button"
          className="tl-add-btn"
          aria-label="新增轨道"
          aria-expanded={menu !== null}
          title="新增一条空轨道"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setMenu((cur) => (cur ? null : { x: rect.left, y: rect.top }));
          }}
        >
          <Icon name="add" size={14} />
        </button>
      </div>
      {menu &&
        createPortal(
          <div
            className="tl-add-menu"
            role="menu"
            style={{ left: menu.x, top: menu.y }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {ADD_TRACKS.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  void useStore
                    .getState()
                    .submit(
                      [{ op: "track.add", track: { kind: item.kind, name: item.name, items: [] } }],
                      `新增了${item.label}轨道`,
                    );
                }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

function measureTrackRows(tracks: { id: string }[]): TrackRowBox[] {
  return [...document.querySelectorAll<HTMLElement>(".tl-head[data-track]")].flatMap((el) => {
    const id = el.dataset.track ?? "";
    const index = tracks.findIndex((item) => item.id === id);
    if (index < 0) return [];
    const rect = el.getBoundingClientRect();
    return [{ id, top: rect.top, height: rect.height, index }];
  });
}

function RowView({
  row,
  project,
  px,
  fps,
  selected,
  flashIds,
  flashAt,
  peaks,
  videoSrcs,
  onScrub,
  ghost,
  onDragStart,
  onContextMenu,
  trackDragging,
  onTrackPlace,
  transitionCuts,
  openTransitionId,
  setOpenTransitionId,
}: {
  row: Row;
  project: Project;
  px: (f: number) => number;
  fps: number;
  selected: string | null;
  flashIds: string[];
  flashAt: number;
  peaks: Record<string, { msPerPeak: number; peaks: number[] } | null>;
  videoSrcs: Record<string, string>;
  onScrub: (e: React.PointerEvent<HTMLDivElement>) => void;
  ghost: Ghost | null;
  onDragStart: (e: React.PointerEvent, b: Block, mode: DragMode) => void;
  onContextMenu: (e: React.MouseEvent, b: Block) => void;
  trackDragging: boolean;
  onTrackPlace: (drop: { id: string; top: number } | null) => void;
  transitionCuts: TransitionCut[];
  openTransitionId: string | null;
  setOpenTransitionId: (id: string | null) => void;
}) {
  const { track } = row;
  const hasVideo = row.blocks.some((b) => b.kind === "clip" && b.mediaKind === "video");
  const { submit, select, seek } = useStore.getState();
  const toggle = (key: "locked" | "hidden" | "muted", label: string) =>
    void submit([{ op: "track.update", id: track.id, set: { [key]: !track[key] } }], label);
  const audible = track.kind === "video" || track.kind === "audio";
  const canDrag = row.kind !== "main" && !track.locked;
  const headTitle =
    row.kind === "main"
      ? "主视频固定在最下面"
      : track.locked
        ? "轨道已锁定"
        : `${track.name ?? row.label}，拖动调整层级`;

  const startTrackDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !canDrag) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const place = (clientY: number) => {
      const hit = trackInsertIndex(
        measureTrackRows(project.tracks),
        track.id,
        clientY,
        trackInsertFloor(project, track.id),
      );
      if (!hit) {
        onTrackPlace(null);
        return null;
      }
      const grid = handle.closest(".tl-grid");
      const top = grid ? hit.line - grid.getBoundingClientRect().top : 0;
      onTrackPlace({ id: track.id, top });
      return hit;
    };
    const move = (ev: PointerEvent) => {
      place(ev.clientY);
    };
    const finish = (ev: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      if (ev.type === "pointercancel") {
        onTrackPlace(null);
        return;
      }
      const hit = place(ev.clientY);
      onTrackPlace(null);
      if (!hit) return;
      try {
        const plan = planTrackMove(project, { id: track.id, index: hit.index });
        if (plan.ops.length > 0) void submit(plan.ops, "调整了轨道层级");
      } catch (err) {
        useStore.getState().toast(err instanceof Error ? err.message : String(err), "error");
      }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.setPointerCapture(event.pointerId);
  };

  return (
    <>
      <div
        className={["tl-head", track.hidden ? "is-hidden" : "", trackDragging ? "is-dragging" : ""]
          .filter(Boolean)
          .join(" ")}
        data-track={track.id}
      >
        <span
          className={`row-label row-${row.kind}${canDrag ? " can-drag" : ""}`}
          title={headTitle}
          onPointerDown={canDrag ? startTrackDrag : undefined}
        >
          <Icon name={ROW_ICON[row.kind]} size={13} />
          {row.label}
        </span>
        <span className="row-tools">
          <TrackToggle
            on={track.locked}
            icon={track.locked ? "lock" : "unlock"}
            label={track.locked ? "解锁轨道" : "锁定轨道（AI 也不能改）"}
            onClick={() =>
              toggle("locked", track.locked ? "已解锁轨道" : "已锁定轨道，AI 也不能改动它")
            }
          />
          <TrackToggle
            on={track.hidden}
            icon={track.hidden ? "eyeOff" : "eye"}
            label={track.hidden ? "显示轨道" : "隐藏轨道"}
            onClick={() => toggle("hidden", track.hidden ? "已显示轨道" : "已隐藏轨道")}
          />
          {audible && (
            <TrackToggle
              on={track.muted}
              icon={track.muted ? "mute" : "volume"}
              label={track.muted ? "取消静音" : "静音"}
              onClick={() => toggle("muted", track.muted ? "已取消静音" : "已静音")}
            />
          )}
        </span>
      </div>
      <div
        className={[
          "tl-lane",
          row.kind,
          hasVideo ? "media-video" : "",
          track.locked ? "locked" : "",
          track.hidden ? "is-hidden" : "",
        ].join(" ")}
        onPointerDown={onScrub}
      >
        {row.blocks.map((b) => {
          const g = ghost?.key === b.key ? ghost : null;
          const from = g ? g.from : b.from;
          const to = g ? g.to : b.to;
          return (
            <Fragment key={b.key}>
              <BlockView
                block={b}
                left={px(from)}
                width={Math.max(2, px(to) - px(from))}
                dragging={g !== null}
                editable={!track.locked && b.kind !== "outro"}
                onDragStart={(e, mode) => onDragStart(e, b, mode)}
                onContextMenu={(e) => onContextMenu(e, b)}
                fps={fps}
                selected={selected === b.id}
                flash={flashIds.includes(b.id) ? flashAt : 0}
                peaks={b.asset ? (peaks[b.asset] ?? null) : null}
                videoSrc={b.mediaKind === "video" && b.asset ? videoSrcs[b.asset] : undefined}
                onSelect={() => {
                  if (b.kind === "outro") return;
                  select(b.id);
                }}
                track={track}
              />
              {keyframeMarkerPositions(b.keyframeFrames ?? [], b.to - b.from).map((marker) => {
                const markerFrame = from + marker.frame;
                return (
                  <button
                    type="button"
                    className="keyframe-marker"
                    key={marker.frame}
                    style={{ left: px(markerFrame) }}
                    title={"关键帧 " + timecode(markerFrame, fps)}
                    aria-label={"跳到关键帧 " + timecode(markerFrame, fps)}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      select(b.id);
                      seek(markerFrame);
                    }}
                  />
                );
              })}
            </Fragment>
          );
        })}
        {row.kind === "main" &&
          transitionCuts.map((cut) => {
            const pair = transitionPairFor(project, cut.incomingId);
            if (!pair) return null;
            return (
              <TransitionEditor
                key={`transition-${cut.incomingId}`}
                pair={pair}
                locked={track.locked}
                variant="timeline"
                left={px(cut.frame)}
                open={openTransitionId === cut.incomingId}
                onOpenChange={(open) => setOpenTransitionId(open ? cut.incomingId : null)}
                onOpen={() => {
                  select(cut.incomingId);
                  seek(cut.frame);
                }}
              />
            );
          })}
      </div>
    </>
  );
}

function TrackToggle({
  on,
  icon,
  label,
  onClick,
}: {
  on: boolean;
  icon: "lock" | "unlock" | "eye" | "eyeOff" | "volume" | "mute";
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={on ? "track-toggle on" : "track-toggle"}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon name={icon} size={13} />
    </button>
  );
}

function BlockView({
  block,
  left,
  width,
  fps,
  selected,
  flash,
  peaks,
  videoSrc,
  onSelect,
  dragging,
  editable,
  onDragStart,
  onContextMenu,
}: {
  block: Block;
  left: number;
  width: number;
  fps: number;
  selected: boolean;
  flash: number;
  peaks: { msPerPeak: number; peaks: number[] } | null;
  videoSrc?: string;
  onSelect: () => void;
  track: Track;
  dragging: boolean;
  editable: boolean;
  onDragStart: (e: React.PointerEvent, mode: DragMode) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const columns = Math.floor(width / 3);
  const videoClip = block.kind === "clip" && block.mediaKind === "video";
  const wave = useMemo(
    () =>
      peaks && block.kind === "clip" && (block.mediaKind === "audio" || block.mediaKind === "video")
        ? waveform(block, peaks, fps, columns)
        : null,
    [peaks, block, fps, columns],
  );
  const speedText = videoClip ? formatSpeed(block.speed) : null;
  return (
    <button
      type="button"
      className={[
        "block",
        block.kind,
        block.mediaKind ?? "",
        selected ? "selected" : "",
        dragging ? "dragging" : "",
        editable ? "editable" : "",
      ].join(" ")}
      style={{ left, width }}
      title={block.label}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.button !== 0 || !editable) return;
        // 两端 6px 内是裁剪，中间是移动
        const r = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - r.left;
        const edge = Math.min(6, r.width / 4);
        onDragStart(e, x < edge ? "trimStart" : x > r.width - edge ? "trimEnd" : "move");
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e);
      }}
      onClick={onSelect}
    >
      {editable && selected && (
        <>
          <span className="handle start" aria-hidden="true" />
          <span className="handle end" aria-hidden="true" />
        </>
      )}
      {block.cut && (
        <span className="cut-tag" title={`前面剪掉了：${block.cut}`}>
          {block.cut}
        </span>
      )}
      {videoClip ? (
        <>
          <span className="block-namebar">
            <span className="block-name">{block.label}</span>
            {speedText ? <span className="block-speed">{speedText}</span> : null}
          </span>
          <span className="block-picture">
            {videoSrc && (
              <VideoFilmstrip
                src={videoSrc}
                block={block}
                fps={fps}
                bandWidth={Math.max(1, width)}
              />
            )}
          </span>
          <span className="block-waveband">
            {wave && (
              <svg
                className="wave"
                viewBox={`0 0 ${Math.max(columns, 1) * 3} 100`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {wave.map((v, i) => (
                  <rect key={i} x={i * 3} width={2} y={50 - v * 46} height={Math.max(1, v * 92)} />
                ))}
              </svg>
            )}
          </span>
        </>
      ) : (
        <>
          {wave && (
            <svg
              className="wave"
              viewBox={`0 0 ${columns * 3} 100`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {wave.map((v, i) => (
                <rect key={i} x={i * 3} width={2} y={50 - v * 46} height={Math.max(1, v * 92)} />
              ))}
            </svg>
          )}
          <span className="block-label">
            <span className="block-name">{block.label}</span>
          </span>
        </>
      )}
      {flash > 0 && <span key={flash} className="block-flash" aria-hidden="true" />}
    </button>
  );
}

/** 画面带取样高度。显示时按格子比例缩放，不另拉宽高。 */
const PICTURE_BAND = 40;

function VideoFilmstrip({
  src,
  block,
  fps,
  bandWidth,
}: {
  src: string;
  block: Block;
  fps: number;
  bandWidth: number;
}) {
  const [strip, setStrip] = useState<string | null>(null);

  useEffect(() => {
    setStrip(null);
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingQuality = "medium";

    const frames = Math.max(1, block.to - block.from);
    const trim = block.trimBeforeFrames ?? 0;
    const speed = block.speed ?? 1;
    let tiles = filmstripTiles(bandWidth, PICTURE_BAND, 16 / 9, frames);
    let sampleTimes: number[] = [];
    const layout = () => {
      const aspect =
        video.videoWidth > 0 && video.videoHeight > 0
          ? video.videoWidth / video.videoHeight
          : 16 / 9;
      tiles = filmstripTiles(bandWidth, PICTURE_BAND, aspect, frames);
      canvas.width = tiles.tileWidth * tiles.count;
      canvas.height = tiles.tileHeight;
      sampleTimes = Array.from({ length: tiles.count }, (_, index) => {
        const offset = Math.min(frames - 1, Math.floor(((index + 0.5) / tiles.count) * frames));
        return frameToMs(sourceFrameAt(trim, speed, offset), fps) / 1000;
      });
    };
    let stopped = false;
    let index = 0;
    let pendingSeek: (() => void) | null = null;

    const drawFrame = () => {
      if (stopped) return;
      const { tileWidth, tileHeight, count } = tiles;
      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;
      if (sourceWidth > 0 && sourceHeight > 0) {
        // 整帧放进格子，比例不对时留白，不裁掉人物
        const scale = Math.min(tileWidth / sourceWidth, tileHeight / sourceHeight);
        const drawWidth = sourceWidth * scale;
        const drawHeight = sourceHeight * scale;
        const x = index * tileWidth;
        context.save();
        context.beginPath();
        context.rect(x, 0, tileWidth, tileHeight);
        context.clip();
        context.drawImage(
          video,
          x + (tileWidth - drawWidth) / 2,
          (tileHeight - drawHeight) / 2,
          drawWidth,
          drawHeight,
        );
        context.restore();
      }
      index += 1;
      if (index >= count) {
        try {
          setStrip(canvas.toDataURL("image/jpeg", 0.72));
        } catch {
          setStrip(null);
        }
        return;
      }
      seekFrame();
    };

    const seekFrame = () => {
      if (stopped) return;
      const lastSafeTime = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.04) : 0;
      const time = Math.min(sampleTimes[index] ?? 0, lastSafeTime);
      if (Math.abs(video.currentTime - time) < 0.015) {
        drawFrame();
        return;
      }
      const onSeeked = () => {
        pendingSeek = null;
        drawFrame();
      };
      pendingSeek = onSeeked;
      video.addEventListener("seeked", onSeeked, { once: true });
      try {
        video.currentTime = time;
      } catch {
        video.removeEventListener("seeked", onSeeked);
        pendingSeek = null;
        setStrip(null);
      }
    };
    const onLoadedData = () => seekFrame();
    const onLoadedMetadata = () => {
      layout();
      if ((sampleTimes[0] ?? 0) <= 0.015 && video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        video.addEventListener("loadeddata", onLoadedData, { once: true });
        return;
      }
      seekFrame();
    };
    const onError = () => setStrip(null);
    video.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.src = src;
    video.load();

    return () => {
      stopped = true;
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("loadeddata", onLoadedData);
      video.removeEventListener("error", onError);
      if (pendingSeek) video.removeEventListener("seeked", pendingSeek);
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [src, block.from, block.to, block.trimBeforeFrames, block.speed, fps, bandWidth]);

  return strip ? <img className="filmstrip" src={strip} alt="" draggable={false} /> : null;
}

type Ghost = { id: string; key: string; from: number; to: number; snapAt: number | null };
type BlockMenu = { id: string; x: number; y: number };
type DragSession = { target: HTMLElement; pointerId: number; controller: AbortController };

/** 时间线首行：撤销 / 重做、分割、吸附和批注 */
function Toolbar({
  zoomPercent,
  canZoomOut,
  canZoomIn,
  onZoomOut,
  onZoomIn,
  onZoomFit,
}: {
  zoomPercent: number;
  canZoomOut: boolean;
  canZoomIn: boolean;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onZoomFit: () => void;
}) {
  const history = useStore((s) => s.history);
  const snap = useStore((s) => s.snap);
  const annotating = useStore((s) => s.annotating);
  const st = useStore.getState();
  return (
    <div className="tl-toolbar">
      <div className="tl-tools">
        <ToolBtn
          icon="undo"
          label="撤销（⌘Z）"
          disabled={!history?.undo}
          onClick={() => void st.undo("undo")}
        />
        <ToolBtn
          icon="redo"
          label="重做（⇧⌘Z）"
          disabled={!history?.redo}
          onClick={() => void st.undo("redo")}
        />
        <span className="divider" aria-hidden="true" />
        <ToolBtn
          icon="split"
          label="在播放头处分割（⌘B）"
          onClick={() => void st.splitAtPlayhead()}
        />
        <ToolBtn
          icon="magnet"
          label={snap ? "吸附：开（拖动时按住 ⌘ 临时关闭）" : "吸附：关"}
          on={snap}
          onClick={st.toggleSnap}
        />
        <span className="divider" aria-hidden="true" />
        <ToolBtn
          icon="comment"
          label={annotating ? "点选画面元素（Esc 取消）" : "添加批注（C）"}
          on={annotating}
          onClick={() => st.setAnnotating(!annotating)}
        />
        <DeleteButton />
        <AddTrack />
      </div>
      <div className="tl-zoom-controls" aria-label="时间线缩放">
        <button
          type="button"
          className="icon-btn tl-zoom-step"
          aria-label="缩小时间线"
          title="缩小时间线"
          disabled={!canZoomOut}
          onClick={onZoomOut}
        >
          −
        </button>
        <span className="tl-zoom-percent">{zoomPercent}%</span>
        <button
          type="button"
          className="icon-btn tl-zoom-step"
          aria-label="放大时间线"
          title="放大时间线"
          disabled={!canZoomIn}
          onClick={onZoomIn}
        >
          +
        </button>
        <button type="button" className="tl-zoom-fit" title="适配时间线宽度" onClick={onZoomFit}>
          适合
        </button>
      </div>
    </div>
  );
}

function ToolBtn({
  icon,
  label,
  onClick,
  disabled = false,
  on = false,
}: {
  icon: "undo" | "redo" | "split" | "magnet" | "comment";
  label: string;
  onClick: () => void;
  disabled?: boolean;
  on?: boolean;
}) {
  return (
    <button
      type="button"
      className={["icon-btn", on ? "on" : "", icon === "comment" ? "annotation-tool" : ""]
        .filter(Boolean)
        .join(" ")}
      aria-label={label}
      title={label}
      aria-pressed={icon === "magnet" || icon === "comment" ? on : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

function DeleteButton() {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selected);
  const info = deleteInfo(project, selected);
  const title = info.ok ? "删除" : info.reason;
  return (
    <button
      type="button"
      className="tl-delete"
      disabled={!info.ok}
      title={title}
      aria-label={title}
      onClick={() => {
        if (selected) removeItem(selected);
      }}
    >
      <Icon name="trash" />
    </button>
  );
}

function BlockMenuView({ menu, onClose }: { menu: BlockMenu; onClose: () => void }) {
  const project = useStore((s) => s.project);
  const info = deleteInfo(project, menu.id);
  const [replacing, setReplacing] = useState(false);
  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div
      className="tl-menu"
      role="menu"
      aria-label="时间线条目"
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.id === "outro" && (
        <>
          <button
            type="button"
            role="menuitem"
            className="tl-menu-action"
            onClick={() => setReplacing((value) => !value)}
          >
            替换片尾素材
          </button>
          {replacing && (
            <div className="tl-outro-assets" role="group" aria-label="选择片尾素材">
              {Object.entries(project?.assets ?? {})
                .filter(
                  ([id, asset]) =>
                    id !== project?.outro?.asset &&
                    (asset.kind === "video" || asset.kind === "image"),
                )
                .map(([id, asset]) => (
                  <button
                    type="button"
                    key={id}
                    className="tl-menu-action"
                    onClick={() => {
                      if (!project?.outro) return;
                      void useStore
                        .getState()
                        .submit(
                          [{ op: "outro.set", outro: { ...project.outro, asset: id } }],
                          `替换了片尾素材：${asset.path.split("/").at(-1) ?? id}`,
                        );
                      onClose();
                    }}
                  >
                    {asset.path.split("/").at(-1) ?? id}
                  </button>
                ))}
            </div>
          )}
        </>
      )}
      <button
        type="button"
        role="menuitem"
        className="tl-menu-delete"
        disabled={!info.ok}
        title={info.ok ? "删除" : info.reason}
        onClick={() => {
          if (menu.id === "outro") {
            void useStore.getState().submit([{ op: "outro.remove" }], "删除了片尾");
          } else removeItem(menu.id);
          onClose();
        }}
      >
        <Icon name="trash" />
        <span>删除</span>
      </button>
    </div>
  );
}

type DeleteInfo = {
  ok: boolean;
  reason: string;
  name: string;
  track: string;
  kind: string;
};

function deleteInfo(project: Project | null, id: string | null): DeleteInfo {
  if (!project || !id) {
    return { ok: false, reason: "先选中要删除的条目", name: "", track: "", kind: "" };
  }
  if (id === "outro") {
    return project.outro
      ? { ok: true, reason: "删除", name: "片尾", track: "主视频", kind: "片尾" }
      : { ok: false, reason: "工程没有片尾", name: "片尾", track: "主视频", kind: "片尾" };
  }
  const ref = findItem(project, id);
  if (!ref) return { ok: false, reason: "先选中要删除的条目", name: id, track: "", kind: "" };
  const name = itemName(project, ref);
  const track = trackTitle(ref.track);
  const kind = kindLabel(ref);
  if (ref.track.locked) return { ok: false, reason: "轨道已锁定", name, track, kind };
  return { ok: true, reason: "删除", name, track, kind };
}

function removeItem(id: string) {
  const s = useStore.getState();
  const info = deleteInfo(s.project, id);
  if (!info.ok || !s.project) return;
  const ref = findItem(s.project, id);
  if (!ref) return;
  const ops: Op[] =
    ref.track.kind === "caption"
      ? [{ op: "caption.remove", ids: [id] }]
      : [{ op: "item.remove", id }];
  const quoted = info.name ? `「${info.name}」` : "";
  void s.submit(ops, `删除了${info.kind}${quoted}`).then((ok) => {
    if (ok && useStore.getState().selected === id) useStore.getState().select(null);
  });
}

function itemName(project: Project, ref: ItemRef): string {
  const { item } = ref;
  if ("text" in item && item.text) return item.text;
  if ("props" in item) {
    const lines = item.props.lines;
    if (Array.isArray(lines)) {
      const text = lines.filter((x): x is string => typeof x === "string").join(" / ");
      if (text) return text;
    }
  }
  if ("asset" in item) {
    return project.assets[item.asset]?.path.split("/").at(-1) ?? item.asset;
  }
  return item.id;
}

function trackTitle(track: Track): string {
  if (track.kind === "video" && track.main) return "主视频";
  if (track.kind === "video") return "画中画";
  if (track.kind === "caption") return "字幕";
  if (track.kind === "overlay") return "标题";
  return "音频";
}

/** 1 倍不显示。和属性面板一样，保留两位小数里用得到的部分 */
function formatSpeed(speed: number | undefined): string | null {
  if (speed === undefined || Math.abs(speed - 1) < 0.005) return null;
  return `${String(Math.round(speed * 100) / 100)}×`;
}
