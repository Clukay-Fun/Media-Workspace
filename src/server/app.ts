import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { ZodError, type z } from "zod";
import {
  type ApiError,
  CommentRequest,
  CommentStatusRequest,
  EditorState,
  ExportRequest,
  httpStatus,
  OpsRequest,
  ROUTES,
  type ServerEvent,
  UndoRequest,
} from "../core/api";
import { MwError } from "../core/errors";
import { zodIssues } from "../core/validate";
import { lintDir, templateOpts } from "../node/actions";
import { buildProps } from "../node/render";
import {
  applyToProject,
  commentOnProject,
  historyState,
  loadEditor,
  loadProject,
  loadReview,
  removeCommentFromProject,
  saveEditor,
  setCommentOnProject,
  undoProject,
} from "../node/store";
import type { EventBus } from "./events";
import type { ExportJobs } from "./export-jobs";

// 本地服务的路由（接口约定见 core/api.ts）。这里只做参数解析和输出格式，逻辑都在 node/ 和 core/ 里。

export type AppContext = {
  dir: string;
  bus: EventBus;
  /** 把本机文件登记到媒体服务，返回网页能访问的 URL（支持 Range） */
  register: (absPath: string) => string;
  exports: ExportJobs;
};

/** 只接受来自本机的请求：防止网页通过 DNS 重绑定访问本地服务 */
const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;
const DEV_ORIGINS = new Set(["http://127.0.0.1:5173", "http://localhost:5173"]);

export function createApp(ctx: AppContext): Hono {
  const app = new Hono();

  app.use("/api/*", async (c, next) => {
    const host = c.req.header("host") ?? "";
    if (!LOCAL_HOST.test(host)) {
      return c.json(apiError(new MwError("USAGE", "只接受本机访问")), 403);
    }
    const origin = c.req.header("origin");
    if (origin && origin !== `http://${host}` && !DEV_ORIGINS.has(origin)) {
      return c.json(apiError(new MwError("USAGE", "不接受其他网页发起的请求")), 403);
    }
    if (
      ["POST", "PUT"].includes(c.req.method) &&
      !c.req.header("content-type")?.toLowerCase().startsWith("application/json")
    ) {
      return c.json(apiError(new MwError("USAGE", "请求体必须是 JSON")), 400);
    }
    await next();
  });

  app.onError((e, c) => {
    const body = apiError(e);
    return c.json(body, httpStatus(body.code));
  });

  const body = async <T extends z.ZodType>(c: { req: { json: () => Promise<unknown> } }, s: T) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw new MwError("USAGE", "请求体不是合法的 JSON");
    }
    return s.parse(raw) as z.output<T>;
  };

  app.get(ROUTES.project, async (c) =>
    c.json({ ok: true, name: basename(ctx.dir, ".mwproj"), project: await loadProject(ctx.dir) }),
  );

  app.get(ROUTES.preview, async (c) => {
    const project = await loadProject(ctx.dir);
    const { props } = await buildProps(ctx.dir, project, ctx.register, "proxy");
    return c.json({ ok: true, props });
  });

  app.get(ROUTES.editor, async (c) => c.json({ ok: true, editor: await loadEditor(ctx.dir) }));
  app.put(ROUTES.editor, async (c) => {
    await saveEditor(ctx.dir, await body(c, EditorState));
    return c.json({ ok: true });
  });

  app.post(ROUTES.ops, async (c) => {
    const req = await body(c, OpsRequest);
    const r = await applyToProject(ctx.dir, {
      ops: req.ops,
      baseRevision: req.baseRevision,
      source: "ui",
      actor: req.actor,
      dryRun: req.dryRun,
      ...templateOpts,
    });
    return c.json(r);
  });

  app.get(ROUTES.lint, async (c) => c.json(await lintDir(ctx.dir)));

  app.get(ROUTES.comments, async (c) => c.json({ ok: true, review: await loadReview(ctx.dir) }));
  app.post(ROUTES.comments, async (c) => {
    const { actor, ...input } = await body(c, CommentRequest);
    return c.json(await commentOnProject(ctx.dir, input, { author: actor, source: "ui" }));
  });
  app.post("/api/comments/:id", async (c) => {
    const req = await body(c, CommentStatusRequest);
    return c.json(
      await setCommentOnProject(ctx.dir, {
        id: c.req.param("id"),
        status: req.status,
        note: req.note,
        author: req.actor,
      }),
    );
  });
  app.delete("/api/comments/:id", async (c) =>
    c.json(await removeCommentFromProject(ctx.dir, c.req.param("id"))),
  );

  app.get(ROUTES.history, async (c) => c.json({ ok: true, ...(await historyState(ctx.dir)) }));

  for (const direction of ["undo", "redo"] as const) {
    app.post(ROUTES[direction], async (c) => {
      const req = await body(c, UndoRequest);
      const r = await undoProject(ctx.dir, {
        direction,
        baseRevision: req.baseRevision,
        source: "ui",
        actor: req.actor,
      });
      return c.json(r);
    });
  }

  app.get("/api/media/:asset/peaks", async (c) => {
    const id = c.req.param("asset");
    const project = await loadProject(ctx.dir);
    const peaks = project.assets[id]?.cache?.peaks;
    if (!peaks) throw new MwError("NOT_FOUND", `素材「${id}」没有波形数据`);
    const data = JSON.parse(await readFile(join(ctx.dir, peaks), "utf8"));
    return c.json({ ok: true, ...data });
  });

  app.post(ROUTES.export, async (c) => {
    const req = await body(c, ExportRequest);
    return c.json({ ok: true, jobId: ctx.exports.start(req.out) });
  });

  app.get(ROUTES.events, (c) =>
    streamSSE(c, async (stream) => {
      const queue: ServerEvent[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = ctx.bus.subscribe((e) => {
        queue.push(e);
        wake?.();
      });
      stream.onAbort(() => {
        unsubscribe();
        wake?.();
      });
      // 先告诉网页当前的版本，断线重连后可以判断要不要刷新
      const project = await loadProject(ctx.dir);
      await stream.writeSSE({
        event: "hello",
        data: JSON.stringify({ revision: project.revision }),
      });
      while (!stream.aborted) {
        const e = queue.shift();
        if (e) {
          await stream.writeSSE({ event: e.type, data: JSON.stringify(e) });
          continue;
        }
        // 没有事件时每 15 秒发一次心跳，避免连接被中间环节断开
        await new Promise<void>((ok) => {
          wake = ok;
          setTimeout(ok, 15_000);
        });
        wake = null;
        if (queue.length === 0 && !stream.aborted)
          await stream.writeSSE({ event: "ping", data: "" });
      }
    }),
  );

  app.notFound((c) =>
    c.req.path.startsWith("/api/")
      ? c.json(apiError(new MwError("NOT_FOUND", `没有这个接口：${c.req.path}`)), 404)
      : c.text("Not Found", 404),
  );

  return app;
}

export function apiError(e: unknown): ApiError {
  if (e instanceof MwError)
    return { ok: false, code: e.code, message: e.message, issues: e.issues };
  if (e instanceof ZodError) {
    const issues = zodIssues(e);
    return {
      ok: false,
      code: issues.some((i) => i.code === "UNKNOWN_FIELD") ? "UNKNOWN_FIELD" : "VALIDATION",
      message: "请求参数不对",
      issues,
    };
  }
  const message = String((e as Error)?.message ?? e);
  return {
    ok: false,
    code: "INTERNAL",
    message,
    issues: [{ code: "INTERNAL", path: "", message }],
  };
}
