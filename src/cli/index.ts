import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import cac from "cac";
import { API_PORT } from "../core/api";
import { MwError } from "../core/errors";
import { LayoutFace } from "../core/layout";
import { BUILTIN_STYLES } from "../core/presets";
import { runMcpStdio } from "../mcp/server";
import {
  alignProject,
  attachOutro,
  commentsInfo,
  coverProject,
  exportProject,
  facesProject,
  frameProject,
  guideInfo,
  importAsset,
  inspectProject,
  lintDir,
  previewProject,
  removeOutro,
  restoreCut,
  templateOpts,
  templatesInfo,
  transcribeProject,
  validateDir,
} from "../node/actions";
import { ASR_MODEL, asrModelDir, fetchAsrModel, hasAsrModel } from "../node/asr";
import {
  getDefaultOutro,
  getLayout,
  layoutFile,
  listStyles,
  outroDefaultFile,
  removeStyle,
  saveStyle,
  setDefaultOutro,
  setLayout,
  textStylesDir,
  useStyle,
} from "../node/library";
import { resolveProjectDir } from "../node/paths";
import {
  clearServing,
  hookOutput,
  markServing,
  promptContext,
  reviewTargets,
  waitForComments,
} from "../node/review-hook";
import {
  applyToProject,
  commentOnProject,
  emptyProject,
  historyState,
  initProject,
  listHistory,
  loadEditor,
  revertProject,
  saveEditor,
  setCommentOnProject,
  undoProject,
} from "../node/store";
import { startServer } from "../server/index";

// mw：stdout 只输出 JSON（给 AI 解析），进度和日志写 stderr。
// 退出码（PLAN 7）：0 成功，1 校验失败，2 参数错误，3 版本冲突，4 媒体错误，5 渲染失败，6 轨道已锁定。

const log = (s: string) => process.stderr.write(`${s}\n`);
const out = (v: unknown): void => {
  process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
};

class UsageError extends Error {}

const EXIT: Record<string, number> = {
  VALIDATION: 1,
  UNKNOWN_FIELD: 1,
  REF_MISSING: 1,
  DUPLICATE_ID: 1,
  TIME_RANGE: 1,
  NOT_FOUND: 1,
  INVALID_OP: 1,
  IN_USE: 1,
  SRT_PARSE: 1,
  FONT_MISSING: 1,
  CONFLICT: 3,
  MEDIA: 4,
  RENDER: 5,
  TRACK_LOCKED: 6,
  USAGE: 2,
};

function fail(e: unknown): never {
  if (e instanceof MwError) {
    out({ ok: false, code: e.code, message: e.message, issues: e.issues });
    process.exit(EXIT[e.code] ?? 1);
  }
  // cac 的参数错误（缺少参数值、未知选项）也按参数错误处理
  if (e instanceof UsageError || (e as Error)?.name === "CACError") {
    out({ ok: false, code: "USAGE", message: (e as Error).message });
    process.exit(2);
  }
  out({ ok: false, code: "INTERNAL", message: String((e as Error)?.stack ?? e) });
  process.exit(1);
}

const act =
  <A extends unknown[]>(fn: (...args: A) => Promise<void>) =>
  (...args: A) =>
    fn(...args).catch(fail);

const templates = templateOpts;

const cli = cac("mw");

cli
  .command("init <name>", "新建工程（名字或路径）")
  .option("--no-styles", "不复制内置样式")
  .action(
    act(async (name: string, o: { styles: boolean }) => {
      const dir = resolveProjectDir(name);
      const p = emptyProject();
      if (o.styles) p.styles = { ...BUILTIN_STYLES };
      // 字幕轨默认用内置字幕样式，新工程开箱就是样片的效果
      if (o.styles) {
        const cap = p.tracks.find((t) => t.kind === "caption");
        if (cap && cap.kind === "caption") cap.style = "caption-word-yellow";
      }
      await initProject(dir, p);
      out({ ok: true, project: dir, revision: 0 });
    }),
  );

cli
  .command("import <proj> <file>", "导入素材：probe、必要时转标准化文件，然后提交 asset.add")
  .option("--id <id>", "素材 ID（不写时自动生成）")
  .option("--base <rev>", "基于哪个 revision 提交（不写时取当前版本）")
  .option("--actor <name>", "操作者", { default: "user" })
  .option("--no-proxy", "不生成预览代理")
  .action(
    act(
      async (
        proj: string,
        file: string,
        o: { id?: string; base?: number; actor: string; proxy: boolean },
      ) => {
        out(
          await importAsset(resolveProjectDir(proj), file, {
            id: o.id === undefined ? undefined : String(o.id),
            baseRevision: o.base === undefined ? undefined : Number(o.base),
            proxy: o.proxy,
            source: "cli",
            actor: o.actor,
            onLog: log,
          }),
        );
      },
    ),
  );

