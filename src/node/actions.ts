import { execFile } from "node:child_process";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { compile, type ResolvedTimeline } from "../core/compile";
import { MwError } from "../core/errors";
import { lintProject } from "../core/lint";
import { Op } from "../core/ops";
import { BUILTIN_STYLES } from "../core/presets";
import { SAFE_AREAS, type SafeAreaName, safeAreaFor } from "../core/safe-area";
import type { Caption, MainClip } from "../core/schema";
import { AnimPresetName, TextStyle } from "../core/text-style";
import { msToFrame } from "../core/time";
import { validate } from "../core/validate";
import { PROJECT_FORMAT_VERSION } from "../core/version";
import { TEMPLATE_NAMES, TEMPLATES } from "../templates";
import { alignCaptions } from "./asr";
import { detectFaces, readFaces } from "./faces";
import { importMedia } from "./media";
import { projectFiles } from "./paths";
import { exportVideo, renderStills } from "./render";
import {
  applyToProject,
  listHistory,
  loadEditor,
  loadProject,
  loadReview,
  readHistory,
  type Source,
} from "./store";

// CLI、MCP、本地服务共用的操作（AGENTS.md 第 2 节：三个外壳只做参数解析和输出格式）。

const run = promisify(execFile);
export const templateOpts = { templates: TEMPLATE_NAMES };

export type Actor = { source: Source; actor: string };

/** 导入素材：probe、必要时转标准化文件和代理，然后提交 asset.add */
export async function importAsset(
  dir: string,
  file: string,
  o: Actor & { id?: string; baseRevision?: number; proxy?: boolean; onLog?: (s: string) => void },
) {
  const p = await loadProject(dir);
  const r = await importMedia(dir, resolve(file), {
    proxy: o.proxy ?? true,
    fps: p.canvas.fps,
    onLog: o.onLog,
  });
  const res = await applyToProject(dir, {
    ops: [{ op: "asset.add", ...(o.id ? { id: o.id } : {}), asset: r.asset }],
    baseRevision: o.baseRevision ?? p.revision,
    source: o.source,
    actor: o.actor,
    ...templateOpts,
  });
  return {
    ...res,
    asset: res.changed[0],
    probe: r.probe,
    created: r.created,
    ...(r.subtitleCheck
      ? {
          subtitleCheck: r.subtitleCheck,
          checkHint: "看一眼 subtitleCheck 图片：原片如果已经烧录了字幕，新字幕会和它重影",
        }
      : {}),
  };
}

/** 质检（docs/decisions/0007）：字号、安全区、字幕行数、遮挡、挡脸。都是警告，不阻止导出 */
export async function lintDir(dir: string) {
  const p = await loadProject(dir);
  const faces: Record<string, NonNullable<Awaited<ReturnType<typeof readFaces>>>> = {};
  for (const [id, a] of Object.entries(p.assets)) {
    const f = a.cache?.faces ? await readFaces(join(dir, a.cache.faces)) : null;
    if (f) faces[id] = f;
  }
  const issues = lintProject(p, {
    styles: { ...BUILTIN_STYLES, ...p.styles },
    faces,
    overlayBounds: (o, style) => {
      const tpl = TEMPLATES[o.template];
      const props = tpl?.schema.safeParse(o.props);
      if (!tpl?.bounds || !props?.success) return { text: [], shapes: [] };
      return tpl.bounds(props.data, style, p.canvas.width, p.canvas.height);
    },
  });
  const videos = Object.entries(p.assets).filter(([, a]) => a.kind === "video");
  return {
    ok: true as const,
    revision: p.revision,
    issues,
    // 没有人脸数据的视频素材：挡脸检查没有覆盖到
    noFaceData: videos.filter(([id]) => !faces[id]).map(([id]) => id),
  };
}

