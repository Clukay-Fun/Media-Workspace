import { type FSWatcher, watch } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { ServerEvent } from "../core/api";
import { projectFiles } from "../node/paths";
import { readLog } from "../node/store";

// 推送给网页的事件。工程的修改不管来自界面、CLI 还是 MCP，都经过 store 写日志，
// 所以只在一处监听日志，取出是谁改了什么——界面自己提交的修改也走同一条路。

export type EventBus = {
  emit: (e: ServerEvent) => void;
  subscribe: (fn: (e: ServerEvent) => void) => () => void;
};

export function createBus(): EventBus {
  const subs = new Set<(e: ServerEvent) => void>();
  return {
    emit: (e) => {
      for (const fn of subs) fn(e);
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

/**
 * 监听修改日志：store 提交时最后一步才追加日志，日志里有了这一版，project.json 一定已经写好。
 * 每个新版本补发一个事件（一次检查可能发现好几版，例如 CLI 连续提交）。
 */
export async function watchProject(
  dir: string,
  bus: EventBus,
  onError?: (e: unknown) => void,
): Promise<{ close: () => void; check: () => Promise<void> }> {
  const logs = projectFiles(dir).logs;
  await mkdir(logs, { recursive: true });
  let last = (await readLog(dir)).at(-1)?.revision ?? 0;
  let timer: NodeJS.Timeout | null = null;
  let running = Promise.resolve();

  const check = () => {
    running = running.then(async () => {
      try {
        for (const e of await readLog(dir)) {
          if (e.revision <= last) continue;
          last = e.revision;
          bus.emit({
            type: "project",
            revision: e.revision,
            changed: e.changed,
            actor: e.actor,
            source: e.source,
            kind: e.kind,
          });
        }
      } catch (e) {
        onError?.(e);
      }
    });
    return running;
  };

  const watcher: FSWatcher = watch(logs, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void check(), 20);
  });
  // 批注写在 review.json（原子写入 = 临时文件改名），只看文件名，合并 20ms 内的多次变化
  let reviewTimer: NodeJS.Timeout | null = null;
  const reviewWatcher: FSWatcher = watch(dir, (_, name) => {
    if (name !== "review.json") return;
    if (reviewTimer) clearTimeout(reviewTimer);
    reviewTimer = setTimeout(() => bus.emit({ type: "review" }), 20);
  });
  return {
    close: () => {
      if (timer) clearTimeout(timer);
      if (reviewTimer) clearTimeout(reviewTimer);
      watcher.close();
      reviewWatcher.close();
    },
    check,
  };
}