cli
  .command("inspect <proj>", "查看工程")
  .option("--tracks", "只看轨道")
  .option("--captions", "只看字幕")
  .option("--assets", "只看素材")
  .option("--styles", "只看样式")
  .option("--templates", "可用的模板")
  .option("--timeline", "compile 之后的时间线（帧）")
  .action(
    act(async (proj: string, o: Record<string, boolean>) => {
      if (o.templates) return out(templatesInfo());
      const views = ["timeline", "tracks", "captions", "assets", "styles"] as const;
      const view = views.find((v) => o[v]) ?? "all";
      out(await inspectProject(resolveProjectDir(proj), view));
    }),
  );

cli.command("validate <proj>", "校验工程（错误 + 警告）").action(
  act(async (proj: string) => {
    const v = await validateDir(resolveProjectDir(proj));
    out(v);
    if (!v.ok) process.exit(1);
  }),
);

cli
  .command("apply <proj>", "提交一批操作")
  .option("--ops <file>", "操作 JSON 文件，- 表示从 stdin 读取")
  .option("--base <rev>", "基于哪个 revision（必填，防止覆盖别人的修改）")
  .option("--actor <name>", "操作者（例如 codex、claude）", { default: "user" })
  .option("--dry-run", "只检查不写入")
  .action(
    act(
      async (proj: string, o: { ops?: string; base?: number; actor: string; dryRun?: boolean }) => {
        if (!o.ops) throw new UsageError("缺少 --ops <file|->");
        if (o.base === undefined)
          throw new UsageError("缺少 --base <revision>，先用 mw inspect 查看当前 revision");
        const text = o.ops === "-" ? await readStdin() : await readFile(o.ops, "utf8");
        let ops: unknown;
        try {
          ops = JSON.parse(text);
        } catch {
          throw new UsageError("ops 不是合法的 JSON");
        }
        const list = Array.isArray(ops) ? ops : [ops];
        // CLI 的便利写法：caption.import 可以写 srtFile，这里读出文件内容（路径相对 ops 文件）
        const base = o.ops === "-" ? process.cwd() : dirname(resolve(o.ops));
        for (const op of list) {
          if (op && typeof op === "object" && "srtFile" in op) {
            const { srtFile, ...rest } = op as { srtFile: string };
            Object.assign(op, { ...rest, srt: await readFile(resolve(base, srtFile), "utf8") });
            delete (op as { srtFile?: string }).srtFile;
          }
        }
        const dir = resolveProjectDir(proj);
        const r = await applyToProject(dir, {
          ops: list,
          baseRevision: Number(o.base),
          source: "cli",
          actor: o.actor,
          dryRun: Boolean(o.dryRun),
          ...templates,
        });
        out(r);
      },
    ),
  );

cli.command("lint <proj>", "质检：字太小、出安全区、字幕放不下、互相遮挡、挡脸（警告）").action(
  act(async (proj: string) => {
    out(await lintDir(resolveProjectDir(proj)));
  }),
);

cli
  .command("faces <proj>", "给还没有人脸数据的视频素材补做人脸检测（macOS）")
  .option("--actor <name>", "操作者", { default: "user" })
  .action(
    act(async (proj: string, o: { actor: string }) => {
      out(
        await facesProject(resolveProjectDir(proj), { source: "cli", actor: o.actor, onLog: log }),
      );
    }),
  );

cli
  .command(
    "uncut <proj> <clip>",
    "恢复剪辑点：把主轨片段 clip 前面剪掉的那段接回来，随删句删掉的字幕一起找回",
  )
  .option("--base <rev>", "基于哪个 revision（默认当前）")
  .option("--actor <name>", "操作者", { default: "user" })
  .option("--dry-run", "只检查，不写入")
  .action(
    act(
      async (proj: string, clip: string, o: { base?: number; actor: string; dryRun?: boolean }) => {
        out(
          await restoreCut(resolveProjectDir(proj), clip, {
            baseRevision: o.base === undefined ? undefined : Number(o.base),
            dryRun: Boolean(o.dryRun),
            source: "cli",
            actor: o.actor,
          }),
        );
      },
    ),
  );

