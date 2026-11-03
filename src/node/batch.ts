import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { z } from "zod";
import { aspectSize, fitStyle, STYLE_REFERENCE } from "../core/aspect";
import { type Issue, MwError } from "../core/errors";
import { estimateLines } from "../core/lint";
import { Id } from "../core/schema";
import type { TextStyle } from "../core/text-style";
import {
  attachOutro,
  createProject,
  frameProject,
  importAsset,
  lintDir,
  removeSilenceProject,
  templateOpts,
  transcribeProject,
  validateDir,
} from "./actions";
import { getDefaultOutro, getLayout, getStyle, useStyle } from "./library";
import { mwHome, projectsDir } from "./paths";
import { applyToProject, emptyProject, loadProject } from "./store";

const ProjectName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((name) => name !== "." && name !== "..", "projectName 不能是路径特殊名称")
  .refine((name) => !name.includes(".."), "projectName 不能包含 ..")
  .refine((name) => !/[\\/\u0000]/u.test(name), "projectName 不能包含路径分隔符")
  .refine((name) => !name.endsWith(".mwproj"), "projectName 不要带 .mwproj 后缀");

const BatchItem = z.strictObject({
  projectName: ProjectName,
  video: z.string().trim().min(1),
  scriptFile: z.string().trim().min(1),
  titleLines: z.tuple([z.string().trim().min(1), z.string().trim().min(1)]),
});

export const BatchManifestSchema = z
  .strictObject({
    version: z.literal(1),
    template: z.strictObject({
      captionStyle: Id,
      titleStyle: Id,
      outro: z.strictObject({
        file: z.union([z.literal("accountDefault"), z.string().trim().min(1)]),
        fadeMs: z.number().int().min(0).max(5000),
      }),
    }),
    items: z.array(BatchItem).min(1),
  })
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>();
    manifest.items.forEach((item, index) => {
      if (seen.has(item.projectName)) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "projectName"],
          message: `projectName「${item.projectName}」重复`,
        });
      }
      seen.add(item.projectName);
    });
  });

export type BatchManifest = z.infer<typeof BatchManifestSchema>;

type BatchDependencies = {
  createProject: typeof createProject;
  useStyle: typeof useStyle;
  loadProject: typeof loadProject;
  applyToProject: typeof applyToProject;
  importAsset: typeof importAsset;
  transcribeProject: typeof transcribeProject;
  removeSilenceProject: typeof removeSilenceProject;
  frameProject: typeof frameProject;
  attachOutro: typeof attachOutro;
  validateDir: typeof validateDir;
  lintDir: typeof lintDir;
  getStyle: typeof getStyle;
  getLayout: typeof getLayout;
  getDefaultOutro: typeof getDefaultOutro;
  readScriptFile: (path: string) => Promise<string>;
};

const DEFAULT_DEPENDENCIES: BatchDependencies = {
  createProject,
  useStyle,
  loadProject,
  applyToProject,
  importAsset,
  transcribeProject,
  removeSilenceProject,
  frameProject,
  attachOutro,
  validateDir,
  lintDir,
  getStyle,
  getLayout,
  getDefaultOutro,
  readScriptFile: (path) => readFile(path, "utf8"),
};

type BatchFailure = {
  stage: string;
  code: string;
  message: string;
  issues?: Issue[];
};

type BatchReport = {
  manifestVersion: 1;
  projectName: string;
  projectPath: string;
  reportPath: string;
  generatedAt: string;
  input: { video: string; scriptFile: string; titleLines: [string, string] };
  projectCreated: boolean;
  finalRevision: number | null;
  titleEstimate?: { estimatedLines: number; maxLines: number; width: number; maxWidth: number };
  steps: Record<string, unknown>;
  failure?: BatchFailure;
};

type PreparedItem = {
  item: BatchManifest["items"][number];
  projectPath: string;
  reportPath: string;
  videoPath: string;
  scriptPath: string;
  scriptText?: string;
  titleEstimate?: { estimatedLines: number; maxLines: number; width: number; maxWidth: number };
  outroPath?: string;
  preflightFailure?: BatchFailure;
};

export type BatchSummary = {
  ok: boolean;
  batchId: string;
  reportsDir: string;
  items: {
    projectName: string;
    projectPath: string;
    reportPath: string;
    projectCreated: boolean;
    finalRevision: number | null;
    failure?: BatchFailure;
  }[];
};

export type BatchOptions = {
  actor?: string;
  onLog?: (message: string) => void;
  /** Dependency injection keeps per-item isolation tests independent of media tools. */
  dependencies?: Partial<BatchDependencies>;
};

