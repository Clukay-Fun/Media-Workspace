import { useCallback, useState } from "react";

// 面板尺寸只是个人习惯，存在浏览器里；读写失败（隐私模式等）就用默认值

export type Layout = { leftW: number; timelineH: number };

const KEY = "mw.layout";

export const DEFAULT_LAYOUT: Layout = { leftW: 0.58, timelineH: 240 };

function read(): Layout {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Layout> | null;
    return { ...DEFAULT_LAYOUT, ...(v ?? {}) };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/** leftW 存成占窗口宽度的比例，换窗口大小时左右比例不变；timelineH 是像素 */
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
