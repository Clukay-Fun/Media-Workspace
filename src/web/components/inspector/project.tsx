import { useState } from "react";
import { type AspectName, aspectOf, planAspect, scaleGuides } from "../../../core/aspect";
import { useStore } from "../../store";
import { Field } from "./common";
import { hasProxyCache, UNSUPPORTED_PROJECT_CONTROLS } from "./media-fields";

/**
 * 未选中元素时按设计稿显示草稿参数和时间线参数；编辑只接入可保存的画幅。
 */
export function ProjectOverview() {
  const name = useStore((s) => s.name);
  const dir = useStore((s) => s.dir);
  const project = useStore((s) => s.project);
  const timeline = useStore((s) => s.preview?.timeline);
  const [editing, setEditing] = useState(false);
  const [draftAspect, setDraftAspect] = useState<AspectName | null>(null);
  const [busy, setBusy] = useState(false);
  const cropping = useStore((s) => s.cropEditing !== null);

  if (!project || !timeline) return null;
  const named = aspectOf(project.canvas);
  return (
    <section className="mw-inspector-project">
      <header className="design-panel-title">
        <h2>项目属性</h2>
      </header>
      <div className="project-attribute-group">
        <h3>草稿参数</h3>
        <dl className="facts">
          <dt>草稿名称</dt>
          <dd>{name || "未命名"}</dd>
          <dt>保存位置</dt>
          <dd className="mono path" title={dir ?? "示例工程没有保存路径"}>
            {dir ?? "（示例工程）"}
          </dd>
          <dt>色彩空间</dt>
          <dd>Rec.709 SDR</dd>
          <dt>浮点链接</dt>
          <dd className="muted">未支持</dd>
          <dt>导入方式</dt>
          <dd>保留在原有位置</dd>
          <dt>自由层级</dt>
          <dd className="muted">未支持</dd>
          <dt>素材混排</dt>
          <dd className="muted">未支持</dd>
          <dt>代理模式</dt>
          <dd>{hasProxyCache(project) ? "已生成代理" : "未生成代理"}</dd>
        </dl>
      </div>
      <div className="project-attribute-group">
        <h3>时间线参数</h3>
        <dl className="facts">
          <dt>时间线名称</dt>
          <dd>主时间线</dd>
          <dt>比例</dt>
          <dd>
            {editing ? (
              <select
                className="select"
                aria-label="比例"
                value={draftAspect ?? "current"}
                disabled={busy || cropping}
                onChange={(e) => setDraftAspect(e.currentTarget.value as AspectName)}
              >
                {!named && (
                  <option value="current">
                    {ratio(timeline.width, timeline.height)}（当前比例）
                  </option>
                )}
                <option value="9:16">9:16</option>
                <option value="16:9">16:9</option>
                <option disabled>1:1（暂不支持）</option>
                <option disabled>4:3（暂不支持）</option>
              </select>
            ) : (
              (named ?? ratio(timeline.width, timeline.height))
            )}
          </dd>
          <dt>分辨率</dt>
          <dd>
            {timeline.width} × {timeline.height}
          </dd>
          <dt>帧率</dt>
          <dd>{timeline.fps.toFixed(2)} 帧/秒</dd>
        </dl>
      </div>
      <footer className="design-project-footer">
        {editing && (
          <button
            type="button"
            className="design-project-cancel"
            disabled={busy}
            onClick={() => setEditing(false)}
          >
            取消
          </button>
        )}
        <button
          type="button"
          className="design-project-edit"
          disabled={busy || cropping}
          title="修改画幅比例"
          onClick={async () => {
            if (!editing) {
              setDraftAspect(named);
              setEditing(true);
              return;
            }
            if (!draftAspect || draftAspect === named) {
              setEditing(false);
              return;
            }
            setBusy(true);
            try {
              if (await switchAspect(draftAspect)) setEditing(false);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "保存中…" : editing ? "完成" : "修改"}
        </button>
      </footer>
    </section>
  );
}

/** 设计稿里的这些控件没有工程字段。显示原因并禁用，不提交。 */
export function UnsupportedProjectControls() {
  return (
    <Field label="暂不可用" note="没有对应字段，不会写入工程">
      <ul className="mw-inspector-unsupported">
        {UNSUPPORTED_PROJECT_CONTROLS.map((item) => (
          <li key={item.id}>
            <button type="button" disabled title={item.reason}>
              <span>{item.label}</span>
              <span className="field-note">{item.reason}</span>
            </button>
          </li>
        ))}
      </ul>
    </Field>
  );
}

const ASPECT_LABEL: Record<AspectName, string> = { "9:16": "竖屏 9:16", "16:9": "横屏 16:9" };

/** 完成编辑时才提交画幅和按比例换算的参考线。 */
async function switchAspect(a: AspectName): Promise<boolean> {
  const s = useStore.getState();
  if (!s.project) return false;
  const from = { width: s.project.canvas.width, height: s.project.canvas.height };
  const plan = planAspect(s.project, a);
  const skipped = plan.skipped.length ? `，锁定轨道上 ${plan.skipped.length} 个元素没动` : "";
  const ok = await s.submit(plan.ops, `已换成${ASPECT_LABEL[a]}${skipped}，可以撤销`);
  const editor = useStore.getState().editor;
  if (ok && editor?.guides.items.length)
    s.updateEditor({
      guides: { ...editor.guides, items: scaleGuides(editor.guides.items, from, plan.size) },
    });
  return ok;
}

/** 画布比例：1080×1920 → 9:16 */
function ratio(width: number, height: number): string {
  const g = gcd(Math.round(width), Math.round(height)) || 1;
  return `${Math.round(width) / g}:${Math.round(height) / g}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
