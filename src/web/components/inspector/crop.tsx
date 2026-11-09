import { cropForAspect, FULL_CROP } from "../../../core/crop";
import type { CropRect, Project } from "../../../core/schema";
import { useStore } from "../../store";
import { cropAspects, cropSource, startCrop } from "../crop-editor";
import { Icon } from "../icons";
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
    <section className="field design-crop">
      <div className="design-section-head">
        <h3>裁切</h3>
        <div>
          <button
            type="button"
            className="icon-btn"
            disabled={locked || editing}
            aria-label="在画面上调整"
            title="在画面上调整"
            onClick={() => startCrop(id)}
          >
            <Icon name="safe" size={19} />
          </button>
          <button
            type="button"
            className="icon-btn"
            disabled={locked || editing || !crop}
            aria-label="去掉裁切"
            title="去掉裁切"
            onClick={() => submit(null, "已去掉裁切")}
          >
            <Icon name="reopen" size={19} />
          </button>
        </div>
      </div>
      <div className="design-crop-grid" role="radiogroup" aria-label="按比例裁切">
        {presets
          .filter((a) => a.value !== null)
          .map((a) => {
            const value = a.value!;
            const on = Boolean(crop) && a.label !== "画布" && Math.abs(current - value) < 0.01;
            return (
              <button
                key={a.label}
                type="button"
                role="radio"
                aria-checked={on}
                className={on ? "on" : undefined}
                disabled={locked || editing}
                title={a.label === "画布" ? "按画布比例裁切" : a.label}
                onClick={() =>
                  submit(
                    cropForAspect(source, value, { x: c.x + c.width / 2, y: c.y + c.height / 2 }),
                    `已按 ${a.label} 裁切`,
                  )
                }
              >
                <span className="design-crop-stage">
                  <i
                    style={{ width: Math.min(55, 46 * value), height: Math.min(46, 55 / value) }}
                  />
                </span>
                <span>{a.label}</span>
              </button>
            );
          })}
      </div>
    </section>
  );
}
