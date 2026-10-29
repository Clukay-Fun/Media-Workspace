import { useSyncExternalStore } from "react";

/** 订阅一条媒体查询，窗口尺寸变化时重新渲染 */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

/** 和 styles.css 里的断点一致：比这窄时，左栏和右栏合并成一个侧栏 */
export const NARROW = "(max-width: 1279px)";
