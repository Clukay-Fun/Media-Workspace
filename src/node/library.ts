import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { LibraryStyle } from "../core/api";
import { MwError } from "../core/errors";
import { Layout, type LayoutInput } from "../core/layout";
import { BUILTIN_STYLES } from "../core/presets";
import { Id, Transition } from "../core/schema";
import { TextStyle } from "../core/text-style";
import { mwHome } from "./paths";
import { applyToProject, loadProject, type Source } from "./store";

// 全局样式模板库（PLAN 4 节 D20、F13 / F14）：~/MediaWorkspace/library/text-styles/<名字>.json。
// 工程里用到的模板会复制一份进 project.styles，以后模板改了旧工程也不变；所以「套用」就是一次 style.add。

export function textStylesDir(): string {
  return join(mwHome(), "library", "text-styles");
}

const Entry = z.strictObject({
  name: Id,
  description: z.string().max(200).default(""),
  savedAt: z.string(),
  style: TextStyle,
});
type Entry = z.infer<typeof Entry>;

const fileOf = (name: string) => join(textStylesDir(), `${Id.parse(name)}.json`);

function checkName(name: string): string {
  const r = Id.safeParse(name);
  if (!r.success) throw new MwError("USAGE", `模板名「${name}」不合法：只能用字母、数字、- 和 _`);
  return r.data;
}

