import { useEffect, useRef } from "react";
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

/** 全部字幕，点一句跳过去；当前选中的那句滚到可见 */
export function CaptionList() {
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
