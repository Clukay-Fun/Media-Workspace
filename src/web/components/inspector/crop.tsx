import { cropForAspect, FULL_CROP } from "../../../core/crop";
import type { CropRect, Project } from "../../../core/schema";
import { useStore } from "../../store";
import { cropAspects, cropSource, startCrop } from "../crop-editor";
import { Field } from "./common";

/** 裁切：常用比例一键套用（按当前裁切的中心），细调去预览里拖框（问题 20） */
export function CropField({
  project,
  id,
  crop,
  locked,
}: {
  project: Project;
  id: string;
  crop: CropRect | undefined;
  locked: boolean;
}) {
  const source = cropSource(project, id);
  const editingState = useStore((s) => (s.cropEditing?.id === id ? s.cropEditing : null));
  const editing = editingState !== null;
  if (!source)
    return (
      <Field label="裁切">
        <p className="field-note">素材没有画面尺寸信息，不能裁切</p>
      </Field>
    );
  const c = crop ?? FULL_CROP;
  const w = Math.round(c.width * source.width);
  const h = Math.round(c.height * source.height);
  const submit = (next: CropRect | null, label: string) =>
    void useStore.getState().submit([{ op: "item.update", id, set: { crop: next } }], label);
  const presets = cropAspects(project.canvas);
  const current = w / h;
  return (
    <Field label="裁切" note={crop ? `保留 ${w} × ${h}` : "整张画面"}>
      <div className="segmented mw-crop-presets" role="radiogroup" aria-label="按比例裁切">
        {presets.map((a) => {
          if (a.value === null) {
            const on = editingState?.aspect === null;
            return (
              <button
                key={a.label}
                type="button"
                role="radio"
                aria-checked={on}
                className={on ? "on" : undefined}
                disabled={locked || editing}
                title="不锁比例，在画面上拖。拖动先不写入，完成后才提交一次"
                onClick={() => startCrop(id)}
              >
                {a.label}
              </button>
            );
          }
          const value = a.value;
          const on = Boolean(crop) && Math.abs(current - value) < 0.01;
          return (
            <button
              key={a.label}
              type="button"
              role="radio"
              aria-checked={on}
              className={on ? "on" : undefined}
              disabled={locked || editing}
              title={a.label === "画布" ? "按画布比例裁，主轨选它就能铺满画面" : undefined}
              onClick={() =>
                submit(
                  cropForAspect(source, value, { x: c.x + c.width / 2, y: c.y + c.height / 2 }),
                  `已按 ${a.label} 裁切`,
                )
              }
            >
              {a.label}
            </button>
          );
        })}
      </div>
      <div className="insp-row insp-below">
        <button
          type="button"
          className="mini-btn"
          disabled={locked || editing}
          onClick={() => startCrop(id)}
        >
          {editing ? "正在画面上调整…" : "在画面上调整"}
        </button>
        {crop && (
          <button
            type="button"
            className="mini-btn"
            disabled={locked || editing}
            title="重置裁切"
            onClick={() => submit(null, "已去掉裁切")}
          >
            去掉裁切
          </button>
        )}
      </div>
    </Field>
  );
}