cli
  .command("align <proj>", "识音：给字幕加上每个字开始念的时间，逐字动画跟着语音走")
  .option("--captions <ids>", "只处理这些字幕（逗号分隔），默认全部")
  .option("--base <rev>", "基于哪个 revision（默认当前）")
  .option("--actor <name>", "操作者", { default: "user" })
  .option("--dry-run", "只识音和检查，不写入")
  .action(
    act(
      async (
        proj: string,
        o: { captions?: string; base?: number; actor: string; dryRun?: boolean },
      ) => {
        out(
          await alignProject(resolveProjectDir(proj), {
            ids: o.captions ? String(o.captions).split(",").filter(Boolean) : undefined,
            baseRevision: o.base === undefined ? undefined : Number(o.base),
            dryRun: Boolean(o.dryRun),
            source: "cli",
            actor: o.actor,
            onLog: log,
          }),
        );
      },
    ),
  );

cli
  .command(
    "transcribe <proj>",
    "从原片识音出字幕：按停顿、标点、词边界断成一行一句；给文稿时按文稿校字，对不上的地方列出来",
  )
  .option("--script <file>", "文稿（纯文本，- = 从标准输入读）；不给时用工程里存过的 script.txt")
  .option("--asset <id>", "识哪个素材，默认主轨第一段视频")
  .option("--max-chars <n>", "一行最多几个字（默认按字幕样式一行放得下的字数）")
  .option("--append", "加在原有字幕后面（默认清空原有字幕）")
  .option("--base <rev>", "基于哪个 revision（默认当前）")
  .option("--actor <name>", "操作者", { default: "user" })
  .option("--dry-run", "只识音和断句，不写入")
  .action(
    act(
      async (
        proj: string,
        o: {
          script?: string;
          asset?: string;
          maxChars?: number;
          append?: boolean;
          base?: number;
          actor: string;
          dryRun?: boolean;
        },
      ) => {
        const script =
          o.script === undefined
            ? undefined
            : o.script === "-"
              ? await readStdin()
              : await readFile(o.script, "utf8");
        out(
          await transcribeProject(resolveProjectDir(proj), {
            ...(script === undefined ? {} : { script }),
            ...(o.asset === undefined ? {} : { asset: String(o.asset) }),
            ...(o.maxChars === undefined ? {} : { maxChars: Number(o.maxChars) }),
            mode: o.append ? "append" : "replace",
            baseRevision: o.base === undefined ? undefined : Number(o.base),
            dryRun: Boolean(o.dryRun),
            source: "cli",
            actor: o.actor,
            onLog: log,
          }),
        );
      },
    ),
  );

cli
  .command("frame <proj>", "按账号版式摆人物：按人脸位置算主画面的缩放和位置，让脸落在参考线上")
  .option("--face <cx,top,bottom>", "这次用的人脸位置（占画面比例），不写时用账号版式的 face")
  .option("--base <rev>", "基于哪个 revision（默认当前）")
  .option("--actor <name>", "操作者", { default: "user" })
  .option("--dry-run", "只计算，不写入")
  .action(
    act(
      async (
        proj: string,
        o: { face?: string; base?: number; actor: string; dryRun?: boolean },
      ) => {
        let face: { cx: number; top: number; bottom: number } | undefined;
        if (o.face !== undefined) {
          const [cx, top, bottom] = String(o.face).split(",").map(Number);
          const r = LayoutFace.safeParse({ cx, top, bottom });
          if (!r.success)
            throw new MwError("USAGE", "--face 要写成 cx,top,bottom（0–1，上沿小于下沿）");
          face = r.data;
        }
        out(
          await frameProject(resolveProjectDir(proj), {
            ...(face ? { face } : {}),
            baseRevision: o.base === undefined ? undefined : Number(o.base),
            dryRun: Boolean(o.dryRun),
            source: "cli",
            actor: o.actor,
            onLog: log,
          }),
        );
      },
    ),
  );

cli
  .command("models", "查看或下载本地模型（识音）")
  .option("--fetch", "下载缺少的模型")
  .action(
    act(async (o: { fetch?: boolean }) => {
      if (o.fetch) await fetchAsrModel(log);
      out({
        ok: true,
        asr: { name: ASR_MODEL.name, dir: asrModelDir(), installed: hasAsrModel() },
      });
    }),
  );

