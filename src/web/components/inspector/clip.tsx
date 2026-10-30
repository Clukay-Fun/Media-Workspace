import { useStore } from "../../store";
import {
  Field,
  InspectorActions,
  InspectorHead,
  type InspectorProps,
  SlotPicker,
  TimingNudge,
} from "./common";

/** 选中视频 / 音频片段：主轨片段、画中画、音频轨上的片段 */
export function ClipInspector(props: InspectorProps) {
  const { project, id, ref_ } = props;
  const { track, item } = ref_;
  const anchored = "at" in item;
  const speed = "speed" in item && typeof item.speed === "number" ? item.speed : null;
  const cut = "cutBefore" in item ? (item.cutBefore as string | undefined) : undefined;
  return (
    <div className="selection">
      <InspectorHead {...props} />
      {cut && (
        <p className="cut-note">
          <span className="cut-tag static">{cut}</span>
          这一段前面剪掉了一截，理由是 AI 粗剪时写的
        </p>
      )}
      {anchored && track.kind !== "audio" && <SlotPicker id={id} ref_={ref_} />}
      {speed !== null && <SpeedField id={id} speed={speed} locked={track.locked} />}
      {anchored && !track.locked && <TimingNudge project={project} id={id} />}
      <InspectorActions ref_={ref_} />
    </div>
  );
}

const SPEEDS = [1, 1.1, 1.2, 1.25];

function SpeedField({ id, speed, locked }: { id: string; speed: number; locked: boolean }) {
  const setSpeed = (v: number) =>
    void useStore
      .getState()
      .submit([{ op: "item.update", id, set: { speed: v } }], `语速改成 ${v} 倍`);
  return (
    <Field label="语速">
      <div className="segmented" role="radiogroup" aria-label="语速">
        {SPEEDS.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={speed === v}
            className={speed === v ? "on" : undefined}
            disabled={locked}
            onClick={() => speed !== v && setSpeed(v)}
          >
            {v}×
          </button>
        ))}
      </div>
    </Field>
  );
}
