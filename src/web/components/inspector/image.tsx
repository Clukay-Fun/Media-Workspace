import {
  InspectorActions,
  InspectorHead,
  type InspectorProps,
  SlotPicker,
  TimingNudge,
} from "./common";

/** 选中图片：位置、出现时间 */
export function ImageInspector(props: InspectorProps) {
  const { project, id, ref_ } = props;
  return (
    <div className="selection">
      <InspectorHead {...props} />
      <SlotPicker id={id} ref_={ref_} />
      {!ref_.track.locked && <TimingNudge project={project} id={id} />}
      <InspectorActions ref_={ref_} />
    </div>
  );
}
