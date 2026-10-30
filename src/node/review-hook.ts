import { watch } from "node:fs";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Comment } from "../core/review";
import { mwHome, projectFiles, projectsDir } from "./paths";
import { atomicWrite, loadReview } from "./store";

// 让对话里的 AI 接到审片台的批注：
// - 对话 hook（Claude Code、Codex 的 UserPromptSubmit）每次发消息时调 promptContext，把新批注附在消息后面；
// - AI 想专心等批注时跑 waitForComments，有新批注就返回。

const servingFile = () => join(mwHome(), "serving.json");

/** mw serve 启动时记下正在审的工程，hook 据此只看这一个 */
export async function markServing(dir: string): Promise<void> {
  await atomicWrite(servingFile(), JSON.stringify({ dir, pid: process.pid }));
}

export async function clearServing(dir: string): Promise<void> {
  const cur = await readServing();
  if (cur?.dir === dir) await rm(servingFile(), { force: true });
}

async function readServing(): Promise<{ dir: string; pid: number } | null> {
  const raw = await readFile(servingFile(), "utf8").catch(() => null);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { dir?: unknown; pid?: unknown };
    return typeof v.dir === "string" && typeof v.pid === "number"
      ? { dir: v.dir, pid: v.pid }
      : null;
  } catch {
    return null;
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM：进程在，只是不属于当前用户
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** 正在审的工程；没开审片台时退回到所有有待处理批注的工程 */
export async function reviewTargets(): Promise<string[]> {
  const s = await readServing();
  if (s && alive(s.pid)) return [s.dir];
  const names = await readdir(projectsDir()).catch(() => [] as string[]);
  const dirs = names.filter((n) => n.endsWith(".mwproj")).map((n) => join(projectsDir(), n));
  const withOpen = await Promise.all(
    dirs.map(async (d) =>
      (await loadReview(d).catch(() => null))?.comments.some((c) => c.status === "open") ? d : null,
    ),
  );
  return withOpen.filter((d): d is string => d !== null);
}

const seenFile = (dir: string) => join(dir, "cache", "review-hook.json");

async function loadSeen(dir: string): Promise<Set<string>> {
  const raw = await readFile(seenFile(dir), "utf8").catch(() => null);
  try {
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

const atText = (ms: number | undefined) => (ms === undefined ? "" : ` @${(ms / 1000).toFixed(1)}s`);

export function describeComment(c: Comment): string {
  const target = c.target ? ` [${c.target}]` : "";
  const point = c.point ? ` 画面(${Math.round(c.point.x)},${Math.round(c.point.y)})` : "";
  return `- ${c.id}${atText(c.atMs)}${target}${point}：${c.text}`;
}

/**
 * 发消息时附给 AI 的一段话。新批注给全文；已经附过、还没处理的只提一句数量，避免每条消息都重复。
 * 没有待处理批注时返回空串（hook 什么都不输出）。
 */
export async function promptContext(dirs: string[]): Promise<string> {
  const parts: string[] = [];
  for (const dir of dirs) {
    const review = await loadReview(dir).catch(() => null);
    if (!review) continue;
    const open = review.comments.filter((c) => c.status === "open");
    const seen = await loadSeen(dir);
    const fresh = open.filter((c) => !seen.has(c.id));
    const old = open.length - fresh.length;
    const name = basename(dir, ".mwproj");
    if (fresh.length > 0) {
      parts.push(`审片台「${name}」有 ${fresh.length} 条新批注：`, ...fresh.map(describeComment));
    }
    if (old > 0)
      parts.push(`「${name}」还有 ${old} 条之前给过的批注没处理（mw comments ${name}）。`);
    if (fresh.length > 0) {
      // 只记批注 ID，不影响渲染
      await mkdir(join(dir, "cache"), { recursive: true });
      await atomicWrite(seenFile(dir), JSON.stringify(open.map((c) => c.id)));
    }
  }
  if (parts.length === 0) return "";
  parts.push("处理完一条就 resolve 并在 note 里写改了什么；不改也 resolve，写明原因。");
  return parts.join("\n");
}

/** Claude Code 和 Codex 的 UserPromptSubmit hook 都认这个格式 */
export function hookOutput(context: string) {
  return {
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context },
  };
}

/**
 * 等到出现新的待处理批注（开始等之前已经在的不算），返回这些批注；超时返回空数组。
 * 监听工程目录而不是 review.json 本身：原子写入是换文件，直接监听文件会丢事件。
 */
export async function waitForComments(
  dir: string,
  o: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Comment[]> {
  // 新写的和被重新打开的都算：开始时不是 open 的
  const wasOpen = new Set(
    (await loadReview(dir)).comments.filter((c) => c.status === "open").map((c) => c.id),
  );
  const fresh = async () =>
    (await loadReview(dir).catch(() => null))?.comments.filter(
      (c) => c.status === "open" && !wasOpen.has(c.id),
    ) ?? [];

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // 检查期间又有写入时，检查完再看一次，不丢事件
    let checking = false;
    let again = false;
    const check = () => {
      if (checking) {
        again = true;
        return;
      }
      checking = true;
      void fresh().then((cs) => {
        checking = false;
        if (cs.length > 0) done(cs);
        else if (again) {
          again = false;
          check();
        }
      });
    };
    const reviewName = basename(projectFiles(dir).review);
    const watcher = watch(dir, (_, name) => {
      if (name === reviewName) check();
    });
    const done = (cs: Comment[]) => {
      watcher.close();
      if (timer) clearTimeout(timer);
      o.signal?.removeEventListener("abort", abort);
      resolve(cs);
    };
    const abort = () => {
      watcher.close();
      if (timer) clearTimeout(timer);
      reject(o.signal?.reason);
    };
    if (o.timeoutMs !== undefined) timer = setTimeout(() => done([]), o.timeoutMs);
    o.signal?.addEventListener("abort", abort, { once: true });
  });
}
