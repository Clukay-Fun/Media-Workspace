import type { FloatClip, ImageItem, MainClip } from "../../../core/schema";
import type { Anim } from "../../../core/text-style";
import { useStore } from "../../store";
import { Field } from "./common";
import { useNumberDraft } from "./number-draft";

// 图片和画中画共用的动画设置：入场、出场、循环（循环只有呼吸，v6，docs/decisions/0018）

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const LOOPS: { value: Anim["preset"]; label: string }[] = [
  { value: "none", label: "无" },
  { value: "breathe", label: "呼吸" },
];

/** 关闭动画不删字段：undefined 会在 HTTP 提交时被 JSON 丢掉，变成空修改；写入 none 才是真的关掉 */
export function VisualAnims({
  id,
  item,
  locked,
}: {
  id: string;
  item: ImageItem | FloatClip | MainClip;
  locked: boolean;
}) {
  const set = (key: "animIn" | "animOut" | "animLoop", anim: Anim) => {
    const label =
      anim.preset === "none"
        ? "已关闭动画"
        : key === "animIn"
          ? "已加入场动画"
          : key === "animOut"
            ? "已加出场动画"
            : "已加循环动画";
    void useStore.getState().submit([{ op: "item.update", id, set: { [key]: anim } }], label);
  };
  return (
    <>
      <AnimField
        label="入场动画"
        anim={item.animIn ?? null}
        locked={locked}
        onChange={(a) => set("animIn", a)}
      />
      <AnimField
        label="出场动画"
        anim={item.animOut ?? null}
        locked={locked}
        onChange={(a) => set("animOut", a)}
      />
      <AnimField
        label="循环动画"
        anim={item.animLoop ?? null}
        presets={LOOPS}
        // 呼吸：约 2.4 秒一个周期、幅度 ±3%（0017 第二批的调研结论）
        defaultMs={2400}
        durationLabel="周期（毫秒）"
        locked={locked}
        onChange={(a) => set("animLoop", a)}
      />
    </>
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

/** 入场 / 出场动画：先选预设，再调时长；「无」也是一条合法动画（preset: none） */
function AnimField({
  label,
  anim,
  presets = PRESETS,
  defaultMs = 300,
  durationLabel = "动画时长（毫秒）",
  locked,
  onChange,
}: {
  label: string;
  anim: Anim | null;
  presets?: { value: Anim["preset"]; label: string }[];
  defaultMs?: number;
  durationLabel?: string;
  locked: boolean;
  onChange: (a: Anim) => void;
}) {
  return (
    <Field label={label}>
      <div className="insp-row">
        <select
          className="select"
          value={anim?.preset ?? "none"}
          disabled={locked}
          aria-label={label}
          onChange={(e) => {
            const preset = e.target.value as Anim["preset"];
            if (preset === "none") {
              onChange({ preset: "none", durationMs: defaultMs, easing: "ease-out" });
              return;
            }
            const base = anim && anim.preset !== "none" ? anim : null;
            onChange({
              ...(base ?? {}),
              preset,
              durationMs: base?.durationMs ?? defaultMs,
              easing: base?.easing ?? "ease-out",
            });
          }}
        >
          {presets.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        {anim && anim.preset !== "none" && (
          <AnimDuration anim={anim} label={durationLabel} locked={locked} onChange={onChange} />
        )}
      </div>
    </Field>
  );
}

function AnimDuration({
  anim,
  label,
  locked,
  onChange,
}: {
  anim: Anim;
  label: string;
  locked: boolean;
  onChange: (a: Anim) => void;
}) {
  const num = useNumberDraft(anim.durationMs);
  const commit = (raw: string) => {
    const n = num.parse(raw);
    if (n === null) return;
    const v = clamp(Math.round(n), 50, 10_000);
    num.setDraft(String(v));
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
        value={num.draft}
        disabled={locked}
        aria-label={label}
        onChange={(e) => num.change(e.target.value)}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={num.keyDown}
      />
      <span className="field-note">毫秒</span>
    </>
  );
}