cli
  .command("preview <proj>", "截图：某一时刻，或多帧网格图")
  .option("--at <ms|id>", "毫秒，或者条目 ID（取它显示时间的 80% 处）")
  .option("--frame <n>", "帧号")
  .option("--sheet [n]", "均匀截 n 帧拼成网格图（默认 12）")
  .option("--safe-area [preset]", "叠加安全区（all/douyin/channels/xiaohongshu）")
  .option("--guides", "叠加参考线（账号版式的和这个工程 editor.json 里的）")
  .option("--out <file>", "输出 PNG")
  .action(
    act(
      async (
        proj: string,
        o: {
          at?: string;
          frame?: number;
          sheet?: number | boolean;
          safeArea?: string | boolean;
          guides?: boolean;
          out?: string;
        },
      ) => {
        out(
          await previewProject(resolveProjectDir(proj), {
            at: o.at === undefined ? undefined : String(o.at),
            frame: o.frame === undefined ? undefined : Number(o.frame),
            sheet:
              o.sheet === undefined || o.sheet === false
                ? undefined
                : typeof o.sheet === "number"
                  ? o.sheet
                  : 12,
            safeArea:
              o.safeArea === undefined || o.safeArea === false
                ? null
                : typeof o.safeArea === "string" && o.safeArea !== ""
                  ? o.safeArea
                  : "all",
            guides: Boolean(o.guides),
            out: o.out,
            onLog: log,
          }),
        );
      },
    ),
  );

cli
  .command("export <proj>", "导出 MP4")
  .option("--out <file>", "输出文件（默认 renders/<工程名>-r<revision>.mp4）")
  .option("--concurrency <n>", "并发数（默认 CPU 核数的一半）")
  .action(
    act(async (proj: string, o: { out?: string; concurrency?: number }) => {
      let last = -1;
      out(
        await exportProject(resolveProjectDir(proj), {
          out: o.out,
          concurrency: o.concurrency ? Number(o.concurrency) : undefined,
          onLog: log,
          onProgress: ({ progress }) => {
            const pct = Math.floor(progress * 100);
            if (pct >= last + 10) {
              last = pct;
              log(`导出 ${pct}%`);
            }
          },
        }),
      );
    }),
  );

cli
  .command("cover <proj>", "导出封面（cover.atMs 那一帧，没有设置时取第 1 秒）")
  .option("--out <file>", "输出 PNG")
  .action(
    act(async (proj: string, o: { out?: string }) => {
      out(await coverProject(resolveProjectDir(proj), { out: o.out, onLog: log }));
    }),
  );

cli
  .command("outro <proj> [file]", "接上片尾：不给文件时用默认片尾（mw outro-default）")
  .option("--fade <ms>", "叠化时长，0 = 硬切；不写时用默认片尾的设置（300ms）")
  .option("--remove", "去掉片尾")
  .action(
    act(async (proj: string, file: string | undefined, o: { fade?: number; remove?: boolean }) => {
      const dir = resolveProjectDir(proj);
      const who = { source: "cli" as const, actor: "user" };
      if (o.remove) return out(await removeOutro(dir, who));
      out(
        await attachOutro(dir, {
          ...who,
          ...(file === undefined ? {} : { file }),
          ...(o.fade === undefined ? {} : { fadeMs: Number(o.fade) }),
          onLog: log,
        }),
      );
    }),
  );

cli
  .command("outro-default [file]", "查看 / 设置默认片尾（只记路径，不复制文件）")
  .option("--fade <ms>", "接上时的叠化时长，0 = 硬切（默认 300）")
  .option("--gain <db>", "片尾音量（dB，默认 0）")
  .action(
    act(async (file: string | undefined, o: { fade?: number; gain?: number }) => {
      if (file === undefined) {
        return out({ ok: true, file: outroDefaultFile(), outro: await getDefaultOutro() });
      }
      const outro = await setDefaultOutro(file, {
        ...(o.fade === undefined ? {} : { fadeMs: Number(o.fade) }),
        ...(o.gain === undefined ? {} : { gainDb: Number(o.gain) }),
      });
      out({ ok: true, file: outroDefaultFile(), outro });
    }),
  );

cli
  .command("layout", "查看 / 设置账号版式（参考线、人脸位置、标题和字幕样式，所有工程共用）")
  .option("--file <json>", "用这个 JSON 文件整份替换账号版式")
  .action(
    act(async (o: { file?: string }) => {
      if (o.file === undefined)
        return out({ ok: true, file: layoutFile(), layout: await getLayout() });
      const input = JSON.parse(await readFile(o.file, "utf8"));
      out({ ok: true, file: layoutFile(), layout: await setLayout(input) });
    }),
  );

