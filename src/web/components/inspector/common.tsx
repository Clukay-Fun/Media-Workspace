import type React from "react";
import { useState } from "react";
import { planDrag } from "../../../core/edit";
import type { Op } from "../../../core/ops";
import type { Anchor, Caption, Project, Slot, Transform } from "../../../core/schema";
import { type StyleScope, styleEditOps } from "../../../core/style-scope";
import { findItem, type ItemRef, kindLabel } from "../../lib/project";
import { msOfFrame, timecode } from "../../lib/timeline";
import { useStore } from "../../store";
import { Icon } from "../icons";
import { swatch } from "../left-panel";

// 右栏属性的公共部分（docs/decisions/0015）。每类元素一个文件，只放它自己的控件；
// 几类都要用的控件（标题栏、样式、位置、出现时间、锁定）放这里。
// 所有修改都转成 ops 用 submit 提交（AGENTS.md 3.1），控件只在松手 / 确认时提交一次。

export type InspectorProps = { project: Project; id: string; ref_: ItemRef; fps: number };

export function Field({
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

/** 标题栏：类型、ID、出现时间和时长、关闭；有锚点时下面写清楚跟着谁出现 */
export function InspectorHead({ project, id, ref_, fps }: InspectorProps) {
  const tl = useStore((s) => s.preview?.timeline);
  const resolved = tl
    ? [...tl.videos, ...tl.images, ...tl.captions, ...tl.overlays].filter((x) => x.id === id)
    : [];
  const from = resolved.length ? Math.min(...resolved.map((r) => r.from)) : null;
  const to = resolved.length ? Math.max(...resolved.map((r) => r.from + r.durationInFrames)) : null;
  const anchor = "at" in ref_.item ? (ref_.item.at as Anchor) : null;
  return (
    <>
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
    </>
  );
}

/** 底部操作：各类元素自己的按钮放在 children，最后是锁定 */
export function InspectorActions({
  ref_,
  children,
}: {
  ref_: ItemRef;
  children?: React.ReactNode;
}) {
  const { track } = ref_;
  const lock = () =>
    void useStore
      .getState()
      .submit(
        [{ op: "track.update", id: track.id, set: { locked: !track.locked } }],
        track.locked ? "已解锁轨道" : "已锁定轨道，AI 也不能改动它",
      );
  return (
    <div className="selection-actions">
      {children}
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
  );
}

/**
 * 一个元素适合用哪些样式：同类元素（字幕 / 标题 / 卡片）已经在用的，加上名字前缀相同的（caption-、title-、card-）。
 * 其余样式收在「更多样式」里，免得给字幕列出标题条、卡片的样式
 */
function relevantStyles(project: Project, ref_: ItemRef): Set<string> {
  const isCaption = ref_.track.kind === "caption";
  const template = "template" in ref_.item ? String(ref_.item.template) : "";
  const group = (tpl: string) => (tpl.startsWith("title") ? "title" : "card");
  const prefix = isCaption ? "caption" : group(template);
  const used = new Set<string>();
  for (const t of project.tracks) {
    if (isCaption ? t.kind !== "caption" : t.kind !== "overlay") continue;
    if ("style" in t && t.style && isCaption) used.add(t.style);
    for (const it of t.items) {
      if (!isCaption && "template" in it && group(String(it.template)) !== prefix) continue;
      if ("style" in it && it.style) used.add(it.style);
    }
  }
  return new Set(
    Object.keys(project.styles).filter((n) => used.has(n) || n.startsWith(`${prefix}-`)),
  );
}

/** 换成工程里的另一个样式（整套替换） */
export function StylePicker({
  project,
  id,
  ref_,
  sample,
}: {
  project: Project;
  id: string;
  ref_: ItemRef;
  sample: string;
}) {
  const [more, setMore] = useState(false);
  const isCaption = ref_.track.kind === "caption";
  const own = "style" in ref_.item ? (ref_.item.style ?? null) : null;
  // 元素没写样式时用轨道的样式（字幕轨）
  const styleId = own ?? ("style" in ref_.track ? (ref_.track.style ?? null) : null);
  const setStyle = (style: string) => {
    const op: Op = isCaption
      ? { op: "caption.update", id, set: { style } }
      : { op: "item.update", id, set: { style } };
    void useStore.getState().submit([op], `已套用样式「${style}」`);
  };
  const fit = relevantStyles(project, ref_);
  const names = Object.keys(project.styles);
  const shown = names.filter((n) => more || fit.has(n) || n === styleId);
  const hidden = names.length - names.filter((n) => fit.has(n) || n === styleId).length;
  return (
    <Field label="样式">
      <div className="style-grid">
        {shown.flatMap((name) => {
          const style = project.styles[name];
          return style
            ? [
                <button
                  key={name}
                  type="button"
                  className={styleId === name ? "style-chip on" : "style-chip"}
                  disabled={ref_.track.locked}
                  title={name}
                  onClick={() => styleId !== name && setStyle(name)}
                >
                  <span className="style-chip-sample" style={swatch(style)}>
                    {sample}
                  </span>
                  <span className="style-chip-name">{name}</span>
                </button>,
              ]
            : [];
        })}
      </div>
      {hidden > 0 && (
        <button type="button" className="link more-styles" onClick={() => setMore(!more)}>
          {more ? "收起" : `更多样式（${hidden}）`}
        </button>
      )}
    </Field>
  );
}

/**
 * 改字幕 / 标题样式里的几个字段。scope = item 只改这一个元素（第一次会复制出它专属的样式），
 * shared = 所有用这个样式的元素一起改。fallback 是元素和轨道都没指定样式时用的默认样式。
 */
export function editStyle(
  id: string,
  patch: Record<string, unknown>,
  scope: StyleScope,
  fallback: string,
  label = "样式已修改",
) {
  const { project, submit, toast } = useStore.getState();
  if (!project) return;
  try {
    const { ops } = styleEditOps(project, id, patch, scope, fallback);
    void submit(ops, label);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "error");
  }
}

/** 位置预设（标题、画中画、图片） */
export function SlotPicker({ id, ref_ }: { id: string; ref_: ItemRef }) {
  const { item, track } = ref_;
  const slot = "slot" in item ? ((item.slot as Slot | undefined) ?? null) : null;
  const transform = "transform" in item ? (item.transform as Transform | undefined) : undefined;
  const customPos = transform?.x !== undefined || transform?.y !== undefined;
  const setSlot = (s: Slot) => {
    // 拖动过的元素带着 x / y，会盖住位置预设；换位置时一起去掉
    const { x: _x, y: _y, ...rest } = transform ?? {};
    const set = customPos ? { slot: s, transform: rest } : { slot: s };
    void useStore.getState().submit([{ op: "item.update", id, set }], `已放到「${SLOT_LABEL[s]}」`);
  };
  return (
    <Field label="位置" note={customPos ? "拖动过，自定义位置" : undefined}>
      <div className="slot-picker" role="radiogroup" aria-label="位置">
        {SLOTS.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={!customPos && slot === s}
            className={!customPos && slot === s ? "slot on" : "slot"}
            disabled={track.locked}
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
  );
}

/** 出现时间微调（有锚点的元素） */
export function TimingNudge({ project, id }: { project: Project; id: string }) {
  const nudge = (deltaMs: number) => {
    const { submit, toast } = useStore.getState();
    try {
      const plan = planDrag(project, { id, mode: "move", deltaMs, snap: false });
      void submit(
        plan.ops,
        deltaMs < 0 ? `提前了 ${-deltaMs / 1000} 秒` : `延后了 ${deltaMs / 1000} 秒`,
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };
  return (
    <Field label="出现时间">
      <div className="nudge" role="group" aria-label="调整出现时间">
        <NudgeBtn icon="back" label="提前 0.5 秒" onClick={() => nudge(-500)} />
        <NudgeBtn icon="prev" label="提前 0.1 秒" onClick={() => nudge(-100)} />
        <NudgeBtn icon="next" label="延后 0.1 秒" onClick={() => nudge(100)} />
        <NudgeBtn icon="forward" label="延后 0.5 秒" onClick={() => nudge(500)} />
      </div>
    </Field>
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
