import { useEffect, useRef, useState } from "react";
import { highlightAt, highlightMask } from "../../../core/animate";
import type { Caption, Highlight } from "../../../core/schema";
import { findItem } from "../../lib/project";
import { timecode } from "../../lib/timeline";
import { useStore } from "../../store";
import { Icon } from "../icons";

export function ListToggle() {
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

/**
 * 全部字幕，点一句跳过去；当前选中的那句滚到可见。
 * 每句右边的笔展开这一句的高亮编辑（docs/decisions/0015），只改这一句，不跳转。
 */
export function CaptionList() {
  const tl = useStore((s) => s.preview?.timeline);
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selected);
  const frame = useStore((s) => s.frame);
  const [editing, setEditing] = useState<string | null>(null);
  const current = useRef<HTMLDivElement>(null);
  useEffect(() => {
    current.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  if (!tl || !project) return null;
  // 中间被剪开的字幕会分成几段显示，列表里只列一次
  const captions = tl.captions.filter((c) => c.part === 0).toSorted((a, b) => a.from - b.from);
  return (
    <>
      <header className="selection-head">
        <span className="kind-badge">字幕 {captions.length} 句</span>
        <ListToggle />
      </header>
      <div className="caption-list">
        {captions.map((c) => {
          const ref_ = findItem(project, c.id);
          const cap = ref_?.item as Caption | undefined;
          const text = cap?.text ?? c.text;
          const highlights = cap?.highlights ?? [];
          const playing = frame >= c.from && frame < c.from + c.durationInFrames;
          const open = editing === c.id;
          return (
            <div
              key={c.id}
              ref={c.id === selected ? current : undefined}
              className={[
                "caption-row",
                c.id === selected ? "current" : "",
                playing ? "playing" : "",
              ].join(" ")}
            >
              <button
                type="button"
                className="caption-row-main"
                onClick={() => {
                  const { select, seek } = useStore.getState();
                  select(c.id, { reveal: false });
                  seek(c.from);
                }}
              >
                <span className="mono">{timecode(c.from, tl.fps)}</span>
                <MarkedText text={text} highlights={highlights} />
              </button>
              <button
                type="button"
                className={open ? "icon-btn ghost on" : "icon-btn ghost"}
                aria-label={open ? "收起高亮" : "标高亮"}
                aria-expanded={open}
                title={open ? "收起" : "标高亮：在文字里选中要强调的词"}
                onClick={() => setEditing(open ? null : c.id)}
              >
                <Icon name="marker" size={12} />
              </button>
              {open && cap && (
                <HighlightEditor caption={cap} locked={ref_?.track.locked ?? false} />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** 已高亮的字标出来，和成片里的效果对应 */
function MarkedText({ text, highlights }: { text: string; highlights: Highlight[] }) {
  if (highlights.length === 0) return <span className="caption-row-text">{text}</span>;
  const mask = highlightMask(text, highlights);
  return (
    <span className="caption-row-text">
      {[...text].map((ch, i) => (
        <span key={i} className={mask[i] ? "hl" : undefined}>
          {ch}
        </span>
      ))}
    </span>
  );
}

/** 在这句里选中文字 → 标为高亮；已有的高亮点 × 去掉 */
function HighlightEditor({ caption, locked }: { caption: Caption; locked: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<[number, number] | null>(null);
  const chars = [...caption.text];
  const mask = highlightMask(caption.text, caption.highlights);
  const picked = range ? highlightAt(caption.text, range[0], range[1]) : null;
  const exists = picked
    ? caption.highlights.some((h) => h.text === picked.text && h.nth === picked.nth)
    : false;

  // 选区里有哪些字：按字所在的 span 判断，选到半个字也算
  const readSelection = () => {
    const sel = window.getSelection();
    const spans = box.current?.querySelectorAll<HTMLElement>("[data-i]");
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !spans) return setRange(null);
    const r = sel.getRangeAt(0);
    const hit = [...spans].filter((s) => r.intersectsNode(s)).map((s) => Number(s.dataset.i));
    setRange(hit.length ? [Math.min(...hit), Math.max(...hit) + 1] : null);
  };

  const save = (highlights: Highlight[], label: string) =>
    void useStore
      .getState()
      .submit([{ op: "caption.update", id: caption.id, set: { highlights } }], label);

  const add = () => {
    if (!picked || exists) return;
    save([...caption.highlights, picked], `已高亮「${picked.text}」`);
    window.getSelection()?.removeAllRanges();
    setRange(null);
  };

  return (
    <div className="hl-editor">
      <div
        ref={box}
        className="hl-text"
        onMouseUp={readSelection}
        onKeyUp={readSelection}
        role="textbox"
        aria-readonly="true"
        aria-label="选中要高亮的文字"
        tabIndex={0}
      >
        {chars.map((ch, i) => (
          <span key={i} data-i={i} className={mask[i] ? "hl" : undefined}>
            {ch}
          </span>
        ))}
      </div>
      <div className="hl-actions">
        <button
          type="button"
          className="mini-btn"
          disabled={locked || !picked || exists}
          // 按下时不让按钮抢走文字选区
          onMouseDown={(e) => e.preventDefault()}
          onClick={add}
        >
          <Icon name="marker" size={12} />
          {picked ? `高亮「${picked.text}」` : "先选中文字"}
        </button>
        {caption.highlights.map((h, i) => (
          <span key={`${h.text}-${h.nth ?? "all"}`} className="hl-chip">
            {h.text}
            {h.nth !== undefined && <span className="hl-nth">第 {h.nth + 1} 处</span>}
            <button
              type="button"
              aria-label={`去掉高亮「${h.text}」`}
              disabled={locked}
              onClick={() =>
                save(
                  caption.highlights.filter((_, k) => k !== i),
                  `已去掉高亮「${h.text}」`,
                )
              }
            >
              <Icon name="close" size={10} />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