function errorFor(stage: string, error: unknown): BatchFailure {
  if (error instanceof MwError) {
    return { stage, code: error.code, message: error.message, issues: error.issues };
  }
  return {
    stage,
    code: "INTERNAL",
    message: error instanceof Error ? error.message : String(error),
  };
}

function preflightError(error: unknown, context: string): BatchFailure {
  const failure = errorFor("preflight", error);
  return failure.code === "INTERNAL"
    ? { ...failure, code: "VALIDATION", message: `${context}: ${failure.message}` }
    : failure;
}

function parseManifest(raw: unknown): BatchManifest {
  const parsed = BatchManifestSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new MwError("USAGE", "批量 manifest 格式不合法", {
    issues: parsed.error.issues.map((issue) => ({
      code: issue.code === "unrecognized_keys" ? "UNKNOWN_FIELD" : "USAGE",
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function projectPathFor(projectName: string): string {
  return join(projectsDir(), `${projectName}.mwproj`);
}

async function prepareItem(
  item: BatchManifest["items"][number],
  manifestDir: string,
  reportPath: string,
  outroPath: string | undefined,
  titleStyleName: string,
  titleStyle: TextStyle | undefined,
  readScriptFile: BatchDependencies["readScriptFile"],
): Promise<PreparedItem> {
  const projectPath = projectPathFor(item.projectName);
  const videoPath = resolve(manifestDir, item.video);
  const scriptPath = resolve(manifestDir, item.scriptFile);
  const prepared: PreparedItem = {
    item,
    projectPath,
    reportPath,
    videoPath,
    scriptPath,
    ...(outroPath ? { outroPath } : {}),
  };

  if (existsSync(projectPath)) {
    prepared.preflightFailure = {
      stage: "preflight",
      code: "VALIDATION",
      message: `工程路径已存在，未覆盖：${projectPath}`,
    };
    return prepared;
  }
  if (titleStyle) {
    const estimate = estimateLines(item.titleLines.join("\n"), titleStyle);
    const maxLines = Math.min(2, titleStyle.layout.maxLines);
    prepared.titleEstimate = {
      estimatedLines: estimate.lines,
      maxLines,
      width: estimate.width,
      maxWidth: titleStyle.layout.maxWidth,
    };
    if (estimate.lines > maxLines) {
      prepared.preflightFailure = {
        stage: "preflight",
        code: "VALIDATION",
        message: `标题按样式「${titleStyleName}」估算为 ${estimate.lines} 行，超过 ${maxLines} 行上限；请缩短 titleLines 后重试`,
      };
      return prepared;
    }
  }
  if (!(await isFile(videoPath))) {
    prepared.preflightFailure = {
      stage: "preflight",
      code: "MEDIA",
      message: `视频文件不存在或不是文件：${videoPath}`,
    };
    return prepared;
  }
  if (!(await isFile(scriptPath))) {
    prepared.preflightFailure = {
      stage: "preflight",
      code: "NOT_FOUND",
      message: `文稿文件不存在或不是文件：${scriptPath}`,
    };
    return prepared;
  }
  let scriptText: string;
  try {
    scriptText = await readScriptFile(scriptPath);
  } catch (error) {
    prepared.preflightFailure = preflightError(error, `无法读取文稿文件 ${scriptPath}`);
    return prepared;
  }
  if (!scriptText.trim()) {
    prepared.preflightFailure = {
      stage: "preflight",
      code: "VALIDATION",
      message: `文稿文件为空：${scriptPath}`,
    };
    return prepared;
  }
  prepared.scriptText = scriptText;
  return prepared;
}

async function useStyleIfNeeded(
  projectPath: string,
  styleName: string,
  actor: string,
  dependencies: BatchDependencies,
) {
  const project = await dependencies.loadProject(projectPath);
  if (project.styles[styleName]) return { style: styleName, copied: false };
  const result = await dependencies.useStyle(projectPath, styleName, {
    as: styleName,
    source: "cli",
    actor,
  });
  return { style: styleName, copied: true, result };
}

async function runItem(
  prepared: PreparedItem,
  manifest: BatchManifest,
  actor: string,
  onLog: ((message: string) => void) | undefined,
  dependencies: BatchDependencies,
): Promise<BatchReport> {
  const report: BatchReport = {
    manifestVersion: 1,
    projectName: prepared.item.projectName,
    projectPath: prepared.projectPath,
    reportPath: prepared.reportPath,
    generatedAt: new Date().toISOString(),
    input: {
      video: prepared.videoPath,
      scriptFile: prepared.scriptPath,
      titleLines: prepared.item.titleLines,
    },
    projectCreated: false,
    finalRevision: null,
    ...(prepared.titleEstimate ? { titleEstimate: prepared.titleEstimate } : {}),
    steps: {},
  };

  if (prepared.preflightFailure) {
    report.failure = prepared.preflightFailure;
    return report;
  }

  let stage = "init";
  try {
    report.steps.init = await dependencies.createProject(prepared.projectPath, {
      aspect: "9:16",
      source: "cli",
      actor,
    });
    report.projectCreated = true;

    stage = "styles";
    const captionStyle = await useStyleIfNeeded(
      prepared.projectPath,
      manifest.template.captionStyle,
      actor,
      dependencies,
    );
    const titleStyle =
      manifest.template.titleStyle === manifest.template.captionStyle
        ? captionStyle
        : await useStyleIfNeeded(
            prepared.projectPath,
            manifest.template.titleStyle,
            actor,
            dependencies,
          );
    let project = await dependencies.loadProject(prepared.projectPath);
    const captionTrack = project.tracks.find((track) => track.kind === "caption");
    if (!captionTrack || captionTrack.kind !== "caption") {
      throw new MwError("NOT_FOUND", "新工程里没有字幕轨");
    }
    let captionTrackResult: unknown = { changed: false, track: captionTrack.id };
    if (captionTrack.style !== manifest.template.captionStyle) {
      captionTrackResult = await dependencies.applyToProject(prepared.projectPath, {
        ops: [
          {
            op: "track.update",
            id: captionTrack.id,
            set: { style: manifest.template.captionStyle },
          },
        ],
        baseRevision: project.revision,
        source: "cli",
        actor,
      });
    }
    report.steps.styles = { captionStyle, titleStyle, captionTrack: captionTrackResult };

    stage = "import";
    report.steps.import = await dependencies.importAsset(prepared.projectPath, prepared.videoPath, {
      source: "cli",
      actor,
      onLog,
    });

    stage = "transcribe";
    report.steps.transcribe = await dependencies.transcribeProject(prepared.projectPath, {
      script: prepared.scriptText,
      mode: "replace",
      source: "cli",
      actor,
      onLog,
    });

    stage = "removeSilence";
    report.steps.removeSilence = await dependencies.removeSilenceProject(prepared.projectPath, {
      edgesOnly: true,
      source: "cli",
      actor,
      onLog,
    });

    stage = "frame";
    report.steps.frame = await dependencies.frameProject(prepared.projectPath, {
      source: "cli",
      actor,
      onLog,
    });

    stage = "title";
    project = await dependencies.loadProject(prepared.projectPath);
    const captionTrackAfterCut = project.tracks.find((track) => track.kind === "caption");
    const firstCaption =
      captionTrackAfterCut?.kind === "caption"
        ? captionTrackAfterCut.items.toSorted((a, b) => a.startMs - b.startMs)[0]
        : undefined;
    if (!firstCaption) throw new MwError("NOT_FOUND", "转写后没有字幕，无法锚定标题");
    const titleTrack = project.tracks.find((track) => track.kind === "overlay");
    if (!titleTrack || titleTrack.kind !== "overlay") {
      throw new MwError("NOT_FOUND", "新工程里没有标题轨");
    }
    const titleResult = await dependencies.applyToProject(prepared.projectPath, {
      ops: [
        {
          op: "item.add",
          track: titleTrack.id,
          item: {
            id: "top-title",
            template: "title-bar",
            at: { caption: firstCaption.id, offsetMs: 0 },
            durationMs: "toEnd",
            style: manifest.template.titleStyle,
            props: { lines: prepared.item.titleLines },
          },
        },
      ],
      baseRevision: project.revision,
      source: "cli",
      actor,
      ...templateOpts,
    });
    report.steps.title = {
      anchor: { caption: firstCaption.id, offsetMs: 0 },
      durationMs: "toEnd",
      result: titleResult,
    };

    stage = "outro";
    const outroResult = await dependencies.attachOutro(prepared.projectPath, {
      ...(manifest.template.outro.file === "accountDefault" ? {} : { file: prepared.outroPath }),
      fadeMs: manifest.template.outro.fadeMs,
      source: "cli",
      actor,
      onLog,
    });
    report.steps.outro = {
      mode: manifest.template.outro.file === "accountDefault" ? "accountDefault" : "file",
      configuredFadeMs: manifest.template.outro.fadeMs,
      result: outroResult,
    };

    stage = "validate";
    const validation = await dependencies.validateDir(prepared.projectPath);
    report.steps.validate = validation;
    if (!validation.ok) {
      throw new MwError("VALIDATION", "批量生成的工程未通过 validate", {
        issues: validation.errors,
      });
    }

    stage = "lint";
    report.steps.lint = await dependencies.lintDir(prepared.projectPath);
  } catch (error) {
    report.failure = errorFor(stage, error);
    report.projectCreated =
      report.projectCreated || existsSync(join(prepared.projectPath, "project.json"));
  }

  if (report.projectCreated) {
    try {
      report.finalRevision = (await dependencies.loadProject(prepared.projectPath)).revision;
    } catch (error) {
      report.failure ??= errorFor("finalRevision", error);
    }
  }
  return report;
}

export async function runBatchManifest(
  manifestFile: string,
  options: BatchOptions = {},
): Promise<BatchSummary> {
  const dependencies: BatchDependencies = { ...DEFAULT_DEPENDENCIES, ...options.dependencies };
  const manifestPath = resolve(manifestFile);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new MwError(
      "USAGE",
      `无法读取批量 manifest：${error instanceof Error ? error.message : String(error)}`,
      {
        path: manifestPath,
      },
    );
  }
  const manifest = parseManifest(raw);
  const actor = options.actor ?? "codex";
  const batchId = randomUUID();
  const reportsDir = join(
    mwHome(),
    "batch-reports",
    `${basename(manifestPath, extname(manifestPath))}-${batchId}`,
  );
  await mkdir(reportsDir, { recursive: true });

  let sharedFailure: BatchFailure | undefined;
  let outroPath: string | undefined;
  let titleStyle: TextStyle | undefined;
  try {
    await dependencies.getStyle(manifest.template.captionStyle);
    const titleStyleEntry = await dependencies.getStyle(manifest.template.titleStyle);
    titleStyle = fitStyle(
      titleStyleEntry.style,
      titleStyleEntry.canvas ?? STYLE_REFERENCE,
      aspectSize("9:16", emptyProject().canvas),
    );
    const layout = await dependencies.getLayout();
    if (!layout?.face) {
      throw new MwError("NOT_FOUND", "账号版式没有 face，无法按版式取景");
    }
    if (manifest.template.outro.file === "accountDefault") {
      const outro = await dependencies.getDefaultOutro();
      if (!outro) throw new MwError("NOT_FOUND", "还没有设置默认片尾");
      outroPath = outro.file;
      if (!(await isFile(outroPath))) {
        throw new MwError("MEDIA", `默认片尾文件不存在或不是文件：${outroPath}`);
      }
    } else {
      outroPath = resolve(dirname(manifestPath), manifest.template.outro.file);
      if (!(await isFile(outroPath))) {
        throw new MwError("MEDIA", `片尾文件不存在或不是文件：${outroPath}`);
      }
    }
  } catch (error) {
    sharedFailure = errorFor("preflight", error);
  }

  const preparedItems: PreparedItem[] = [];
  for (const [index, item] of manifest.items.entries()) {
    // Index keeps the report filename short even when projectName contains CJK characters.
    const reportPath = join(reportsDir, `${String(index + 1).padStart(2, "0")}.json`);
    let prepared: PreparedItem;
    try {
      prepared = await prepareItem(
        item,
        dirname(manifestPath),
        reportPath,
        outroPath,
        manifest.template.titleStyle,
        titleStyle,
        dependencies.readScriptFile,
      );
    } catch (error) {
      prepared = {
        item,
        projectPath: projectPathFor(item.projectName),
        reportPath,
        videoPath: resolve(dirname(manifestPath), item.video),
        scriptPath: resolve(dirname(manifestPath), item.scriptFile),
        preflightFailure: preflightError(error, "单项预检失败"),
      };
    }
    if (sharedFailure) prepared.preflightFailure ??= sharedFailure;
    preparedItems.push(prepared);
  }

  const results: BatchReport[] = [];
  for (const prepared of preparedItems) {
    const report = await runItem(prepared, manifest, actor, options.onLog, dependencies);
    try {
      await writeFile(prepared.reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
    } catch (error) {
      report.failure ??= errorFor("report", error);
    }
    results.push(report);
  }

  return {
    ok: results.every((item) => item.projectCreated && !item.failure),
    batchId,
    reportsDir,
    items: results.map((item) => ({
      projectName: item.projectName,
      projectPath: item.projectPath,
      reportPath: item.reportPath,
      projectCreated: item.projectCreated,
      finalRevision: item.finalRevision,
      ...(item.failure ? { failure: item.failure } : {}),
    })),
  };
}
