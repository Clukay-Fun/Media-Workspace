import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ASPECTS } from "../core/aspect";
import { MwError } from "../core/errors";
import { Layout, LayoutFace } from "../core/layout";
import {
  alignProject,
  aspectProject,
  attachOutro,
  commentsInfo,
  compareProject,
  coverProject,
  createProject,
  exportProject,
  facesProject,
  frameProject,
  guideInfo,
  importAsset,
  inspectProject,
  lintDir,
  previewProject,
  removeOutro,
  removeSilenceProject,
  restoreCut,
  templateOpts,
  templatesInfo,
  transcribeProject,
  validateDir,
} from "../node/actions";
import {
  getLayout,
  layoutFile,
  listStyles,
  removeStyle,
  saveStyle,
  setLayout,
  useStyle,
} from "../node/library";
import { resolveProjectDir } from "../node/paths";
import {
  applyToProject,
  historyState,
  revertProject,
  revisionDiff,
  setCommentOnProject,
  undoProject,
} from "../node/store";
import { apiError } from "../server/app";

// MCP stdio 服务（阶段 B）：工具和 mw 命令一一对应，逻辑全部复用 node/actions 和 node/store。
// 返回值和 CLI 的 JSON 输出一致；出错时 isError = true，内容是 { ok:false, code, message, issues }。

const project = z
  .string()
  .min(1)
  .describe("工程名（在 ~/MediaWorkspace/projects 下）或 .mwproj 路径");
const actor = z.string().min(1).default("ai").describe("操作者，例如 codex、claude");
const base = z.number().int().nonnegative().describe("基于哪个 revision（先 inspect 拿到）");

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type Result = { content: Content[]; isError?: boolean };

const json = (v: unknown): Result => ({
  content: [{ type: "text", text: JSON.stringify(v, null, 2) }],
});

