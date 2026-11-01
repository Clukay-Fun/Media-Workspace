import { useEffect, useRef } from "react";
import type { LintIssue } from "../../core/lint";
import { frameOfMs, timecode } from "../lib/timeline";
import { useStore } from "../store";
import { Icon } from "./icons";

// 顶栏 ⚠：点开列出质检结果。属性栏不再放质检卡片（问题 8），这里是唯一能看全的地方。
// 数字只算警告；提示（有账号版式时的通用安全区等）列在下面，只作参考。

export function IssuesMenu() {
  const lint = useStore((s) => s.lint);
  const fps = useStore((s) => s.project?.canvas.fps ?? 30);
  const box = useRef<HTMLDetailsElement>(null);
  // 点菜单外面或按 Esc 收起（details 本身不会自己关）
  useEffect(() => {
    const close = (e: Event) => {
      const el = box.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node))
        el.open = false;
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, []);

  const all = lint?.issues ?? [];
  const warnings = all.filter((i) => i.level !== "hint");
  const hints = all.filter((i) => i.level === "hint");

  return (
    <details className="issues-menu" ref={box}>
      <summary
        className={warnings.length ? "chip warn" : "chip"}
        aria-label={`质检 ${warnings.length}`}
        title={warnings.length ? `${warnings.length} 条警告` : "质检没有发现问题"}
      >
        <Icon name="warn" size={14} />
        {warnings.length}
      </summary>
      <div className="issues-panel">
        {all.length === 0 && <p className="issues-empty">质检没有发现问题</p>}
        {warnings.length > 0 && (
          <IssueGroup title={`警告 ${warnings.length}`} issues={warnings} fps={fps} />
        )}
        {hints.length > 0 && (
          <IssueGroup title={`提示 ${hints.length} · 仅供参考`} issues={hints} fps={fps} hint />
        )}
      </div>
    </details>
  );
}

function IssueGroup({
  title,
  issues,
  fps,
  hint = false,
}: {
  title: string;
  issues: LintIssue[];
  fps: number;
  hint?: boolean;
}) {
  return (
    <section>
      <strong>{title}</strong>
      <ul>
        {issues.map((i, n) => (
          <li key={`${i.id}-${n}`} className={hint ? "issue-row hint" : "issue-row"}>
            <button type="button" className="issue-main" onClick={() => jump(i)}>
              <span className="mono">{timecode(frameOfMs(i.atMs, fps), fps)}</span>
              <span>{i.message}</span>
            </button>
            <button
              type="button"
              className="link"
              title="写成批注，让 AI 处理"
              onClick={() =>
                void useStore.getState().addComment({
                  text: `质检：${i.message}`,
                  atMs: i.atMs,
                  ...(i.id ? { target: i.id } : {}),
                })
              }
            >
              交给 AI
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function jump(i: LintIssue) {
  const s = useStore.getState();
  if (!s.project) return;
  if (i.id) s.select(i.id, { reveal: false });
  s.seek(frameOfMs(i.atMs, s.project.canvas.fps));
}
