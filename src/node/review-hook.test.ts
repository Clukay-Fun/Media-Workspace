import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearServing,
  hookOutput,
  markServing,
  promptContext,
  reviewTargets,
  waitForComments,
} from "./review-hook";
import { commentOnProject, initProject, setCommentOnProject } from "./store";

let root: string;
let dir: string;
const prevHome = process.env.MW_HOME;
const meta = { author: "user", source: "ui" as const };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mw-hook-"));
  process.env.MW_HOME = root;
  await mkdir(join(root, "projects"));
  dir = join(root, "projects", "demo.mwproj");
  await initProject(dir);
});
afterEach(async () => {
  if (prevHome === undefined) delete process.env.MW_HOME;
  else process.env.MW_HOME = prevHome;
  await rm(root, { recursive: true, force: true });
});

describe("promptContext", () => {
  it("没有待处理批注时什么都不输出", async () => {
    expect(await promptContext([dir])).toBe("");
  });

  it("新批注给全文，已经附过的只提数量", async () => {
    await commentOnProject(dir, { text: "标题再往上一点", atMs: 1200 }, meta);
    const first = await promptContext([dir]);
    expect(first).toContain("1 条新批注");
    expect(first).toContain("k1 @1.2s：标题再往上一点");

    await commentOnProject(dir, { text: "字幕换黄色" }, meta);
    const second = await promptContext([dir]);
    expect(second).toContain("k2：字幕换黄色");
    expect(second).not.toContain("标题再往上一点");
    expect(second).toContain("还有 1 条之前给过的批注没处理");

    await setCommentOnProject(dir, { id: "k1", status: "resolved", author: "claude" });
    await setCommentOnProject(dir, { id: "k2", status: "resolved", author: "claude" });
    expect(await promptContext([dir])).toBe("");
  });

  it("输出 Claude Code / Codex 都认的 hook 格式", () => {
    expect(hookOutput("x")).toEqual({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "x" },
    });
  });
});

describe("reviewTargets", () => {
  it("开着审片台时只看那个工程，关掉后看所有有待处理批注的工程", async () => {
    const other = join(root, "projects", "other.mwproj");
    await initProject(other);
    await commentOnProject(other, { text: "a" }, meta);

    await markServing(dir);
    expect(await reviewTargets()).toEqual([dir]);
    await clearServing(dir);
    expect(await reviewTargets()).toEqual([other]);
  });
});

describe("waitForComments", () => {
  it("已有的批注不算，新写的才返回", async () => {
    await commentOnProject(dir, { text: "旧的" }, meta);
    const waiting = waitForComments(dir, { timeoutMs: 5000 });
    await new Promise((r) => setTimeout(r, 50));
    await commentOnProject(dir, { text: "新的" }, meta);
    const got = await waiting;
    expect(got.map((c) => c.text)).toEqual(["新的"]);
  });

  it("超时返回空列表", async () => {
    expect(await waitForComments(dir, { timeoutMs: 50 })).toEqual([]);
  });
});
