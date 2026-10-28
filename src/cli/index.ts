import { execFile } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import cac from "cac";
import { z } from "zod";
import { compile, type ResolvedTimeline } from "../core/compile";
import { MwError } from "../core/errors";
import { Op } from "../core/ops";
import { BUILTIN_STYLES } from "../core/presets";
import { SAFE_AREAS, type SafeAreaName, safeAreaFor } from "../core/safe-area";
import { AnimPresetName, TextStyle } from "../core/text-style";
import { msToFrame } from "../core/time";
import { validate } from "../core/validate";
import { PROJECT_FORMAT_VERSION } from "../core/version";
import { ASR_MODEL, alignCaptions, asrModelDir, fetchAsrModel, hasAsrModel } from "../node/asr";
import { importMedia } from "../node/media";
import { projectFiles, resolveProjectDir } from "../node/paths";
import { exportVideo, renderStills } from "../node/render";
import {
  applyToProject,
  emptyProject,
  initProject,
  listHistory,
  loadEditor,
  loadProject,
  readLog,
  revertProject,
  saveEditor,
} from "../node/store";
import { TEMPLATE_NAMES, TEMPLATES } from "../templates";

// mw：stdout 只输出 JSON（给 AI 解析），进度和日志写 stderr。
// 退出码（PLAN 7）：0 成功，1 校验失败，2 参数错误，3 版本冲突，4 媒体错误，5 渲染失败，6 轨道已锁定。

const run = promisify(execFile);
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

const templates = { templates: TEMPLATE_NAMES };

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
        const dir = resolveProjectDir(proj);
        const p = await loadProject(dir);
        const r = await importMedia(dir, resolve(file), {
          proxy: o.proxy,
          fps: p.canvas.fps,
          onLog: log,
        });
        const res = await applyToProject(dir, {
          ops: [{ op: "asset.add", ...(o.id ? { id: String(o.id) } : {}), asset: r.asset }],
          baseRevision: o.base ?? p.revision,
          source: "cli",
          actor: o.actor,
          ...templates,
        });
        out({ ...res, asset: res.changed[0], probe: r.probe, created: r.created });
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
      if (o.templates) {
        out(
          Object.values(TEMPLATES).map((t) => ({
            ...t.meta,
            props: z.toJSONSchema(t.schema, { io: "input" }),
          })),
        );
        return;
      }
      const p = await loadProject(resolveProjectDir(proj));
      if (o.timeline) return out(compile(p));
      if (o.tracks)
        return out(
          p.tracks.map((t) => ({
            id: t.id,
            name: t.name,
            kind: t.kind,
            main: t.kind === "video" ? t.main : undefined,
            locked: t.locked,
            hidden: t.hidden,
            muted: t.muted,
            items: t.items.length,
          })),
        );
      if (o.captions)
        return out(
          p.tracks
            .filter((t) => t.kind === "caption")
            .map((t) => ({ track: t.id, items: t.items })),
        );
      if (o.assets) return out(p.assets);
      if (o.styles) return out(p.styles);
      out(p);
    }),
  );

