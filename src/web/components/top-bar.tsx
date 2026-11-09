import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { Icon } from "./icons";

/** 顶栏只承担工程切换、打开素材库和导出。 */
export function TopBar() {
  const project = useStore((s) => s.project);
  const name = useStore((s) => s.name);
  const projectId = useStore((s) => s.projectId);
  const projects = useStore((s) => s.projects);
  const switchTarget = useStore((s) => s.switchTarget);
  const requestProjectSwitch = useStore((s) => s.requestProjectSwitch);
  const resolveProjectSwitch = useStore((s) => s.resolveProjectSwitch);
  const toast = useStore((s) => s.toast);
  const exportJob = useStore((s) => s.exportJob);
  const leftOpen = useStore((s) => s.leftOpen);
  const sideOpen = useStore((s) => s.sideOpen);
  const { startExport, setLeftTab, setLeftOpen, setSideOpen } = useStore.getState();
  const exporting = exportJob !== null && !exportJob.done;
  const exportStatus = exporting ? `导出中 ${Math.round(exportJob.progress * 100)}%` : "导出";
  const [switchOpen, setSwitchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const switcher = useRef<HTMLDivElement>(null);
  const switchTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!switchOpen) return;
    const close = (event: PointerEvent) => {
      if (!switcher.current?.contains(event.target as Node)) setSwitchOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [switchOpen]);
  const filtered = useMemo(
    () =>
      projects.filter((p) => p.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
    [projects, query],
  );
  const fontFallbacks = exportJob?.done
    ? [
        ...new Set(
          (exportJob.fontWarnings ?? [])
            .filter((w) => w.actual)
            .map((w) => `${w.requested}→${w.actual}`),
        ),
      ]
    : [];

  return (
    <header className="topbar design-topbar">
      <div className="topbar-title">
        <div
          className="project-switcher"
          ref={switcher}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || !switchOpen) return;
            event.stopPropagation();
            setSwitchOpen(false);
            switchTrigger.current?.focus();
          }}
        >
          <button
            type="button"
            className="project-switcher-trigger"
            ref={switchTrigger}
            aria-label="切换工程"
            aria-expanded={switchOpen}
            onClick={(event) => {
              if (event.detail === 0) setSwitchOpen((open) => !open);
            }}
            onPointerDown={(event) => {
              const active = document.activeElement;
              const editing =
                active instanceof HTMLElement &&
                active.matches("input, textarea, select, [contenteditable='true']") &&
                !active.closest(".project-switcher");
              if (editing) {
                event.preventDefault();
                toast("请先完成当前输入，再切换工程", "info");
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
      <div className="topbar-actions">
        <button
          type="button"
          className="icon-btn asset-toggle left-toggle"
          aria-label={leftOpen ? "关闭素材库" : "打开素材库"}
          aria-expanded={leftOpen}
          title="素材库"
          onClick={() => {
            if (!leftOpen) setLeftTab("assets");
            setLeftOpen(!leftOpen);
          }}
        >
          <Icon name="image" />
        </button>
        <button
          type="button"
          className="icon-btn inspector-toggle"
          aria-label={sideOpen ? "关闭属性" : "打开属性"}
          aria-expanded={sideOpen}
          aria-controls="workbench-inspector"
          title={sideOpen ? "关闭属性" : "打开属性"}
          onClick={() => setSideOpen(!sideOpen)}
        >
          <Icon name="panel" />
        </button>
        <button
          type="button"
          className="export-btn"
          aria-label={exportStatus}
          title={exportStatus}
          disabled={exporting || !project}
          onClick={() => void startExport()}
          style={{ "--progress": exporting ? exportJob.progress : 0 } as React.CSSProperties}
        >
          <span className="export-fill" aria-hidden="true" />
          <Icon name="export" size={14} />
        </button>
        {fontFallbacks.length > 0 && (
          <span className="font-export-summary" role="status" title="导出使用了字体回退">
            回退：{fontFallbacks.join("、")}
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
