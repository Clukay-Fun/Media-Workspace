import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerEvent } from "../core/api";
import { applyToProject, initProject } from "../node/store";
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
  it("读工程、提交操作、版本冲突返回 409", async () => {
    const { req } = setup();
    const p = await (await req("/api/project")).json();
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

  it("只接受本机的 Host（防 DNS 重绑定）", async () => {
    const { req } = setup();
    expect((await req("/api/project", { host: "evil.example.com" })).status).toBe(403);
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

  it("导出任务推送进度；同时只能有一个导出", async () => {
    let finish: () => void = () => {};
    const { req, events } = setup(async (_dir, o) => {
      o?.onProgress?.({ progress: 0.5, renderedFrames: 10 });
      await new Promise<void>((ok) => {
        finish = ok;
      });
      return { ok: true, revision: 0, file: "/out.mp4", frames: 20, seconds: 1, warnings: [] };
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
