import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_STYLES } from "../core/presets";
import {
  attachOutro,
  validateDir as checkProject,
  frameProject,
  importAsset,
  removeSilenceProject,
  transcribeProject,
} from "./actions";
import { BatchManifestSchema, type BatchOptions, runBatchManifest } from "./batch";
import {
  getDefaultOutro,
  getLayout,
  getStyle,
  setDefaultOutro,
  setLayout,
  textStylesDir,
} from "./library";
import { projectsDir } from "./paths";
import { applyToProject, loadProject } from "./store";

let root: string;
let sourceDir: string;
let video1: string;
let video2: string;
let script: string;
let unreadableScript: string;
let outro: string;
const previousHome = process.env.MW_HOME;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mw-batch-"));
  process.env.MW_HOME = root;
  sourceDir = join(root, "source");
  await mkdir(sourceDir, { recursive: true });
  video1 = join(sourceDir, "one.mov");
  video2 = join(sourceDir, "two.mov");
  script = join(sourceDir, "script.txt");
  unreadableScript = join(sourceDir, "unreadable.txt");
  outro = join(sourceDir, "outro.mov");
  await Promise.all([
    writeFile(video1, "test video placeholder"),
    writeFile(video2, "test video placeholder"),
    writeFile(script, "这是用于测试批量工程生成的口播文稿。"),
    writeFile(unreadableScript, "文件通过 stat，但读取被模拟为失败。"),
    writeFile(outro, "test outro placeholder"),
  ]);
  await setLayout({ face: { cx: 0.5, top: 0.3, bottom: 0.5 } });
  await setDefaultOutro(outro, { fadeMs: 0 });
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env.MW_HOME;
  else process.env.MW_HOME = previousHome;
  await rm(root, { recursive: true, force: true });
});

function manifest(items: unknown[], titleStyle = "title-bar-yellow") {
  return {
    version: 1,
    template: {
      captionStyle: "caption-word-yellow",
      titleStyle,
      outro: { file: "accountDefault", fadeMs: 0 },
    },
    items,
  };
}

async function writeManifest(contents: unknown): Promise<string> {
  const path = join(sourceDir, "batch.json");
  await writeFile(path, `${JSON.stringify(contents, null, 2)}\n`);
  return path;
}

