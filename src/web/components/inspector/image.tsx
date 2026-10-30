import { useEffect, useState } from "react";
import type { ImageItem, Transform } from "../../../core/schema";
import type { Anim } from "../../../core/text-style";
import { useStore } from "../../store";
import {
  Field,
  InspectorActions,
  InspectorHead,
  type InspectorProps,
  SlotPicker,
  TimingNudge,
} from "./common";

/** 选中图片：位置和大小、入场 / 出场动画、出现时间 */
export function ImageInspector(props: InspectorProps) {
  const { project, id, ref_ } = props;
  const image = ref_.item as ImageItem;
  const resolved = useStore((s) => s.preview?.timeline.images.find((i) => i.id === id));
  const shown = resolved?.transform ?? {
    x: project.canvas.width / 2,
    y: project.canvas.height / 2,
    scale: 1,
    rotation: 0,
    opacity: 1,
    radius: 0,
  };
  const locked = ref_.track.locked;

  // 只写改过的字段：其它值继续跟着槽位 / 默认值走，不会被一次编辑全部钉死
  const setTransform = (patch: Partial<Transform>, label: string) => {
    const next = { ...(image.transform ?? {}), ...patch };
    void useStore.getState().submit([{ op: "item.update", id, set: { transform: next } }], label);
  };

  const setAnim = (key: "animIn" | "animOut", anim: Anim | null) => {
    void useStore
      .getState()
      .submit(
        [{ op: "item.update", id, set: { [key]: anim ?? undefined } }],
        anim ? (key === "animIn" ? "已加入场动画" : "已加出场动画") : "已关闭动画",
      );
  };

  return (
    <div className="selection">
      <InspectorHead {...props} />
      <SlotPicker id={id} ref_={ref_} />
      <Field label="位置和大小">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <NumField
            label="缩放 %"
            value={Math.round(shown.scale * 100)}
            min={1}
            max={2000}
            disabled={locked}
            onCommit={(v) => setTransform({ scale: v / 100 }, `缩放改成 ${v}%`)}
          />
          <NumField
            label="旋转 °"
            value={Math.round(shown.rotation * 10) / 10}
            step={1}
            disabled={locked}
            onCommit={(v) => setTransform({ rotation: v }, `旋转改成 ${v}°`)}
          />
          <NumField
            label="X"
            value={Math.round(shown.x)}
            disabled={locked}
            onCommit={(v) => setTransform({ x: v }, `X 移到 ${v}`)}
          />
          <NumField
            label="Y"
            value={Math.round(shown.y)}
            disabled={locked}
            onCommit={(v) => setTransform({ y: v }, `Y 移到 ${v}`)}
          />
          <NumField
            label="不透明度 %"
            value={Math.round(shown.opacity * 100)}
            min={0}
            max={100}
            disabled={locked}
            onCommit={(v) => setTransform({ opacity: v / 100 }, `不透明度改成 ${v}%`)}
          />
          <NumField
            label="圆角 px"
            value={Math.round(shown.radius)}
            min={0}
            disabled={locked}
            onCommit={(v) => setTransform({ radius: v }, `圆角改成 ${v}px`)}
          />
        </div>
      </Field>
      <AnimField
        label="入场动画"
        anim={image.animIn ?? null}
        locked={locked}
        onChange={(a) => setAnim("animIn", a)}
      />
      <AnimField
        label="出场动画"
        anim={image.animOut ?? null}
        locked={locked}
        onChange={(a) => setAnim("animOut", a)}
      />
      {!locked && <TimingNudge project={project} id={id} />}
      <InspectorActions ref_={ref_} />
    </div>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function NumField({
  label,
  value,
  min,
  max,
  step = 1,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled: boolean;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    const v = clamp(n, min ?? -Infinity, max ?? Infinity);
    setDraft(String(v));
    if (v !== value) onCommit(v);
  };

  return (
    <label style={{ display: "grid", gap: 4, fontSize: 11, color: "var(--text-3)" }}>
      <span>{label}</span>
      <input
        className="select"
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            setDraft(String(value));
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

const PRESETS: { value: Anim["preset"]; label: string }[] = [
  { value: "none", label: "无" },
  { value: "fade", label: "淡化" },
  { value: "fade-up", label: "上移" },
  { value: "pop", label: "弹出" },
  { value: "zoom-in", label: "放大" },
  { value: "slide", label: "滑动" },
];

/** 入场 / 出场动画：先选预设，再调时长；选「无」就是把字段去掉 */
function AnimField({
  label,
  anim,
  locked,
  onChange,
}: {
  label: string;
  anim: Anim | null;
  locked: boolean;
  onChange: (a: Anim | null) => void;
}) {
  return (
    <Field label={label}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <select
          className="select"
          value={anim?.preset ?? "none"}
          disabled={locked}
          aria-label={label}
          onChange={(e) => {
            const preset = e.target.value as Anim["preset"];
            if (preset === "none") {
              onChange(null);
              return;
            }
            onChange({
              ...(anim ?? { preset, durationMs: 300, easing: "ease-out" }),
              preset,
              durationMs: anim?.durationMs ?? 300,
            });
          }}
        >
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        {anim && <AnimDuration anim={anim} locked={locked} onChange={onChange} />}
      </div>
    </Field>
  );
}

function AnimDuration({
  anim,
  locked,
  onChange,
}: {
  anim: Anim;
  locked: boolean;
  onChange: (a: Anim) => void;
}) {
  const [draft, setDraft] = useState(String(anim.durationMs));
  useEffect(() => setDraft(String(anim.durationMs)), [anim.durationMs]);

  const commit = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      setDraft(String(anim.durationMs));
      return;
    }
    const v = clamp(Math.round(n), 50, 10_000);
    setDraft(String(v));
    if (v !== anim.durationMs) onChange({ ...anim, durationMs: v });
  };

  return (
    <>
      <input
        className="select"
        type="number"
        min={50}
        max={10_000}
        step={50}
        value={draft}
        disabled={locked}
        aria-label="动画时长（毫秒）"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            setDraft(String(anim.durationMs));
            e.currentTarget.blur();
          }
        }}
        style={{ width: 92 }}
      />
      <span className="field-note">毫秒</span>
    </>
  );
}
