import { useEffect, useRef, useState } from "react";
import { planDrag } from "../../core/edit";
import type { Op } from "../../core/ops";
import type { Anchor, Caption, Project } from "../../core/schema";
import { findItem, type ItemRef, kindLabel } from "../lib/project";
import { msOfFrame, timecode } from "../lib/timeline";
import { useStore } from "../store";
import { CommentCard } from "./comment-card";
import { Icon } from "./icons";

/** 选中元素的详情：只放审片时常用的几样——说的哪句、时间微调、改字、样式、锁定，和它的批注 */
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
  const styleNames = Object.keys(project.styles);

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

      {isCaption && <CaptionEditor caption={item as Caption} locked={track.locked} />}

      <div className="selection-actions">
        {anchor && !track.locked && (
          <div className="nudge" role="group" aria-label="调整出现时间">
            <NudgeBtn icon="back" label="提前 0.5 秒" onClick={() => nudge(-500)} />
            <NudgeBtn icon="prev" label="提前 0.1 秒" onClick={() => nudge(-100)} />
            <NudgeBtn icon="next" label="延后 0.1 秒" onClick={() => nudge(100)} />
            <NudgeBtn icon="forward" label="延后 0.5 秒" onClick={() => nudge(500)} />
          </div>
        )}
        {(isCaption || track.kind === "overlay") && (
          <select
            className="select"
            value={styleId ?? ""}
            disabled={track.locked}
            title="样式"
            onChange={(e) => e.target.value && setStyle(e.target.value)}
          >
            <option value="">{isCaption ? "样式：跟随轨道" : "样式：模板默认"}</option>
            {styleNames.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
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
    <section className="section">
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

export function Composer() {
  const selected = useStore((s) => s.selected);
  const frame = useStore((s) => s.frame);
  const fps = useStore((s) => s.preview?.timeline.fps ?? 30);
  const nonce = useStore((s) => s.composerNonce);
  const pin = useStore((s) => s.pin);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (nonce > 0) box.current?.focus();
  }, [nonce]);

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    await useStore.getState().addComment({
      text: t,
      atMs: msOfFrame(frame, fps),
      ...(selected ? { target: selected } : {}),
      ...(pin ? { point: pin } : {}),
    });
    setBusy(false);
    setText("");
  };

  return (
    <div className="composer">
      <div className="composer-context">
        <span className="ctx mono">
          <Icon name="target" size={12} />
          {timecode(frame, fps)}
        </span>
        {selected && <span className="ctx">{selected}</span>}
        {pin && (
          <button
            type="button"
            className="ctx removable"
            onClick={() => useStore.getState().setPin(null)}
          >
            画面位置 <Icon name="close" size={10} />
          </button>
        )}
      </div>
      <textarea
        ref={box}
        value={text}
        rows={3}
        placeholder="对当前画面提出修改意见…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
          if (e.key === "Escape") e.currentTarget.blur();
        }}
      />
      <button
        type="button"
        className="send-btn"
        disabled={!text.trim() || busy}
        onClick={() => void send()}
      >
        交给 AI
      </button>
    </div>
  );
}
