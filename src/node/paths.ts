import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/** 数据根目录，默认 ~/MediaWorkspace，用 MW_HOME 修改（测试必须指向临时目录） */
export function mwHome(): string {
  return process.env.MW_HOME ? resolve(process.env.MW_HOME) : join(homedir(), "MediaWorkspace");
}

export function projectsDir(): string {
  return join(mwHome(), "projects");
}

/**
 * 工程参数既可以是路径，也可以是名字：
 * 带路径分隔符、以 .mwproj 结尾或者当前目录下存在时按路径处理，否则在默认工程目录里找 <名字>.mwproj。
 */
export function resolveProjectDir(nameOrPath: string): string {
  if (isAbsolute(nameOrPath) || nameOrPath.includes("/") || nameOrPath.endsWith(".mwproj")) {
    return resolve(nameOrPath);
  }
  if (existsSync(nameOrPath)) return resolve(nameOrPath);
  return join(projectsDir(), `${nameOrPath}.mwproj`);
}

export function projectFiles(dir: string) {
  return {
    project: join(dir, "project.json"),
    editor: join(dir, "editor.json"),
    review: join(dir, "review.json"),
    history: join(dir, "history"),
    logs: join(dir, "logs"),
    opsLog: join(dir, "logs", "ops.jsonl"),
    renderLogs: join(dir, "logs", "render"),
    captions: join(dir, "captions"),
    media: join(dir, "cache", "media"),
    stills: join(dir, "cache", "stills"),
    renders: join(dir, "renders"),
    lock: join(dir, ".lock"),
  };
}
