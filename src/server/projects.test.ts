import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initProject } from "../node/store";
import { listAvailableProjects, resolveAvailableProject } from "./projects";

let root: string;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("工作台工程发现", () => {
  it("只列出 projects 根目录下可打开的真实 .mwproj 直接子目录", async () => {
    root = await mkdtemp(join(tmpdir(), "mw-project-list-"));
    const projects = join(root, "projects");
    const outside = join(root, "outside.mwproj");
    await mkdir(projects, { recursive: true });
    await initProject(join(projects, "alpha.mwproj"));
    await initProject(join(projects, "中文工程.mwproj"));
    await initProject(outside);
    await symlink(outside, join(projects, "escape.mwproj"));
    await mkdir(join(projects, "not-a-project.mwproj"));

    const list = await listAvailableProjects(projects);
    expect(list.map((project) => project.id)).toEqual(["中文工程", "alpha"]);
    expect(await resolveAvailableProject("alpha", projects)).toMatchObject({
      id: "alpha",
      dir: await realpath(join(projects, "alpha.mwproj")),
      revision: 0,
    });
    await expect(resolveAvailableProject("../outside", projects)).rejects.toThrow();
    await expect(resolveAvailableProject("escape", projects)).rejects.toThrow();
  });
});
