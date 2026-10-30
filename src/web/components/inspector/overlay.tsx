import {
  InspectorActions,
  InspectorHead,
  type InspectorProps,
  SlotPicker,
  StylePicker,
  TimingNudge,
} from "./common";

/** 选中标题 / 卡片：样式、位置、出现时间 */
export function OverlayInspector(props: InspectorProps) {
  const { project, id, ref_ } = props;
  return (
    <div className="selection">
      <InspectorHead {...props} />
      <StylePicker project={project} id={id} ref_={ref_} sample="标题" />
      <SlotPicker id={id} ref_={ref_} />
      {!ref_.track.locked && <TimingNudge project={project} id={id} />}
      <InspectorActions ref_={ref_} />
    </div>
  );
}
