import { useEffect, useState } from "react";
import type { Caption } from "../../../core/schema";
import { useStore } from "../../store";
import { CAPTION_INSPECTOR_TABS } from "./caption-batch";
import { CaptionList } from "./caption-list";
import { InspectorHead, type InspectorProps, isImeComposing, StylePicker, Tabs } from "./common";
import { TextStyleEditor } from "./text-style-editor";

/** 选中一句字幕：这一句的文字和样式、整套换样式、全部字幕三页（问题 12） */
export function CaptionInspector(props: InspectorProps) {
  const { project, id, ref_ } = props;
  const tab = useStore((s) => s.captionTab);
  return (
    <div className="selection mw-inspector-caption">
      <InspectorHead {...props} />
      <Tabs
        label="字幕属性"
        value={tab}
        onChange={useStore.getState().setCaptionTab}
        items={CAPTION_INSPECTOR_TABS.map((item) => ({ id: item.id, label: item.label }))}
      />
      {tab === "list" && <CaptionList />}
      {tab === "edit" && (
        <>
          <CaptionEditor caption={ref_.item as Caption} locked={ref_.track.locked} />
          <TextStyleEditor
            project={project}
            id={id}
            ref_={ref_}
            fallback="caption-word-yellow"
            showHighlight
            elementLabel="字幕"
            section="edit"
          />
        </>
      )}
      {tab === "style" && (
        <>
          <StylePicker project={project} id={id} ref_={ref_} sample="字幕" />
          <TextStyleEditor
            project={project}
            id={id}
            ref_={ref_}
            fallback="caption-word-yellow"
            showHighlight
            elementLabel="字幕"
            section="style"
          />
        </>
      )}
      {tab === "motion" && (
        <TextStyleEditor
          project={project}
          id={id}
          ref_={ref_}
          fallback="caption-word-yellow"
          showHighlight
          elementLabel="字幕"
          section="motion"
        />
      )}
    </div>
  );
}

function CaptionEditor({ caption, locked }: { caption: Caption; locked: boolean }) {
  const [text, setText] = useState(caption.text);
  useEffect(() => setText(caption.text), [caption.text]);
  const save = () => {
    const t = text.trim();
    if (!t || t === caption.text) return setText(caption.text);
    const retimed =
      Boolean(caption.charStartMs?.length) && [...t].length !== [...caption.text].length;
    void useStore
      .getState()
      .submit(
        [{ op: "caption.update", id: caption.id, set: { text: t } }],
        retimed ? "字幕已修改。字数变了，逐字时间可能对不上，需要重新对齐" : "字幕已修改",
      );
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
          if (isImeComposing(e)) return;
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
