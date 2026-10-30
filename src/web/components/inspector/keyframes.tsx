import { transformAt } from "../../../core/animate";
import type { ResolvedImage, ResolvedVideo } from "../../../core/compile";
import type { Keyframe, Transform } from "../../../core/schema";
import type { Easing } from "../../../core/text-style";
import {
  changedTransformFields,
  orderedKeyframes,
  TRANSFORM_FIELDS,
  type TransformField,
} from "../../lib/keyframes";
import { frameOfMs, msOfFrame, timecode } from "../../lib/timeline";
import { useStore } from "../../store";
import { Field } from "./common";

type ResolvedKeyframedItem = Pick<
  ResolvedVideo | ResolvedImage,
  "from" | "durationInFrames" | "transform" | "keyframes"
>;

const EASINGS: { value: Easing; label: string }[] = [
  { value: "linear", label: "匀速" },
  { value: "ease-in", label: "缓入" },
  { value: "ease-out", label: "缓出" },
  { value: "ease-in-out", label: "缓入缓出" },
  { value: "spring", label: "弹簧" },
];

const FIELD_LABELS: Record<TransformField, string> = {
  x: "X",
  y: "Y",
  scale: "缩放",
  rotation: "旋转",
  opacity: "不透明度",
  radius: "圆角",
};

/** 视频片段和图片共用的关键帧列表、添加、跳转、缓动和删除控件。 */
export function KeyframesInspector({
  id,
  fps,
  locked,
  keyframes,
}: {
  id: string;
  fps: number;
  locked: boolean;
  keyframes: Keyframe[];
}) {
  const preview = useStore((s) => s.preview);
  const frame = useStore((s) => s.frame);
  const { seek, submit } = useStore.getState();
  const video = preview?.timeline.videos.find((item) => item.id === id && item.kind === "video");
  const image = preview?.timeline.images.find((item) => item.id === id);
  const resolved: ResolvedKeyframedItem | null = video ?? image ?? null;
  const playheadFrame = Math.round(frame);
  const localFrame = playheadFrame - (resolved?.from ?? 0);
  const inRange =
    resolved !== null &&
    playheadFrame >= resolved.from &&
    playheadFrame < resolved.from + resolved.durationInFrames;
  const sorted = orderedKeyframes(keyframes);
  const existing = sorted.find((keyframe) => frameOfMs(keyframe.atMs, fps) === localFrame);
  const currentTransform = resolved
    ? transformAt(resolved.transform, resolved.keyframes, localFrame)
    : null;

  const addAtPlayhead = () => {
    if (!resolved || !inRange || !currentTransform) return;
    const atMs = existing?.atMs ?? msOfFrame(localFrame, fps);
    void submit(
      [
        {
          op: "keyframe.set",
          item: id,
          atMs,
          transform: currentTransform,
          ...(existing ? { easing: existing.easing } : {}),
        },
      ],
      existing ? "已更新播放头处的关键帧" : "已添加关键帧",
    );
  };

  const setEasing = (keyframe: Keyframe, easing: Easing) => {
    if (locked || keyframe.easing === easing) return;
    void submit(
      [
        {
          op: "keyframe.set",
          item: id,
          atMs: keyframe.atMs,
          transform: keyframe.transform,
          easing,
        },
      ],
      "已修改关键帧缓动",
    );
  };

  const remove = (keyframe: Keyframe) => {
    if (locked) return;
    void submit([{ op: "keyframe.remove", item: id, atMs: keyframe.atMs }], "已删除关键帧");
  };

  return (
    <Field label="关键帧" note={keyframes.length > 0 ? keyframes.length + " 个" : undefined}>
      <div className="keyframes-editor">
        {keyframes.length > 0 && (
          <p className="keyframes-hint">有关键帧时，拖动和改数值会写进播放头处的关键帧</p>
        )}
        <button
          type="button"
          className="mini-btn primary keyframes-add"
          disabled={locked || !inRange}
          title={!inRange ? "播放头需要位于元素显示范围内" : undefined}
          onClick={addAtPlayhead}
        >
          {existing ? "更新播放头处关键帧" : "在播放头处加关键帧"}
        </button>
        {!inRange && (
          <p className="keyframes-range-note">
            {resolved ? "播放头不在元素显示范围内" : "预览尚未就绪"}
          </p>
        )}
        {sorted.length === 0 ? (
          <p className="keyframes-empty">还没有关键帧</p>
        ) : (
          <div className="keyframes-list">
            {sorted.map((keyframe, index) => {
              const atFrame = (resolved?.from ?? 0) + frameOfMs(keyframe.atMs, fps);
              const previousKeyframe = sorted[index - 1];
              const effective: Transform = resolved
                ? { ...resolved.transform, ...keyframe.transform }
                : keyframe.transform;
              const previous: Transform = resolved
                ? index === 0
                  ? resolved.transform
                  : { ...resolved.transform, ...(previousKeyframe?.transform ?? {}) }
                : (previousKeyframe?.transform ?? {});
              const changed = changedTransformFields(effective, previous);

              return (
                <div className="keyframe-entry" key={keyframe.atMs}>
                  <button
                    type="button"
                    className="keyframe-jump"
                    disabled={!resolved}
                    aria-label={"跳到关键帧 " + timecode(atFrame, fps)}
                    onClick={() => seek(atFrame)}
                  >
                    <span className="keyframe-time mono">{timecode(atFrame, fps)}</span>
                    {changed.length > 0 ? (
                      <span className="keyframe-values">
                        {changed.map((field) => (
                          <span className="keyframe-value" key={field}>
                            {FIELD_LABELS[field]} {formatValue(field, effective[field])}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="keyframe-no-change">与上一关键帧相同</span>
                    )}
                  </button>
                  <div className="keyframe-controls">
                    <label className="keyframe-easing">
                      <span>缓动</span>
                      <select
                        className="select"
                        value={keyframe.easing}
                        disabled={locked}
                        aria-label={"关键帧 " + timecode(atFrame, fps) + " 的缓动"}
                        onChange={(event) => setEasing(keyframe, event.target.value as Easing)}
                      >
                        {EASINGS.map((easing) => (
                          <option value={easing.value} key={easing.value}>
                            {easing.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="mini-btn keyframe-delete"
                      disabled={locked}
                      aria-label={"删除关键帧 " + timecode(atFrame, fps)}
                      onClick={() => remove(keyframe)}
                    >
                      删除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Field>
  );
}

function formatValue(field: TransformField, value: number | undefined): string {
  if (value === undefined) return "—";
  if (field === "x" || field === "y") return String(Math.round(value));
  if (field === "scale") return compact(value * 100) + "%";
  if (field === "opacity") return compact(value * 100) + "%";
  if (field === "rotation") return compact(value) + "°";
  return compact(value) + "px";
}

function compact(value: number): string {
  return String(Math.round(value * 10) / 10);
}
