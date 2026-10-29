import type React from "react";
import { useRef } from "react";

/**
 * 拖动分隔条。axis="x" 左右拖，"y" 上下拖；onDrag 收到相对按下时的位移（像素）。
 * 双击恢复默认。
 */
export function Splitter({
  axis,
  label,
  onStart,
  onDrag,
  onReset,
}: {
  axis: "x" | "y";
  label: string;
  onStart: () => void;
  onDrag: (delta: number) => void;
  onReset: () => void;
}) {
  const start = useRef<number | null>(null);
  const pos = (e: React.PointerEvent) => (axis === "x" ? e.clientX : e.clientY);
  return (
    <div
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-label={label}
      tabIndex={-1}
      className={`splitter ${axis}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = pos(e);
        onStart();
      }}
      onPointerMove={(e) => {
        if (start.current !== null) onDrag(pos(e) - start.current);
      }}
      onPointerUp={() => {
        start.current = null;
      }}
      onDoubleClick={onReset}
    />
  );
}
