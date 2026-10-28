import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MwError } from "../core/errors";
import { projectFiles } from "./paths";
import {
  applyToProject,
  initProject,
  listHistory,
  loadProject,
  readLog,
  revertProject,
  withLock,
} from "./store";

let root: string;
let dir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mw-store-"));
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
  item: { type: "clip", asset: "a1", inMs: 0, outMs: 5000 },
};
const req = (ops: unknown[], baseRevision: number) =>
  ({ ops, baseRevision, source: "cli", actor: "test" }) as const;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof MwError) return e.code;
    throw e;
  }
  return "OK";
}

describe("store", () => {
  it("apply 之后 revision 加一，上一版进 history，记录日志", async () => {
    const r = await applyToProject(dir, req([asset, addClip], 0));
    expect(r).toMatchObject({ revision: 1, changed: ["a1", "c1"] });
    expect((await loadProject(dir)).revision).toBe(1);
    expect(await listHistory(dir)).toEqual([0]);
    const log = await readLog(dir);
    expect(log.map((l) => [l.kind, l.revision, l.actor])).toEqual([
      ["init", 0, "user"],
      ["apply", 1, "test"],
    ]);
  });

  it("revision 不一致时返回 CONFLICT，工程不变", async () => {
    await applyToProject(dir, req([asset], 0));
    expect(await code(applyToProject(dir, req([addClip], 0)))).toBe("CONFLICT");
    expect((await loadProject(dir)).revision).toBe(1);
  });

  it("两个进程同时基于同一版提交：只有一个成功，另一个 CONFLICT", async () => {
    const results = await Promise.all([
      code(applyToProject(dir, req([asset], 0))),
      code(applyToProject(dir, req([{ ...asset, id: "a2" }], 0))),
    ]);
    expect(results.toSorted()).toEqual(["CONFLICT", "OK"]);
  });

  it("校验失败、锁定轨道时 project.json 不变，也不产生历史", async () => {
    const before = await readFile(projectFiles(dir).project, "utf8");
    expect(await code(applyToProject(dir, req([addClip], 0)))).toBe("VALIDATION");
    await applyToProject(dir, req([{ op: "track.update", id: "main", set: { locked: true } }], 0));
    const locked = await readFile(projectFiles(dir).project, "utf8");
    expect(await code(applyToProject(dir, req([asset, addClip], 1)))).toBe("TRACK_LOCKED");
    expect(await readFile(projectFiles(dir).project, "utf8")).toBe(locked);
    expect(before).not.toBe(locked);
    expect(await listHistory(dir)).toEqual([0]);
  });

  it("dry-run 只检查不写入", async () => {
    const r = await applyToProject(dir, { ...req([asset], 0), dryRun: true });
    expect(r).toMatchObject({ dryRun: true, revision: 0, changed: ["a1"] });
    expect((await loadProject(dir)).revision).toBe(0);
  });

  it("回退到历史版本：内容恢复，revision 继续增加", async () => {
    await applyToProject(dir, req([asset], 0));
    await applyToProject(dir, req([addClip], 1));
    const r = await revertProject(dir, { to: 1, source: "cli", actor: "test" });
    expect(r.revision).toBe(3);
    const p = await loadProject(dir);
    expect(p.tracks[0]?.items).toEqual([]);
    expect(p.assets.a1).toBeDefined();
  });

  it("回退不能改动已锁定的轨道", async () => {
    await applyToProject(dir, req([asset], 0));
    await applyToProject(
      dir,
      req([addClip, { op: "track.update", id: "main", set: { locked: true } }], 1),
    );
    expect(await code(revertProject(dir, { to: 1, source: "cli", actor: "test" }))).toBe(
      "TRACK_LOCKED",
    );
  });

  it("残留的锁（进程已经不存在）会被接管；写入后不留临时文件", async () => {
    await writeFile(projectFiles(dir).lock, JSON.stringify({ pid: 999_999_999, at: Date.now() }));
    await applyToProject(dir, req([asset], 0));
    const files = await readdir(dir);
    expect(files.filter((f) => f.endsWith(".tmp") || f === ".lock")).toEqual([]);
  });

  it("锁被占用时排队等待，按顺序执行", async () => {
    const order: string[] = [];
    await Promise.all([
      withLock(dir, async () => {
        order.push("a-start");
        await new Promise((r) => setTimeout(r, 100));
        order.push("a-end");
      }),
      new Promise((r) => setTimeout(r, 10)).then(() =>
        withLock(dir, async () => {
          order.push("b");
        }),
      ),
    ]);
    expect(order).toEqual(["a-start", "a-end", "b"]);
  });

  it("工程不存在时报 NOT_FOUND", async () => {
    expect(await code(applyToProject(join(root, "nope.mwproj"), req([asset], 0)))).toBe(
      "NOT_FOUND",
    );
  });
});