/** 内置样式 + 库里的样式，按名字排序；读不了的文件跳过并说明原因 */
export async function listStyles(): Promise<{ styles: LibraryStyle[]; skipped: string[] }> {
  const styles: LibraryStyle[] = Object.entries(BUILTIN_STYLES).map(([name, style]) => ({
    name,
    description: "内置",
    builtin: true,
    savedAt: null,
    style,
  }));
  const skipped: string[] = [];
  const files = await readdir(textStylesDir()).catch(() => [] as string[]);
  for (const f of files.filter((f) => f.endsWith(".json")).sort()) {
    try {
      const e = Entry.parse(JSON.parse(await readFile(join(textStylesDir(), f), "utf8")));
      if (e.name in BUILTIN_STYLES) continue;
      styles.push({ ...e, builtin: false });
    } catch (err) {
      skipped.push(`${f}：${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    }
  }
  return { styles: styles.sort((a, b) => a.name.localeCompare(b.name)), skipped };
}

export async function getStyle(name: string): Promise<LibraryStyle> {
  const { styles } = await listStyles();
  const s = styles.find((x) => x.name === name);
  if (!s)
    throw new MwError("NOT_FOUND", `模板库里没有样式「${name}」`, { hint: "用 mw styles 查看" });
  return s;
}

/** 把工程里的一个样式存进模板库 */
export async function saveStyle(
  dir: string,
  styleId: string,
  o: { as?: string; description?: string; overwrite?: boolean } = {},
): Promise<LibraryStyle> {
  const p = await loadProject(dir);
  // 渲染时工程里没有的内置样式会用内置的那份，这里也一样
  const style = p.styles[styleId] ?? (BUILTIN_STYLES as Record<string, TextStyle>)[styleId];
  if (!style) throw new MwError("NOT_FOUND", `工程里没有样式「${styleId}」`);
  const name = checkName(o.as ?? styleId);
  if (name in BUILTIN_STYLES) {
    throw new MwError("DUPLICATE_ID", `「${name}」是内置样式的名字`, {
      hint: "用 --as 换一个名字",
    });
  }
  const existing = await listStyles();
  if (!o.overwrite && existing.styles.some((s) => s.name === name)) {
    throw new MwError("DUPLICATE_ID", `模板库里已经有「${name}」`, {
      hint: "用 --as 换一个名字，或加 --overwrite 覆盖",
    });
  }
  const entry: Entry = {
    name,
    description: o.description ?? "",
    savedAt: new Date().toISOString(),
    style,
  };
  await mkdir(textStylesDir(), { recursive: true });
  await writeFile(fileOf(name), `${JSON.stringify(entry, null, 2)}\n`);
  return { ...entry, builtin: false };
}

/** 把模板库里的样式复制进工程（style.add）；工程里已有同名样式时报 DUPLICATE_ID，可以用 as 换名字 */
export async function useStyle(
  dir: string,
  name: string,
  o: { as?: string; baseRevision?: number; source: Source; actor: string },
) {
  const s = await getStyle(name);
  const id = checkName(o.as ?? name);
  const p = await loadProject(dir);
  const res = await applyToProject(dir, {
    ops: [{ op: "style.add", id, style: s.style }],
    baseRevision: o.baseRevision ?? p.revision,
    source: o.source,
    actor: o.actor,
  });
  return { ...res, style: id };
}

export async function removeStyle(name: string): Promise<{ ok: true; removed: string }> {
  checkName(name);
  if (name in BUILTIN_STYLES) throw new MwError("USAGE", `「${name}」是内置样式，不能删除`);
  const s = await getStyle(name);
  await rm(fileOf(s.name));
  return { ok: true, removed: s.name };
}

// 默认片尾（阶段 E，docs/decisions/0023）：~/MediaWorkspace/library/outro.json 记一个视频文件的路径和接上去的方式。
// 「接上默认片尾」时导入这个文件（原文件只读，标准化文件放进工程 cache），再 outro.set。

export function outroDefaultFile(): string {
  return join(mwHome(), "library", "outro.json");
}

export const OutroDefault = z.strictObject({
  file: z.string().min(1),
  /** null = 硬切 */
  transitionIn: Transition.nullable().default({ type: "fade", durationMs: 300 }),
  gainDb: z.number().min(-60).max(20).default(0),
  savedAt: z.string(),
});
export type OutroDefault = z.infer<typeof OutroDefault>;

/** 没设置过时返回 null；文件坏了报错（不要悄悄当成没有） */
export async function getDefaultOutro(): Promise<OutroDefault | null> {
  const f = outroDefaultFile();
  if (!existsSync(f)) return null;
  const r = OutroDefault.safeParse(JSON.parse(await readFile(f, "utf8")));
  if (!r.success) {
    throw new MwError("VALIDATION", `默认片尾的设置文件坏了：${f}`, {
      hint: "用 mw outro-default <视频文件> 重新设置",
    });
  }
  return r.data;
}

/** 设置默认片尾：只记路径，不复制文件；fadeMs = 0 表示硬切 */
export async function setDefaultOutro(
  file: string,
  o: { fadeMs?: number; gainDb?: number } = {},
): Promise<OutroDefault> {
  const abs = resolve(file);
  if (!existsSync(abs)) throw new MwError("MEDIA", `文件不存在：${abs}`);
  const entry = OutroDefault.parse({
    file: abs,
    ...(o.fadeMs === undefined
      ? {}
      : { transitionIn: o.fadeMs > 0 ? { type: "fade", durationMs: o.fadeMs } : null }),
    ...(o.gainDb === undefined ? {} : { gainDb: o.gainDb }),
    savedAt: new Date().toISOString(),
  });
  await mkdir(join(mwHome(), "library"), { recursive: true });
  await writeFile(outroDefaultFile(), `${JSON.stringify(entry, null, 2)}\n`);
  return entry;
}

// 账号版式（阶段 F，docs/decisions/0025）：~/MediaWorkspace/library/layout.json，所有工程共用。

export function layoutFile(): string {
  return join(mwHome(), "library", "layout.json");
}

/** 没设置过时返回 null；文件坏了报错 */
export async function getLayout(): Promise<Layout | null> {
  const f = layoutFile();
  if (!existsSync(f)) return null;
  const r = Layout.safeParse(JSON.parse(await readFile(f, "utf8")));
  if (!r.success) {
    throw new MwError("VALIDATION", `账号版式文件坏了：${f}`, {
      hint: "用 mw layout --file <json> 重新设置",
    });
  }
  return r.data;
}

/** 整份替换账号版式 */
export async function setLayout(input: LayoutInput): Promise<Layout> {
  const r = Layout.safeParse({ ...input, savedAt: new Date().toISOString() });
  if (!r.success) {
    throw new MwError("VALIDATION", `版式不合法：${r.error.issues[0]?.message ?? ""}`);
  }
  await mkdir(join(mwHome(), "library"), { recursive: true });
  await writeFile(layoutFile(), `${JSON.stringify(r.data, null, 2)}\n`);
  return r.data;
}
