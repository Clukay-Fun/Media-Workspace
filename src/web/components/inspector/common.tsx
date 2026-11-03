import type React from "react";
import { useState } from "react";
import { builtinStyles } from "../../../core/aspect";
import type { Op } from "../../../core/ops";
import type { Anchor, Caption, Project, Slot, Transform } from "../../../core/schema";
import { type StyleScope, styleEditOps } from "../../../core/style-scope";
import { displayName, findItem, type ItemRef, kindLabel } from "../../lib/project";
import { itemFrames, msOfFrame, timecode } from "../../lib/timeline";
import { useStore } from "../../store";
import { Icon } from "../icons";
import { swatch } from "../left-panel";

// 右栏属性的公共部分（docs/decisions/0015）。每类元素一个文件，只放它自己的控件；
// 几类都要用的控件（标题栏、选项卡、样式、位置）放这里。锁定只在时间线轨道头上（问题 10）。
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

/**
 * 标题栏：类型、名字、取消选中；下面一行写开始时间、时长，有锚点时写清楚跟着谁出现（问题 2）。
 * 取消选中只清掉选中，右栏保持打开（问题 25）
 */
export function InspectorHead({ project, id, ref_, fps }: InspectorProps) {
  const tl = useStore((s) => s.preview?.timeline);
  const range = tl ? itemFrames(tl, id) : null;
  const anchor = "at" in ref_.item ? (ref_.item.at as Anchor) : null;
  return (
    <div className="selection-intro">
      <header className="selection-head">
        <span className="kind-badge">{kindLabel(ref_)}</span>
        <h2 title={`ID：${id}`}>{displayName(project, ref_)}</h2>
        <button
          type="button"
          className="icon-btn ghost close"
          aria-label="取消选中"
          title="取消选中"
          onClick={() => useStore.getState().select(null)}
        >
          <Icon name="close" size={12} />
        </button>
      </header>
      <dl className="selection-meta">
        {range && (
          <>
            <div>
              <dt>开始</dt>
              <dd className="mono">{timecode(range.from, fps)}</dd>
            </div>
            <div>
              <dt>时长</dt>
              <dd>{(msOfFrame(range.to - range.from, fps) / 1000).toFixed(1)} 秒</dd>
            </div>
          </>
        )}
        {anchor && (
          <div className="wide">
            <dt>出现</dt>
            <dd>{describeAnchor(project, anchor)}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/** 小选项卡：字幕的文字 / 样式 / 全部字幕，动画的入场 / 出场 / 循环。dot 标出这一页已经设了东西 */
export function Tabs<T extends string>({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: T;
  items: { id: T; label: string; dot?: boolean }[];
  onChange: (id: T) => void;
}) {
  return (
    <div className="sub-tabs" role="tablist" aria-label={label}>
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          className={value === t.id ? "on" : undefined}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.dot && <span className="tab-dot" aria-label="已设置" />}
        </button>
      ))}
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
  const [q, setQ] = useState("");
  const isCaption = ref_.track.kind === "caption";
  const template = "template" in ref_.item ? String(ref_.item.template) : "";
  const prefix = isCaption ? "caption" : template.startsWith("title") ? "title" : "card";
  const builtins = builtinStyles(project.canvas);
  const own = "style" in ref_.item ? (ref_.item.style ?? null) : null;
  // 元素没写样式时用轨道的样式（字幕轨）
  const styleId = own ?? ("style" in ref_.track ? (ref_.track.style ?? null) : null);
  const setStyle = (style: string) => {
    const ops: Op[] = [];
    const preset = project.styles[style] ?? builtins[style];
    // 内置样式没有复制进工程时先复制，套用后旧工程仍然能独立开
    if (!project.styles[style] && preset) ops.push({ op: "style.add", id: style, style: preset });
    ops.push(
      isCaption
        ? { op: "caption.update", id, set: { style } }
        : { op: "item.update", id, set: { style } },
    );
    void useStore.getState().submit(ops, `已套用样式「${style}」`);
  };
  const fit = relevantStyles(project, ref_);
  for (const name of Object.keys(builtins)) {
    if (name.startsWith(`${prefix}-`)) fit.add(name);
  }
  const names = [...new Set([...Object.keys(project.styles), ...Object.keys(builtins)])];
  const query = q.trim().toLowerCase();
  const inCategory = (n: string) => fit.has(n) || n === styleId;
  // 搜索也要受元素类别限制：字幕栏不能搜出标题 / 卡片样式
  const shown = names.filter((n) =>
    query ? inCategory(n) && n.toLowerCase().includes(query) : more || inCategory(n),
  );
  const hidden = names.length - names.filter((n) => fit.has(n) || n === styleId).length;
  return (
    <Field label="样式">
      <label className="search">
        <input
          type="search"
          value={q}
          placeholder="搜索样式名"
          aria-label="搜索样式"
          onChange={(e) => setQ(e.currentTarget.value)}
        />
      </label>
      <div className="style-grid">
        {shown.flatMap((name) => {
          const style = project.styles[name] ?? builtins[name];
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
                  <span className="style-chip-name">
                    {name}
                    {!project.styles[name] ? " · 内置" : ""}
                  </span>
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

function describeAnchor(project: Project, at: Anchor): string {
  if ("ms" in at) return `固定在第 ${(at.ms / 1000).toFixed(1)} 秒，不跟着片段或字幕走`;
  const off = at.offsetMs
    ? `，${at.offsetMs > 0 ? "延后" : "提前"} ${Math.abs(at.offsetMs / 1000)} 秒`
    : "";
  if ("clip" in at) return `跟着片段 ${at.clip} 开始${off}`;
  const cap = findItem(project, at.caption)?.item as Caption | undefined;
  if (at.char !== undefined && cap) {
    const ch = [...cap.text][at.char] ?? "";
    return `念到「${cap.text}」第 ${at.char + 1} 个字「${ch}」时${off}`;
  }
  return cap ? `跟着字幕「${cap.text}」开始${off}` : `跟着字幕 ${at.caption}${off}`;
}

/** 中文输入法选字时按回车是确认候选词，不能当成提交（229 是部分浏览器组字时的 keyCode） */
export function isImeComposing(e: React.KeyboardEvent<HTMLElement> | KeyboardEvent): boolean {
  const isComp = "nativeEvent" in e ? e.nativeEvent.isComposing : e.isComposing;
  return Boolean(isComp) || e.keyCode === 229;
}
