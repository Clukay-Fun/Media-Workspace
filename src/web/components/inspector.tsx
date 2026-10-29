import { useEffect, useRef, useState } from "react";
import { planDrag } from "../../core/edit";
import type { Op } from "../../core/ops";
import type { Anchor, Caption, Project } from "../../core/schema";
import { TEMPLATES } from "../../templates";
import { findItem, type ItemRef, kindLabel } from "../lib/project";
import { msOfFrame, timecode } from "../lib/timeline";
import { useStore } from "../store";
import { CommentCard } from "./comment-card";
import { Icon } from "./icons";

/** 「选中」页：选中元素的信息和它的批注；选中字幕时可以切换成全部字幕列表 */
export function SelectionView() {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selected);
  const preview = useStore((s) => s.preview);
  const review = useStore((s) => s.review);
  const listing = useStore((s) => s.captionList);
  const ref = project && selected ? findItem(project, selected) : null;
  const comments = (review?.comments ?? []).filter((c) => selected && c.target === selected);
  const isCaption = ref?.track.kind === "caption";

  if (!project || !ref || !selected) {
    return (
      <div className="empty">
        <Icon name="target" size={20} />
        <p>点画面或时间线上的元素</p>
        <span>双击画面可以钉一条批注</span>
      </div>
    );
  }
  if (isCaption && listing) return <CaptionList />;
  return (
    <>
      <Selection project={project} id={selected} ref_={ref} fps={preview?.timeline.fps ?? 30} />
      {comments.length > 0 && (
        <section className="section">
          <h3>批注</h3>
          <div className="comment-list">
            {comments.map((c) => (
              <CommentCard key={c.id} comment={c} compact />
            ))}
          </div>
        </section>
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
  const template = "template" in item ? TEMPLATES[item.template] : undefined;
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

  return (
    <>
      <header className="selection-head">
        <span className="kind-badge">{kindLabel(ref_)}</span>
        <h2>{id}</h2>
        {isCaption && <ListToggle />}
        {track.locked && (
          <span className="locked-note" title="轨道已锁定，AI 和界面都不能修改">
            <Icon name="lock" size={12} /> 已锁定
          </span>
        )}
      </header>

      {from !== null && to !== null && (
        <dl className="facts">
          <dt>出现</dt>
          <dd className="mono">{timecode(from, fps)}</dd>
          <dt>结束</dt>
          <dd className="mono">{timecode(to, fps)}</dd>
          <dt>时长</dt>
          <dd className="mono">{(msOfFrame(to - from, fps) / 1000).toFixed(1)} 秒</dd>
          <dt>轨道</dt>
          <dd>{track.name ?? track.id}</dd>
        </dl>
      )}

      {anchor && (
        <section className="section">
          <h3>出现时间</h3>
          <p className="anchor">{describeAnchor(project, anchor)}</p>
          {!track.locked && (
            <div className="nudge" role="group" aria-label="调整出现时间">
              <NudgeBtn icon="back" label="提前 0.5 秒" onClick={() => nudge(-500)} />
              <NudgeBtn icon="prev" label="提前 0.1 秒" onClick={() => nudge(-100)} />
              <NudgeBtn icon="next" label="延后 0.1 秒" onClick={() => nudge(100)} />
              <NudgeBtn icon="forward" label="延后 0.5 秒" onClick={() => nudge(500)} />
            </div>
          )}
        </section>
      )}

      {isCaption && <CaptionEditor caption={item as Caption} locked={track.locked} />}

      {template && (
        <section className="section">
          <h3>模板</h3>
          <p className="muted">
            <b>{template.meta.label}</b> · {forHumans(template.meta.description)}
          </p>
        </section>
      )}

      {(isCaption || track.kind === "overlay") && (
        <section className="section">
          <h3>样式</h3>
          <select
            className="select"
            value={styleId ?? ""}
            disabled={track.locked}
            onChange={(e) => e.target.value && setStyle(e.target.value)}
          >
            <option value="">{isCaption ? "跟随轨道" : "模板默认"}</option>
            {styleNames.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </section>
      )}

      {"transform" in item && item.transform && (
        <section className="section">
          <h3>位置</h3>
          <dl className="facts">
            <dt>中心</dt>
            <dd className="mono">
              {Math.round(item.transform.x ?? project.canvas.width / 2)},{" "}
              {Math.round(item.transform.y ?? project.canvas.height / 2)}
            </dd>
            <dt>缩放</dt>
            <dd className="mono">{Math.round((item.transform.scale ?? 1) * 100)}%</dd>
          </dl>
          {!isCaption && !track.locked && (
            <p className="hint">在画面上直接拖动，靠近中线和参考线会吸附；按住 ⌘ 不吸附。</p>
          )}
        </section>
      )}
    </>
  );
}

/** 模板说明是写给 AI 的，去掉括号里的参数写法（含英文字母的括注） */
const forHumans = (text: string) => text.replace(/\s*[（(][^（）()]*[A-Za-z][^（）()]*[）)]/g, "");

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
        placeholder="写批注，回车记下（C）"
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
        记下
      </button>
    </div>
  );
}
