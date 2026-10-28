import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  alignProject,
  coverProject,
  exportProject,
  facesProject,
  guideInfo,
  importAsset,
  inspectProject,
  lintDir,
  previewProject,
  templateOpts,
  templatesInfo,
  validateDir,
} from "../node/actions";
import { resolveProjectDir } from "../node/paths";
import { applyToProject, historyState, revertProject, undoProject } from "../node/store";
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
        "第一次使用前先调用：编排规则、全部操作（ops）和文本样式的 JSON Schema、模板、动画预设、安全区",
    },
    () => call(async () => guideInfo()),
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
    "validate",
    { description: "校验工程，返回错误和警告", inputSchema: { project } },
    ({ project: p }) => call(() => validateDir(dirOf(p))),
  );

  server.registerTool(
    "apply",
    {
      description:
        "提交一批操作（全部成功或全部不生效）。必须带 baseRevision；返回 CONFLICT 时重新 inspect。操作格式见 guide",
      inputSchema: {
        project,
        ops: z.array(z.record(z.string(), z.unknown())).min(1),
        baseRevision: base,
        actor,
        dryRun: z.boolean().default(false),
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
    "faces",
    {
      description: "给还没有人脸数据的视频素材补做人脸检测（macOS），之后 lint 才能检查挡脸",
      inputSchema: { project, actor },
    },
    ({ project: p, actor: a }) => call(() => facesProject(dirOf(p), { source: "mcp", actor: a })),
  );

  server.registerTool(
    "import",
    {
      description:
        "导入素材文件（视频、音频、图片）：probe、必要时转标准化文件和预览代理，然后提交 asset.add",
      inputSchema: {
        project,
        file: z.string().min(1).describe("素材的绝对路径"),
        id: z.string().optional(),
        baseRevision: base.optional(),
        actor,
      },
    },
    ({ project: p, file, id, baseRevision, actor: a }) =>
      call(async () => {
        const r = await importAsset(dirOf(p), file, { id, baseRevision, source: "mcp", actor: a });
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
    "preview",
    {
      description:
        "截图自查：at（毫秒或条目 ID）、frame，或 sheet（均匀截 n 帧拼成网格图）。返回 PNG 图片和文件路径",
      inputSchema: {
        project,
        at: z.string().optional(),
        frame: z.number().int().nonnegative().optional(),
        sheet: z.number().int().positive().max(48).optional(),
        safeArea: z.enum(["all", "douyin", "channels", "xiaohongshu"]).optional(),
        guides: z.boolean().default(false),
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
    "history",
    { description: "修改记录，以及现在撤销 / 重做会回到哪一版", inputSchema: { project } },
    ({ project: p }) => call(async () => ({ ok: true, ...(await historyState(dirOf(p))) })),
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
