import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerEvent } from "../core/api";
import { applyToProject, commentOnProject, initProject } from "../node/store";
import { createApp } from "./app";
import { createBus, watchProject } from "./events";
import { createExportJobs } from "./export-jobs";

let root: string;
let dir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mw-server-"));
  dir = join(root, "demo.mwproj");
  await initProject(dir);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const asset = {
  op: "asset.add",
  id: "a1",
  asset: { kind: "video", path: "/raw.mov", probe: { durationMs: 10_000 } },
};
const addClip = {
  op: "item.add",
  track: "main",
  item: { id: "c1", type: "clip", asset: "a1", inMs: 0, outMs: 5000 },
};

function setup(run?: Parameters<typeof createExportJobs>[2]) {
  const bus = createBus();
  const events: ServerEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const app = createApp({
    dir,
    bus,
    register: (abs) => `http://media/${abs}`,
    exports: createExportJobs(dir, bus, run),
  });
  const req = (path: string, init?: { method?: string; body?: unknown; host?: string }) =>
    app.request(`http://127.0.0.1:5170${path}`, {
      method: init?.method ?? (init?.body ? "POST" : "GET"),
      headers: { host: init?.host ?? "127.0.0.1:5170", "content-type": "application/json" },
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  return { app, bus, events, req };
}

describe("本地服务接口", () => {
  it("账号版式：读、整份替换，不合法返回 422", async () => {
    const old = process.env.MW_HOME;
    process.env.MW_HOME = root;
    try {
      const { req } = setup();
      expect(await (await req("/api/library/layout")).json()).toEqual({ ok: true, layout: null });
      const guides = [{ id: "c", axis: "v", pos: 0.5, label: "中线" }];
      const put = await req("/api/library/layout", { method: "PUT", body: { guides } });
      expect((await put.json()).layout).toMatchObject({ version: 1, guides, face: null });
      expect((await (await req("/api/library/layout")).json()).layout.guides).toEqual(guides);
      const bad = await req("/api/library/layout", { method: "PUT", body: { face: { cx: 2 } } });
      expect(bad.status).toBe(422);
    } finally {
      if (old === undefined) delete process.env.MW_HOME;
      else process.env.MW_HOME = old;
    }
  });

  it("读工程、提交操作、版本冲突返回 409", async () => {
    const { req } = setup();
    const p = await (await req("/api/project")).json();
    expect(p.name).toBe("demo");
    expect(p.dir).toBe(dir);
    expect(p.project.revision).toBe(0);
    const ok = await req("/api/ops", { body: { ops: [asset], baseRevision: 0 } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, revision: 1, changed: ["a1"] });
    const conflict = await req("/api/ops", { body: { ops: [asset], baseRevision: 0 } });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ ok: false, code: "CONFLICT" });
  });

  it("锁定轨道返回 423；参数拼错返回 UNKNOWN_FIELD；不是 JSON 返回 400", async () => {
    const { req, app } = setup();
    await req("/api/ops", {
      body: { ops: [{ op: "track.update", id: "main", set: { locked: true } }], baseRevision: 0 },
    });
    const locked = await req("/api/ops", { body: { ops: [asset, addClip], baseRevision: 1 } });
    expect(locked.status).toBe(423);
    const typo = await req("/api/ops", { body: { ops: [asset], baseRevison: 1 } });
    expect(typo.status).toBe(422);
    expect((await typo.json()).code).toBe("UNKNOWN_FIELD");
    const bad = await app.request("http://127.0.0.1/api/ops", {
      method: "POST",
      headers: { host: "127.0.0.1" },
      body: "{",
    });
    expect(bad.status).toBe(400);
  });

  it("撤销 / 重做和历史", async () => {
    const { req } = setup();
    await req("/api/ops", { body: { ops: [asset], baseRevision: 0 } });
    await req("/api/ops", { body: { ops: [addClip], baseRevision: 1 } });
    const u = await (await req("/api/undo", { body: { baseRevision: 2 } })).json();
    expect(u).toMatchObject({ ok: true, revision: 3, changed: ["c1"] });
    const h = await (await req("/api/history")).json();
    expect(h.redo).toEqual({ revision: 2 });
    expect(h.entries.map((e: { kind: string }) => e.kind)).toEqual([
      "init",
      "apply",
      "apply",
      "undo",
    ]);
    const r = await req("/api/redo", { body: { baseRevision: 3 } });
    expect(await r.json()).toMatchObject({ revision: 4, changed: ["c1"] });
  });

  it("编辑器状态读写，不增加 revision", async () => {
    const { req } = setup();
    const { editor } = await (await req("/api/editor")).json();
    editor.guides.items.push({ id: "g1", axis: "h", pos: 1167 });
    expect((await req("/api/editor", { method: "PUT", body: editor })).status).toBe(200);
    expect((await (await req("/api/editor")).json()).editor.guides.items).toHaveLength(1);
    expect((await (await req("/api/project")).json()).project.revision).toBe(0);
  });

  it("预览参数：合成组件的 props，媒体换成 URL", async () => {
    const { req } = setup();
    const r = await (await req("/api/preview")).json();
    expect(r.ok).toBe(true);
    expect(r.props.timeline).toMatchObject({ width: 1080, height: 1920, fps: 30 });
  });

  it("质检结果", async () => {
    const { req } = setup();
    await req("/api/ops", { body: { ops: [asset], baseRevision: 0 } });
    expect(await (await req("/api/lint")).json()).toEqual({
      ok: true,
      revision: 1,
      issues: [],
      noFaceData: ["a1"],
    });
  });

  it("批注：写入、标记已处理、删除，不增加 revision", async () => {
    const { req } = setup();
    await req("/api/ops", { body: { ops: [asset, addClip], baseRevision: 0 } });
    const c = await (
      await req("/api/comments", { body: { text: "这段太长", atMs: 1200, target: "c1" } })
    ).json();
    expect(c.comment).toMatchObject({ id: "k1", author: "user", source: "ui", revision: 1 });
    const missing = await req("/api/comments", { body: { text: "x", target: "nope" } });
    expect(missing.status).toBe(404);
    await req("/api/comments/k1", {
      body: { status: "resolved", note: "剪掉 2 秒", actor: "claude" },
    });
    const r = await (await req("/api/comments")).json();
    expect(r.review.comments[0]).toMatchObject({
      status: "resolved",
      resolution: { by: "claude" },
    });
    expect((await req("/api/comments/k1", { method: "DELETE" })).status).toBe(200);
    expect((await (await req("/api/comments")).json()).review.comments).toEqual([]);
    expect((await (await req("/api/project")).json()).project.revision).toBe(1);
  });

  it("只接受本机的 Host（防 DNS 重绑定）", async () => {
    const { req } = setup();
    expect((await req("/api/project", { host: "evil.example.com" })).status).toBe(403);
  });

  it("拒绝外部网页的简单写请求，允许开发工作台来源", async () => {
    const { app, req } = setup();
    const external = await app.request("http://127.0.0.1:5170/api/comments", {
      method: "POST",
      headers: {
        host: "127.0.0.1:5170",
        origin: "https://attacker.example",
        "content-type": "text/plain",
      },
      body: JSON.stringify({ text: "外部批注" }),
    });
    expect(external.status).toBe(403);
    expect((await (await req("/api/comments")).json()).review.comments).toEqual([]);

    const dev = await app.request("http://127.0.0.1:5170/api/comments", {
      method: "POST",
      headers: {
        host: "127.0.0.1:5170",
        origin: "http://127.0.0.1:5173",
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: "开发工作台批注" }),
    });
    expect(dev.status).toBe(200);
  });

  it("模板库：列出、存进库、重名报错", async () => {
    const oldHome = process.env.MW_HOME;
    process.env.MW_HOME = root;
    try {
      const { req } = setup();
      const list = await (await req("/api/library/styles")).json();
      expect(list.styles.map((s: { name: string }) => s.name)).toContain("caption-word-yellow");
      const body = { style: "caption-word-yellow", as: "srv-cap" };
      const saved = await req("/api/library/styles", { method: "POST", body });
      expect(await saved.json()).toEqual({ ok: true, saved: "srv-cap" });
      const again = await req("/api/library/styles", { method: "POST", body });
      expect(again.status).toBe(422);
      expect((await again.json()).code).toBe("DUPLICATE_ID");
    } finally {
      if (oldHome === undefined) delete process.env.MW_HOME;
      else process.env.MW_HOME = oldHome;
    }
  });

  it("没有的接口返回结构化的 404", async () => {
    const { req } = setup();
    const r = await req("/api/nope");
    expect(r.status).toBe(404);
    expect((await r.json()).code).toBe("NOT_FOUND");
  });
});