async function call(fn: () => Promise<Result | unknown>): Promise<Result> {
  try {
    const r = await fn();
    return r && typeof r === "object" && "content" in r ? (r as Result) : json(r);
  } catch (e) {
    return { ...json(apiError(e)), isError: true };
  }
}

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "media-workspace", version: "0.0.0" });
  const dirOf = (p: string) => resolveProjectDir(p);

  server.registerTool(
    "guide",
    {
      description:
        "第一次使用前先调用：编排规则、全部操作（ops）和文本样式的 JSON Schema、模板、动画预设、安全区；v8 裁切示例见规则中的 crop",
    },
    () => call(async () => guideInfo()),
  );

  server.registerTool(
    "init",
    {
      description:
        "新建工程（名字放在 ~/MediaWorkspace/projects 下，或给 .mwproj 路径）：默认复制内置样式，字幕轨用内置字幕样式。" +
        "接着 import 原片（主轨空着时自动放上主轨）",
      inputSchema: {
        project,
        styles: z.boolean().default(true).describe("false = 不复制内置样式"),
        aspect: z.enum(ASPECTS).default("9:16").describe("画幅：9:16 竖屏（默认）或 16:9 横屏"),
        actor,
      },
    },
    ({ project: p, styles, aspect, actor: a }) =>
      call(() => createProject(p, { styles, aspect, source: "mcp", actor: a })),
  );

  server.registerTool(
    "aspect",
    {
      description:
        "切换画幅 9:16 ⇄ 16:9：画布、字幕和标题样式（字号按短边、位置按安全区换算）、标题 / 图片 / 画中画位置、关键帧、" +
        "主轨裁切一次提交，可以 undo。不要只用 canvas.update 改宽高，字幕会跑出画面。" +
        "锁定轨道上的元素不动，列在 skipped 里；竖屏素材切横屏时 fitWarnings 会提示留黑和近景风险，换完用 frame 重新摆人物、lint 检查",
      inputSchema: {
        project,
        aspect: z.enum(ASPECTS),
        baseRevision: base.optional(),
        actor,
        dryRun: z.boolean().default(false),
      },
    },
    ({ project: p, aspect, baseRevision, actor: a, dryRun }) =>
      call(() =>
        aspectProject(dirOf(p), aspect, { baseRevision, dryRun, source: "mcp", actor: a }),
      ),
  );

  server.registerTool(
    "inspect",
    {
      description:
        "查看工程。view=timeline 返回 compile 之后的时间线（帧）；templates 返回可用模板",
      inputSchema: {
        project,
        view: z
          .enum(["all", "tracks", "captions", "assets", "styles", "timeline", "templates"])
          .default("all"),
      },
    },
    ({ project: p, view }) =>
      call(async () => (view === "templates" ? templatesInfo() : inspectProject(dirOf(p), view))),
  );

  server.registerTool(
    "styles",
    {
      description:
        "样式模板库（跨工程共用）：list 列出内置和保存过的样式；save 把工程里的样式存进库（name 是样式 ID，as 是库里的名字）；use 把库里的样式复制进工程（name 是模板名，as 是工程里的样式 ID）；remove 删除库里的样式",
      inputSchema: {
        action: z.enum(["list", "save", "use", "remove"]).default("list"),
        project: project.optional(),
        name: z.string().optional(),
        as: z.string().optional(),
        description: z.string().optional(),
        overwrite: z.boolean().default(false),
        baseRevision: base.optional(),
        actor,
      },
    },
    ({ action, project: p, name, as, description, overwrite, baseRevision, actor: a }) =>
      call(async () => {
        if (action === "list") return { ok: true, ...(await listStyles()) };
        if (!name) throw new MwError("USAGE", `${action} 需要 name`);
        if (action === "remove") return removeStyle(name);
        if (!p) throw new MwError("USAGE", `${action} 需要 project`);
        const opt = as === undefined ? {} : { as };
        if (action === "save") {
          const s = await saveStyle(dirOf(p), name, {
            ...opt,
            overwrite,
            ...(description === undefined ? {} : { description }),
          });
          return { ok: true, saved: s.name };
        }
        return useStyle(dirOf(p), name, {
          ...opt,
          ...(baseRevision === undefined ? {} : { baseRevision }),
          source: "mcp",
          actor: a,
        });
      }),
  );

  server.registerTool(
    "validate",
    { description: "校验工程，返回错误和警告", inputSchema: { project } },
    ({ project: p }) => call(() => validateDir(dirOf(p))),
  );

  server.registerTool(
    "apply",
    {
      description:
        '提交一批操作（全部成功或全部不生效）。必须带 baseRevision；返回 CONFLICT 时重新 inspect。操作格式见 guide。裁切例：{op:"item.update",id:"c1",set:{crop:{x:0.1,y:0.15,width:0.8,height:0.7}}}；crop:null 恢复完整画面。封面字段放在 set 里，例如 {op:"cover.update",set:{atMs:2000,title:{template:"title-bar",props:{lines:["示例标题"]}}}}',
      inputSchema: {
        project,
        ops: z
          .array(z.record(z.string(), z.unknown()))
          .min(1)
          .describe("操作列表；cover.update 的 atMs、title 等字段都放在 set 对象里"),
        baseRevision: base,
        actor,
        dryRun: z.boolean().default(false).describe("只校验并返回结果，不写入工程"),
      },
    },
    ({ project: p, ops, baseRevision, actor: a, dryRun }) =>
      call(() =>
        applyToProject(dirOf(p), {
          ops,
          baseRevision,
          source: "mcp",
          actor: a,
          dryRun,
          ...templateOpts,
        }),
      ),
  );

  server.registerTool(
    "lint",
    {
      description:
        "质检（提交后自查用）：字太小、文字出安全区、字幕放不下、元素互相遮挡、挡脸。每条带 atMs，可以直接 preview 查看",
      inputSchema: { project },
    },
    ({ project: p }) => call(() => lintDir(dirOf(p))),
  );

  server.registerTool(
    "comments",
    {
      description:
        "人在审片台上留的批注（atMs 时间点、target 条目 ID、文字）。开始工作前先看，逐条处理后用 resolve 标记",
      inputSchema: { project, all: z.boolean().default(false).describe("包括已处理的") },
    },
    ({ project: p, all }) => call(() => commentsInfo(dirOf(p), { all })),
  );

  server.registerTool(
    "resolve",
    {
      description: "把批注标记为已处理，note 写明改了什么；不打算改的也标记，并在 note 里说明原因",
      inputSchema: {
        project,
        id: z.string().min(1),
        note: z.string().min(1),
        actor,
      },
    },
    ({ project: p, id, note, actor: a }) =>
      call(() => setCommentOnProject(dirOf(p), { id, status: "resolved", note, author: a })),
  );

  server.registerTool(
    "faces",
    {
      description: "给还没有人脸数据的视频素材补做人脸检测（macOS），之后 lint 才能检查挡脸",
      inputSchema: { project, actor },
    },
    ({ project: p, actor: a }) => call(() => facesProject(dirOf(p), { source: "mcp", actor: a })),
  );

  server.registerTool(
    "remove-silence",
    {
      description:
        "从主轨视频素材的音频中找静音并剪掉停顿，不依赖字幕或识音模型。全片剪时会避开字幕对应的发音区间：有逐字时间时按首字和末字留余量，没有时保护字幕起止时间。" +
        "keepMs 是静音段两端各保留的时长（默认 120，edgesOnly 时 300）；edgesOnly 只剪开头和结尾的空白，句中停顿保留（人没说要剪停顿时用这个）",
      inputSchema: {
        project,
        minPauseMs: z
          .number()
          .int()
          .positive()
          .default(400)
          .describe("只检测不短于此时长的静音，毫秒"),
        keepMs: z.number().int().nonnegative().optional().describe("静音段两端各保留的时长，毫秒"),
        edgesOnly: z.boolean().default(false).describe("只剪开头和结尾，保留句中停顿"),
        baseRevision: base.optional().describe("基于哪个 revision；先 inspect 获取"),
        actor,
      },
    },
    ({ project: p, minPauseMs, keepMs, edgesOnly, baseRevision, actor: a }) =>
      call(() =>
        removeSilenceProject(dirOf(p), {
          minPauseMs,
          keepMs,
          edgesOnly,
          baseRevision,
          source: "mcp",
          actor: a,
        }),
      ),
  );

  server.registerTool(
    "compare",
    {
      description:
        "比较工程和参考成片，生成同一时间点并排 PNG，并返回时长、剪切点、人脸位置和字幕换行差异 JSON",
      inputSchema: {
        project,
        reference: z.string().min(1).describe("参考成片的绝对路径"),
        atMs: z.number().int().nonnegative().optional(),
        out: z.string().optional(),
        sceneThreshold: z.number().positive().max(1).default(0.3),
        cutToleranceMs: z.number().int().nonnegative().default(500),
        faceIntervalMs: z.number().int().min(250).default(1000),
      },
    },
    ({ project: p, reference, atMs, out, sceneThreshold, cutToleranceMs, faceIntervalMs }) =>
      call(async () => {
        const result = await compareProject(dirOf(p), reference, {
          atMs,
          out,
          sceneThreshold,
          cutToleranceMs,
          faceIntervalMs,
        });
        const data = (await readFile(result.comparisonImage)).toString("base64");
        return {
          content: [
            { type: "text", text: JSON.stringify(result, null, 2) },
            { type: "image", data, mimeType: "image/png" },
          ],
        } satisfies Result;
      }),
  );

  server.registerTool(
    "import",
    {
      description:
        "导入素材文件（视频、音频、图片）：probe、必要时转标准化文件和预览代理，然后提交 asset.add；" +
        "主轨空着时视频整段放上主轨（倍速按账号设置，返回 mainClip），main=false 只导入",
      inputSchema: {
        project,
        file: z.string().min(1).describe("素材的绝对路径"),
        id: z.string().optional(),
        main: z.boolean().optional(),
        baseRevision: base.optional(),
        actor,
      },
    },
    ({ project: p, file, id, main, baseRevision, actor: a }) =>
      call(async () => {
        const r = await importAsset(dirOf(p), file, {
          id,
          main,
          baseRevision,
          source: "mcp",
          actor: a,
        });
        const content: Content[] = [{ type: "text", text: JSON.stringify(r, null, 2) }];
        // 烧录字幕检查图直接给 AI 看
        if (r.subtitleCheck) {
          const data = (await readFile(r.subtitleCheck)).toString("base64");
          content.push({ type: "image", data, mimeType: "image/jpeg" });
        }
        return { content } satisfies Result;
      }),
  );

  server.registerTool(
    "uncut",
    {
      description:
        "恢复剪辑点：把主轨片段 clip 前面剪掉的那段源时间接回来，随删句一起删掉的字幕从历史里找回。" +
        "人在剪辑点上批注「这刀不要剪」「恢复」时用",
      inputSchema: {
        project,
        clip: z.string().describe("剪辑点后面那个主轨片段的 ID（带 cutBefore 的那个）"),
        baseRevision: base.optional(),
        actor,
        dryRun: z.boolean().default(false),
      },
    },
    ({ project: p, clip, baseRevision, actor: a, dryRun }) =>
      call(() => restoreCut(dirOf(p), clip, { baseRevision, dryRun, source: "mcp", actor: a })),
  );

  server.registerTool(
    "align",
    {
      description:
        "识音：给字幕写入每个字开始念的时间，让逐字动画跟着语音走。改了字幕文字之后需要重新运行",
      inputSchema: {
        project,
        captions: z.array(z.string()).optional().describe("只处理这些字幕 ID，默认全部"),
        baseRevision: base.optional(),
        actor,
        dryRun: z.boolean().default(false),
      },
    },
    ({ project: p, captions, baseRevision, actor: a, dryRun }) =>
      call(() =>
        alignProject(dirOf(p), {
          ids: captions,
          baseRevision,
          dryRun,
          source: "mcp",
          actor: a,
        }),
      ),
  );

  server.registerTool(
    "layout",
    {
      description:
        "账号版式（所有工程共用）：参考线、人脸框该落在哪、标题和字幕用哪个样式、口播倍速（speed）、一条字幕最多几个字（captionMaxChars）。不给 layout 时读；给了整份替换。" +
        "位置都是占画面宽 / 高的比例（0–1）",
      inputSchema: {
        layout: Layout.optional().describe("新的整份版式；不给时只读"),
      },
    },
    ({ layout }) =>
      call(async () => ({
        ok: true,
        file: layoutFile(),
        layout: layout ? await setLayout(layout) : await getLayout(),
      })),
  );

  server.registerTool(
    "frame",
    {
      description:
        "按账号版式摆人物：按人脸检测算主轨片段的缩放和位置，让人脸框落在版式的 face 上（同一素材的片段用同一套取景，有关键帧的不动）。" +
        "人物位置一律用它，不要手调 transform；clamped 为 true 表示为了不露黑边脸会偏大或偏一点",
      inputSchema: {
        project,
        face: LayoutFace.optional().describe("这次用的人脸位置，不给时用账号版式的 face"),
        baseRevision: base.optional(),
        actor,
        dryRun: z.boolean().default(false),
      },
    },
    ({ project: p, face, baseRevision, actor: a, dryRun }) =>
      call(() =>
        frameProject(dirOf(p), {
          ...(face ? { face } : {}),
          baseRevision,
          dryRun,
          source: "mcp",
          actor: a,
        }),
      ),
  );

  server.registerTool(
    "transcribe",
    {
      description:
        "从原片识音出字幕（不需要 SRT）：按停顿、标点、词边界断成一行一句，带逐字时间，默认清空原有字幕。" +
        "给文稿（纯文本）时字以文稿为准、时间用识音的；返回的 check 是漏读 / 多读 / 改口，要给用户确认；" +
        "splitLines 是太长被切开的行，读一遍不顺就用 caption.split / caption.merge 调",
      inputSchema: {
        project,
        script: z.string().optional().describe("文稿纯文本；不给时用工程里存过的 script.txt"),
        asset: z.string().optional().describe("识哪个素材，默认主轨第一段视频"),
        maxChars: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("一行最多几个字，默认按字幕样式算"),
        mode: z.enum(["replace", "append"]).default("replace"),
        baseRevision: base.optional(),
        actor,
        dryRun: z.boolean().default(false),
      },
    },
    ({ project: p, baseRevision, actor: a, ...o }) =>
      call(() =>
        transcribeProject(dirOf(p), {
          ...o,
          baseRevision,
          source: "mcp",
          actor: a,
        }),
      ),
  );

  server.registerTool(
    "preview",
    {
      description:
        '截图自查：at 是字符串，可传毫秒（如 "1200"）或条目 ID（如 "s3"）；frame 是从 0 开始的帧号；sheet 是均匀抽帧数量（1–48）。三种定位方式选一种。返回 PNG 图片和文件路径',
      inputSchema: {
        project,
        at: z.string().optional().describe('时间毫秒的字符串或条目 ID，例如 "1200"、"s3"'),
        frame: z.number().int().nonnegative().optional().describe("视频帧序号，从 0 开始"),
        sheet: z
          .number()
          .int()
          .positive()
          .max(48)
          .optional()
          .describe("均匀抽取的帧数，拼成网格图"),
        safeArea: z.boolean().default(false).describe("叠加视频号安全区（红框）"),
        guides: z.boolean().default(false).describe("叠加账号版式参考线"),
      },
    },
    ({ project: p, at, frame, sheet, safeArea, guides }) =>
      call(async () => {
        const r = await previewProject(dirOf(p), { at, frame, sheet, safeArea, guides });
        const data = (await readFile(r.file)).toString("base64");
        return {
          content: [
            { type: "text", text: JSON.stringify(r, null, 2) },
            { type: "image", data, mimeType: "image/png" },
          ],
        } satisfies Result;
      }),
  );

  server.registerTool(
    "export",
    {
      description: "导出 MP4（可能需要几十秒到几分钟）。返回文件路径",
      inputSchema: { project, out: z.string().optional() },
    },
    ({ project: p, out }) => call(() => exportProject(dirOf(p), { out })),
  );

  server.registerTool(
    "cover",
    {
      description: "导出封面 PNG（cover.atMs 那一帧，没有设置时取第 1 秒）",
      inputSchema: { project, out: z.string().optional() },
    },
    ({ project: p, out }) => call(() => coverProject(dirOf(p), { out })),
  );

  server.registerTool(
    "outro",
    {
      description:
        "接上片尾：不给 file 时用用户设置的默认片尾（没设置会报 NOT_FOUND，请用户用 mw outro-default 设置）；remove 去掉片尾。fadeMs 叠化时长，0 = 硬切",
      inputSchema: {
        project,
        file: z.string().optional(),
        fadeMs: z.number().int().min(0).max(5000).optional(),
        remove: z.boolean().optional(),
        actor,
      },
    },
    ({ project: p, file, fadeMs, remove, actor: a }) =>
      call(() =>
        remove
          ? removeOutro(dirOf(p), { source: "mcp", actor: a })
          : attachOutro(dirOf(p), {
              source: "mcp",
              actor: a,
              ...(file === undefined ? {} : { file }),
              ...(fadeMs === undefined ? {} : { fadeMs }),
            }),
      ),
  );

  server.registerTool(
    "history",
    {
      description:
        "修改记录，以及现在撤销 / 重做会回到哪一版。带 revision 时改为返回这一版改了什么（每个元素的前后值），例如 { revision: 12 }",
      inputSchema: {
        project,
        revision: z.number().int().nonnegative().optional().describe("只看这一版的改动"),
      },
    },
    ({ project: p, revision }) =>
      call(async () =>
        revision === undefined
          ? { ok: true, ...(await historyState(dirOf(p))) }
          : revisionDiff(dirOf(p), revision),
      ),
  );

  for (const direction of ["undo", "redo"] as const) {
    server.registerTool(
      direction,
      {
        description: direction === "undo" ? "撤销上一次修改" : "重做刚才撤销的修改",
        inputSchema: { project, baseRevision: base, actor },
      },
      ({ project: p, baseRevision, actor: a }) =>
        call(() => undoProject(dirOf(p), { direction, baseRevision, source: "mcp", actor: a })),
    );
  }

  server.registerTool(
    "revert",
    {
      description: "回退到某个历史版本（作为新的一版写入，锁定的轨道不会被改动）",
      inputSchema: { project, to: z.number().int().nonnegative(), baseRevision: base, actor },
    },
    ({ project: p, to, baseRevision, actor: a }) =>
      call(() => revertProject(dirOf(p), { to, baseRevision, source: "mcp", actor: a })),
  );

  return server;
}

export async function runMcpStdio(): Promise<void> {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
  // stdio 关闭（客户端退出）时结束
  await new Promise<void>((done) => {
    process.stdin.once("close", done);
  });
}
