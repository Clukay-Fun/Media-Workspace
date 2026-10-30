import { useEffect, useRef, useState } from "react";
import type { FloatClip, MainClip } from "../../../core/schema";
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
  const clip = "outMs" in item ? (item as MainClip | FloatClip) : null;
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
      {clip && (
        <SpeedField
          id={id}
          speed={clip.speed}
          sourceMs={clip.outMs - clip.inMs}
          locked={track.locked}
        />
      )}
      {clip && <VolumeField id={id} gainDb={clip.gainDb} locked={track.locked} />}
      {anchored && !track.locked && <TimingNudge project={project} id={id} />}
      <InspectorActions ref_={ref_} />
    </div>
  );
}

const SPEEDS = [1, 1.1, 1.2, 1.25];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const formatSpeed = (v: number) => String(Math.round(v * 100) / 100);

/** 变速：常用倍速 + 自由输入；改完的时长（源长度 ÷ 倍速）跟着显示 */
function SpeedField({
  id,
  speed,
  sourceMs,
  locked,
}: {
  id: string;
  speed: number;
  sourceMs: number;
  locked: boolean;
}) {
  const [draft, setDraft] = useState(formatSpeed(speed));
  const lastSent = useRef<number | null>(null);

  useEffect(() => {
    setDraft(formatSpeed(speed));
    lastSent.current = null;
  }, [speed]);

  const setSpeed = (v: number) => {
    if (v === speed || v === lastSent.current) return;
    lastSent.current = v;
    void useStore
      .getState()
      .submit([{ op: "item.update", id, set: { speed: v } }], `变速改成 ${formatSpeed(v)} 倍`)
      .then((ok) => {
        if (!ok) lastSent.current = null;
      });
  };

  const commit = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      setDraft(formatSpeed(speed));
      return;
    }
    const v = clamp(Math.round(n * 100) / 100, 0.1, 10);
    setDraft(formatSpeed(v));
    setSpeed(v);
  };

  const typed = Number(draft);
  const shown = Number.isFinite(typed) && typed > 0 ? clamp(typed, 0.1, 10) : speed;
  const seconds = (sourceMs / 1000 / shown).toFixed(1);

  return (
    <Field label="变速" note="保持音调">
      <div className="segmented" role="radiogroup" aria-label="常用变速">
        {SPEEDS.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={speed === v}
            className={speed === v ? "on" : undefined}
            disabled={locked}
            onClick={() => setSpeed(v)}
          >
            {v}×
          </button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <input
          className="select"
          type="number"
          min={0.1}
          max={10}
          step={0.01}
          value={draft}
          disabled={locked}
          aria-label="变速倍数"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              setDraft(formatSpeed(speed));
              e.currentTarget.blur();
            }
          }}
          style={{ width: 84 }}
        />
        <span className="field-note">倍 · 变速后 {seconds} 秒</span>
      </div>
    </Field>
  );
}

/** 音量：滑杆和数值输入共用一份草稿，松手 / 回车时才提交一次 */
function VolumeField({ id, gainDb, locked }: { id: string; gainDb: number; locked: boolean }) {
  const [draft, setDraft] = useState(String(gainDb));
  const lastSent = useRef<number | null>(null);

  useEffect(() => {
    setDraft(String(gainDb));
    lastSent.current = null;
  }, [gainDb]);

  const commit = (raw: number) => {
    if (!Number.isFinite(raw)) {
      setDraft(String(gainDb));
      return;
    }
    const v = clamp(Math.round(raw), -60, 20);
    setDraft(String(v));
    if (v === gainDb || v === lastSent.current) return;
    lastSent.current = v;
    void useStore
      .getState()
      .submit([{ op: "item.update", id, set: { gainDb: v } }], `音量调到 ${v} dB`)
      .then((ok) => {
        if (!ok) lastSent.current = null;
      });
  };

  const typed = Number(draft);
  const sliderValue = Number.isFinite(typed) ? clamp(typed, -60, 20) : gainDb;

  return (
    <Field label="音量" note="0 dB 是原声">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="range"
          min={-60}
          max={20}
          step={1}
          value={sliderValue}
          disabled={locked}
          aria-label="音量"
          onChange={(e) => setDraft(e.target.value)}
          onPointerUp={(e) => commit(Number(e.currentTarget.value))}
          onKeyUp={(e) => commit(Number(e.currentTarget.value))}
          onBlur={(e) => commit(Number(e.currentTarget.value))}
          style={{ flex: 1, minWidth: 0, accentColor: "var(--accent)" }}
        />
        <input
          className="select"
          type="number"
          min={-60}
          max={20}
          step={1}
          value={draft}
          disabled={locked}
          aria-label="音量分贝"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(Number(e.currentTarget.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              setDraft(String(gainDb));
              e.currentTarget.blur();
            }
          }}
          style={{ width: 78 }}
        />
        <span className="field-note">dB</span>
      </div>
    </Field>
  );
}
