import { useEffect, useRef } from "react";
import type { FloatClip, MainClip } from "../../../core/schema";
import { useStore } from "../../store";
import { Icon } from "../icons";
import { Field, type InspectorProps } from "./common";
import { CropField } from "./crop";
import { commitGainDb, commitSpeed, gainSliderValue, speedDurationLabel } from "./media-fields";
import { useNumberDraft } from "./number-draft";

/** 选中视频 / 音频片段：主轨片段、画中画、音频轨上的片段 */
export function ClipInspector(props: InspectorProps) {
  const { project, id, ref_ } = props;
  const { track, item } = ref_;
  const clip = "outMs" in item ? (item as MainClip | FloatClip) : null;
  return (
    <div className="selection mw-inspector-video">
      <header className="design-panel-title">
        <h2>视频</h2>
        <button
          type="button"
          className="design-panel-close"
          aria-label="关闭属性"
          onClick={() => useStore.getState().select(null)}
        >
          <Icon name="close" size={14} />
        </button>
      </header>
      {clip && track.kind === "video" && (
        <CropField project={project} id={id} crop={clip.crop} locked={track.locked} />
      )}
      {clip && (
        <SpeedField
          id={id}
          speed={clip.speed}
          sourceMs={clip.outMs - clip.inMs}
          locked={track.locked}
        />
      )}
      {clip && <VolumeField id={id} gainDb={clip.gainDb} locked={track.locked} />}
    </div>
  );
}

const formatSpeed = (v: number) => String(Math.round(v * 100) / 100);

/** 没有保持音调字段。控件一直禁用，避免看起来像已经打开。 */
export function PreservePitchControl() {
  return (
    <label className="mw-inspector-check">
      <input type="checkbox" disabled aria-label="保持音调" />
      <span>保持音调</span>
      <span className="field-note">未支持</span>
    </label>
  );
}

/** 变速：刻度滑杆和自由输入。时长用当前看到的倍速，不把旧值夹进 0.1–10。 */
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
  const num = useNumberDraft(speed);
  const lastSent = useRef<number | null>(null);
  const sliderChanged = useRef(false);

  useEffect(() => {
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
    const n = num.parse(raw);
    const v = n === null ? null : commitSpeed(n);
    if (v === null) {
      num.setDraft(formatSpeed(speed));
      return;
    }
    num.setDraft(formatSpeed(v));
    setSpeed(v);
  };

  const typed = Number(num.draft);
  const shown = Number.isFinite(typed) && typed > 0 ? typed : speed;
  const seconds = speedDurationLabel(sourceMs, shown);

  return (
    <Field label="变速">
      <div className="design-slider-row">
        <div className="design-scale">
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={Math.min(2, Math.max(0.5, shown))}
            disabled={locked}
            aria-label="速度滑块"
            onChange={(e) => {
              sliderChanged.current = true;
              num.change(e.target.value);
            }}
            onPointerUp={(e) => {
              if (sliderChanged.current) {
                sliderChanged.current = false;
                commit(e.currentTarget.value);
              }
            }}
            onKeyUp={(e) => {
              if (sliderChanged.current) {
                sliderChanged.current = false;
                commit(e.currentTarget.value);
              }
            }}
            onBlur={(e) => {
              if (sliderChanged.current) {
                sliderChanged.current = false;
                commit(e.currentTarget.value);
              }
            }}
          />
          <ScaleMarks labels={["0.5×", "1×", "1.5×", "2×"]} />
        </div>
        <label className="design-value-input">
          <input
            type="number"
            min={0.1}
            max={10}
            step={0.01}
            value={num.draft}
            disabled={locked}
            aria-label="变速倍数"
            title="支持 0.1–10 倍"
            onChange={(e) => num.change(e.target.value)}
            onBlur={(e) => commit(e.currentTarget.value)}
            onKeyDown={num.keyDown}
          />
          <span>×</span>
        </label>
      </div>
      <div className="design-speed-extra">
        <span>变速后 {seconds ?? "—"} 秒</span>
      </div>
      <PreservePitchControl />
    </Field>
  );
}

/** 音量：滑杆和数值输入共用一份草稿，松手 / 回车时才提交一次 */
function VolumeField({ id, gainDb, locked }: { id: string; gainDb: number; locked: boolean }) {
  const num = useNumberDraft(gainDb);
  const lastSent = useRef<number | null>(null);
  const sliderChanged = useRef(false);

  useEffect(() => {
    lastSent.current = null;
  }, [gainDb]);

  const commit = (raw: number) => {
    const v = commitGainDb(raw);
    if (v === null) {
      num.setDraft(String(gainDb));
      return;
    }
    num.setDraft(String(v));
    if (v === gainDb || v === lastSent.current) return;
    lastSent.current = v;
    void useStore
      .getState()
      .submit([{ op: "item.update", id, set: { gainDb: v } }], `音量调到 ${v} dB`)
      .then((ok) => {
        if (!ok) lastSent.current = null;
      });
  };

  const commitTyped = (raw: string) => {
    const n = num.parse(raw);
    if (n === null) return;
    commit(n);
  };

  const sliderValue = gainSliderValue(Number(num.draft), gainDb);

  return (
    <Field label="音量">
      <div className="design-slider-row">
        <div className="design-scale">
          <input
            type="range"
            min={-60}
            max={12}
            step={1}
            value={Math.min(12, sliderValue)}
            disabled={locked}
            aria-label="音量"
            onChange={(e) => {
              sliderChanged.current = true;
              num.change(e.target.value);
            }}
            onPointerUp={(e) => {
              if (sliderChanged.current) {
                sliderChanged.current = false;
                commit(Number(e.currentTarget.value));
              }
            }}
            onKeyUp={(e) => {
              if (sliderChanged.current) {
                sliderChanged.current = false;
                commit(Number(e.currentTarget.value));
              }
            }}
            onBlur={(e) => {
              if (sliderChanged.current) {
                sliderChanged.current = false;
                commit(Number(e.currentTarget.value));
              }
            }}
          />
          <ScaleMarks
            labels={["−60", "−30", "−15", "0", "+12"]}
            positions={[0, 41.667, 62.5, 83.333, 100]}
          />
        </div>
        <label className="design-value-input">
          <input
            type="number"
            min={-60}
            max={20}
            step={1}
            value={num.draft}
            disabled={locked}
            aria-label="音量分贝"
            title="支持 −60 到 +20 dB"
            onChange={(e) => num.change(e.target.value)}
            onBlur={(e) => commitTyped(e.currentTarget.value)}
            onKeyDown={num.keyDown}
          />
          <span>dB</span>
        </label>
      </div>
    </Field>
  );
}

function ScaleMarks({ labels, positions }: { labels: string[]; positions?: number[] }) {
  return (
    <div className="design-scale-marks" aria-hidden="true">
      <div className="design-scale-ticks">
        {Array.from({ length: 25 }, (_, i) => (
          <i key={i} className={i % 4 === 0 ? "major" : undefined} />
        ))}
      </div>
      <div className="design-scale-labels">
        {labels.map((label, i) => (
          <span
            key={label}
            style={{ left: `${positions?.[i] ?? (i / (labels.length - 1)) * 100}%` }}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
