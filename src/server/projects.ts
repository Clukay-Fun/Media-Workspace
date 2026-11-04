import { readdir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AvailableProject } from "../core/api";
import { MwError } from "../core/errors";
import { projectsDir } from "../node/paths";
import { loadProject } from "../node/store";

export type ResolvedProject = AvailableProject & { dir: string };

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function rootPath(root = projectsDir()): Promise<string | null> {
  try {
    return await realpath(root);
  } catch {
    return null;
  }
}

/** Only direct, real project directories under MW_HOME/projects are discoverable. */
export async function listAvailableProjects(root = projectsDir()): Promise<AvailableProject[]> {
  const resolvedRoot = await rootPath(root);
  if (!resolvedRoot) return [];

  const entries = await readdir(resolvedRoot, { withFileTypes: true });
  const projects: AvailableProject[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith(".mwproj")) continue;
    const dir = join(resolvedRoot, entry.name);
    try {
      const resolvedDir = await realpath(dir);
      if (!isWithin(resolvedRoot, resolvedDir) || resolvedDir !== dir) continue;
      const project = await loadProject(dir);
      const name = basename(entry.name, ".mwproj");
      projects.push({ id: name, name, revision: project.revision });
    } catch {
      // A malformed or incomplete directory is not an openable project.
    }
  }
  return projects.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
}

export async function resolveAvailableProject(
  id: string,
  root = projectsDir(),
): Promise<ResolvedProject> {
  const projects = await listAvailableProjects(root);
  const item = projects.find((project) => project.id === id);
  if (!item) throw new MwError("NOT_FOUND", `工程「${id}」不存在或不在默认工程目录中`);

  const resolvedRoot = await rootPath(root);
  if (!resolvedRoot) throw new MwError("NOT_FOUND", "默认工程目录不存在");
  const dir = join(resolvedRoot, `${item.id}.mwproj`);
  const resolvedDir = await realpath(dir);
  const info = await stat(resolvedDir);
  if (!isWithin(resolvedRoot, resolvedDir) || !info.isDirectory() || resolvedDir !== dir)
    throw new MwError("NOT_FOUND", `工程「${id}」不在默认工程目录中`);
  return { ...item, dir };
}
