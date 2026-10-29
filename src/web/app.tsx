import type React from "react";
import { useEffect, useRef } from "react";
import { ReviewSidebar } from "./components/review-sidebar";
import { Splitter } from "./components/splitter";
import { Stage } from "./components/stage";
import { Timeline } from "./components/timeline";
import { TopBar } from "./components/top-bar";
import { DEFAULT_LAYOUT, useLayout } from "./lib/layout";
import { useStore } from "./store";

/**
 * 审片工作区：左边上预览、下时间线（同宽，播放控制和画面中线对齐），右边审阅栏。
 * 断点按容器宽度（container query），嵌进别的应用、宿主侧栏开合时也对。
 */
export function App() {
  useEffect(() => useStore.getState().init(), []);
  useShortcuts();
  const [layout, setLayout] = useLayout();
  const app = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const side = useRef(0);
  const origin = useRef(layout);

  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const dragSide = (dx: number) => {
    const w = app.current?.clientWidth ?? window.innerWidth;
    setLayout({ sideW: clamp(side.current - dx, 260, Math.min(520, w - 420)) });
  };
  const dragTimeline = (dy: number) => {
    const h = main.current?.clientHeight ?? window.innerHeight;
    setLayout({ timelineH: clamp(origin.current.timelineH - dy, 96, h - 200) });
  };

  return (
    <div className="review-root">
      <div
        className="app"
        ref={app}
        style={
          {
            ...(layout.sideW ? { "--side-w": `${layout.sideW}px` } : {}),
            "--tl-h": `${layout.timelineH}px`,
          } as React.CSSProperties
        }
      >
        <TopBar />
        <div className="review-main" ref={main}>
          <Stage />
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
        </div>
        <Splitter
          axis="x"
          label="调整审阅栏宽度"
          onStart={() => {
            side.current = app.current?.querySelector(".sidebar")?.clientWidth ?? 340;
          }}
          onDrag={dragSide}
          onReset={() => setLayout({ sideW: null })}
        />
        <ReviewSidebar />
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
