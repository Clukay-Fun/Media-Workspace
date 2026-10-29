import type React from "react";
import { useEffect, useRef, useState } from "react";
import { planDrag } from "../../core/edit";
import type { Op } from "../../core/ops";
import type { Anchor, Caption, Project, Slot, Transform } from "../../core/schema";
import { findItem, type ItemRef, kindLabel } from "../lib/project";
import { msOfFrame, timecode } from "../lib/timeline";
import { useStore } from "../store";
import { CommentCard } from "./comment-card";
import { Icon } from "./icons";
import { swatch } from "./left-panel";

/**
 * 选中元素的属性：能用点的就不用写——样式、位置、语速、时间微调都是直接点的选项；
 * 点不出来的改动在底部输入框告诉 AI。
 */
export function SelectionCard() {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selected);
  const preview = useStore((s) => s.preview);
  const review = useStore((s) => s.review);
  const listing = useStore((s) => s.captionList);
  const ref = project && selected ? findItem(project, selected) : null;
  if (!project || !ref || !selected) return null;
  const comments = (review?.comments ?? []).filter(
    (c) => c.target === selected && c.status === "open",
  );
  if (ref.track.kind === "caption" && listing) return <CaptionList />;
  return (
    <>
      <Selection project={project} id={selected} ref_={ref} fps={preview?.timeline.fps ?? 30} />
      {comments.length > 0 && (
        <div className="comment-list">
          {comments.map((c) => (
            <CommentCard key={c.id} comment={c} compact />
          ))}
        </div>
      )}
    </>
  );
}

function ListToggle() {
  const listing = useStore((s) => s.captionList);
  return (
    <button
      type="button"
      className={listing ? "mini-btn on" : "mini-btn"}
      onClick={() => useStore.getState().setCaptionList(!listing)}
      title={listing ? "回到这句字幕" : "显示全部字幕"}
    >
      <Icon name="list" size={12} />
      全部字幕
    </button>
  );
}