/** 给还没有人脸数据的视频素材补做检测（只在 macOS 上可用） */
export async function facesProject(dir: string, o: Actor & { onLog?: (s: string) => void }) {
  const p = await loadProject(dir);
  const media = projectFiles(dir).media;
  const ops: Op[] = [];
  const skipped: string[] = [];
  for (const [id, a] of Object.entries(p.assets)) {
    if (a.kind !== "video" || a.cache?.faces) continue;
    o.onLog?.(`检测人脸：${id}`);
    const track = await detectFaces(a.cache?.proxy ? join(dir, a.cache.proxy) : a.path, media);
    if (!track) {
      skipped.push(id);
      continue;
    }
    const file = join(media, `${a.fingerprint ?? id}.faces.json`);
    await mkdir(media, { recursive: true });
    await writeFile(file, JSON.stringify(track));
    ops.push({ op: "asset.cache", id, set: { faces: relative(dir, file) } });
  }
  if (ops.length === 0) return { ok: true as const, revision: p.revision, detected: [], skipped };
  const r = await applyToProject(dir, {
    ops,
    baseRevision: p.revision,
    source: o.source,
    actor: o.actor,
    ...templateOpts,
  });
  return { ...r, detected: ops.map((x) => (x as { id: string }).id), skipped };
}

/**
 * 恢复剪辑点（docs/decisions/0016）：主轨片段 clip 前面剪掉的源时间接回来；
 * 落在这段时间里、随删句一起删掉的字幕从历史里找回（连逐字时间、高亮），放回原来的轨道。
 * 一次提交，撤销也是一次。
 */
export async function restoreCut(
  dir: string,
  clip: string,
  o: Actor & { baseRevision?: number; dryRun?: boolean },
) {
  const p = await loadProject(dir);
  const main = p.tracks.find((t) => t.kind === "video" && t.main);
  const items = (main?.items ?? []) as MainClip[];
  const k = items.findIndex((i) => i.id === clip);
  const cur = items[k];
  const prev = items[k - 1];
  if (!cur || !prev || cur.type !== "clip" || prev.type !== "clip" || prev.asset !== cur.asset) {
    throw new MwError("INVALID_OP", `「${clip}」前面不是剪辑点，没有可以恢复的内容`);
  }
  const asset = cur.asset;
  const [from, to] = [prev.outMs, cur.inMs];

  // 从新到旧翻历史，找这段源时间里现在已经不在的字幕；同一句取最新的版本
  const present = new Set(p.tracks.flatMap((t) => t.items.map((i) => i.id)));
  const found = new Map<string, { track: string; caption: Caption }>();
  for (const rev of (await listHistory(dir)).reverse()) {
    if (rev >= p.revision) continue;
    const old = await readHistory(dir, rev).catch(() => null);
    for (const t of old?.tracks ?? []) {
      if (t.kind !== "caption") continue;
      for (const c of t.items) {
        if (c.asset !== asset || c.endMs <= from || c.startMs >= to) continue;
        if (present.has(c.id) || found.has(c.id)) continue;
        found.set(c.id, { track: t.id, caption: c });
      }
    }
  }
  // 放回时不能和现有字幕重叠（比如后来又合并、改过时间）；重叠的不放回，告诉调用方
  const skipped: string[] = [];
  const captionOps: Op[] = [];
  const restored: string[] = [];
  for (const { track, caption } of [...found.values()].sort(
    (a, b) => a.caption.startMs - b.caption.startMs,
  )) {
    const t = p.tracks.find((x) => x.id === track && x.kind === "caption");
    const clash = t?.items.some(
      (c) =>
        "startMs" in c &&
        c.asset === asset &&
        c.startMs < caption.endMs &&
        c.endMs > caption.startMs,
    );
    if (!t || clash) {
      skipped.push(caption.id);
      continue;
    }
    const index = t.items.filter((c) => "startMs" in c && c.startMs < caption.startMs).length;
    captionOps.push({ op: "item.add", track, item: caption, index });
    restored.push(caption.id);
  }
  // item.add 的 index 是插入时的位置：按开始时间从后往前插，前面的位置不受影响
  captionOps.reverse();

  const r = await applyToProject(dir, {
    ops: [{ op: "cut.restore", clip }, ...captionOps],
    baseRevision: o.baseRevision ?? p.revision,
    source: o.source,
    actor: o.actor,
    dryRun: Boolean(o.dryRun),
    ...templateOpts,
  });
  return {
    ...r,
    restoredMs: [from, to],
    captions: restored,
    skipped,
  };
}

