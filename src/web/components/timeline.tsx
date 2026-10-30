import type React from "react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { EditorState } from "../../core/api";
import { type DragMode, planDrag } from "../../core/edit";
import type { Project, Track } from "../../core/schema";
import { frameToMs, sourceFrameAt } from "../../core/time";
import { aiChanges } from "../lib/changes";
import { keyframeMarkerPositions } from "../lib/keyframes";
import {
  type Block,
  frameOfMs,
  itemFrames,
  msOfFrame,
  type Row,
  tickStep,
  timecode,
  timelineRows,
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
  const [zoomPps, setZoomPps] = useState<number | null>(null);
  const [openTransitionId, setOpenTransitionId] = useState<string | null>(null);
  const history = useStore((s) => s.history);
  const reviewedRev = useStore((s) => s.reviewedRev);
  const dragSession = useRef<DragSession | null>(null);
  const editorRef = useRef<EditorState | null>(null);
  const saveEditorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
          void api
            .saveEditor(next)
            .catch(() => useStore.getState().toast("时间线设置保存失败", "error"));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api, name]);

  useEffect(
    () => () => {
      if (saveEditorTimer.current) {
        clearTimeout(saveEditorTimer.current);
        const latest = editorRef.current;
        if (latest) void api.saveEditor(latest).catch(() => {});
      }
    },
    [api],
  );

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
      label: kind === "major" ? timecode(frame, fps).replace(/\.\d$/, "") : null,
    });
  }

  const scheduleEditorSave = (next: EditorState) => {
    editorRef.current = next;
    if (saveEditorTimer.current) clearTimeout(saveEditorTimer.current);
    saveEditorTimer.current = setTimeout(() => {
      void api
        .saveEditor(next)
        .catch(() => useStore.getState().toast("时间线设置保存失败", "error"));
    }, 240);
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
    ...(lint?.issues ?? []).map((i, n) => ({
      key: `lint-${n}`,
      kind: "lint" as const,
      frame: frameOfMs(i.atMs, fps),
      title: i.message,
      target: i.id,
    })),
  ];

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
          snap: s.snap && !ev.metaKey,
          playheadMs: msOfFrame(s.frame, fps),
        });
        setGhost({
          id: b.id,
          from: frameOfMs(plan.preview.startMs, fps),
          to: frameOfMs(plan.preview.endMs, fps),
          snapAt: plan.snappedTo ? frameOfMs(plan.snappedTo.at, fps) : null,
        });
      } catch {
        plan = null;
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
          {markers.map((m) => (
            <button
              type="button"
              key={m.key}
              className={`marker ${m.kind}`}
              style={{ left: px(m.frame) }}
              title={m.title}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                if (m.target) select(m.target);
                seek(m.frame);
              }}
            >
              <Icon name={m.kind === "comment" ? "comment" : "warn"} size={11} />
            </button>
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
    </section>
  );
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
  transitionCuts: TransitionCut[];
  openTransitionId: string | null;
  setOpenTransitionId: (id: string | null) => void;
}) {
  const { track } = row;
  const { submit, select, seek } = useStore.getState();
  const toggle = (key: "locked" | "hidden" | "muted", label: string) =>
    void submit([{ op: "track.update", id: track.id, set: { [key]: !track[key] } }], label);
  const audible = track.kind === "video" || track.kind === "audio";

  return (
    <>
      <div className={`tl-head ${track.hidden ? "is-hidden" : ""}`}>
        <span className={`row-label row-${row.kind}`} title={track.name ?? track.id}>
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
          track.locked ? "locked" : "",
          track.hidden ? "is-hidden" : "",
        ].join(" ")}
        onPointerDown={onScrub}
      >
        {row.blocks.map((b) => {
          const g = ghost?.id === b.id ? ghost : null;
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
                fps={fps}
                selected={selected === b.id}
                flash={flashIds.includes(b.id) ? flashAt : 0}
                peaks={b.asset ? (peaks[b.asset] ?? null) : null}
                videoSrc={b.mediaKind === "video" && b.asset ? videoSrcs[b.asset] : undefined}
                thumbnailHeight={row.kind === "main" ? 36 : 26}
                onSelect={() => {
                  if (b.kind !== "outro") select(b.id);
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
  thumbnailHeight,
  onSelect,
  dragging,
  editable,
  onDragStart,
}: {
  block: Block;
  left: number;
  width: number;
  fps: number;
  selected: boolean;
  flash: number;
  peaks: { msPerPeak: number; peaks: number[] } | null;
  videoSrc?: string;
  thumbnailHeight: number;
  onSelect: () => void;
  track: Track;
  dragging: boolean;
  editable: boolean;
  onDragStart: (e: React.PointerEvent, mode: DragMode) => void;
}) {
  const columns = Math.floor(width / 3);
  const wave = useMemo(
    () =>
      peaks && block.kind === "clip" && block.mediaKind === "audio"
        ? waveform(block, peaks, fps, columns)
        : null,
    [peaks, block, fps, columns],
  );
  const thumbnailCount =
    block.kind === "clip" && block.mediaKind === "video"
      ? Math.max(
          1,
          Math.min(block.to - block.from, 24, Math.ceil(width / (thumbnailHeight * (16 / 9)))),
        )
      : 0;
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
      {videoSrc && thumbnailCount > 0 && (
        <VideoFilmstrip
          src={videoSrc}
          block={block}
          fps={fps}
          count={thumbnailCount}
          tileHeight={thumbnailHeight}
        />
      )}
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
      <span className="block-label">{block.label}</span>
      {flash > 0 && <span key={flash} className="block-flash" aria-hidden="true" />}
    </button>
  );
}

function VideoFilmstrip({
  src,
  block,
  fps,
  count,
  tileHeight,
}: {
  src: string;
  block: Block;
  fps: number;
  count: number;
  tileHeight: number;
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
    const tileWidth = Math.round((tileHeight * 16) / 9);
    canvas.width = tileWidth * count;
    canvas.height = tileHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingQuality = "medium";

    const frames = Math.max(1, block.to - block.from);
    const trim = block.trimBeforeFrames ?? 0;
    const speed = block.speed ?? 1;
    const sampleTimes = Array.from({ length: count }, (_, index) => {
      const offset = Math.min(frames - 1, Math.floor(((index + 0.5) / count) * frames));
      return frameToMs(sourceFrameAt(trim, speed, offset), fps) / 1000;
    });
    let stopped = false;
    let index = 0;
    let pendingSeek: (() => void) | null = null;

    const drawFrame = () => {
      if (stopped) return;
      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;
      if (sourceWidth > 0 && sourceHeight > 0) {
        const scale = Math.max(tileWidth / sourceWidth, tileHeight / sourceHeight);
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
  }, [src, block.from, block.to, block.trimBeforeFrames, block.speed, fps, count, tileHeight]);

  return strip ? <img className="filmstrip" src={strip} alt="" draggable={false} /> : null;
}

type Ghost = { id: string; from: number; to: number; snapAt: number | null };
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
