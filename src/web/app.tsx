import { useEffect } from "react";
import { Inspector } from "./components/inspector";
import { LeftPanel } from "./components/left-panel";
import { Stage } from "./components/stage";
import { Timeline } from "./components/timeline";
import { TopBar } from "./components/top-bar";
import { NARROW, useMedia } from "./lib/use-media";
import { useStore } from "./store";

export function App() {
  useEffect(() => useStore.getState().init(), []);
  useShortcuts();
  const narrow = useMedia(NARROW);
  return (
    <div className={narrow ? "app narrow" : "app"}>
      <TopBar />
      {!narrow && <LeftPanel />}
      <Stage />
      {narrow ? <LeftPanel merged /> : <Inspector />}
      <Timeline />
      <Toasts />
    </div>
  );
}

/** 快捷键：空格播放，←/→ 逐帧（⇧ 一秒），⌘Z / ⇧⌘Z，C 写批注，Esc 取消选中。打字时不响应 */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT"))
        return;
      const s = useStore.getState();
      const fps = s.preview?.timeline.fps ?? 30;
      const total = s.preview?.timeline.durationInFrames ?? 1;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void s.undo(e.shiftKey ? "redo" : "undo");
      } else if (e.code === "Space") {
        e.preventDefault();
        s.setPlaying(!s.playing);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const d = (e.shiftKey ? fps : 1) * (e.key === "ArrowLeft" ? -1 : 1);
        s.seek(Math.min(total - 1, Math.max(0, s.frame + d)));
      } else if (!mod && e.key.toLowerCase() === "c") {
        e.preventDefault();
        s.setPlaying(false);
        s.focusComposer();
      } else if (e.key === "Escape") {
        s.select(null);
        s.setPin(null);
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
