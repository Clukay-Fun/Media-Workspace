import { MwError } from "../core/errors";
import { exportProject } from "../node/actions";
import type { EventBus } from "./events";

// 导出任务：同一时间只跑一个（渲染会占满 CPU），进度通过 SSE 推给网页。

export type ExportJobs = {
  start: (out?: string) => string;
  running: () => string | null;
};

export function createExportJobs(
  dir: string,
  bus: EventBus,
  run: typeof exportProject = exportProject,
): ExportJobs {
  let current: string | null = null;
  let seq = 0;
  return {
    running: () => current,
    start: (out) => {
      if (current) {
        throw new MwError("CONFLICT", "正在导出，等这次完成后再试", { hint: `任务 ${current}` });
      }
      const jobId = `export-${Date.now()}-${++seq}`;
      current = jobId;
      let last = -1;
      bus.emit({ type: "export", jobId, progress: 0, done: false });
      run(dir, {
        out,
        onProgress: ({ progress }) => {
          // 每 1% 推一次，避免每帧都推
          const pct = Math.floor(progress * 100);
          if (pct === last) return;
          last = pct;
          bus.emit({ type: "export", jobId, progress, done: false });
        },
      })
        .then((r) => bus.emit({ type: "export", jobId, progress: 1, done: true, file: r.file }))
        .catch((e: unknown) =>
          bus.emit({
            type: "export",
            jobId,
            progress: 0,
            done: true,
            error: {
              code: e instanceof MwError ? e.code : "RENDER",
              message: String((e as Error)?.message ?? e),
            },
          }),
        )
        .finally(() => {
          current = null;
        });
      return jobId;
    },
  };
}