cli.command("validate <proj>", "校验工程（错误 + 警告）").action(
  act(async (proj: string) => {
    const raw = JSON.parse(await readFile(projectFiles(resolveProjectDir(proj)).project, "utf8"));
    const v = validate(raw, templates);
    out({ ok: v.ok, errors: v.errors, warnings: v.warnings });
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
        const dir = resolveProjectDir(proj);
        const p = await loadProject(dir);
        const ids = o.captions ? String(o.captions).split(",").filter(Boolean) : undefined;
        const { ops, report } = await alignCaptions(dir, p, { ids, onLog: log });
        const r = await applyToProject(dir, {
          ops,
          baseRevision: o.base === undefined ? p.revision : Number(o.base),
          source: "cli",
          actor: o.actor,
          dryRun: Boolean(o.dryRun),
          ...templates,
        });
        // 对得不好的句子单独列出来，方便人工检查（多半是字幕和实际念的不一致）
        out({ ...r, aligned: report.length, check: report.filter((x) => x.match < 0.8) });
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
  .option("--at <ms|id>", "毫秒，或者条目 ID（取它显示时间的中间）")
  .option("--frame <n>", "帧号")
  .option("--sheet [n]", "均匀截 n 帧拼成网格图（默认 12）")
  .option("--safe-area [preset]", "叠加安全区（all/douyin/channels/xiaohongshu）")
  .option("--guides", "叠加 editor.json 里的参考线")
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
        const dir = resolveProjectDir(proj);
        const p = await loadProject(dir);
        const tl = compile(p);
        const stills = projectFiles(dir).stills;
        let frames: number[];
        if (o.sheet !== undefined && o.sheet !== false) {
          const n = typeof o.sheet === "number" && o.sheet > 0 ? o.sheet : 12;
          frames = Array.from({ length: n }, (_, i) =>
            Math.round(((i + 0.5) * tl.durationInFrames) / n),
          );
        } else if (o.frame !== undefined) {
          frames = [Number(o.frame)];
        } else if (o.at !== undefined) {
          frames = [frameAt(tl, String(o.at))];
        } else {
          throw new UsageError("需要 --at、--frame 或 --sheet 之一");
        }
        const tmp = join(stills, `tmp-${process.pid}`);
        const pngs = await renderStills(dir, p, frames, tmp, log);
        const editor = await loadEditor(dir);
        const overlays = overlayFilters(tl, {
          safeArea:
            o.safeArea === undefined || o.safeArea === false
              ? null
              : typeof o.safeArea === "string" && o.safeArea !== ""
                ? o.safeArea
                : "all",
          guides: o.guides ? editor.guides.items : [],
        });
        const outFile =
          o.out !== undefined
            ? resolve(o.out)
            : join(
                stills,
                o.sheet !== undefined
                  ? `sheet-r${p.revision}.png`
                  : `frame-${frames[0]}-r${p.revision}.png`,
              );
        await mkdir(dirname(outFile), { recursive: true });
        if (frames.length === 1) {
          await ffmpeg(["-i", pngs[0] ?? "", ...(overlays ? ["-vf", overlays] : []), outFile]);
        } else {
          const cols = 4;
          const rows = Math.ceil(frames.length / cols);
          const vf = [overlays, "scale=270:-1", `tile=${cols}x${rows}:padding=6:color=white`]
            .filter(Boolean)
            .join(",");
          await ffmpeg(
            [
              "-framerate",
              "1",
              "-pattern_type",
              "sequence",
              "-i",
              "%d.png",
              "-vf",
              vf,
              "-frames:v",
              "1",
              outFile,
            ],
            tmp,
            pngs,
          );
        }
        await rm(tmp, { recursive: true, force: true });
        out({
          ok: true,
          revision: p.revision,
          file: outFile,
          frames: frames.map((f) => ({ frame: f, ms: Math.round((f * 1000) / tl.fps) })),
          warnings: tl.warnings,
        });
      },
    ),
  );

cli
  .command("export <proj>", "导出 MP4")
  .option("--out <file>", "输出文件（默认 renders/<工程名>-r<revision>.mp4）")
  .option("--concurrency <n>", "并发数（默认 CPU 核数的一半）")
  .action(
    act(async (proj: string, o: { out?: string; concurrency?: number }) => {
      const dir = resolveProjectDir(proj);
      const p = await loadProject(dir);
      const v = validate(p, templates);
      if (!v.ok)
        throw new MwError("VALIDATION", "工程校验没有通过，不能导出", { issues: v.errors });
      const file = o.out
        ? resolve(o.out)
        : join(projectFiles(dir).renders, `${basename(dir, ".mwproj")}-r${p.revision}.mp4`);
      const t0 = Date.now();
      let last = -1;
      const r = await exportVideo(dir, p, {
        out: file,
        concurrency: o.concurrency ? Number(o.concurrency) : undefined,
        onLog: log,
        onProgress: ({ progress }) => {
          const pct = Math.floor(progress * 100);
          if (pct >= last + 10) {
            last = pct;
            log(`导出 ${pct}%`);
          }
        },
      });
      out({
        ok: true,
        revision: p.revision,
        file: r.out,
        frames: r.frames,
        seconds: (Date.now() - t0) / 1000,
        warnings: v.warnings,
      });
    }),
  );

cli
  .command("cover <proj>", "导出封面（cover.atMs 那一帧，没有设置时取第 1 秒）")
  .option("--out <file>", "输出 PNG")
  .action(
    act(async (proj: string, o: { out?: string }) => {
      const dir = resolveProjectDir(proj);
      const p = await loadProject(dir);
      const tl = compile(p);
      const frame = msToFrame(p.cover?.atMs ?? 1000, tl.fps);
      const file = o.out
        ? resolve(o.out)
        : join(projectFiles(dir).renders, `${basename(dir, ".mwproj")}-cover-r${p.revision}.png`);
      const tmp = join(projectFiles(dir).stills, `cover-${process.pid}`);
      const [png] = await renderStills(dir, p, [frame], tmp, log);
      await mkdir(dirname(file), { recursive: true });
      await ffmpeg(["-i", png ?? "", file]);
      await rm(tmp, { recursive: true, force: true });
      out({ ok: true, revision: p.revision, file, frame });
    }),
  );

