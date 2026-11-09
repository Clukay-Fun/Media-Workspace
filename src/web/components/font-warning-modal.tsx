import { useEffect, useMemo, useState } from "react";
import type { FontWarning } from "../../core/api";
import type { Op } from "../../core/ops";
import type { Project } from "../../core/schema";
import type { StyleScope } from "../../core/style-scope";
import { useStore } from "../store";
import {
  affectedFontLine,
  dismissFontWarningPatch,
  FONT_LICENSE_NOTE,
  type FontCatalogEntry,
  fontFallbackStyle,
  fontReplacementOps,
  licenseStatusLabel,
} from "./inspector/font-choice";

function warningKey(warning: { code: string; requested: string; actual: string | null }): string {
  return `${warning.code}|${warning.requested}|${warning.actual ?? ""}`;
}

export function FontWarningDialog({
  project,
  warning,
  catalog,
  dismissed,
  onIgnore,
  onUpdateEditor,
  onSubmit,
}: {
  project: Project;
  warning: FontWarning;
  catalog: readonly FontCatalogEntry[];
  dismissed: readonly string[];
  onIgnore: () => void;
  onUpdateEditor: (patch: { fontWarningsDismissed: string[] }) => void;
  onSubmit: (ops: Op[], label: string) => Promise<boolean>;
}) {
  const [scope, setScope] = useState<StyleScope>("item");
  const [replacement, setReplacement] = useState("");
  const [dontRemind, setDontRemind] = useState(false);
  const options = useMemo(() => {
    const seen = new Set<string>();
    return catalog.filter((font) => {
      const value = font.source === "project" ? font.id : font.family;
      if (!font.available || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }, [catalog]);
  const listed = warning.elements.flatMap((id) => {
    const line = affectedFontLine(project, id);
    return line ? [{ id, line }] : [];
  });

  useEffect(() => {
    setReplacement(
      options.find((font) => font.source === "system" && font.family !== warning.requested)
        ?.family ??
        options.find((font) => font.source === "project")?.id ??
        "",
    );
    setScope("item");
    setDontRemind(false);
  }, [options, warning]);

  const key = warningKey(warning);
  const continueFallback = () => {
    if (dontRemind) onUpdateEditor(dismissFontWarningPatch(dismissed, key));
    onIgnore();
  };
  const replace = async () => {
    if (!replacement) return;
    try {
      const planned = fontReplacementOps(
        project,
        listed.map((entry) => entry.id),
        replacement,
        scope,
        fontFallbackStyle,
      );
      if (planned.ops.length === 0) return;
      const ok = await onSubmit(
        planned.ops,
        `字体「${warning.requested}」替换为「${replacement}」`,
      );
      if (ok) onIgnore();
    } catch (error) {
      useStore.getState().toast(error instanceof Error ? error.message : String(error), "error");
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
            字体「{warning.requested}」{warning.code === "FONT_MISSING" ? "不可用" : "缺失"}
          </h2>
        </header>
        <p className="font-warning-message">{warning.message}</p>
        <dl className="font-warning-meta">
          <div>
            <dt>实际回退</dt>
            <dd>
              {warning.actual ?? "CSS 系统回退（由 Chromium 决定）"}
              {warning.license && ` · ${licenseStatusLabel(warning.license.status)}`}
            </dd>
          </div>
          <div>
            <dt>影响元素</dt>
            <dd>{listed.length > 0 ? `${listed.length} 个` : "当前预览文字"}</dd>
          </div>
        </dl>
        {listed.length > 0 && (
          <ul className="font-warning-elements">
            {listed.map(({ id, line }) => (
              <li key={id}>{line}</li>
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
                  {font.family} · {licenseStatusLabel(font.license.status)}
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
        <p className="font-warning-legal">{FONT_LICENSE_NOTE}</p>
        <footer>
          <button
            type="button"
            className="export-btn"
            disabled={!replacement}
            onClick={() => void replace()}
          >
            替换
          </button>
          <button type="button" className="chip" onClick={continueFallback}>
            继续回退
          </button>
          <button type="button" className="chip" onClick={onIgnore}>
            稍后处理
          </button>
        </footer>
      </section>
    </div>
  );
}

export function FontWarningModal() {
  const project = useStore((s) => s.project);
  const warnings = useStore((s) => s.fontWarnings);
  const editor = useStore((s) => s.editor);
  const catalog = useStore((s) => s.fontCatalog);
  const [ignored, setIgnored] = useState<string[]>([]);
  const dismissed = editor?.fontWarningsDismissed ?? [];
  const current = useMemo(
    () =>
      warnings.find((warning) => {
        const key = warningKey(warning);
        return !ignored.includes(key) && !dismissed.includes(key);
      }) ?? null,
    [dismissed, ignored, warnings],
  );

  if (!current || !project) return null;
  return (
    <FontWarningDialog
      project={project}
      warning={current}
      catalog={catalog}
      dismissed={dismissed}
      onIgnore={() => setIgnored((keys) => [...keys, warningKey(current)])}
      onUpdateEditor={(patch) => useStore.getState().updateEditor(patch)}
      onSubmit={(ops, label) => useStore.getState().submit(ops, label)}
    />
  );
}