cli.command("history <proj>", "修改记录、可以回退的版本、撤销 / 重做状态").action(
  act(async (proj: string) => {
    const dir = resolveProjectDir(proj);
    out({ ok: true, revisions: await listHistory(dir), ...(await historyState(dir)) });
  }),
);

cli
  .command("revert <proj>", "回退到某个版本（作为新的一版写入）")
  .option("--to <rev>", "目标版本")
  .option("--base <rev>", "当前版本（可选，用来防止覆盖别人的修改）")
  .option("--actor <name>", "操作者", { default: "user" })
  .action(
    act(async (proj: string, o: { to?: number; base?: number; actor: string }) => {
      if (o.to === undefined) throw new UsageError("缺少 --to <revision>");
      out(
        await revertProject(resolveProjectDir(proj), {
          to: Number(o.to),
          baseRevision: o.base === undefined ? undefined : Number(o.base),
          source: "cli",
          actor: o.actor,
        }),
      );
    }),
  );

cli
  .command("guides <proj>", "查看或修改参考线（editor.json，不影响渲染）")
  .option("--add <list>", "例如 h:1167,v:536（h = 水平线的 y，v = 竖线的 x）")
  .option("--clear", "清除全部参考线")
  .action(
    act(async (proj: string, o: { add?: string; clear?: boolean }) => {
      const dir = resolveProjectDir(proj);
      const ed = await loadEditor(dir);
      if (o.clear) ed.guides.items = [];
      if (o.add) {
        for (const part of String(o.add).split(",")) {
          const m = /^(h|v):(\d+(?:\.\d+)?)$/.exec(part.trim());
          if (!m) throw new UsageError(`参考线格式不对：${part}（应为 h:1167 或 v:536）`);
          const n = ed.guides.items.length + 1;
          ed.guides.items.push({ id: `g${n}`, axis: m[1] as "h" | "v", pos: Number(m[2]) });
        }
      }
      if (o.add || o.clear) await saveEditor(dir, ed);
      out(ed.guides);
    }),
  );

cli
  .command(
    "styles [action] [...args]",
    "样式模板库：列出 / save <工程> <样式> / use <工程> <模板> / remove <模板>",
  )
  .option("--as <name>", "save：存进库用的名字；use：在工程里用的样式 ID")
  .option("--desc <text>", "save：一句话说明这个样式适合什么内容")
  .option("--overwrite", "save：覆盖库里的同名样式")
  .action(
    act(
      async (
        action: string | undefined,
        args: string[],
        o: { as?: string; desc?: string; overwrite?: boolean },
      ) => {
        const as = o.as === undefined ? {} : { as: String(o.as) };
        const need = (n: number, usage: string) => {
          if (args.length !== n) throw new UsageError(`用法：mw styles ${usage}`);
        };
        switch (action ?? "list") {
          case "list":
            out({ ok: true, dir: textStylesDir(), ...(await listStyles()) });
            return;
          case "save": {
            need(2, "save <工程> <样式 ID> [--as 名字] [--desc 说明]");
            const [proj = "", id = ""] = args;
            const style = await saveStyle(resolveProjectDir(proj), id, {
              ...as,
              ...(o.desc === undefined ? {} : { description: String(o.desc) }),
              overwrite: o.overwrite === true,
            });
            out({ ok: true, saved: style.name, file: textStylesDir() });
            return;
          }
          case "use": {
            need(2, "use <工程> <模板名> [--as 样式 ID]");
            const [proj = "", name = ""] = args;
            out(
              await useStyle(resolveProjectDir(proj), name, {
                ...as,
                source: "cli",
                actor: "user",
              }),
            );
            return;
          }
          case "remove":
            need(1, "remove <模板名>");
            out(await removeStyle(args[0] ?? ""));
            return;
          default:
            throw new UsageError(`不认识的操作：${action}（可以用 list、save、use、remove）`);
        }
      },
    ),
  );

cli
  .command("comments <proj>", "审片批注：默认只列还没处理的")
  .option("--all", "包括已处理的")
  .option("--wait", "一直等到审片台上出现新批注再返回（AI 空闲时挂在后台用）")
  .option("--timeout <s>", "--wait 最多等几秒，超时返回空列表")
  .action(
    act(async (proj: string, o: { all?: boolean; wait?: boolean; timeout?: number }) => {
      const dir = resolveProjectDir(proj);
      if (o.wait) {
        const timeoutMs = o.timeout === undefined ? undefined : Number(o.timeout) * 1000;
        const comments = await waitForComments(dir, timeoutMs === undefined ? {} : { timeoutMs });
        out({ ok: true, comments });
        return;
      }
      out(await commentsInfo(dir, { all: o.all }));
    }),
  );

