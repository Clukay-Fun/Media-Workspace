import { useCallback, useState } from "react";

// 面板尺寸只是个人习惯，存在浏览器里；读写失败（隐私模式等）就用默认值

/** sideW 为 null 时用样式表里按容器宽度给的默认值（340 / 300） */
export type Layout = { sideW: number | null; timelineH: number };

const KEY = "mw.layout.v2";

export const DEFAULT_LAYOUT: Layout = { sideW: null, timelineH: 180 };

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