describe("推送", () => {
  it("任何来源（这里是 CLI）提交后推送 project 事件，带改动的条目和操作者", async () => {
    const bus = createBus();
    const events: ServerEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const w = await watchProject(dir, bus);
    try {
      await applyToProject(dir, { ops: [asset], baseRevision: 0, source: "cli", actor: "codex" });
      await applyToProject(dir, {
        ops: [addClip],
        baseRevision: 1,
        source: "mcp",
        actor: "claude",
      });
      const t0 = Date.now();
      while (events.length < 2 && Date.now() - t0 < 2000)
        await new Promise((r) => setTimeout(r, 20));
      expect(events).toEqual([
        {
          type: "project",
          revision: 1,
          changed: ["a1"],
          actor: "codex",
          source: "cli",
          kind: "apply",
        },
        {
          type: "project",
          revision: 2,
          changed: ["c1"],
          actor: "claude",
          source: "mcp",
          kind: "apply",
        },
      ]);
      // 1 秒内送达（验收第 2 项）
      expect(Date.now() - t0).toBeLessThan(1000);
    } finally {
      w.close();
    }
  });

  it("别的进程（这里是 MCP）写批注后推送 review 事件", async () => {
    const bus = createBus();
    const events: ServerEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const w = await watchProject(dir, bus);
    try {
      await commentOnProject(dir, { text: "看一下" }, { author: "claude", source: "mcp" });
      const t0 = Date.now();
      while (events.length < 1 && Date.now() - t0 < 2000)
        await new Promise((r) => setTimeout(r, 20));
      expect(events).toEqual([{ type: "review" }]);
    } finally {
      w.close();
    }
  });

  it("导出任务推送进度；同时只能有一个导出", async () => {
    let finish: () => void = () => {};
    const { req, events } = setup(async (_dir, o) => {
      o?.onProgress?.({ progress: 0.5, renderedFrames: 10 });
      await new Promise<void>((ok) => {
        finish = ok;
      });
      return {
        ok: true,
        revision: 0,
        file: "/out.mp4",
        frames: 20,
        durationMs: 667,
        renderSeconds: 1,
        warnings: [],
      };
    });
    const r = await (await req("/api/export", { body: {} })).json();
    expect(r.jobId).toMatch(/^export-/);
    expect((await req("/api/export", { body: {} })).status).toBe(409);
    finish();
    await new Promise((ok) => setTimeout(ok, 10));
    const ex = events.filter((e) => e.type === "export");
    expect(ex.map((e) => e.type === "export" && e.progress)).toEqual([0, 0.5, 1]);
    expect(ex.at(-1)).toMatchObject({ done: true, file: "/out.mp4" });
  });
});
