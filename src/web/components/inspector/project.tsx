import { ASPECTS, type AspectName, aspectOf, planAspect, scaleGuides } from "../../../core/aspect";
import { timecode } from "../../lib/timeline";
import { useStore } from "../../store";
import { Field } from "./common";
import { CoverPanel } from "./cover";
import { hasProxyCache, UNSUPPORTED_PROJECT_CONTROLS } from "./media-fields";

/**
 * 未选中元素时的项目概览（docs/decisions/0015 第 7 条）：先让人确认在看哪个工程，
 * 再往下才是章节和质检。保存路径在加载工程时已经和工程一起存进 store，不再单独请求。
 */
export function ProjectOverview() {
  const name = useStore((s) => s.name);
  const dir = useStore((s) => s.dir);
  const project = useStore((s) => s.project);
  const timeline = useStore((s) => s.preview?.timeline);

  if (!project || !timeline) return null;
  const captionCount = project.tracks.reduce(
    (n, t) => n + (t.kind === "caption" ? t.items.length : 0),
    0,
  );
  const named = aspectOf(project.canvas);
  return (
    <section className="mw-inspector-project">
      <h3 className="panel-title">项目</h3>
      <dl className="facts">
        <dt>工程</dt>
        <dd>{name || "未命名"}</dd>
        <dt>路径</dt>
        <dd className="mono path" title={dir ?? "示例工程没有保存路径"}>
          {dir ?? "（示例工程）"}
        </dd>
        <dt>时长</dt>
        <dd className="mono">{timecode(timeline.durationInFrames, timeline.fps)}</dd>
        <dt>画布</dt>
        <dd>
          {timeline.width} × {timeline.height}
        </dd>
        <dt>比例</dt>
        <dd>{named ?? ratio(timeline.width, timeline.height)}</dd>
        <dt>帧率</dt>
        <dd>{timeline.fps} fps</dd>
        <dt>素材</dt>
        <dd>{Object.keys(project.assets).length} 个</dd>
        <dt>字幕</dt>
        <dd>{captionCount} 句</dd>
        <dt>代理缓存</dt>
        <dd>{hasProxyCache(project) ? "有" : "没有"}</dd>
      </dl>
      <AspectField />
      <UnsupportedProjectControls />
      <CoverPanel />
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

/** 切换画幅：样式、元素位置、主轨裁切一起换算（core/aspect），一次提交，可以撤销 */
function AspectField() {
  const project = useStore((s) => s.project);
  const locked = useStore((s) => s.cropEditing !== null);
  if (!project) return null;
  const current = aspectOf(project.canvas);
  const switchTo = async (a: AspectName) => {
    const s = useStore.getState();
    if (!s.project) return;
    const from = { width: s.project.canvas.width, height: s.project.canvas.height };
    const plan = planAspect(s.project, a);
    const skipped = plan.skipped.length ? `，锁定轨道上 ${plan.skipped.length} 个元素没动` : "";
    const ok = await s.submit(plan.ops, `已换成${ASPECT_LABEL[a]}${skipped}，可以撤销`);
    // 这个工程自己的参考线（editor.json）按比例挪过去
    const editor = useStore.getState().editor;
    if (ok && editor?.guides.items.length) {
      s.updateEditor({
        guides: { ...editor.guides, items: scaleGuides(editor.guides.items, from, plan.size) },
      });
    }
  };
  return (
    <Field
      label="画幅"
      note={current ? "字幕、标题、画中画跟着换位置" : "当前比例只读，只能换成 9:16 或 16:9"}
    >
      <div className="segmented" role="radiogroup" aria-label="画幅">
        {ASPECTS.map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={current === a}
            className={current === a ? "on" : undefined}
            disabled={locked}
            onClick={() => current !== a && void switchTo(a)}
          >
            {ASPECT_LABEL[a]}
          </button>
        ))}
      </div>
    </Field>
  );
}

/** 画布比例：1080×1920 → 9:16 */
function ratio(width: number, height: number): string {
  const g = gcd(Math.round(width), Math.round(height)) || 1;
  return `${Math.round(width) / g}:${Math.round(height) / g}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
