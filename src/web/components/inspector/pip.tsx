import type React from "react";
import { transformAt } from "../../../core/animate";
import { planTransform } from "../../../core/edit";
import type { FloatClip, Project, Transform } from "../../../core/schema";
import { CORNER_LABEL, CORNERS, type Corner, cornerPlacement } from "../../lib/pip";
import { msOfFrame } from "../../lib/timeline";
import { useStore } from "../../store";
import { Field } from "./common";
import { useNumberDraft } from "./number-draft";

/** 非主轨视频的画中画属性：四角小窗预设 + 缩放 / 圆角 / 透明度。 */
export function PipInspector({
  project,
  id,
  item,
  locked,
}: {
  project: Project;
  id: string;
  item: FloatClip;
  locked: boolean;
}) {
  const tl = useStore((s) => s.preview?.timeline);
  const frame = useStore((s) => s.frame);
  const fps = tl?.fps ?? 30;
  const video = tl?.videos.find((v) => v.id === id);
  const local = video ? frame - video.from : 0;
  const atMs =
    video && video.keyframes.length
      ? msOfFrame(Math.max(0, Math.min(local, video.durationInFrames - 1)), fps)
      : undefined;

  // 没有编译结果时用工程默认值兜底；正常选中时 video 一定存在
  const t = video
    ? transformAt(video.transform, video.keyframes, local)
    : {
        x: project.canvas.width / 2,
        y: project.canvas.height / 2,
        scale: 1,
        rotation: 0,
        opacity: 1,
        radius: 0,
        ...(item.transform ?? {}),
      };

  const apply = (patch: Partial<Transform>, label: string) => {
    const { submit, toast } = useStore.getState();
    try {
      // 有关键帧时写进播放头处的关键帧，和画面拖动走同一条路
      const plan = planTransform(project, { id, transform: patch, snap: false, atMs });
      void submit(plan.ops, label);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const probe = project.assets[item.asset]?.probe;
  const placementFor = (c: Corner) =>
    cornerPlacement(c, project.canvas, probe?.width, probe?.height);

  const active = CORNERS.find((c) => {
    const p = placementFor(c);
    return (
      Math.abs(p.scale - t.scale) < 0.005 && Math.abs(p.x - t.x) < 2 && Math.abs(p.y - t.y) < 2
    );
  });

  return (
    <>
      <Field label="位置" note="小窗贴安全区四角">
        <div className="pip-corners">
          {CORNERS.map((c) => (
            <button
              key={c}
              type="button"
              className={active === c ? "slot on" : "slot"}
              aria-pressed={active === c}
              disabled={locked}
              onClick={() => {
                apply(placementFor(c), `小窗移到${CORNER_LABEL[c]}`);
              }}
            >
              <span className="slot-frame" aria-hidden="true">
                <span
                  style={{
                    position: "absolute",
                    width: 8,
                    height: 10,
                    borderRadius: 2,
                    background: "var(--accent)",
                    ...DOT[c],
                  }}
                />
              </span>
              {CORNER_LABEL[c]}
            </button>
          ))}
        </div>
      </Field>
      <Field label="缩放和外观">
        <div className="pip-numbers">
          <PipNumber
            label="缩放 %"
            value={Math.round(t.scale * 100)}
            min={1}
            max={2000}
            disabled={locked}
            onCommit={(v) => apply({ scale: v / 100 }, `小窗缩放改成 ${v}%`)}
          />
          <PipNumber
            label="圆角 px"
            value={Math.round(t.radius)}
            min={0}
            disabled={locked}
            onCommit={(v) => apply({ radius: v }, `小窗圆角改成 ${v}px`)}
          />
          <PipNumber
            label="不透明度 %"
            value={Math.round(t.opacity * 100)}
            min={0}
            max={100}
            disabled={locked}
            onCommit={(v) => apply({ opacity: v / 100 }, `小窗不透明度改成 ${v}%`)}
          />
        </div>
      </Field>
    </>
  );
}

/** 示意图里的小窗色块位置 */
const DOT: Record<Corner, React.CSSProperties> = {
  "top-left": { left: 3, top: 3 },
  "top-right": { right: 3, top: 3 },
  "bottom-left": { left: 3, bottom: 3 },
  "bottom-right": { right: 3, bottom: 3 },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function PipNumber({
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
  const num = useNumberDraft(value);
  const commit = (raw: string) => {
    const n = num.parse(raw);
    if (n === null) return;
    const v = clamp(n, min ?? -Infinity, max ?? Infinity);
    num.setDraft(String(v));
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
        value={num.draft}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => num.change(e.target.value)}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={num.keyDown}
      />
    </label>
  );
}
