import { useEffect, useState } from "react";
import type { Overlay } from "../../../core/schema";
import { TEMPLATES } from "../../../templates";
import { InspectorHead, type InspectorProps, SlotPicker, StylePicker, Tabs } from "./common";
import { TextStyleEditor } from "./text-style-editor";

/** 选中标题 / 卡片：样式、位置、出现时间 */
export function OverlayInspector(props: InspectorProps) {
  const { project, id, ref_ } = props;
  const overlay = ref_.item as Overlay;
  const fallback = TEMPLATES[overlay.template]?.meta.defaultStyle ?? "title-bar-yellow";
  const [page, setPage] = useState<"properties" | "styles">("properties");
  useEffect(() => setPage("properties"), [id]);
  return (
    <div className="selection">
      <InspectorHead {...props} />
      <Tabs
        label="标题属性页面"
        value={page}
        onChange={setPage}
        items={[
          { id: "properties", label: "属性" },
          { id: "styles", label: "套用样式" },
        ]}
      />
      {page === "properties" ? (
        <>
          <TextStyleEditor
            project={project}
            id={id}
            ref_={ref_}
            fallback={fallback}
            elementLabel="标题 / 卡片"
          />
          <SlotPicker id={id} ref_={ref_} />
        </>
      ) : (
        <StylePicker project={project} id={id} ref_={ref_} sample="标题" />
      )}
    </div>
  );
}
