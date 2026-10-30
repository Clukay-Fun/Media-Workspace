import { useCallback, useState } from "react";

// 面板尺寸只是个人习惯，存在浏览器里；读写失败（隐私模式等）就用默认值

/** leftW、sideW 为 null 时用样式表里按容器宽度给的默认值 */
export type Layout = { leftW: number | null; sideW: number | null; timelineH: number };

const KEY = "mw.layout.v4";

export const DEFAULT_LAYOUT: Layout = { leftW: null, sideW: null, timelineH: 260 };

function read(): Layout {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Layout> | null;
    return { ...DEFAULT_LAYOUT, ...(v ?? {}) };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function useLayout(): [Layout, (patch: Partial<Layout>) => void] {
  const [layout, setLayout] = useState(read);
  const update = useCallback((patch: Partial<Layout>) => {
    setLayout((cur) => {
      const next = { ...cur, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);
  return [layout, update];
}
