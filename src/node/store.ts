import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { EditorState, type HistoryEntry } from "../core/api";
import { MwError } from "../core/errors";
import { migrate } from "../core/migrations";
import { type ApplyOptions, applyOps } from "../core/ops";
import { Project } from "../core/schema";
import { changedIds, type UndoState, undoState } from "../core/undo";
import { validate, zodIssues } from "../core/validate";
import { PROJECT_FORMAT_VERSION } from "../core/version";
import { projectFiles } from "./paths";

// project.json 只能通过这里写入（AGENTS.md 规则 1）：
// 加锁 → 检查 revision 和轨道锁定 → 校验 → 备份上一版到 history → 写临时文件、fsync、rename → 记日志。

const HISTORY_KEEP = 200;
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 5_000;

export type Source = "cli" | "mcp" | "ui";

export type LogEntry = {
  at: string;
  source: Source;
  actor: string;
  revision: number;
  baseRevision: number;
  kind: "init" | "apply" | "revert" | "undo" | "redo";
  ops?: unknown[];
  revertTo?: number;
  changed: string[];
};

export const DEFAULT_EDITOR: EditorState = EditorState.parse({});

/** 新工程：磁吸主轨 + 字幕轨 + 叠加层轨（标题、卡片），和剪映新建草稿的结构接近 */
export function emptyProject(): Project {
  return Project.parse({
    version: PROJECT_FORMAT_VERSION,
    revision: 0,
    canvas: {},
    tracks: [
      { id: "main", name: "主轨", kind: "video", main: true, items: [] },
      { id: "captions", name: "字幕", kind: "caption", items: [] },
      { id: "titles", name: "标题", kind: "overlay", items: [] },
    ],
  });
}

export async function initProject(
  dir: string,
  project: Project = emptyProject(),
): Promise<Project> {
  const f = projectFiles(dir);
  if (await exists(f.project)) {
    throw new MwError("VALIDATION", `工程已经存在：${dir}`, {
      hint: "换一个名字，或者直接使用这个工程",
    });
  }
  for (const d of [f.history, f.logs, f.renderLogs, f.captions, f.media, f.stills, f.renders]) {
    await mkdir(d, { recursive: true });
  }
  await atomicWrite(f.editor, json(DEFAULT_EDITOR));
  await atomicWrite(f.project, json(project));
  await appendLog(dir, {
    at: new Date().toISOString(),
    source: "cli",
    actor: "user",
    revision: project.revision,
    baseRevision: project.revision,
    kind: "init",
    changed: [],
  });
  return project;
}

export async function loadProject(dir: string): Promise<Project> {
  const f = projectFiles(dir);
  let raw: string;
  try {
    raw = await readFile(f.project, "utf8");
  } catch {
    throw new MwError("NOT_FOUND", `找不到工程：${dir}`, { hint: "用 mw init 新建工程" });
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new MwError("VALIDATION", "project.json 不是合法的 JSON", { path: f.project });
  }
  const parsed = Project.safeParse(migrate(data));
  if (!parsed.success) {
    throw new MwError("VALIDATION", "project.json 不符合工程格式", {
      issues: zodIssues(parsed.error),
    });
  }
  return parsed.data;
}

export type ApplyRequest = {
  ops: unknown;
  baseRevision: number;
  source: Source;
  actor: string;
  dryRun?: boolean;
} & ApplyOptions;

export type ApplyResponse = {
  ok: true;
  revision: number;
  changed: string[];
  warnings: { code: string; path: string; message: string }[];
  dryRun: boolean;
};

export async function applyToProject(dir: string, req: ApplyRequest): Promise<ApplyResponse> {
  return withLock(dir, async () => {
    const current = await loadProject(dir);
    checkRevision(current, req.baseRevision);
    const r = applyOps(current, req.ops, { templates: req.templates });
    const next: Project = { ...r.project, revision: current.revision + 1 };
    if (req.dryRun) {
      return {
        ok: true,
        revision: current.revision,
        changed: r.changed,
        warnings: r.warnings,
        dryRun: true,
      };
    }
    await commit(dir, current, next, {
      at: new Date().toISOString(),
      source: req.source,
      actor: req.actor,
      revision: next.revision,
      baseRevision: req.baseRevision,
      kind: "apply",
      ops: Array.isArray(req.ops) ? req.ops : [req.ops],
      changed: r.changed,
    });
    return {
      ok: true,
      revision: next.revision,
      changed: r.changed,
      warnings: r.warnings,
      dryRun: false,
    };
  });
}

