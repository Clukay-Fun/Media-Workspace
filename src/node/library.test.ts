import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MwError } from "../core/errors";
import { BUILTIN_STYLES } from "../core/presets";
import { listStyles, removeStyle, saveStyle, textStylesDir, useStyle } from "./library";
import { emptyProject, initProject, loadProject } from "./store";

let root: string;
let a: string;
let b: string;
const oldHome = process.env.MW_HOME;
const who = { source: "cli" as const, actor: "test" };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mw-library-"));
  process.env.MW_HOME = root;
  a = join(root, "a.mwproj");
  b = join(root, "b.mwproj");
  await initProject(a, { ...emptyProject(), styles: { ...BUILTIN_STYLES } });
  await initProject(b);
});
afterEach(async () => {
  if (oldHome === undefined) delete process.env.MW_HOME;
  else process.env.MW_HOME = oldHome;
  await rm(root, { recursive: true, force: true });
});

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof MwError ? e.code : String(e);
  }
  return "ok";
};

describe("样式模板库", () => {
  it("空库里只有内置样式", async () => {
    const { styles } = await listStyles();
    expect(styles.every((s) => s.builtin)).toBe(true);
    expect(styles.map((s) => s.name)).toContain("caption-word-yellow");
  });

  it("从一个工程存进库，在另一个工程里套用，样式完全一样", async () => {
    const saved = await saveStyle(a, "caption-word-yellow", {
      as: "my-caption",
      description: "测试",
    });
    expect(saved.name).toBe("my-caption");
    const r = await useStyle(b, "my-caption", who);
    expect(r.style).toBe("my-caption");
    const pa = await loadProject(a);
    const pb = await loadProject(b);
    expect(pb.styles["my-caption"]).toEqual(pa.styles["caption-word-yellow"]);
  });

  it("重名：库里已有要 overwrite，内置名不能占用，工程里已有要换名字", async () => {
    await saveStyle(a, "caption-word-yellow", { as: "x" });
    expect(await code(saveStyle(a, "caption-word-yellow", { as: "x" }))).toBe("DUPLICATE_ID");
    expect(await code(saveStyle(a, "caption-word-yellow", { as: "x", overwrite: true }))).toBe(
      "ok",
    );
    expect(await code(saveStyle(a, "caption-word-yellow"))).toBe("DUPLICATE_ID");
    expect(await code(useStyle(a, "caption-word-yellow", who))).toBe("DUPLICATE_ID");
    expect(await code(useStyle(a, "caption-word-yellow", { ...who, as: "copy" }))).toBe("ok");
  });

  it("名字不合法、找不到、删内置都报错；坏文件跳过不影响其他", async () => {
    expect(await code(saveStyle(a, "caption-word-yellow", { as: "../evil" }))).toBe("USAGE");
    expect(await code(useStyle(a, "nope", who))).toBe("NOT_FOUND");
    expect(await code(removeStyle("title-bar-yellow"))).toBe("USAGE");
    await saveStyle(a, "title-bar-yellow", { as: "t2" });
    await writeFile(join(textStylesDir(), "broken.json"), "{");
    const { styles, skipped } = await listStyles();
    expect(styles.some((s) => s.name === "t2")).toBe(true);
    expect(skipped).toHaveLength(1);
    await removeStyle("t2");
    expect((await listStyles()).styles.some((s) => s.name === "t2")).toBe(false);
  });
});
