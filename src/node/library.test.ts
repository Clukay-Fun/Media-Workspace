import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MwError } from "../core/errors";
import { BUILTIN_STYLES } from "../core/presets";
import { attachOutro } from "./actions";
import {
  getDefaultOutro,
  getLayout,
  layoutFile,
  listStyles,
  removeStyle,
  saveStyle,
  setDefaultOutro,
  setLayout,
  textStylesDir,
  useStyle,
} from "./library";
import { applyToProject, emptyProject, initProject, loadProject } from "./store";

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

describe("默认片尾", () => {
  it("没设置时为 null，接默认片尾报 NOT_FOUND", async () => {
    expect(await getDefaultOutro()).toBeNull();
    expect(await code(attachOutro(b, who))).toBe("NOT_FOUND");
  });

  it("文件不存在时不能设置", async () => {
    expect(await code(setDefaultOutro(join(root, "nope.mp4")))).toBe("MEDIA");
  });

  it("设置后接上：同一个文件已经导入过就直接用那个素材，按默认设置叠化", async () => {
    const file = join(root, "outro.mp4");
    await writeFile(file, "");
    expect(await setDefaultOutro(file, { fadeMs: 500, gainDb: -6 })).toMatchObject({
      file,
      transitionIn: { type: "fade", durationMs: 500 },
      gainDb: -6,
    });
    await applyToProject(b, {
      ops: [{ op: "asset.add", id: "end", asset: { kind: "video", path: file } }],
      baseRevision: 0,
      ...who,
    });
    const r = await attachOutro(b, who);
    expect(r).toMatchObject({ outro: "end", usedDefault: true });
    expect((await loadProject(b)).outro).toEqual({
      asset: "end",
      transitionIn: { type: "fade", durationMs: 500 },
      gainDb: -6,
    });
    // fadeMs 0 = 硬切
    await attachOutro(b, { ...who, fadeMs: 0 });
    expect((await loadProject(b)).outro).toEqual({ asset: "end", gainDb: -6 });
    await setDefaultOutro(file, { fadeMs: 0 });
    expect((await getDefaultOutro())?.transitionIn).toBeNull();
  });
});

describe("账号版式", () => {
  it("没设置时为 null；设置后补上默认值，坏文件报 VALIDATION", async () => {
    expect(await getLayout()).toBeNull();
    const l = await setLayout({
      guides: [{ id: "top", axis: "h", pos: 0.25, label: "头顶" }],
      face: { cx: 0.5, top: 0.3, bottom: 0.5 },
    });
    expect(l).toMatchObject({ version: 1, titleStyle: null, captionStyle: null });
    expect(await getLayout()).toEqual(l);
    expect(await code(setLayout({ face: { cx: 0.5, top: 0.6, bottom: 0.5 } }))).toBe("VALIDATION");
    expect(await code(setLayout({ guides: [{ id: "x", axis: "h", pos: 960 }] }))).toBe(
      "VALIDATION",
    );
    await writeFile(layoutFile(), '{"version":2}');
    expect(await code(getLayout())).toBe("VALIDATION");
  });
});
