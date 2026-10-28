import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initProject } from "../node/store";
import { createMcpServer } from "./server";

let root: string;
let dir: string;
let client: Client;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mw-mcp-"));
  dir = join(root, "demo.mwproj");
  await initProject(dir);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer().connect(a);
  client = new Client({ name: "test", version: "0" });
  await client.connect(b);
});
afterEach(async () => {
  await client.close();
  await rm(root, { recursive: true, force: true });
});

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text?: string }[];
    isError?: boolean;
  };
  return { isError: Boolean(r.isError), data: JSON.parse(r.content[0]?.text ?? "null") };
};

const asset = {
  op: "asset.add",
  id: "a1",
  asset: { kind: "video", path: "/raw.mov", probe: { durationMs: 10_000 } },
};

describe("MCP", () => {
  it("工具和 mw 命令一一对应", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "align",
        "apply",
        "comments",
        "cover",
        "export",
        "faces",
        "guide",
        "history",
        "import",
        "inspect",
        "lint",
        "preview",
        "redo",
        "resolve",
        "revert",
        "undo",
        "validate",
      ].sort(),
    );
  });

  it("inspect → apply → history → undo", async () => {
    const p = await call("inspect", { project: dir });
    expect(p.data.revision).toBe(0);
    const r = await call("apply", { project: dir, ops: [asset], baseRevision: 0, actor: "codex" });
    expect(r).toMatchObject({ isError: false, data: { ok: true, revision: 1 } });
    const h = await call("history", { project: dir });
    expect(h.data.entries.at(-1)).toMatchObject({ actor: "codex", source: "mcp" });
    const u = await call("undo", { project: dir, baseRevision: 1 });
    expect(u.data).toMatchObject({ ok: true, revision: 2, changed: [] });
  });

  it("锁定的轨道返回 TRACK_LOCKED，冲突返回 CONFLICT（isError）", async () => {
    await call("apply", {
      project: dir,
      ops: [{ op: "track.update", id: "main", set: { locked: true } }, asset],
      baseRevision: 0,
    });
    const locked = await call("apply", {
      project: dir,
      ops: [
        {
          op: "item.add",
          track: "main",
          item: { type: "clip", asset: "a1", inMs: 0, outMs: 1000 },
        },
      ],
      baseRevision: 1,
    });
    expect(locked).toMatchObject({ isError: true, data: { code: "TRACK_LOCKED" } });
    const conflict = await call("apply", { project: dir, ops: [asset], baseRevision: 0 });
    expect(conflict.data.code).toBe("CONFLICT");
  });

  it("guide 返回操作的 JSON Schema", async () => {
    const g = await call("guide");
    expect(g.data.ops).toBeTruthy();
    expect(g.data.rules.length).toBeGreaterThan(3);
  });
});
