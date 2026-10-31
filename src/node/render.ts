import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import type { MainProps } from "../composition/Main";
import { compile, type ResolvedTimeline } from "../core/compile";
import { MwError } from "../core/errors";
import { facesFor } from "../core/fonts";
import { BUILTIN_STYLES } from "../core/presets";
import type { Project } from "../core/schema";
import type { TextStyle } from "../core/text-style";
import { overlayAssets, TEMPLATES } from "../templates";
import { resolveFaces } from "./fonts";
import { type MediaServer, startMediaServer } from "./media-server";

// 渲染（PLAN 9）：compile → 准备 props（媒体 URL、字体）→ Remotion 渲染。
// 预览截图和导出用同一个合成组件、同一份 props，保证一致。

const REPO = resolve(import.meta.dirname, "..", "..");
const ENTRY = join(REPO, "src", "composition", "index.ts");
const BUNDLE_CACHE = join(REPO, ".remotion", "bundles");

/** 合成组件依赖的源码目录：内容变了才重新打包 */
const BUNDLE_INPUTS = ["src/core", "src/composition", "src/templates"];

async function hashSources(): Promise<string> {
  const h = createHash("sha256");
  const pkg = JSON.parse(await readFile(join(REPO, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  h.update(JSON.stringify(pkg.dependencies));
  const walk = async (d: string): Promise<void> => {
    const entries = (await readdir(d, { withFileTypes: true })).toSorted((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        h.update(p.slice(REPO.length));
        h.update(await readFile(p));
      }
    }
  };
  for (const d of BUNDLE_INPUTS) await walk(join(REPO, d));
  return h.digest("hex").slice(0, 16);
}

/** 打包合成组件。源码没变时复用上一次的结果（打包要 5–10 秒） */
export async function getBundle(onLog?: (s: string) => void): Promise<string> {
  const key = await hashSources();
  const out = join(BUNDLE_CACHE, key);
  if (existsSync(join(out, "index.html"))) return out;
  onLog?.("打包合成组件……");
  const tmp = `${out}.tmp-${process.pid}`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(BUNDLE_CACHE, { recursive: true });
  await bundle({ entryPoint: ENTRY, outDir: tmp });
  await rm(out, { recursive: true, force: true });
  await rename(tmp, out);
  // 只留最新一份：每份约 35MB，源码每改一次就多一份。别的进程正在打的包（.tmp-）不动
  for (const name of await readdir(BUNDLE_CACHE)) {
    if (name !== key && !name.includes(".tmp-"))
      await rm(join(BUNDLE_CACHE, name), { recursive: true, force: true });
  }
  return out;
}

export type PreparedRender = {
  props: MainProps;
  timeline: ResolvedTimeline;
  server: MediaServer;
};

/**
 * 把用到的素材和字体换成 URL，生成合成组件的参数。
 * 导出用标准化文件（mez）；网页预览用 540p 代理文件（proxy），没有时退回 mez、原文件。
 */
export async function buildProps(
  dir: string,
  project: Project,
  register: (absPath: string) => string,
  variant: "mez" | "proxy" = "mez",
): Promise<{ props: MainProps; timeline: ResolvedTimeline }> {
  const timeline = compile(project);
  const srcs: Record<string, string> = {};
  const used = new Set<string>([
    ...timeline.videos.map((v) => v.asset),
    ...timeline.images.map((i) => i.asset),
    ...(timeline.outro ? [timeline.outro.asset] : []),
    ...timeline.overlays.flatMap((o) => overlayAssets(o)),
  ]);
  for (const id of used) {
    const a = project.assets[id];
    if (!a) throw new MwError("REF_MISSING", `素材「${id}」不存在`);
    const cached = variant === "proxy" ? (a.cache?.proxy ?? a.cache?.mez) : a.cache?.mez;
    // 已经是标准格式的素材没有 mez，直接用原文件
    const file = cached ? join(dir, cached) : a.path;
    const abs = isAbsolute(file) ? file : resolve(dir, file);
    if (!existsSync(abs)) {
      throw new MwError("MEDIA", `素材文件不存在：${abs}`, {
        hint: "用 asset.relink 指向新的位置，或重新导入素材",
      });
    }
    srcs[id] = register(abs);
  }

  // 字体：只加载实际用到的样式（没写样式的字幕 / 叠加层用内置默认样式）
  const styles: Record<string, TextStyle> = { ...BUILTIN_STYLES, ...project.styles };
  const usedStyles = new Set<string>([
    ...timeline.captions.map((c) => c.style ?? "caption-word-yellow"),
    ...timeline.overlays.map(
      (o) => o.style ?? TEMPLATES[o.template]?.meta.defaultStyle ?? "title-bar-yellow",
    ),
  ]);
  const faces = new Map<string, ReturnType<typeof facesFor>[number]>();
  for (const id of usedStyles) {
    const st = styles[id];
    if (st) for (const f of facesFor(st)) faces.set(`${f.id}|${f.weight}`, f);
  }
  const fonts = resolveFaces([...faces.values()]).map((f) => ({
    css: f.css,
    weight: f.weight,
    url: register(f.path),
  }));

  // 模板参数在这里先校验，出错时给出结构化错误，而不是渲染到一半才失败
  for (const o of timeline.overlays) {
    const tpl = TEMPLATES[o.template];
    if (!tpl) throw new MwError("REF_MISSING", `模板「${o.template}」不存在`);
    const r = tpl.schema.safeParse(o.props);
    if (!r.success) {
      throw new MwError("VALIDATION", `叠加层「${o.id}」的模板参数不对`, {
        issues: r.error.issues.map((i) => ({
          code: "VALIDATION",
          path: `${o.id}.props.${i.path.join(".")}`,
          message: i.message,
        })),
      });
    }
    if (o.size && !tpl.meta.sizes.includes(o.size)) {
      throw new MwError("VALIDATION", `模板「${o.template}」没有 ${o.size} 尺寸`, {
        hint:
          tpl.meta.sizes.length > 0
            ? `可用尺寸：${tpl.meta.sizes.join(" / ")}`
            : "它不是卡片，去掉 size",
      });
    }
  }
  return { props: { timeline, styles: project.styles, srcs, fonts }, timeline };
}

/** 准备渲染输入：起一个临时媒体服务，把用到的素材和字体换成 URL */
export async function prepare(dir: string, project: Project): Promise<PreparedRender> {
  const server = await startMediaServer(null);
  try {
    const { props, timeline } = await buildProps(dir, project, (abs) => server.register(abs));
    return { props, timeline, server };
  } catch (e) {
    await server.close();
    throw e;
  }
}

function renderError(e: unknown): never {
  if (e instanceof MwError) throw e;
  throw new MwError("RENDER", "渲染失败", {
    hint: String((e as Error)?.message ?? e).slice(0, 800),
  });
}

export type ExportOptions = {
  out: string;
  concurrency?: number;
  onProgress?: (p: { progress: number; renderedFrames: number }) => void;
  onLog?: (s: string) => void;
};

export async function exportVideo(
  dir: string,
  project: Project,
  opts: ExportOptions,
): Promise<{ out: string; frames: number }> {
  const serveUrl = await getBundle(opts.onLog);
  const { props, timeline, server } = await prepare(dir, project);
  try {
    const inputProps = props as unknown as Record<string, unknown>;
    const composition = await selectComposition({ serveUrl, id: "Main", inputProps });
    await mkdir(dirname(opts.out), { recursive: true });
    const tmp = `${opts.out}.part.mp4`;
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      codec: "h264",
      crf: 18,
      pixelFormat: "yuv420p",
      colorSpace: "bt709",
      audioCodec: "aac",
      audioBitrate: "192k",
      outputLocation: tmp,
      concurrency: opts.concurrency ?? Math.max(1, Math.floor(availableParallelism() / 2)),
      onProgress: ({ progress, renderedFrames }) => opts.onProgress?.({ progress, renderedFrames }),
    });
    await rename(tmp, opts.out);
    return { out: opts.out, frames: timeline.durationInFrames };
  } catch (e) {
    await rm(`${opts.out}.part.mp4`, { force: true });
    renderError(e);
  } finally {
    await server.close();
  }
}

/** 渲染若干帧的截图（PNG）。帧号超出范围时截到最后一帧 */
export async function renderStills(
  dir: string,
  project: Project,
  frames: number[],
  outDir: string,
  onLog?: (s: string) => void,
): Promise<string[]> {
  const serveUrl = await getBundle(onLog);
  const { props, timeline, server } = await prepare(dir, project);
  try {
    const inputProps = props as unknown as Record<string, unknown>;
    const composition = await selectComposition({ serveUrl, id: "Main", inputProps });
    await mkdir(outDir, { recursive: true });
    const outs: string[] = [];
    for (const f of frames) {
      const frame = Math.max(0, Math.min(timeline.durationInFrames - 1, Math.round(f)));
      const output = join(outDir, `frame-${String(frame).padStart(6, "0")}.png`);
      await renderStill({ composition, serveUrl, inputProps, frame, output, imageFormat: "png" });
      outs.push(output);
    }
    return outs;
  } catch (e) {
    renderError(e);
  } finally {
    await server.close();
  }
}

export async function fileSize(file: string): Promise<number> {
  return (await stat(file)).size;
}
