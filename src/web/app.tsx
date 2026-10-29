import type React from "react";
import { useEffect, useRef } from "react";
import { LeftPanel } from "./components/left-panel";
import { Splitter } from "./components/splitter";
import { Stage } from "./components/stage";
import { Timeline } from "./components/timeline";
import { TopBar } from "./components/top-bar";
import { DEFAULT_LAYOUT, useLayout } from "./lib/layout";
import { useStore } from "./store";

/** 左边上面板、下时间线，右边整列放视频（竖屏视频在又高又窄的一列里显示得最大） */
export function App() {
  useEffect(() => useStore.getState().init(), []);
  useShortcuts();
  const [layout, setLayout] = useLayout();
  const app = useRef<HTMLDivElement>(null);
  const left = useRef<HTMLDivElement>(null);
  const origin = useRef(layout);

  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const dragLeft = (dx: number) => {
    const w = app.current?.clientWidth ?? window.innerWidth;
    const px = clamp(origin.current.leftW * w + dx, 360, w - 300);
    setLayout({ leftW: px / w });
  };
  const dragTimeline = (dy: number) => {
    const h = left.current?.clientHeight ?? window.innerHeight;
    setLayout({ timelineH: clamp(origin.current.timelineH - dy, 120, h - 200) });
  };

  return (
    <div
      className="app"
      ref={app}
      style={
        {
          "--left-w": `${layout.leftW * 100}%`,
          "--tl-h": `${layout.timelineH}px`,
        } as React.CSSProperties
      }
    >
      <TopBar />
      <div className="workspace" ref={left}>
        <LeftPanel />
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
        label="调整左右宽度"
        onStart={() => {
          origin.current = layout;
        }}
        onDrag={dragLeft}
        onReset={() => setLayout({ leftW: DEFAULT_LAYOUT.leftW })}
      />
      <Stage />
      <Toasts />
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