cli
  .command("comment <proj> <text>", "写一条批注")
  .option("--at <ms>", "时间线毫秒")
  .option("--target <id>", "指向的条目 ID")
  .option("--actor <name>", "操作者", { default: "user" })
  .action(
    act(async (proj: string, text: string, o: { at?: number; target?: string; actor: string }) => {
      out(
        await commentOnProject(
          resolveProjectDir(proj),
          {
            text: String(text),
            ...(o.at !== undefined ? { atMs: Number(o.at) } : {}),
            ...(o.target ? { target: String(o.target) } : {}),
          },
          { author: o.actor, source: "cli" },
        ),
      );
    }),
  );

cli
  .command("resolve <proj> <id>", "把批注标记为已处理")
  .option("--note <text>", "改了什么，或者为什么不改")
  .option("--reopen", "重新打开")
  .option("--actor <name>", "操作者", { default: "user" })
  .action(
    act(async (proj: string, id: string, o: { note?: string; reopen?: boolean; actor: string }) => {
      out(
        await setCommentOnProject(resolveProjectDir(proj), {
          id: String(id),
          status: o.reopen ? "open" : "resolved",
          note: o.note,
          author: o.actor,
        }),
      );
    }),
  );

cli
  .command("hook <event>", "给对话客户端用的 hook（目前只有 prompt）：把审片台的新批注附在消息后面")
  .action(async (event: string) => {
    // hook 出错不能挡住用户发消息：任何异常都当成没有批注，静默退出
    try {
      if (event !== "prompt") return;
      const context = await promptContext(await reviewTargets());
      if (context) process.stdout.write(`${JSON.stringify(hookOutput(context))}\n`);
    } catch (e) {
      log(`mw hook：${(e as Error)?.message ?? e}`);
    }
  });

cli.command("guide", "给 AI 的说明：操作、样式结构、模板、动画预设").action(
  act(async () => {
    out(guideInfo());
  }),
);

for (const direction of ["undo", "redo"] as const) {
  cli
    .command(`${direction} <proj>`, direction === "undo" ? "撤销上一次修改" : "重做刚才撤销的修改")
    .option("--base <rev>", "当前版本（必填，防止撤销掉别人刚做的修改）")
    .option("--actor <name>", "操作者", { default: "user" })
    .action(
      act(async (proj: string, o: { base?: number; actor: string }) => {
        if (o.base === undefined)
          throw new UsageError("缺少 --base <revision>，先用 mw inspect 查看当前 revision");
        out(
          await undoProject(resolveProjectDir(proj), {
            direction,
            baseRevision: Number(o.base),
            source: "cli",
            actor: o.actor,
          }),
        );
      }),
    );
}

cli
  .command("serve <proj>", "启动本地工作台（只监听 127.0.0.1）")
  .option("--port <n>", `端口（默认 ${API_PORT}）`)
  .action(
    act(async (proj: string, o: { port?: number }) => {
      const s = await startServer(resolveProjectDir(proj), {
        port: o.port === undefined ? API_PORT : Number(o.port),
        onLog: log,
      });
      const dir = resolveProjectDir(proj);
      await markServing(dir);
      out({ ok: true, url: s.url });
      // 一直运行，直到 Ctrl+C
      await new Promise<void>((done) => {
        const stop = () =>
          void s
            .close()
            .then(() => clearServing(dir))
            .then(done);
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
      });
    }),
  );

cli.command("mcp", "以 MCP stdio 服务运行（给 Codex、Claude Code 等 AI 应用接入）").action(
  act(async () => {
    await runMcpStdio();
  }),
);

cli.help();
cli.version("0.0.0");

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

try {
  // cac 会把单独的 "-" 当成缺少参数值，这里换成 --ops=- 的写法
  const argv = process.argv.flatMap((a, i, all) =>
    a === "-" && all[i - 1] === "--ops"
      ? []
      : a === "--ops" && all[i + 1] === "-"
        ? ["--ops=-"]
        : [a],
  );
  cli.parse(argv, { run: false });
  if (!cli.matchedCommand) {
    if (process.argv.length <= 2) cli.outputHelp();
    else throw new UsageError(`不认识的命令：${process.argv[2]}，用 mw --help 查看`);
  } else {
    await cli.runMatchedCommand();
  }
} catch (e) {
  fail(e);
}