/** 识音对齐，作为一次 caption.update 提交；匹配率低的句子列在 check 里让人检查 */
export async function alignProject(
  dir: string,
  o: Actor & {
    ids?: string[];
    baseRevision?: number;
    dryRun?: boolean;
    onLog?: (s: string) => void;
  },
) {
  const p = await loadProject(dir);
  const { ops, report } = await alignCaptions(dir, p, { ids: o.ids, onLog: o.onLog });
  const r = await applyToProject(dir, {
    ops,
    baseRevision: o.baseRevision ?? p.revision,
    source: o.source,
    actor: o.actor,
    dryRun: Boolean(o.dryRun),
    ...templateOpts,
  });
  return {
    ...r,
    aligned: report.length,
    check: report.filter((x) => x.match < 0.8),
    // 真正开口比字幕早、开始时间往前挪过的句子
    moved: report.filter((x) => x.startMovedMs > 0).map((x) => ({ id: x.id, ms: x.startMovedMs })),
  };
}

export type InspectView = "all" | "tracks" | "captions" | "assets" | "styles" | "timeline";

export async function inspectProject(dir: string, view: InspectView = "all"): Promise<unknown> {
  const p = await loadProject(dir);
  switch (view) {
    case "timeline":
      return compile(p);
    case "tracks":
      return p.tracks.map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind,
        main: t.kind === "video" ? t.main : undefined,
        locked: t.locked,
        hidden: t.hidden,
        muted: t.muted,
        items: t.items.length,
      }));
    case "captions":
      return p.tracks
        .filter((t) => t.kind === "caption")
        .map((t) => ({ track: t.id, items: t.items }));
    case "assets":
      return p.assets;
    case "styles":
      return p.styles;
    default:
      return p;
  }
}

export function templatesInfo(): unknown {
  return Object.values(TEMPLATES).map((t) => ({
    ...t.meta,
    props: z.toJSONSchema(t.schema, { io: "input" }),
  }));
}

/** 直接校验 project.json 原文（不经过加载时的解析），能看到全部错误 */
export async function validateDir(dir: string) {
  const raw = JSON.parse(await readFile(projectFiles(dir).project, "utf8"));
  const v = validate(raw, templateOpts);
  return { ok: v.ok, errors: v.errors, warnings: v.warnings };
}

export type PreviewOptions = {
  /** 毫秒，或者条目 ID（取它显示时间的 80% 处） */
  at?: string;
  frame?: number;
  /** 均匀截 n 帧拼成网格图 */
  sheet?: number;
  safeArea?: string | null;
  guides?: boolean;
  out?: string;
  onLog?: (s: string) => void;
};

