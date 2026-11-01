/**
 * 描述: 字幕属性面板组件
 * 主要功能:
 *   - 字幕文本修改（支持中文输入法防误提交/防失焦）
 *   - 字幕样式与逐字对齐标记展示
 *   - 全部字幕列表展开切换
 */

import { useEffect, useState } from "react";
import type { Caption } from "../../../core/schema";
import { useStore } from "../../store";
import { ListToggle } from "./caption-list";
import {
  InspectorActions,
  InspectorHead,
  type InspectorProps,
  isImeComposing,
  StylePicker,
} from "./common";
import { TextStyleEditor } from "./text-style-editor";

//#region 字幕属性面板

/**
 * 选中一句字幕：文字、样式。
 *
 * 用处，参数:
 *   - props: 属性栏公共参数（工程、条目引用等）
 *
 * 功能:
 *   - 渲染字幕信息、文字编辑、样式选择及操作区
 */
export function CaptionInspector(props: InspectorProps) {
  const { project, id, ref_ } = props;
  return (
    <div className="selection">
      <InspectorHead {...props} />
      <CaptionEditor caption={ref_.item as Caption} locked={ref_.track.locked} />
      <StylePicker project={project} id={id} ref_={ref_} sample="字幕" />
      <TextStyleEditor
        project={project}
        id={id}
        ref_={ref_}
        fallback="caption-word-yellow"
        showHighlight
        elementLabel="字幕"
      />
      <InspectorActions ref_={ref_}>
        <ListToggle />
      </InspectorActions>
    </div>
  );
}

//#endregion

//#region 字幕文本编辑器

/**
 * 字幕文字内容编辑框。
 *
 * 用处，参数:
 *   - caption: 字幕对象
 *   - locked: 所在轨道是否锁定
 *
 * 功能:
 *   - 输入法组字选词（isComposing / keyCode 229）按回车不提交不失焦
 *   - 回车失焦提交修改，Esc 放弃修改并还原
 */
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

//#endregion
