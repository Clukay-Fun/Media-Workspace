import { useEffect, useState } from "react";
import type { Caption } from "../../../core/schema";
import { useStore } from "../../store";
import { ListToggle } from "./caption-list";
import { InspectorActions, InspectorHead, type InspectorProps, StylePicker } from "./common";

/** 选中一句字幕：文字、样式 */
export function CaptionInspector(props: InspectorProps) {
  const { project, id, ref_ } = props;
  return (
    <div className="selection">
      <InspectorHead {...props} />
      <CaptionEditor caption={ref_.item as Caption} locked={ref_.track.locked} />
      <StylePicker project={project} id={id} ref_={ref_} sample="字幕" />
      <InspectorActions ref_={ref_}>
        <ListToggle />
      </InspectorActions>
    </div>
  );
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