describe("batch manifest", () => {
  it("只接受 v1 必填字段，工程名唯一且每项正好两行标题", () => {
    const validItem = {
      projectName: "项目一",
      video: "one.mov",
      scriptFile: "script.txt",
      titleLines: ["主标题", "副标题"],
    };
    expect(BatchManifestSchema.safeParse(manifest([validItem])).success).toBe(true);
    expect(
      BatchManifestSchema.safeParse(manifest([{ ...validItem, titleLines: ["只有一行"] }])).success,
    ).toBe(false);
    expect(
      BatchManifestSchema.safeParse(
        manifest([validItem, { ...validItem, projectName: " 项目一 " }]),
      ).success,
    ).toBe(false);
    expect(BatchManifestSchema.safeParse({ ...manifest([validItem]), extra: true }).success).toBe(
      false,
    );
  });

  it("已有同名工程时拒绝覆盖并写出报告", async () => {
    const existing = join(projectsDir(), "keep.mwproj");
    await mkdir(existing, { recursive: true });
    await writeFile(join(existing, "project.json"), "keep this project\n");
    const path = await writeManifest(
      manifest([
        {
          projectName: "keep",
          video: "one.mov",
          scriptFile: "script.txt",
          titleLines: ["主标题", "副标题"],
        },
      ]),
    );
    const createProject = vi.fn();
    const result = await runBatchManifest(path, {
      dependencies: {
        createProject: createProject as unknown as NonNullable<
          BatchOptions["dependencies"]
        >["createProject"],
      },
    });
    const report = JSON.parse(await readFile(result.items[0]?.reportPath ?? "", "utf8"));
    expect(result.ok).toBe(false);
    expect(report.failure).toMatchObject({ stage: "preflight", code: "VALIDATION" });
    expect(createProject).not.toHaveBeenCalled();
    expect(await readFile(join(existing, "project.json"), "utf8")).toBe("keep this project\n");
  });

  it("所选标题样式估算会折成三行时，在预检阶段拒绝该项", async () => {
    const path = await writeManifest(
      manifest([
        {
          projectName: "长标题",
          video: "one.mov",
          scriptFile: "script.txt",
          titleLines: ["一二三四五六七八九十一二", "副标题"],
        },
      ]),
    );
    const createProject = vi.fn();
    const result = await runBatchManifest(path, {
      dependencies: {
        createProject: createProject as unknown as NonNullable<
          BatchOptions["dependencies"]
        >["createProject"],
      },
    });
    const report = JSON.parse(await readFile(result.items[0]?.reportPath ?? "", "utf8"));
    expect(result.items[0]?.projectCreated).toBe(false);
    expect(report.titleEstimate).toMatchObject({ estimatedLines: 3, maxLines: 2 });
    expect(report.failure).toMatchObject({ stage: "preflight", code: "VALIDATION" });
    expect(report.failure.message).toContain("估算为 3 行");
    expect(createProject).not.toHaveBeenCalled();
  });

  it("按样式库保存画布适配标题样式后再估算行数", async () => {
    const sourceCanvas = { width: 1920, height: 1080 };
    const wideTitle = {
      ...BUILTIN_STYLES["title-bar-yellow"],
      layout: { ...BUILTIN_STYLES["title-bar-yellow"].layout, maxWidth: 1300 },
    };
    await mkdir(textStylesDir(), { recursive: true });
    await writeFile(
      join(textStylesDir(), "wide-title.json"),
      JSON.stringify({
        name: "wide-title",
        description: "测试横屏样式适配",
        savedAt: new Date().toISOString(),
        style: wideTitle,
        canvas: sourceCanvas,
      }),
    );
    const longTitle = "一二三四五六七八九十一二";
    const originalStyleEstimate = (12 * wideTitle.font.size) / wideTitle.layout.maxWidth;
    expect(Math.ceil(originalStyleEstimate)).toBe(1);

    const path = await writeManifest(
      manifest(
        [
          {
            projectName: "横屏样式标题",
            video: "one.mov",
            scriptFile: "script.txt",
            titleLines: [longTitle, "副标题"],
          },
        ],
        "wide-title",
      ),
    );
    const result = await runBatchManifest(path);
    const report = JSON.parse(await readFile(result.items[0]?.reportPath ?? "", "utf8"));
    expect(report.titleEstimate).toMatchObject({ estimatedLines: 3, maxLines: 2 });
    expect(report.titleEstimate.maxWidth).toBeLessThan(wideTitle.layout.maxWidth);
    expect(report.failure).toMatchObject({ stage: "preflight", code: "VALIDATION" });
  });

  it("文稿预检读取失败和单项导入失败都会隔离，并继续处理后续工程", async () => {
    const path = await writeManifest(
      manifest([
        {
          projectName: "文稿读取失败",
          video: "one.mov",
          scriptFile: "unreadable.txt",
          titleLines: ["第一条", "副标题"],
        },
        {
          projectName: "导入失败",
          video: "one.mov",
          scriptFile: "script.txt",
          titleLines: ["第二条", "副标题"],
        },
        {
          projectName: "第二项",
          video: "two.mov",
          scriptFile: "script.txt",
          titleLines: ["第三条", "副标题"],
        },
        {
          projectName: "第四项",
          video: "two.mov",
          scriptFile: "script.txt",
          titleLines: ["第四条", "副标题"],
        },
      ]),
    );

    const mockImport = async (
      projectPath: string,
      file: string,
      options: Parameters<typeof importAsset>[2],
    ) => {
      void options;
      if (basename(file) === "one.mov") throw new Error("fixture import failure");
      const project = await loadProject(projectPath);
      const result = await applyToProject(projectPath, {
        ops: [
          {
            op: "asset.add",
            id: "a1",
            asset: {
              kind: "video",
              path: file,
              probe: { durationMs: 30_000, width: 1080, height: 1920, hasAudio: true },
            },
          },
          {
            op: "item.add",
            track: "main",
            item: { id: "clip1", type: "clip", asset: "a1", inMs: 0, outMs: 30_000 },
          },
        ],
        baseRevision: project.revision,
        source: "cli",
        actor: "batch-test",
      });
      return {
        ...result,
        asset: "a1",
        mainClip: "clip1",
        speed: 1,
        probe: {
          kind: "video" as const,
          durationMs: 30_000,
          width: 1080,
          height: 1920,
          hasAudio: true,
        },
        created: [],
      };
    };

    const transcribe = async (
      projectPath: string,
      options: Parameters<typeof transcribeProject>[1],
    ) => {
      const project = await loadProject(projectPath);
      const result = await applyToProject(projectPath, {
        ops: [
          {
            op: "caption.add",
            track: "captions",
            mode: "replace",
            items: [
              {
                asset: "a1",
                startMs: 500,
                endMs: 2500,
                text: "这是用于测试的字幕。",
                highlights: [],
              },
            ],
          },
        ],
        baseRevision: project.revision,
        source: "cli",
        actor: "batch-test",
      });
      return {
        ...result,
        asset: "a1",
        captions: 1,
        maxChars: 14,
        usedScript: Boolean(options.script),
        heard: "这是用于测试的字幕。",
        diffs: [],
        check: [],
        splitLines: [],
      } as Awaited<ReturnType<typeof transcribeProject>>;
    };

    const validate = async (
      projectPath: string,
    ): Promise<Awaited<ReturnType<typeof checkProject>>> =>
      projectPath.includes("第四项")
        ? {
            ok: false,
            errors: [
              { code: "VALIDATION", path: "tracks[0]", message: "fixture validation failure" },
            ],
            warnings: [],
          }
        : await checkProject(projectPath);

    const dependencies: NonNullable<BatchOptions["dependencies"]> = {
      importAsset: mockImport,
      transcribeProject: transcribe,
      validateDir: validate,
      readScriptFile: async (path) => {
        if (basename(path) === "unreadable.txt") throw new Error("fixture permission denied");
        return readFile(path, "utf8");
      },
      removeSilenceProject: async () =>
        ({ ok: true }) as unknown as Awaited<ReturnType<typeof removeSilenceProject>>,
      frameProject: async () =>
        ({ ok: true }) as unknown as Awaited<ReturnType<typeof frameProject>>,
      attachOutro: async () => ({ ok: true }) as unknown as Awaited<ReturnType<typeof attachOutro>>,
    };
    const result = await runBatchManifest(path, { dependencies });
    const reports = await Promise.all(
      result.items.map(async (item) => JSON.parse(await readFile(item.reportPath, "utf8"))),
    );
    expect(result.items).toHaveLength(4);
    expect(reports[0]?.failure).toMatchObject({ stage: "preflight", code: "VALIDATION" });
    expect(reports[1]?.failure).toMatchObject({ stage: "import", code: "INTERNAL" });
    expect(reports[2]?.failure).toBeUndefined();
    const completed = await loadProject(result.items[2]?.projectPath ?? "");
    const firstCaption = completed.tracks.find((track) => track.kind === "caption");
    expect(reports[2]?.steps.title.anchor.caption).toBe(
      firstCaption?.kind === "caption" ? firstCaption.items[0]?.id : undefined,
    );
    expect(reports[2]?.steps.outro.configuredFadeMs).toBe(0);
    expect(result.items[2]?.projectCreated).toBe(true);
    expect(reports[3]?.failure).toMatchObject({ stage: "validate", code: "VALIDATION" });
    expect(reports[3]?.steps.validate).toMatchObject({ ok: false });
    expect(await getLayout()).toMatchObject({ face: { cx: 0.5 } });
    expect(await getDefaultOutro()).toMatchObject({ file: outro });
    expect(await getStyle("caption-word-yellow")).toMatchObject({ name: "caption-word-yellow" });
    expect(await readFile(join(result.reportsDir, "03.json"), "utf8")).toContain(
      '"projectName": "第二项"',
    );
  });
});
