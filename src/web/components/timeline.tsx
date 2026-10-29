import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type DragMode, planDrag } from "../../core/edit";
import type { Track } from "../../core/schema";
import {
  type Block,
  frameOfMs,
  msOfFrame,
  type Row,
  tickStep,
  timecode,
  timelineRows,
  waveform,
} from "../lib/timeline";
import { useStore } from "../store";
import { Icon } from "./icons";

const HEAD = 132;
/** .tl-grid 的右内边距 */
const GUTTER = 16;

export function Timeline() {
  const project = useStore((s) => s.project);
  const preview = useStore((s) => s.preview);
  const frame = useStore((s) => s.frame);
  const selected = useStore((s) => s.selected);
  const review = useStore((s) => s.review);
  const lint = useStore((s) => s.lint);
  const flash = useStore((s) => s.flash);
  const peaks = useStore((s) => s.peaks);
  const { seek, select } = useStore.getState();
  const [ghost, setGhost] = useState<Ghost | null>(null);

  // 量整个时间线区域（数据没到之前也在），轨道区宽度 = 总宽 − 轨道头 − 右边距
  const root = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(
      ([e]) => e && setWidth(Math.max(0, e.contentRect.width - HEAD - GUTTER)),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tl = preview?.timeline;
  const rows = useMemo(() => (project && tl ? timelineRows(project, tl) : []), [project, tl]);
  if (!project || !tl) return <section className="timeline" ref={root} />;

  const fps = tl.fps;
  const total = Math.max(1, tl.durationInFrames);
  const px = (f: number) => (f / total) * width;
  const step = tickStep((width / total) * fps);
  const ticks: number[] = [];
  for (let s = 0; s * fps < total; s += step) ticks.push(Math.round(s * fps));

  const frameAt = (clientX: number) => {
    const r = root.current?.getBoundingClientRect();
    if (!r || width === 0) return 0;
    return Math.max(0, Math.min(total - 1, ((clientX - r.left - HEAD) / width) * total));
  };
  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    seek(frameAt(e.clientX));
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
    target.setPointerCapture(e.pointerId);
    let plan: ReturnType<typeof planDrag> | null = null;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      const s = useStore.getState();
      if (!s.project) return;
      try {
        plan = planDrag(s.project, {
          id: b.id,
          mode,
          deltaMs: msOfFrame((dx / width) * total, fps),
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
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      setGhost(null);
      if (moved && plan?.ops.length) {
        const label = mode === "move" ? `移动了 ${b.id}` : `调整了 ${b.id} 的长度`;
        void useStore.getState().submit(plan.ops, label);
      }
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  return (
    <section className="timeline" ref={root}>
      <Toolbar frame={frame} fps={fps} />
      <div className="tl-grid" style={{ gridTemplateColumns: `${HEAD}px 1fr` }}>
        <div className="tl-corner" />
        <div
          className="tl-ruler"
          onPointerDown={scrub}
          onPointerMove={(e) => e.buttons === 1 && seek(frameAt(e.clientX))}
        >
          {ticks.map((f) => (
            <span key={f} className="tick" style={{ left: px(f) }}>
              {timecode(f, fps).replace(/\.\d$/, "")}
            </span>
          ))}
        </div>

        <div className="tl-head marker-head">标记</div>
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

        {rows.map((row) => (
          <RowView
            key={row.track.id}
            row={row}
            px={px}
            fps={fps}
            selected={selected}
            flashIds={flashing?.ids ?? []}
            flashAt={flashing?.at ?? 0}
            peaks={peaks}
            onScrub={scrub}
            ghost={ghost}
            onDragStart={startDrag}
          />
        ))}
      </div>
      {width > 0 && <div className="playhead" style={{ left: HEAD + px(frame) }} />}
      {ghost?.snapAt != null && (
        <div className="snap-line" style={{ left: HEAD + px(ghost.snapAt) }} />
      )}
    </section>
  );
}

function RowView({
  row,
  px,
  fps,
  selected,
  flashIds,
  flashAt,
  peaks,
  onScrub,
  ghost,
  onDragStart,
}: {
  row: Row;
  px: (f: number) => number;
  fps: number;
  selected: string | null;
  flashIds: string[];
  flashAt: number;
  peaks: Record<string, { msPerPeak: number; peaks: number[] } | null>;
  onScrub: (e: React.PointerEvent<HTMLDivElement>) => void;
  ghost: Ghost | null;
  onDragStart: (e: React.PointerEvent, b: Block, mode: DragMode) => void;
}) {
  const { track } = row;
  const { submit, select, seek } = useStore.getState();
  const frame = useStore((s) => s.frame);
  const toggle = (key: "locked" | "hidden" | "muted", label: string) =>
    void submit([{ op: "track.update", id: track.id, set: { [key]: !track[key] } }], label);
  const audible = track.kind === "video" || track.kind === "audio";

  return (
    <>
      <div className={`tl-head ${track.hidden ? "is-hidden" : ""}`}>
        <span className="row-label" title={track.id}>
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
            <BlockView
              key={b.key}
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
              onSelect={() => {
                if (b.kind !== "outro") select(b.id);
                if (frame < b.from || frame >= b.to) seek(b.from);
              }}
              track={track}
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
  onSelect: () => void;
  track: Track;
  dragging: boolean;
  editable: boolean;
  onDragStart: (e: React.PointerEvent, mode: DragMode) => void;
}) {
  const columns = Math.floor(width / 3);
  const wave = useMemo(
    () => (peaks && block.kind === "clip" ? waveform(block, peaks, fps, columns) : null),
    [peaks, block, fps, columns],
  );
  return (
    <button
      type="button"
      className={[
        "block",
        block.kind,
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

type Ghost = { id: string; from: number; to: number; snapAt: number | null };

/** 撤销 / 重做、分割、吸附开关和当前时间 */
function Toolbar({ frame, fps }: { frame: number; fps: number }) {
  const history = useStore((s) => s.history);
  const snap = useStore((s) => s.snap);
  const { undo, splitAtPlayhead, toggleSnap } = useStore.getState();
  return (
    <div className="tl-toolbar">
      <div className="tl-tools">
        <ToolBtn
          icon="undo"
          label="撤销（⌘Z）"
          disabled={!history?.undo}
          onClick={() => void undo("undo")}
        />
        <ToolBtn
          icon="redo"
          label="重做（⇧⌘Z）"
          disabled={!history?.redo}
          onClick={() => void undo("redo")}
        />
        <span className="divider" aria-hidden="true" />
        <ToolBtn icon="split" label="在播放头处分割（⌘B）" onClick={() => void splitAtPlayhead()} />
        <ToolBtn
          icon="magnet"
          label={snap ? "吸附：开（拖动时按住 ⌘ 临时关闭）" : "吸附：关"}
          on={snap}
          onClick={toggleSnap}
        />
      </div>
      <span className="tl-time mono">{timecode(frame, fps)}</span>
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
  icon: "undo" | "redo" | "split" | "magnet";
  label: string;
  onClick: () => void;
  disabled?: boolean;
  on?: boolean;
}) {
  return (
    <button
      type="button"
      className={on ? "icon-btn on" : "icon-btn"}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}
