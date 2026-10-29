import type React from "react";
import { useEffect, useRef } from "react";
import { LeftPanel } from "./components/left-panel";
import { ReviewSidebar } from "./components/review-sidebar";
import { Splitter } from "./components/splitter";
import { Stage } from "./components/stage";
import { Timeline } from "./components/timeline";
import { TopBar } from "./components/top-bar";
import { DEFAULT_LAYOUT, useLayout } from "./lib/layout";
import { useStore } from "./store";

/**
 * 上面三栏：左栏素材 / 样式，中间预览（顶上章节条），右栏属性 / 批注 / AI 改动；
 * 下面整宽时间线。断点按容器宽度（container query），嵌进别的应用时也对。
 */
export function App() {
  useEffect(() => useStore.getState().init(), []);
  useShortcuts();
  const [layout, setLayout] = useLayout();
  const app = useRef<HTMLDivElement>(null);
  const left = useRef(0);
  const side = useRef(0);
  const origin = useRef(layout);

  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  // 中间至少留 420，竖屏画面才不会太小
  const room = (other: number) => (app.current?.clientWidth ?? window.innerWidth) - other - 420;
  const dragLeft = (dx: number) => {
    setLayout({ leftW: clamp(left.current + dx, 220, Math.min(480, room(side.current))) });
  };
  const dragSide = (dx: number) => {
    setLayout({ sideW: clamp(side.current - dx, 260, Math.min(520, room(left.current))) });
  };
  const measure = () => {
    left.current = app.current?.querySelector(".left-panel")?.clientWidth ?? 280;
    side.current = app.current?.querySelector(".sidebar")?.clientWidth ?? 340;
  };
  const dragTimeline = (dy: number) => {
    const h = app.current?.clientHeight ?? window.innerHeight;
    setLayout({ timelineH: clamp(origin.current.timelineH - dy, 140, h - 320) });
  };

  return (
    <div className="review-root">
      <div
        className="app"
        ref={app}
        style={
          {
            ...(layout.leftW ? { "--left-w": `${layout.leftW}px` } : {}),
            ...(layout.sideW ? { "--side-w": `${layout.sideW}px` } : {}),
            "--tl-h": `${layout.timelineH}px`,
          } as React.CSSProperties
        }
      >
        <TopBar />
        <LeftPanel />
        <Splitter
          axis="x"
          label="调整左栏宽度"
          className="left"
          onStart={measure}
          onDrag={dragLeft}
          onReset={() => setLayout({ leftW: null })}
        />
        <Stage />
        <Splitter
          axis="x"
          label="调整审阅栏宽度"
          className="side"
          onStart={measure}
          onDrag={dragSide}
          onReset={() => setLayout({ sideW: null })}
        />
        <ReviewSidebar />
        <Splitter
          axis="y"
          label="调整时间线高度"
          onStart={() => {
            origin.current = layout;
          }}
          onDrag={dragTimeline}
          onReset={() => setLayout({ timelineH: DEFAULT_LAYOUT.timelineH })}
        />
        <Timeline />
        <Toasts />
      </div>
    </div>
  );
}

/** 快捷键：空格播放，←/→ 逐帧（⇧ 一秒），⌘Z / ⇧⌘Z，⌘B 分割，C 写批注，Esc 取消选中。打字时不响应 */
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
      } else if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        void s.splitAtPlayhead();
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
