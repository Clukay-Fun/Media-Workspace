import type React from "react";
import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Icon } from "./icons";
import { IssuesMenu } from "./issues-menu";

export function TopBar() {
  const project = useStore((s) => s.project);
  const name = useStore((s) => s.name);
  const projectId = useStore((s) => s.projectId);
  const projects = useStore((s) => s.projects);
  const switchTarget = useStore((s) => s.switchTarget);
  const requestProjectSwitch = useStore((s) => s.requestProjectSwitch);
  const resolveProjectSwitch = useStore((s) => s.resolveProjectSwitch);
  const toast = useStore((s) => s.toast);
  const history = useStore((s) => s.history);
  const review = useStore((s) => s.review);
  const aiChange = useStore((s) => s.aiChange);
  const exportJob = useStore((s) => s.exportJob);
  const sideOpen = useStore((s) => s.sideOpen);
  const {
    startExport,
    setSideTab,
    setSideOpen,
    setLeftTab,
    setLeftOpen,
    select,
    undo,
    dismissAiChange,
  } = useStore.getState();

  const open = review?.comments.filter((c) => c.status === "open").length ?? 0;
  const exporting = exportJob !== null && !exportJob.done;
  const exportFontSummary = exportJob?.done
    ? [
        ...new Set(
          (exportJob.fontWarnings ?? [])
            .filter((w) => w.actual)
            .map((w) => `${w.requested}→${w.actual}（${w.license?.status ?? "未登记"}）`),
        ),
      ]
    : [];
  const canUndoAi = aiChange && aiChange.revision === project?.revision && history?.undo;

  const [switchOpen, setSwitchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () =>
      projects.filter((p) => p.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
    [projects, query],
  );

  return (
    <header className="topbar">
      <div className="topbar-title">
        <div className="project-switcher">
          <button
            type="button"
            className="project-switcher-trigger"
            aria-label="切换工程"
            aria-expanded={switchOpen}
            onPointerDown={(event) => {
              const active = document.activeElement;
              const isEditor =
                active instanceof HTMLElement &&
                active.matches("input, textarea, select, [contenteditable='true']") &&
                !active.closest(".project-switcher");
              if (isEditor) {
                event.preventDefault();
                toast("请先完成当前输入；文本框失焦后会自动保存，再切换工程", "info");
                return;
              }
              setSwitchOpen((open) => !open);
            }}
          >
            <h1 className="topbar-name" title={name}>
              {name || "载入中…"}
            </h1>
            <Icon name="chevronDown" size={14} />
          </button>
          {switchOpen && (
            <div className="project-switcher-menu" role="listbox" aria-label="可打开工程">
              <input
                className="project-switcher-search"
                aria-label="搜索工程"
                placeholder="搜索工程"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="project-switcher-list">
                {filtered.map((item) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={item.id === projectId}
                    key={item.id}
                    onClick={() => {
                      setSwitchOpen(false);
                      setQuery("");
                      requestProjectSwitch(item.id);
                    }}
                  >
                    <span>{item.name}</span>
                    <small>rev {item.revision}</small>
                  </button>
                ))}
                {filtered.length === 0 && <p>没有匹配的工程</p>}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="topbar-center">
        {aiChange && (
          <div className="ai-change" role="status">
            <Icon name="spark" size={14} />
            <span>
              <b>{aiChange.actor || "AI"}</b> 刚改了 {aiChange.changed.length} 处
            </span>
            <button
              type="button"
              className="link"
              onClick={() => {
                select(aiChange.changed[0] ?? null, { reveal: false });
                setSideTab("changes");
              }}
            >
              查看
            </button>
            {canUndoAi && (
              <button type="button" className="link" onClick={() => void undo("undo")}>
                撤销这次修改
              </button>
            )}
            <button
              type="button"
              className="icon-btn ghost"
              aria-label="关闭"
              onClick={dismissAiChange}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        )}
      </div>

      <div className="topbar-actions">
        <button
          type="button"
          className="icon-btn asset-toggle"
          aria-label="素材"
          title="素材和样式"
          onClick={() => {
            setLeftTab("assets");
            setLeftOpen(true);
          }}
        >
          <Icon name="image" />
        </button>
        <IssuesMenu />
        <button
          type="button"
          className={open ? "chip accent" : "chip"}
          aria-label={`待处理批注 ${open}`}
          onClick={() => setSideTab("comments")}
        >
          <Icon name="comment" size={14} />
          {open}
        </button>
        <button
          type="button"
          className="icon-btn drawer-toggle"
          aria-label="右栏"
          title="属性、批注、AI 改动"
          onClick={() => setSideOpen(!sideOpen)}
        >
          <Icon name="panel" />
        </button>
        <button
          type="button"
          className="export-btn"
          disabled={exporting || !project}
          onClick={() => void startExport()}
          style={{ "--progress": exporting ? exportJob.progress : 0 } as React.CSSProperties}
        >
          <span className="export-fill" aria-hidden="true" />
          <Icon name="export" size={14} />
          <span className="export-label">
            {exporting ? `导出中 ${Math.round(exportJob.progress * 100)}%` : "导出"}
          </span>
        </button>
        {exportFontSummary.length > 0 && (
          <span className="font-export-summary" role="status" title="导出使用了字体回退">
            回退：{exportFontSummary.join("、")}
          </span>
        )}
      </div>
      {switchTarget && (
        <div className="project-switcher-backdrop" role="presentation">
          <section
            className="project-switcher-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="switch-title"
          >
            <h2 id="switch-title">有一条未提交的批注</h2>
            <p>先保存到「{name}」，或明确丢弃后切换工程。</p>
            <div>
              <button
                type="button"
                className="chip"
                onClick={() => void resolveProjectSwitch("cancel")}
              >
                取消
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => void resolveProjectSwitch("discard")}
              >
                丢弃并切换
              </button>
              <button
                type="button"
                className="export-btn"
                onClick={() => void resolveProjectSwitch("save")}
              >
                保存并切换
              </button>
            </div>
          </section>
        </div>
      )}
    </header>
  );
}
