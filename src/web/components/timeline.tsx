import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Track } from "../../core/schema";
import {
  type Block,
  frameOfMs,
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

  return (
    <section className="timeline" ref={root}>
      <div className="tl-grid" style={{ gridTemplateColumns: `${HEAD}px 1fr` }}>
        <div className="tl-corner mono">{timecode(frame, fps)}</div>
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
          />
        ))}
      </div>
      {width > 0 && <div className="playhead" style={{ left: HEAD + px(frame) }} />}
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
}: {
  row: Row;
  px: (f: number) => number;
  fps: number;
  selected: string | null;
  flashIds: string[];
  flashAt: number;
  peaks: Record<string, { msPerPeak: number; peaks: number[] } | null>;
  onScrub: (e: React.PointerEvent<HTMLDivElement>) => void;
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
        {row.blocks.map((b) => (
          <BlockView
            key={b.key}
            block={b}
            left={px(b.from)}
            width={Math.max(2, px(b.to) - px(b.from))}
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
        ))}
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
}) {
  const columns = Math.floor(width / 3);
  const wave = useMemo(
    () => (peaks && block.kind === "clip" ? waveform(block, peaks, fps, columns) : null),
    [peaks, block, fps, columns],
  );
  return (
    <button
      type="button"
      className={["block", block.kind, selected ? "selected" : ""].join(" ")}
      style={{ left, width }}
      title={block.label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onSelect}
    >
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