/**
 * 回退到某个历史版本：把那一版的内容作为新的一版写入（revision 继续增加，不改写历史）。
 * 锁定的轨道不会被回退改动（D18）。
 */
export async function revertProject(
  dir: string,
  req: {
    to: number;
    baseRevision?: number;
    source: Source;
    actor: string;
    /** 撤销 / 重做也是回退，只是在日志里标出来，用于推算撤销栈 */
    kind?: "revert" | "undo" | "redo";
  },
): Promise<ApplyResponse> {
  return withLock(dir, async () => {
    const current = await loadProject(dir);
    if (req.baseRevision !== undefined) checkRevision(current, req.baseRevision);
    if (req.to === current.revision) {
      return { ok: true, revision: current.revision, changed: [], warnings: [], dryRun: false };
    }
    const target = await readHistory(dir, req.to);
    for (const t of current.tracks) {
      if (!t.locked) continue;
      const old = target.tracks.find((x) => x.id === t.id);
      // 和 ops 一样，锁定的轨道仍然可以改锁定 / 隐藏 / 静音开关（这样「锁定」本身也能撤销）
      if (!old || JSON.stringify(content(old)) !== JSON.stringify(content(t))) {
        throw new MwError("TRACK_LOCKED", `回退会改动已锁定的轨道「${t.name ?? t.id}」`, {
          hint: "先解锁这条轨道再回退",
        });
      }
    }
    const v = validate({ ...target, revision: current.revision + 1 });
    if (!v.ok)
      throw new MwError("VALIDATION", `第 ${req.to} 版在当前环境下不合法`, { issues: v.errors });
    const changed = changedIds(current, v.project);
    await commit(dir, current, v.project, {
      at: new Date().toISOString(),
      source: req.source,
      actor: req.actor,
      revision: v.project.revision,
      baseRevision: current.revision,
      kind: req.kind ?? "revert",
      revertTo: req.to,
      changed,
    });
    return {
      ok: true,
      revision: v.project.revision,
      changed,
      warnings: v.warnings,
      dryRun: false,
    };
  });
}

const content = ({ locked: _l, hidden: _h, muted: _m, ...rest }: Project["tracks"][number]) => rest;

/** 撤销 / 重做：按日志推算出要回到哪一版，再作为一次回退写入 */
export async function undoProject(
  dir: string,
  req: { direction: "undo" | "redo"; baseRevision: number; source: Source; actor: string },
): Promise<ApplyResponse> {
  const state = undoState(await readLog(dir));
  const target = req.direction === "undo" ? state.undo : state.redo;
  if (!target) {
    throw new MwError(
      "INVALID_OP",
      req.direction === "undo" ? "没有可以撤销的修改" : "没有可以重做的修改",
    );
  }
  return revertProject(dir, {
    to: target.revision,
    baseRevision: req.baseRevision,
    source: req.source,
    actor: req.actor,
    kind: req.direction,
  });
}

/** 历史列表和当前的撤销 / 重做状态（界面、MCP 用） */
export async function historyState(dir: string): Promise<{
  entries: HistoryEntry[];
  undo: UndoState["undo"];
  redo: UndoState["redo"];
}> {
  const log = await readLog(dir);
  const entries = log.map((e) => ({
    revision: e.revision,
    at: e.at,
    actor: e.actor,
    source: e.source,
    kind: e.kind,
    changed: e.changed,
    ops: (e.ops ?? []).map((o) => String((o as { op?: unknown })?.op ?? "?")),
  }));
  return { entries, ...undoState(log) };
}

export async function readLog(dir: string): Promise<LogEntry[]> {
  const raw = await readFile(projectFiles(dir).opsLog, "utf8").catch(() => "");
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as LogEntry);
}