cli.command("history <proj>", "修改记录和可以回退的版本").action(
  act(async (proj: string) => {
    const dir = resolveProjectDir(proj);
    const logs = await readLog(dir);
    out({
      revisions: await listHistory(dir),
      log: logs.map((l) => ({
        revision: l.revision,
        at: l.at,
        kind: l.kind,
        source: l.source,
        actor: l.actor,
        ops: l.ops?.map((o) => (o as { op: string }).op),
        revertTo: l.revertTo,
        changed: l.changed,
      })),
    });
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

cli.command("guide", "给 AI 的说明：操作、样式结构、模板、动画预设").action(
  act(async () => {
    out({
      formatVersion: PROJECT_FORMAT_VERSION,
      rules: [
        "先 mw inspect 拿到 revision，再 mw apply --base <revision> 提交；CONFLICT 时重新 inspect",
        "一批操作要么全部生效，要么全部不生效；锁定的轨道（locked）不能修改，会返回 TRACK_LOCKED",
        "时间单位一律是整数毫秒。字幕绑定素材源时间；叠加层优先用 at: { caption: <字幕ID> } 锚定",
        "提交后用 mw validate、mw preview --sheet 自查，只修一轮；修的时候不要改动已经确定的时长",
        "字段名拼错会返回 UNKNOWN_FIELD，不会被悄悄忽略",
      ],
      ops: z.toJSONSchema(Op, { io: "input" }),
      textStyle: z.toJSONSchema(TextStyle, { io: "input" }),
      animationPresets: AnimPresetName.options,
      templates: Object.values(TEMPLATES).map((t) => t.meta),
      builtinStyles: Object.keys(BUILTIN_STYLES),
      safeAreas: SAFE_AREAS,
    });
  }),
);

cli.help();
cli.version("0.0.0");

function frameAt(tl: ResolvedTimeline, at: string): number {
  if (/^\d+$/.test(at)) return msToFrame(Number(at), tl.fps);
  const items = [...tl.videos, ...tl.images, ...tl.captions, ...tl.overlays];
  const hit = items.find((i) => i.id === at);
  if (!hit) throw new UsageError(`找不到「${at}」：--at 需要毫秒数，或者片段 / 字幕 / 叠加层的 ID`);
  // 取显示时间的 80% 处：逐字出现的字幕这时已经出全
  return hit.from + Math.floor(hit.durationInFrames * 0.8);
}

function overlayFilters(
  tl: ResolvedTimeline,
  o: { safeArea: string | null; guides: { axis: "h" | "v"; pos: number }[] },
): string {
  const f: string[] = [];
  if (o.safeArea) {
    if (!(o.safeArea in SAFE_AREAS)) throw new UsageError(`没有这个安全区预设：${o.safeArea}`);
    const s = safeAreaFor(o.safeArea as SafeAreaName, tl.width, tl.height);
    const w = tl.width - s.left - s.right;
    const h = tl.height - s.top - s.bottom;
    f.push(`drawbox=x=${s.left}:y=${s.top}:w=${w}:h=${h}:color=red@0.8:t=4`);
  }
  for (const g of o.guides) {
    f.push(
      g.axis === "h"
        ? `drawbox=x=0:y=${g.pos - 1}:w=${tl.width}:h=2:color=cyan@0.9:t=fill`
        : `drawbox=x=${g.pos - 1}:y=0:w=2:h=${tl.height}:color=cyan@0.9:t=fill`,
    );
  }
  return f.join(",");
}

async function ffmpeg(args: string[], cwd?: string, inputs?: string[]): Promise<void> {
  const bin = process.env.MW_FFMPEG ?? "ffmpeg";
  if (cwd && inputs) {
    // 网格图：把截图按顺序链接成 1.png、2.png……
    const { symlink } = await import("node:fs/promises");
    await Promise.all(inputs.map((p, i) => symlink(p, join(cwd, `${i + 1}.png`))));
    args = args.map((a) => (a === "%d.png" ? join(cwd, "%d.png") : a));
    args.splice(args.indexOf("-pattern_type"), 0, "-start_number", "1");
  }
  try {
    await run(bin, ["-v", "error", "-y", ...args]);
  } catch (e) {
    throw new MwError("MEDIA", "ffmpeg 处理截图失败", {
      hint: String((e as Error).message).slice(0, 500),
    });
  }
}

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
