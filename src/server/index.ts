import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join, relative, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { API_PORT } from "../core/api";
import { MwError } from "../core/errors";
import { getFontCatalog } from "../node/fonts";
import { startMediaServer } from "../node/media-server";
import { projectsDir } from "../node/paths";
import { loadProject } from "../node/store";
import { createApp } from "./app";
import { createBus, watchProject } from "./events";
import { createExportJobs } from "./export-jobs";
import { ProjectSessions } from "./project-sessions";

// mw serve：本地服务 + 工作台网页。只监听 127.0.0.1（D9）。

const WEB_DIST = resolve(import.meta.dirname, "..", "..", "dist", "web");

export type RunningServer = { url: string; port: number; close: () => Promise<void> };

export async function startServer(
  dir?: string,
  opts: { port?: number; onLog?: (s: string) => void } = {},
): Promise<RunningServer> {
  // 预热字体目录；扫描失败只体现在 /api/fonts 的 warning，不阻止工作台启动。
  void getFontCatalog().catch((e) => opts.onLog?.(`字体目录扫描失败：${String(e)}`));
  // 传入工程时保持旧的单工程服务；不传时仅允许浏览 projectsDir() 下的工程。
  if (dir) await loadProject(dir);
  const media = await startMediaServer(null);
  const bus = createBus();
  const sessions = dir ? null : new ProjectSessions(media);
  const watcher = dir
    ? await watchProject(dir, bus, (e) => opts.onLog?.(`读取修改日志失败：${e}`))
    : null;
  const app = createApp(
    sessions
      ? {
          listProjects: () => sessions.list(),
          resolveProject: (id: string) => sessions.get(id),
          watchProject: (id: string) => sessions.watch(id),
        }
      : {
          dir: dir as string,
          bus,
          register: (abs) => media.register(abs),
          exports: createExportJobs(dir as string, bus),
        },
  );

  // 工作台网页（pnpm web:build 的产物）；开发时用 Vite（5173 端口，/api 代理到这里）
  if (existsSync(join(WEB_DIST, "index.html"))) {
    const root = relative(process.cwd(), WEB_DIST) || ".";
    app.use("/*", serveStatic({ root }));
    app.get("*", serveStatic({ root, path: "index.html" }));
  } else {
    app.get("/", (c) =>
      c.html(
        '<meta charset="utf-8"><p>工作台网页还没有构建：运行 <code>pnpm web:build</code>，' +
          "或者开发时运行 <code>pnpm web:dev</code> 打开 http://127.0.0.1:5173。</p>",
      ),
    );
  }

  const port = opts.port ?? API_PORT;
  const server = await new Promise<ReturnType<typeof serve>>((ok, bad) => {
    const s = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => ok(s));
    s.once("error", (e: NodeJS.ErrnoException) =>
      bad(
        e.code === "EADDRINUSE"
          ? new MwError("USAGE", `端口 ${port} 已被占用`, { hint: "用 --port 换一个端口" })
          : e,
      ),
    );
  });
  const actual = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${actual}`;
  opts.onLog?.(`工作台：${url}`);
  return {
    url,
    port: actual,
    close: async () => {
      watcher?.close();
      await sessions?.close();
      await new Promise<void>((ok) => server.close(() => ok()));
      await media.close();
    },
  };
}