export async function listHistory(dir: string): Promise<number[]> {
  const names = await readdir(projectFiles(dir).history).catch(() => [] as string[]);
  return names
    .map((n) => /^(\d+)\.json$/.exec(n)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

async function readHistory(dir: string, revision: number): Promise<Project> {
  const file = join(projectFiles(dir).history, historyName(revision));
  const raw = await readFile(file, "utf8").catch(() => null);
  if (raw === null) {
    throw new MwError("NOT_FOUND", `历史里没有第 ${revision} 版`, {
      hint: "用 mw history 查看可以回退的版本",
    });
  }
  return Project.parse(migrate(JSON.parse(raw)));
}

/** editor.json：编辑器状态，不经过 revision 和 ops（D22），但同样原子写入 */
export async function loadEditor(dir: string): Promise<EditorState> {
  const raw = await readFile(projectFiles(dir).editor, "utf8").catch(() => null);
  if (!raw) return structuredClone(DEFAULT_EDITOR);
  // 编辑器状态坏了不影响工程：解析不了就用默认值
  const r = EditorState.safeParse(JSON.parse(raw));
  return r.success ? r.data : structuredClone(DEFAULT_EDITOR);
}

export async function saveEditor(dir: string, editor: EditorState): Promise<void> {
  await atomicWrite(projectFiles(dir).editor, json(EditorState.parse(editor)));
}

function checkRevision(current: Project, base: number): void {
  if (current.revision !== base) {
    throw new MwError(
      "CONFLICT",
      `工程已经被修改：当前是第 ${current.revision} 版，你基于第 ${base} 版`,
      {
        hint: "重新 mw inspect 获取最新内容，再基于最新的 revision 提交",
      },
    );
  }
}

async function commit(dir: string, current: Project, next: Project, log: LogEntry): Promise<void> {
  const f = projectFiles(dir);
  await mkdir(f.history, { recursive: true });
  // 先备份上一版，再替换当前版：中途崩溃时最多多一份历史，不会丢版本
  await atomicWrite(join(f.history, historyName(current.revision)), json(current));
  await atomicWrite(f.project, json(next));
  await appendLog(dir, log);
  await pruneHistory(dir);
}

async function pruneHistory(dir: string): Promise<void> {
  const revs = await listHistory(dir);
  for (const r of revs.slice(0, Math.max(0, revs.length - HISTORY_KEEP))) {
    await rm(join(projectFiles(dir).history, historyName(r)), { force: true });
  }
}

async function appendLog(dir: string, entry: LogEntry): Promise<void> {
  const file = projectFiles(dir).opsLog;
  await mkdir(dirname(file), { recursive: true });
  const fh = await open(file, "a");
  try {
    await fh.appendFile(`${JSON.stringify(entry)}\n`);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/** 写临时文件 → fsync → rename：任何时刻读到的都是完整的旧版或新版 */
export async function atomicWrite(file: string, content: string): Promise<void> {
  const tmp = join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`);
  const fh = await open(tmp, "wx");
  try {
    await fh.writeFile(content);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await rename(tmp, file);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

/**
 * 工程级的互斥锁（.lock 文件，O_EXCL 创建）。CLI、MCP、界面服务是不同进程，所以不能用内存锁。
 * 持锁进程已经不存在、或者锁超过 30 秒没释放，视为残留，可以接管。
 */
export async function withLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const file = projectFiles(dir).lock;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fh = await open(file, "wx");
      await fh.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }));
      await fh.close();
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        throw new MwError("NOT_FOUND", `找不到工程：${dir}`, { hint: "用 mw init 新建工程" });
      }
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (await isStale(file)) {
        await rm(file, { force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new MwError("CONFLICT", "工程正在被另一个操作修改，等待超时", { hint: "稍后重试" });
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(file, { force: true });
  }
}

async function isStale(file: string): Promise<boolean> {
  try {
    const raw = await readFile(file, "utf8");
    const { pid, at } = JSON.parse(raw) as { pid: number; at: number };
    if (Date.now() - at > LOCK_STALE_MS) return true;
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  } catch {
    // 锁文件刚创建还没写完，或者内容损坏：按修改时间判断
    const st = await stat(file).catch(() => null);
    return st ? Date.now() - st.mtimeMs > LOCK_STALE_MS : false;
  }
}

function historyName(revision: number): string {
  return `${String(revision).padStart(6, "0")}.json`;
}

function json(v: unknown): string {
  return `${JSON.stringify(v, null, 2)}\n`;
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false,
  );
}
