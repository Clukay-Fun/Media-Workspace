import { useEffect, useRef, useState } from "react";
import { builtinStyles } from "../../../core/aspect";
import type { Overlay, Project } from "../../../core/schema";
import { TEMPLATES } from "../../../templates";
import { useStore } from "../../store";
import {
  editStyle,
  Field,
  InspectorHead,
  type InspectorProps,
  isImeComposing,
  SlotPicker,
  StylePicker,
  Tabs,
} from "./common";
import { overlayPropOp, TITLE_LOOKS, titleLookPatch } from "./overlay-fields";
import { TextStyleEditor } from "./text-style-editor";

type OverlayPage = "edit" | "templates" | "style" | "motion";

/** 选中标题 / 卡片：内容、外观预设、样式、动效 */
export function OverlayInspector(props: InspectorProps) {
  const { project, id, ref_ } = props;
  const overlay = ref_.item as Overlay;
  const fallback = TEMPLATES[overlay.template]?.meta.defaultStyle ?? "title-bar-yellow";
  const [page, setPage] = useState<OverlayPage>("edit");
  useEffect(() => setPage("edit"), [id]);
  return (
    <div className="selection mw-inspector-overlay">
      <InspectorHead {...props} />
      <Tabs
        label="标题属性"
        value={page}
        onChange={setPage}
        items={[
          { id: "edit", label: "编辑" },
          { id: "templates", label: "标题模板" },
          { id: "style", label: "样式" },
          { id: "motion", label: "动效" },
        ]}
      />
      {page === "edit" && (
        <>
          <OverlayPropEditor
            id={id}
            project={project}
            template={overlay.template}
            props={overlay.props}
            locked={ref_.track.locked}
          />
          <SlotPicker id={id} ref_={ref_} />
        </>
      )}
      {page === "templates" && (
        <>
          <TitleLooks id={id} project={project} fallback={fallback} locked={ref_.track.locked} />
          <StylePicker project={project} id={id} ref_={ref_} sample="标题" />
        </>
      )}
      {page === "style" && (
        <TextStyleEditor
          project={project}
          id={id}
          ref_={ref_}
          fallback={fallback}
          elementLabel="标题"
          section="style"
        />
      )}
      {page === "motion" && (
        <TextStyleEditor
          project={project}
          id={id}
          ref_={ref_}
          fallback={fallback}
          elementLabel="标题"
          section="motion"
        />
      )}
    </div>
  );
}

function TitleLooks({
  id,
  project,
  fallback,
  locked,
}: {
  id: string;
  project: Project;
  fallback: string;
  locked: boolean;
}) {
  const builtins = builtinStyles(project.canvas);
  return (
    <Field label="标题模板" note="只改文字样式，不换结构模板">
      <div className="preset-row">
        {TITLE_LOOKS.map((look) => (
          <button
            key={look.id}
            type="button"
            className="preset-chip"
            disabled={locked || !look.enabled}
            onClick={() => {
              const chosen = titleLookPatch(look.id);
              const style = chosen
                ? (project.styles[chosen.styleId] ?? builtins[chosen.styleId])
                : null;
              if (!chosen || !style) return;
              editStyle(
                id,
                style as unknown as Record<string, unknown>,
                "item",
                fallback,
                `已套用「${look.label}」`,
              );
            }}
          >
            <b>{look.label}</b>
            {!look.enabled && <span>未登记</span>}
          </button>
        ))}
      </div>
    </Field>
  );
}