export async function previewProject(dir: string, o: PreviewOptions) {
  const p = await loadProject(dir);
  const tl = compile(p);
  const stills = projectFiles(dir).stills;
  let frames: number[];
  if (o.sheet !== undefined) {
    const n = o.sheet > 0 ? o.sheet : 12;
    frames = Array.from({ length: n }, (_, i) => Math.round(((i + 0.5) * tl.durationInFrames) / n));
  } else if (o.frame !== undefined) {
    frames = [Number(o.frame)];
  } else if (o.at !== undefined) {
    frames = [frameAt(tl, String(o.at))];
  } else {
    throw new MwError("USAGE", "需要 at、frame 或 sheet 之一");
  }
  const tmp = join(stills, `tmp-${process.pid}-${Date.now()}`);
  const pngs = await renderStills(dir, p, frames, tmp, o.onLog);
  const editor = await loadEditor(dir);
  const overlays = overlayFilters(tl, {
    safeArea: o.safeArea ?? null,
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
  try {
    if (frames.length === 1) {
      await ffmpeg(["-i", pngs[0] ?? "", ...(overlays ? ["-vf", overlays] : []), outFile]);
    } else {
      const cols = 4;
      const rows = Math.ceil(frames.length / cols);
      const vf = [overlays, "scale=270:-1", `tile=${cols}x${rows}:padding=6:color=white`]
        .filter(Boolean)
        .join(",");
      // 网格图：把截图按顺序链接成 1.png、2.png……
      await Promise.all(pngs.map((png, i) => symlink(png, join(tmp, `${i + 1}.png`))));
      await ffmpeg([
        ...["-framerate", "1", "-start_number", "1", "-pattern_type", "sequence"],
        ...["-i", join(tmp, "%d.png"), "-vf", vf, "-frames:v", "1", outFile],
      ]);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  return {
    ok: true as const,
    revision: p.revision,
    file: outFile,
    frames: frames.map((f) => ({ frame: f, ms: Math.round((f * 1000) / tl.fps) })),
    warnings: tl.warnings,
  };
}

export type ExportOptions = {
  out?: string;
  concurrency?: number;
  onLog?: (s: string) => void;
  onProgress?: (p: { progress: number; renderedFrames: number }) => void;
};

export async function exportProject(dir: string, o: ExportOptions = {}) {
  const p = await loadProject(dir);
  const v = validate(p, templateOpts);
  if (!v.ok) throw new MwError("VALIDATION", "工程校验没有通过，不能导出", { issues: v.errors });
  const file = o.out
    ? resolve(o.out)
    : join(projectFiles(dir).renders, `${basename(dir, ".mwproj")}-r${p.revision}.mp4`);
  const t0 = Date.now();
  const r = await exportVideo(dir, p, {
    out: file,
    concurrency: o.concurrency,
    onLog: o.onLog,
    onProgress: o.onProgress,
  });
  return {
    ok: true as const,
    revision: p.revision,
    file: r.out,
    frames: r.frames,
    seconds: (Date.now() - t0) / 1000,
    warnings: v.warnings,
  };
}

export async function coverProject(
  dir: string,
  o: { out?: string; onLog?: (s: string) => void } = {},
) {
  const p = await loadProject(dir);
  const tl = compile(p);
  const frame = msToFrame(p.cover?.atMs ?? 1000, tl.fps);
  const file = o.out
    ? resolve(o.out)
    : join(projectFiles(dir).renders, `${basename(dir, ".mwproj")}-cover-r${p.revision}.png`);
  const tmp = join(projectFiles(dir).stills, `cover-${process.pid}-${Date.now()}`);
  try {
    const [png] = await renderStills(dir, p, [frame], tmp, o.onLog);
    await mkdir(dirname(file), { recursive: true });
    await ffmpeg(["-i", png ?? "", file]);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  return { ok: true as const, revision: p.revision, file, frame };
}

/** 审片批注：默认只列还没处理的 */
export async function commentsInfo(dir: string, o: { all?: boolean } = {}) {
  const [p, r] = await Promise.all([loadProject(dir), loadReview(dir)]);
  const comments = o.all ? r.comments : r.comments.filter((c) => c.status === "open");
  return {
    ok: true as const,
    revision: p.revision,
    open: r.comments.filter((c) => c.status === "open").length,
    comments,
  };
}

/** 给 AI 的说明：规则、操作和样式的 JSON Schema、模板、动画预设 */
export function guideInfo() {
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    rules: [
      "先 inspect 拿到 revision，再 apply 并带上这个 baseRevision；CONFLICT 时重新 inspect",
      "一批操作要么全部生效，要么全部不生效；锁定的轨道（locked）不能修改，会返回 TRACK_LOCKED",
      "时间单位一律是整数毫秒。字幕绑定素材源时间；叠加层优先用 at: { caption: <字幕ID> } 锚定",
      "提交后用 validate、preview（sheet）自查，只修一轮；修的时候不要改动已经确定的时长",
      "字段名拼错会返回 UNKNOWN_FIELD，不会被悄悄忽略",
      "逐字节奏默认用剪映的前快后慢（stagger: { fraction: 0.75 } + inSlot），不看语音；要严格跟着念的速度出字时改用 spread 并跑 align，改了字幕文字后需要重新 align",
      "加标题、卡片之前先列方案（哪句话 → 加什么画面 → 用哪个模板 → 什么时间），给用户确认后再 apply",
      "删句（cut.removeCaptions）之前先跑 align：它会把字幕开始时间挪到真正开口的地方，否则下一句的第一个字可能被剪掉一半",
      "剪错了用 uncut 恢复那一刀（片段 ID 是剪辑点后面那段），字幕会从历史里找回；不要整体 undo，会把后面的修改一起撤掉",
      "粗剪时在主轨片段的 cutBefore 写上前面剪掉的是什么（口误、重复、停顿，16 字以内），审片台会标在时间线上",
      "按内容分好章节（chapters.set，每章锚到开头那句字幕，标题 12 字以内），审片台的属性页显示章节目录",
      "需要在说到某个词时出现的元素，用 at: { caption: <字幕ID>, char: <第几个字> } 锚定，而不是估算毫秒",
      "开始工作前先看 comments：人在审片台上留的批注（带时间点和条目 ID），逐条处理后用 resolve 标记并写明改了什么；不打算改的也 resolve，在 note 里说明原因",
      "用户说「等我批注」或手头没活时，在后台跑 mw comments <工程> --wait：审片台上一有新批注就返回，处理完再挂上继续等",
      "样式模板库：先用 styles（list）看有哪些现成样式，用 use 复制进工程再引用；用户说「存成模板」「以后都用这个」时用 save 存进库，写一句 description 说明适合什么内容",
      "文字装饰（格式 v5）：gradient 竖直渐变、glow 发光；highlight.underline 给关键词画下划线，highlight.activeBox 给正在念的字 / 词垫色块（跟着 animation.unit），highlight.gradient / glow 只作用于高亮的字。改完用 preview 截两三帧看效果",
      "提交后跑 lint：字太小、出安全区、字幕放不下、互相遮挡、挡脸；导入新视频时看一眼 subtitleCheck，原片已有字幕会重影",
    ],
    ops: z.toJSONSchema(Op, { io: "input" }),
    textStyle: z.toJSONSchema(TextStyle, { io: "input" }),
    animationPresets: AnimPresetName.options,
    templates: Object.values(TEMPLATES).map((t) => t.meta),
    builtinStyles: Object.keys(BUILTIN_STYLES),
    safeAreas: SAFE_AREAS,
  };
}

function frameAt(tl: ResolvedTimeline, at: string): number {
  if (/^\d+$/.test(at)) return msToFrame(Number(at), tl.fps);
  const items = [...tl.videos, ...tl.images, ...tl.captions, ...tl.overlays];
  const hit = items.find((i) => i.id === at);
  if (!hit)
    throw new MwError("USAGE", `找不到「${at}」：at 需要毫秒数，或者片段 / 字幕 / 叠加层的 ID`);
  // 取显示时间的 80% 处：逐字出现的字幕这时已经出全
  return hit.from + Math.floor(hit.durationInFrames * 0.8);
}

function overlayFilters(
  tl: ResolvedTimeline,
  o: { safeArea: string | null; guides: { axis: "h" | "v"; pos: number }[] },
): string {
  const f: string[] = [];
  if (o.safeArea) {
    if (!(o.safeArea in SAFE_AREAS))
      throw new MwError("USAGE", `没有这个安全区预设：${o.safeArea}`);
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

async function ffmpeg(args: string[]): Promise<void> {
  const bin = process.env.MW_FFMPEG ?? "ffmpeg";
  try {
    await run(bin, ["-v", "error", "-y", ...args]);
  } catch (e) {
    throw new MwError("MEDIA", "ffmpeg 处理截图失败", {
      hint: String((e as Error).message).slice(0, 500),
    });
  }
}