/** 全部字幕，点一句跳过去；当前选中的那句滚到可见 */
function CaptionList() {
  const tl = useStore((s) => s.preview?.timeline);
  const selected = useStore((s) => s.selected);
  const frame = useStore((s) => s.frame);
  const current = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    current.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  if (!tl) return null;
  const captions = tl.captions.toSorted((a, b) => a.from - b.from);
  return (
    <>
      <header className="selection-head">
        <span className="kind-badge">字幕 {captions.length} 句</span>
        <ListToggle />
      </header>
      <div className="caption-list">
        {captions.map((c) => {
          const playing = frame >= c.from && frame < c.from + c.durationInFrames;
          return (
            <button
              type="button"
              key={c.id}
              ref={c.id === selected ? current : undefined}
              className={[
                "caption-row",
                c.id === selected ? "current" : "",
                playing ? "playing" : "",
              ].join(" ")}
              onClick={() => {
                const { select, seek } = useStore.getState();
                select(c.id, { reveal: false });
                seek(c.from);
              }}
            >
              <span className="mono">{timecode(c.from, tl.fps)}</span>
              <span className="caption-row-text">{c.text}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function Selection({
  project,
  id,
  ref_,
  fps,
}: {
  project: Project;
  id: string;
  ref_: ItemRef;
  fps: number;
}) {
  const preview = useStore((s) => s.preview);
  const { submit } = useStore.getState();
  const { track, item } = ref_;
  const tl = preview?.timeline;
  const resolved = tl
    ? [...tl.videos, ...tl.images, ...tl.captions, ...tl.overlays].filter((x) => x.id === id)
    : [];
  const from = resolved.length ? Math.min(...resolved.map((r) => r.from)) : null;
  const to = resolved.length ? Math.max(...resolved.map((r) => r.from + r.durationInFrames)) : null;
  const isCaption = track.kind === "caption";
  const anchor = "at" in item ? (item.at as Anchor) : null;
  const styleId = "style" in item ? (item.style ?? null) : null;
  const hasStyle = isCaption || track.kind === "overlay";
  // 字幕的位置由样式决定；主轨铺满画面。其余（标题、画中画、图片）可以选位置
  const hasSlot = anchor !== null && !isCaption && track.kind !== "audio";
  const slot = "slot" in item ? ((item.slot as Slot | undefined) ?? null) : null;
  const transform = "transform" in item ? (item.transform as Transform | undefined) : undefined;
  const customPos = transform?.x !== undefined || transform?.y !== undefined;
  const speed = "speed" in item && typeof item.speed === "number" ? item.speed : null;
  const cut = "cutBefore" in item ? (item.cutBefore as string | undefined) : undefined;
  const locked = track.locked;

  const nudge = (deltaMs: number) => {
    try {
      const plan = planDrag(project, { id, mode: "move", deltaMs, snap: false });
      void submit(
        plan.ops,
        deltaMs < 0 ? `提前了 ${-deltaMs / 1000} 秒` : `延后了 ${deltaMs / 1000} 秒`,
      );
    } catch (e) {
      useStore.getState().toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const setStyle = (style: string) => {
    const op: Op = isCaption
      ? { op: "caption.update", id, set: { style } }
      : { op: "item.update", id, set: { style } };
    void submit([op], `已套用样式「${style}」`);
  };

  const setSlot = (s: Slot) => {
    // 拖动过的元素带着 x / y，会盖住位置预设；换位置时一起去掉
    const { x: _x, y: _y, ...rest } = transform ?? {};
    const set = customPos ? { slot: s, transform: rest } : { slot: s };
    void submit([{ op: "item.update", id, set }], `已放到「${SLOT_LABEL[s]}」`);
  };

  const setSpeed = (v: number) =>
    void submit([{ op: "item.update", id, set: { speed: v } }], `语速改成 ${v} 倍`);

  const lock = () =>
    void submit(
      [{ op: "track.update", id: track.id, set: { locked: !track.locked } }],
      track.locked ? "已解锁轨道" : "已锁定轨道，AI 也不能改动它",
    );

  return (
    <div className="selection">
      <header className="selection-head">
        <span className="kind-badge">{kindLabel(ref_)}</span>
        <h2>{id}</h2>
        {from !== null && to !== null && (
          <span className="selection-time mono">
            {timecode(from, fps)} · {(msOfFrame(to - from, fps) / 1000).toFixed(1)}s
          </span>
        )}
        <button
          type="button"
          className="icon-btn ghost close"
          aria-label="关闭"
          onClick={() => useStore.getState().select(null)}
        >
          <Icon name="close" size={12} />
        </button>
      </header>

      {anchor && <p className="anchor">{describeAnchor(project, anchor)}</p>}

      {isCaption && <CaptionEditor caption={item as Caption} locked={locked} />}

      {cut && (
        <p className="cut-note">
          <span className="cut-tag static">{cut}</span>
          这一段前面剪掉了一截，理由是 AI 粗剪时写的
        </p>
      )}

      {hasStyle && (
        <Field label="样式">
          <div className="style-grid">
            {Object.entries(project.styles).map(([name, style]) => (
              <button
                key={name}
                type="button"
                className={styleId === name ? "style-chip on" : "style-chip"}
                disabled={locked}
                title={name}
                onClick={() => styleId !== name && setStyle(name)}
              >
                <span className="style-chip-sample" style={swatch(style)}>
                  {isCaption ? "字幕" : "标题"}
                </span>
                <span className="style-chip-name">{name}</span>
              </button>
            ))}
          </div>
        </Field>
      )}

      {hasSlot && (
        <Field label="位置" note={customPos ? "拖动过，自定义位置" : undefined}>
          <div className="slot-picker" role="radiogroup" aria-label="位置">
            {SLOTS.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={!customPos && slot === s}
                className={!customPos && slot === s ? "slot on" : "slot"}
                disabled={locked}
                onClick={() => setSlot(s)}
              >
                <span className="slot-frame" aria-hidden="true">
                  <span className="slot-bar" style={{ top: `${SLOT_Y[s] * 100}%` }} />
                </span>
                {SLOT_LABEL[s]}
              </button>
            ))}
          </div>
        </Field>
      )}

      {speed !== null && (
        <Field label="语速">
          <div className="segmented" role="radiogroup" aria-label="语速">
            {SPEEDS.map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={speed === v}
                className={speed === v ? "on" : undefined}
                disabled={locked}
                onClick={() => speed !== v && setSpeed(v)}
              >
                {v}×
              </button>
            ))}
          </div>
        </Field>
      )}

      {anchor && !locked && (
        <Field label="出现时间">
          <div className="nudge" role="group" aria-label="调整出现时间">
            <NudgeBtn icon="back" label="提前 0.5 秒" onClick={() => nudge(-500)} />
            <NudgeBtn icon="prev" label="提前 0.1 秒" onClick={() => nudge(-100)} />
            <NudgeBtn icon="next" label="延后 0.1 秒" onClick={() => nudge(100)} />
            <NudgeBtn icon="forward" label="延后 0.5 秒" onClick={() => nudge(500)} />
          </div>
        </Field>
      )}

      <div className="selection-actions">
        {isCaption && <ListToggle />}
        <button
          type="button"
          className={track.locked ? "mini-btn locked" : "mini-btn"}
          title={track.locked ? "解锁这条轨道" : "锁定这条轨道，AI 也不能改"}
          onClick={lock}
        >
          <Icon name={track.locked ? "lock" : "unlock"} size={12} />
          {track.locked ? "已锁定" : "锁定"}
        </button>
      </div>
    </div>
  );
}

const SLOTS: Slot[] = ["top", "upper-third", "center", "lower-third", "caption"];
const SLOT_LABEL: Record<Slot, string> = {
  top: "顶部",
  "upper-third": "上方",
  center: "中间",
  "lower-third": "下方",
  caption: "字幕区",
};
/** 只用来画示意图 */
const SLOT_Y: Record<Slot, number> = {
  top: 0.1,
  "upper-third": 0.28,
  center: 0.46,
  "lower-third": 0.64,
  caption: 0.78,
};
const SPEEDS = [1, 1.1, 1.2, 1.25];

function Field({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="field">
      <h3>
        {label}
        {note && <span className="field-note">{note}</span>}
      </h3>
      {children}
    </section>
  );
}

function NudgeBtn({
  icon,
  label,
  onClick,
}: {
  icon: "back" | "prev" | "next" | "forward";
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} size={14} />
    </button>
  );
}

function describeAnchor(project: Project, at: Anchor): string {
  if ("ms" in at) return `固定在 ${(at.ms / 1000).toFixed(1)} 秒`;
  const off = at.offsetMs
    ? `，${at.offsetMs > 0 ? "延后" : "提前"} ${Math.abs(at.offsetMs / 1000)} 秒`
    : "";
  if ("clip" in at) return `跟随片段 ${at.clip} 开始${off}`;
  const cap = findItem(project, at.caption)?.item as Caption | undefined;
  if (at.char !== undefined && cap) {
    const ch = [...cap.text][at.char] ?? "";
    return `念到「${cap.text}」第 ${at.char + 1} 个字「${ch}」时${off}`;
  }
  return cap ? `跟随字幕「${cap.text}」开始${off}` : `跟随字幕 ${at.caption}${off}`;
}

function CaptionEditor({ caption, locked }: { caption: Caption; locked: boolean }) {
  const [text, setText] = useState(caption.text);
  useEffect(() => setText(caption.text), [caption.text]);
  const save = () => {
    const t = text.trim();
    if (!t || t === caption.text) return setText(caption.text);
    void useStore
      .getState()
      .submit([{ op: "caption.update", id: caption.id, set: { text: t } }], "字幕已修改");
  };
  return (
    <section className="field">
      <h3>字幕文字</h3>
      <textarea
        className="caption-text"
        value={text}
        disabled={locked}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            setText(caption.text);
            e.currentTarget.blur();
          }
        }}
      />
      <div className="tags">
        <span
          className={caption.charStartMs ? "tag ok" : "tag dim"}
          title={
            caption.charStartMs
              ? "逐字时间来自识音对齐；改了字数要让 AI 重新对齐"
              : "逐字时间按字数估算，还没识音对齐"
          }
        >
          {caption.charStartMs ? "已对齐" : "估算"}
        </span>
        {caption.highlights.map((h) => (
          <span key={`${h.text}-${h.nth ?? 0}`} className="tag">
            {h.text}
          </span>
        ))}
      </div>
    </section>
  );
}
