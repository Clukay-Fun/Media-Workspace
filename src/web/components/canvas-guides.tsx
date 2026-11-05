import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { EditorState } from "../../core/api";
import { safeAreaFor } from "../../core/safe-area";
import { useStore } from "../store";

// 预览画面上的构图辅助：安全区、可拖动的参考线、标尺。只存在 editor.json 里，不进导出。

export type SafeAreaMode = "off" | "title" | "channels";

/** editor.json 里旧值是 "all"（当时只有开关，默认关），不认识的一律当不显示 */
export function safeAreaMode(editor: EditorState | null): SafeAreaMode {
  const v = editor?.showSafeArea;
  return v === "title" || v === "channels" ? v : "off";
}

export function SafeAreaOverlay({ width, height, scale }: Dims) {
  const mode = useStore((s) => safeAreaMode(s.editor));
  if (mode === "title") {
    // 广电通用的两层框：外层操作安全区（四边各留 5%），内层字幕安全区（各留 10%）
    return (
      <>
        {[0.05, 0.1].map((k) => (
          <div
            key={k}
            className="safe-frame"
            style={{
              left: width * k * scale,
              right: width * k * scale,
              top: height * k * scale,
              bottom: height * k * scale,
            }}
          />
        ))}
      </>
    );
  }
  if (mode === "channels") {
    const s = safeAreaFor(width, height);
    return (
      <div
        className="safe-area"
        style={{
          left: s.left * scale,
          top: s.top * scale,
          right: s.right * scale,
          bottom: s.bottom * scale,
        }}
      >
        <span>视频号安全区</span>
      </div>
    );
  }
  return null;
}

type Dims = { width: number; height: number; scale: number };
type Guide = EditorState["guides"]["items"][number];
type Moving = { id: string; axis: "h" | "v"; pos: number; fresh: boolean };

/** 每隔多少画布像素一个刻度、一个数字 */
const TICK = 100;
const LABEL = 500;
export const RULER_BAND = 28;

/** 构图参考线和标尺：线随时能拖，拖出画面就删掉；从标尺上往画面里拖出一条新线 */
export function CanvasGuides({ width, height, scale, band }: Dims & { band: number }) {
  const editor = useStore((s) => s.editor);
  const [moving, setMoving] = useState<Moving | null>(null);
  const layer = useRef<HTMLDivElement>(null);

  const posAt = (axis: "h" | "v", e: { clientX: number; clientY: number }) => {
    const r = layer.current?.getBoundingClientRect();
    if (!r || scale <= 0) return 0;
    return Math.round(
      axis === "h" ? (e.clientY - r.top - band) / scale : (e.clientX - r.left - band) / scale,
    );
  };

  // 拖动期间在 window 上跟指针，拖到画面外面也能收到松开
  useEffect(() => {
    if (!moving) return;
    const move = (e: PointerEvent) => setMoving((m) => (m ? { ...m, pos: posAt(m.axis, e) } : m));
    const up = (e: PointerEvent) => {
      const s = useStore.getState();
      const ed = s.editor;
      setMoving(null);
      if (!ed) return;
      const pos = posAt(moving.axis, e);
      const limit = moving.axis === "h" ? height : width;
      const rest = ed.guides.items.filter((g) => g.id !== moving.id);
      const items: Guide[] =
        pos < 0 || pos > limit ? rest : [...rest, { id: moving.id, axis: moving.axis, pos }];
      s.updateEditor({ guides: { ...ed.guides, items } });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // posAt 只依赖 scale；moving 换了一条线时重新挂
  }, [moving?.id, scale, width, height]);

  if (!editor) return null;
  const { guides, rulers } = editor;
  const shown = guides.hidden ? [] : guides.items;
  const lines: (Guide & { live?: boolean })[] = shown.map((g) =>
    moving?.id === g.id ? { ...g, pos: moving.pos, live: true } : g,
  );
  if (moving?.fresh) lines.push({ id: moving.id, axis: moving.axis, pos: moving.pos, live: true });

  const grab = (g: Guide) => (e: React.PointerEvent) => {
    if (guides.locked) return;
    e.stopPropagation();
    e.preventDefault();
    setMoving({ id: g.id, axis: g.axis, pos: g.pos, fresh: false });
  };
  const pull = (axis: "h" | "v") => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // 隐藏着时从标尺拉线，先把参考线显示出来
    if (guides.hidden) useStore.getState().updateEditor({ guides: { ...guides, hidden: false } });
    setMoving({ id: newGuideId(), axis, pos: posAt(axis, e), fresh: true });
  };

  const ticks = (len: number) =>
    Array.from({ length: Math.floor(len / LABEL) + 1 }, (_, i) => i * LABEL);

  return (
    <div
      ref={layer}
      className={moving ? "canvas-guides moving" : "canvas-guides"}
      style={{ "--ruler-band": `${band}px` } as React.CSSProperties}
    >
      {lines.map((g) => {
        const out = g.pos < 0 || g.pos > (g.axis === "h" ? height : width);
        return (
          <div
            key={g.id}
            className={[
              "user-guide",
              g.axis,
              guides.locked ? "locked" : "",
              out ? "removing" : "",
            ].join(" ")}
            style={g.axis === "h" ? { top: band + g.pos * scale } : { left: band + g.pos * scale }}
            title={guides.locked ? "参考线已锁定" : "拖动调整；拖出画面删除"}
            onPointerDown={grab(g)}
          >
            {g.live && <span>{out ? "松开删除" : `${g.axis === "h" ? "y" : "x"} ${g.pos}`}</span>}
          </div>
        );
      })}
      {rulers && (
        <>
          <div
            className="ruler top"
            style={{ left: band, height: band, backgroundSize: `${TICK * scale}px 100%` }}
            title="往下拖出水平参考线"
            onPointerDown={pull("h")}
          >
            {ticks(width).map((x) => (
              <span key={x} style={{ left: x * scale }}>
                {x}
              </span>
            ))}
          </div>
          <div
            className="ruler left"
            style={{ top: band, width: band, backgroundSize: `100% ${TICK * scale}px` }}
            title="往右拖出垂直参考线"
            onPointerDown={pull("v")}
          >
            {ticks(height).map((y) => (
              <span key={y} style={{ top: y * scale }}>
                {y}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function newGuideId() {
  return `u${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 2).toString(36)}`;
}

/** 菜单里的「添加参考线」：放在画面中线；中线已有时往后错开，免得叠在一起 */
export function addGuide(axis: "h" | "v", width: number, height: number) {
  const s = useStore.getState();
  const ed = s.editor;
  if (!ed) return;
  const mid = Math.round((axis === "h" ? height : width) / 2);
  let pos = mid;
  while (ed.guides.items.some((g) => g.axis === axis && g.pos === pos)) pos += 40;
  s.updateEditor({
    guides: {
      ...ed.guides,
      hidden: false,
      items: [...ed.guides.items, { id: newGuideId(), axis, pos }],
    },
  });
}