function OverlayPropEditor({
  id,
  project,
  template,
  props,
  locked,
}: {
  id: string;
  project: Project;
  template: string;
  props: Record<string, unknown>;
  locked: boolean;
}) {
  const commit = (field: string, value: unknown) => {
    try {
      const op = overlayPropOp(id, template, props, field, value);
      void useStore.getState().submit([op], "标题内容已修改");
    } catch (error) {
      useStore.getState().toast(error instanceof Error ? error.message : String(error), "error");
      return false;
    }
    return true;
  };
  if (template === "screenshot") {
    const images = Object.entries(project.assets).filter(([, asset]) => asset.kind === "image");
    return (
      <Field label="截图">
        {images.length === 0 ? (
          <p className="field-note">工程里没有图片素材，不能更换截图</p>
        ) : (
          <select
            className="select"
            aria-label="图片"
            disabled={locked}
            value={typeof props.image === "string" ? props.image : ""}
            onChange={(event) => commit("image", event.target.value)}
          >
            <option value="" disabled>
              选择图片
            </option>
            {images.map(([assetId]) => (
              <option key={assetId} value={assetId}>
                {assetId}
              </option>
            ))}
          </select>
        )}
        <DraftText
          label="说明"
          value={typeof props.caption === "string" ? props.caption : ""}
          locked={locked}
          onCommit={(value) => commit("caption", value)}
        />
      </Field>
    );
  }
  if (template === "title-bar") {
    const lines = Array.isArray(props.lines) ? props.lines.map(String) : [];
    return (
      <DraftText
        label="标题行"
        value={lines.join("\n")}
        locked={locked}
        rows={3}
        onCommit={(value) =>
          commit(
            "lines",
            value
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean),
          )
        }
      />
    );
  }
  if (template === "text-card") {
    return (
      <>
        <DraftText
          label="标题"
          value={typeof props.title === "string" ? props.title : ""}
          locked={locked}
          onCommit={(value) => commit("title", value)}
        />
        <DraftText
          label="正文"
          value={typeof props.body === "string" ? props.body : ""}
          locked={locked}
          rows={4}
          onCommit={(value) => commit("body", value)}
        />
      </>
    );
  }
  if (template === "quote") {
    return (
      <>
        <DraftText
          label="金句"
          value={typeof props.text === "string" ? props.text : ""}
          locked={locked}
          max={36}
          onCommit={(value) => commit("text", value)}
        />
        <DraftText
          label="出处"
          value={typeof props.source === "string" ? props.source : ""}
          locked={locked}
          max={18}
          onCommit={(value) => commit("source", value)}
        />
      </>
    );
  }
  if (template === "bullet-list") {
    const items = Array.isArray(props.items) ? props.items : [];
    return (
      <>
        <DraftText
          label="标题"
          value={typeof props.title === "string" ? props.title : ""}
          locked={locked}
          max={18}
          onCommit={(value) => commit("title", value)}
        />
        <Field label="要点">
          {items.map((item, index) => {
            const row =
              item && typeof item === "object" ? (item as { text?: string; atMs?: number }) : {};
            return (
              <div key={index} className="insp-row">
                <DraftText
                  label={`要点 ${index + 1}`}
                  value={row.text ?? ""}
                  locked={locked}
                  max={14}
                  onCommit={(value) => {
                    const next = items.map((entry, entryIndex) =>
                      entryIndex === index && entry && typeof entry === "object"
                        ? { ...entry, text: value }
                        : entry,
                    );
                    return commit("items", next);
                  }}
                />
                <DraftText
                  label={`要点 ${index + 1} 时间`}
                  value={row.atMs === undefined ? "" : String(row.atMs)}
                  locked={locked}
                  onCommit={(value) => {
                    const atMs = value.trim() === "" ? undefined : Number(value);
                    const next = items.map((entry, entryIndex) => {
                      if (entryIndex !== index || !entry || typeof entry !== "object") return entry;
                      const copy = { ...entry } as { text?: string; atMs?: number };
                      if (atMs === undefined) delete copy.atMs;
                      else copy.atMs = atMs;
                      return copy;
                    });
                    return commit("items", next);
                  }}
                />
              </div>
            );
          })}
        </Field>
      </>
    );
  }
  if (template === "big-number") {
    return (
      <>
        <DraftText
          label="数字"
          value={props.to === undefined ? "" : String(props.to)}
          locked={locked}
          onCommit={(value) => commit("to", Number(value))}
        />
        <DraftText
          label="前缀"
          value={typeof props.prefix === "string" ? props.prefix : ""}
          locked={locked}
          max={12}
          onCommit={(value) => commit("prefix", value)}
        />
        <DraftText
          label="后缀"
          value={typeof props.suffix === "string" ? props.suffix : ""}
          locked={locked}
          max={6}
          onCommit={(value) => commit("suffix", value)}
        />
        <DraftText
          label="说明"
          value={typeof props.label === "string" ? props.label : ""}
          locked={locked}
          max={12}
          onCommit={(value) => commit("label", value)}
        />
      </>
    );
  }
  if (template === "name-bar") {
    return (
      <>
        <DraftText
          label="名字"
          value={typeof props.name === "string" ? props.name : ""}
          locked={locked}
          max={8}
          onCommit={(value) => commit("name", value)}
        />
        <DraftText
          label="头衔"
          value={typeof props.title === "string" ? props.title : ""}
          locked={locked}
          max={12}
          onCommit={(value) => commit("title", value)}
        />
      </>
    );
  }
  if (template === "tip-bar") {
    return (
      <DraftText
        label="提示"
        value={typeof props.text === "string" ? props.text : ""}
        locked={locked}
        max={16}
        onCommit={(value) => commit("text", value)}
      />
    );
  }
  return <p className="field-note">这个模板没有单独的文字字段</p>;
}

function DraftText({
  label,
  value,
  locked,
  rows = 2,
  max,
  onCommit,
}: {
  label: string;
  value: string;
  locked: boolean;
  rows?: number;
  max?: number;
  onCommit: (value: string) => boolean;
}) {
  const [draft, setDraft] = useState(value);
  const cancelOnBlur = useRef(false);
  useEffect(() => setDraft(value), [value]);
  const save = () => {
    if (draft === value) return;
    if (!onCommit(draft)) setDraft(value);
  };
  return (
    <Field label={label}>
      <textarea
        className="caption-text"
        rows={rows}
        value={draft}
        disabled={locked}
        maxLength={max}
        aria-label={label}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => {
          cancelOnBlur.current = false;
        }}
        onBlur={() => {
          if (cancelOnBlur.current) {
            cancelOnBlur.current = false;
            return;
          }
          save();
        }}
        onKeyDown={(event) => {
          if (isImeComposing(event)) return;
          if (event.key === "Enter" && !event.shiftKey && rows === 2) {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            cancelOnBlur.current = true;
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
      />
    </Field>
  );
}
