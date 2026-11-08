import { useEffect, useMemo, useState } from "react";
import { type StyleScope, styleEditOps } from "../../core/style-scope";
import { TEMPLATES } from "../../templates";
import { displayName, findItem, kindLabel } from "../lib/project";
import { useStore } from "../store";

function warningKey(warning: { code: string; requested: string; actual: string | null }): string {
  return `${warning.code}|${warning.requested}|${warning.actual ?? ""}`;
}

function fallbackFor(
  project: NonNullable<ReturnType<typeof useStore.getState>["project"]>,
  id: string,
) {
  const ref = findItem(project, id);
  if (!ref) return "caption-word-yellow";
  if (ref.track.kind === "caption") return "caption-word-yellow";
  return "template" in ref.item
    ? (TEMPLATES[ref.item.template]?.meta.defaultStyle ?? "title-bar-yellow")
    : "title-bar-yellow";
}

export function FontWarningModal() {
  const project = useStore((s) => s.project);
  const warnings = useStore((s) => s.fontWarnings);
  const editor = useStore((s) => s.editor);
  const catalog = useStore((s) => s.fontCatalog);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [scope, setScope] = useState<StyleScope>("item");
  const [replacement, setReplacement] = useState("");
  const [dontRemind, setDontRemind] = useState(false);

  const dismissed = editor?.fontWarningsDismissed ?? [];
  const current = useMemo(
    () =>
      warnings.find((warning) => {
        const key = warningKey(warning);
        return !ignored.includes(key) && !dismissed.includes(key);
      }) ?? null,
    [dismissed, ignored, warnings],
  );
  const options = useMemo(() => {
    const seen = new Set<string>();
    return catalog.filter((font) => {
      const value = font.source === "project" ? font.id : font.family;
      if (!font.available || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }, [catalog]);

  useEffect(() => {
    setReplacement(
      options.find((font) => font.source === "system" && font.family !== current?.requested)
        ?.family ??
        options.find((font) => font.source === "project")?.id ??
        "",
    );
    setScope("item");
    setDontRemind(false);
  }, [current, options]);

  if (!current || !project) return null;
  const key = warningKey(current);
  const refs = current.elements
    .map((id) => {
      const ref = findItem(project, id);
      return ref ? { id, ref } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const close = () => setIgnored((keys) => [...keys, key]);
  const continueFallback = () => {
    if (dontRemind) {
      useStore
        .getState()
        .updateEditor({ fontWarningsDismissed: [...new Set([...dismissed, key])] });
    }
    close();
  };
  const replace = async () => {
    if (!replacement) return;
    const ops = [];
    const targets = scope === "shared" ? refs.slice(0, 1) : refs;
    for (const { id, ref } of targets) {
      const result = styleEditOps(
        project,
        id,
        { font: { family: replacement } },
        scope,
        fallbackFor(project, id),
      );
      ops.push(...result.ops);
    }
    if (ops.length > 0) {
      const ok = await useStore
        .getState()
        .submit(ops, `字体「${current.requested}」替换为「${replacement}」`);
      if (ok) close();
    }
  };

  return (
    <div className="font-warning-backdrop" role="presentation">
      <section
        className="font-warning-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="font-warning-title"
      >
        <header>
          <span className="font-warning-kicker">字体提示</span>
          <h2 id="font-warning-title">
            字体「{current.requested}」{current.code === "FONT_MISSING" ? "不可用" : "缺失"}
          </h2>
        </header>
        <p className="font-warning-message">{current.message}</p>
        <dl className="font-warning-meta">
          <div>
            <dt>实际回退</dt>
            <dd>
              {current.actual ?? "CSS 系统回退（由 Chromium 决定）"}
              {current.license && ` · ${current.license.status}`}
            </dd>
          </div>
          <div>
            <dt>影响元素</dt>
            <dd>{refs.length > 0 ? `${refs.length} 个` : "当前预览文字"}</dd>
          </div>
        </dl>
        {refs.length > 0 && (
          <ul className="font-warning-elements">
            {refs.map(({ id, ref }) => (
              <li key={id}>
                <b>{kindLabel(ref)}</b>
                <span>{displayName(project, ref)}</span>
              </li>
            ))}
          </ul>
        )}
        <label className="font-warning-select">
          <span>替换为</span>
          <select
            value={replacement}
            onChange={(event) => setReplacement(event.currentTarget.value)}
          >
            <option value="">选择可用字体</option>
            {options.map((font) => {
              const value = font.source === "project" ? font.id : font.family;
              return (
                <option key={value} value={value}>
                  {font.family} · {font.license.status}
                </option>
              );
            })}
          </select>
        </label>
        <label className="font-warning-select">
          <span>修改范围</span>
          <select
            value={scope}
            onChange={(event) => setScope(event.currentTarget.value as StyleScope)}
          >
            <option value="item">只替换受影响元素</option>
            <option value="shared">替换共享样式（影响同样式元素）</option>
          </select>
        </label>
        <label className="font-warning-check">
          <input
            type="checkbox"
            checked={dontRemind}
            onChange={(event) => setDontRemind(event.currentTarget.checked)}
          />
          不再提醒这个字体 warning（写入当前工程 editor.json）
        </label>
        <p className="font-warning-legal">
          授权状态仅供参考，非法律意见；未知授权不会阻止预览、编辑或导出。
        </p>
        <footer>
          <button type="button" className="chip" onClick={continueFallback}>
            继续使用回退
          </button>
          <button type="button" className="chip" onClick={close}>
            稍后处理
          </button>
          <button
            type="button"
            className="export-btn"
            disabled={!replacement}
            onClick={() => void replace()}
          >
            替换字体
          </button>
        </footer>
      </section>
    </div>
  );
}
