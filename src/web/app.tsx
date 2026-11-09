import { Fragment, useEffect } from "react";
import { FontWarningModal } from "./components/font-warning-modal";
import { MaterialPopover } from "./components/material-popover";
import { ReviewSidebar } from "./components/review-sidebar";
import { Stage } from "./components/stage";
import { TopBar } from "./components/top-bar";
import { useStore } from "./store";

/**
 * 五份设计稿对应播放器和属性面板；素材从顶栏打开浮层。
 */
export function App() {
  useEffect(() => useStore.getState().init(), []);
  const projectId = useStore((s) => s.projectId);
  useShortcuts();
  return (
    <div className="review-root">
      <div className="app">
        <TopBar />
        {/* 同一工程的一组视图要一起换 key；分别给四个兄弟加 key 会在切工程时留下旧的子树。 */}
        <Fragment key={projectId ?? "no-project"}>
          <MaterialPopover />
          <Stage />
          <ReviewSidebar />
        </Fragment>
        <FontWarningModal />
        <Toasts />
      </div>
    </div>
  );
}

/** 快捷键：空格播放，←/→ 逐帧（⇧ 一秒），⌘Z / ⇧⌘Z，⌘B 分割，C 开启批注，Esc 取消。打字时不响应 */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT"))
        return;
      const s = useStore.getState();
      // 裁切时 Esc / 回车归裁切框（crop-editor），其它快捷键也先停用
      if (s.cropEditing) return;
      const fps = s.preview?.timeline.fps ?? 30;
      const total = s.preview?.timeline.durationInFrames ?? 1;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void s.undo(e.shiftKey ? "redo" : "undo");
      } else if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        void s.splitAtPlayhead();
      } else if (mod && !e.altKey && e.key === ";" && s.editor) {
        e.preventDefault();
        s.updateEditor({ guides: { ...s.editor.guides, hidden: !s.editor.guides.hidden } });
      } else if (mod && e.altKey && e.key.toLowerCase() === "r" && s.editor) {
        e.preventDefault();
        s.updateEditor({ rulers: !s.editor.rulers });
      } else if (e.code === "Space") {
        e.preventDefault();
        s.setPlaying(!s.playing);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const d = (e.shiftKey ? fps : 1) * (e.key === "ArrowLeft" ? -1 : 1);
        s.seek(Math.min(total - 1, Math.max(0, s.frame + d)));
      } else if (!mod && e.key.toLowerCase() === "c") {
        e.preventDefault();
        s.setAnnotating(true);
      } else if (e.key === "Escape") {
        // 先收起左栏抽屉，再取消选中
        if (s.leftOpen) return s.setLeftOpen(false);
        if (s.sideOpen) return s.setSideOpen(false);
        s.select(null);
        s.setPin(null);
        s.setAnnotating(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
