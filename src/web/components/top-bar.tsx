import type React from "react";
import { frameOfMs } from "../lib/timeline";
import { useStore } from "../store";
import { Icon } from "./icons";

/** 嵌进别的应用时（地址带 ?embed），宿主已经显示了工程名，这里不再重复 */
const EMBED = new URLSearchParams(location.search).has("embed");

export function TopBar() {
  const name = useStore((s) => s.name);
  const project = useStore((s) => s.project);
  const live = useStore((s) => s.live);
  const history = useStore((s) => s.history);
  const lint = useStore((s) => s.lint);
  const review = useStore((s) => s.review);
  const aiChange = useStore((s) => s.aiChange);
  const exportJob = useStore((s) => s.exportJob);
  const sideOpen = useStore((s) => s.sideOpen);
  const leftOpen = useStore((s) => s.leftOpen);
  const { undo, startExport, setSideTab, setSideOpen, setLeftOpen, dismissAiChange, select, seek } =
    useStore.getState();

  const open = review?.comments.filter((c) => c.status === "open").length ?? 0;
  const issues = lint?.issues ?? [];
  const exporting = exportJob !== null && !exportJob.done;
  // 只有这次 AI 修改还是最新一版时，「撤销」才是撤销它
  const canUndoAi = aiChange && aiChange.revision === project?.revision && history?.undo;

  const jumpToIssue = () => {
    const first = issues[0];
    setSideTab("issues");
    if (!first || !project) return;
    select(first.id, { reveal: false });
    seek(frameOfMs(first.atMs, project.canvas.fps));
  };

  return (
    <header className="topbar">
      <div className="topbar-title">
        <button
          type="button"
          className="icon-btn left-toggle"
          aria-label="左栏"
          title="选中、样式、素材"
          onClick={() => setLeftOpen(!leftOpen)}
        >
          <Icon name="list" />
        </button>
        <span className="project-name" title={name} hidden={EMBED}>
          {name || "载入中…"}
        </span>
        {project && <span className="revision">第 {project.revision} 版</span>}
        <span
          className={live ? "live on" : "live"}
          title={live ? "实时同步中" : "连接已断开，正在重连"}
        >
          {live ? "同步中" : "已断开"}
        </span>
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
          className={issues.length ? "chip warn" : "chip"}
          aria-label={`质检 ${issues.length}`}
          onClick={jumpToIssue}
          title={issues[0]?.message ?? "质检没有发现问题"}
        >
          <Icon name="warn" size={14} />
          质检 {issues.length}
        </button>
        <button
          type="button"
          className={open ? "chip accent" : "chip"}
          aria-label={`待处理批注 ${open}`}
          onClick={() => setSideTab("comments")}
        >
          <Icon name="comment" size={14} />
          待处理 {open}
        </button>
        <button
          type="button"
          className="icon-btn drawer-toggle"
          aria-label="审阅栏"
          title="审阅栏"
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
          {exporting ? `导出中 ${Math.round(exportJob.progress * 100)}%` : "导出"}
        </button>
      </div>
    </header>
  );
}
