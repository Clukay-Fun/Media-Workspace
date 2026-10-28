import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { open, rename, stat, unlink } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { promisify } from "node:util";
import { MwError } from "../core/errors";
import type { Asset } from "../core/schema";
import { projectFiles } from "./paths";
import { atomicWrite } from "./store";

// 素材导入（PLAN 8）：probe → 必要时转标准化文件（mez）→ 预览代理 → 波形。
// 原始素材只读，生成的文件都放在工程的 cache/media/ 下，按指纹命名，重复导入直接复用。

const run = promisify(execFile);
const ffmpegBin = () => process.env.MW_FFMPEG ?? "ffmpeg";
const ffprobeBin = () => process.env.MW_FFPROBE ?? "ffprobe";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const AUDIO_EXT = new Set([".mp3", ".m4a", ".wav", ".aac", ".flac"]);
const HDR_TRANSFER = new Set(["arib-std-b67", "smpte2084"]);

export type MediaProbe = {
  kind: Asset["kind"];
  durationMs: number;
  width?: number;
  height?: number;
  fps?: number;
  /** 平均帧率和标称帧率不一致：可变帧率 */
  vfr?: boolean;
  videoCodec?: string;
  pixFmt?: string;
  transfer?: string;
  rotation?: number;
  hasAudio: boolean;
  audioCodec?: string;
  sampleRate?: number;
};

type FfStream = {
  codec_type?: string;
  codec_name?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  color_transfer?: string;
  sample_rate?: string;
  duration?: string;
  side_data_list?: { rotation?: number }[];
  tags?: { rotate?: string };
  disposition?: { attached_pic?: number };
};

export async function probeMedia(file: string): Promise<MediaProbe> {
  let out: string;
  try {
    ({ stdout: out } = await run(
      ffprobeBin(),
      ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file],
      { maxBuffer: 16 << 20 },
    ));
  } catch (e) {
    throw new MwError("MEDIA", `无法读取素材：${file}`, {
      hint: String((e as Error).message).slice(0, 300),
    });
  }
  const data = JSON.parse(out) as { streams?: FfStream[]; format?: { duration?: string } };
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const audio = streams.find((s) => s.codec_type === "audio");
  const isImage = IMAGE_EXT.has(extname(file).toLowerCase());
  const kind: Asset["kind"] = isImage ? "image" : video ? "video" : "audio";
  if (!video && !audio) throw new MwError("MEDIA", `素材里没有视频也没有音频：${file}`);

  const rotation = Math.round(
    video?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ??
      Number(video?.tags?.rotate ?? 0),
  );
  const swap = Math.abs(rotation) % 180 === 90;
  const nominal = ratio(video?.r_frame_rate);
  const average = ratio(video?.avg_frame_rate);
  const durationS = Number(data.format?.duration ?? video?.duration ?? audio?.duration ?? 0);

  return {
    kind,
    durationMs: isImage ? 0 : Math.round(durationS * 1000),
    ...(video
      ? {
          width: swap ? video.height : video.width,
          height: swap ? video.width : video.height,
          fps: isImage ? undefined : nominal,
          vfr: isImage
            ? undefined
            : nominal !== undefined && average !== undefined && Math.abs(nominal - average) > 0.01,
          videoCodec: video.codec_name,
          pixFmt: video.pix_fmt,
          transfer: video.color_transfer,
          rotation,
        }
      : {}),
    hasAudio: Boolean(audio),
    audioCodec: audio?.codec_name,
    sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : undefined,
  };
}

function ratio(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const [a, b] = s.split("/").map(Number);
  if (!a || !b) return undefined;
  return Math.round((a / b) * 1000) / 1000;
}

/** 已经是「H.264 8-bit + 恒定 30fps + SDR + 无旋转 + AAC 48k（或无音频）」时不需要转换 */
export function needsNormalize(p: MediaProbe, fps = 30): boolean {
  if (p.kind !== "video") return false;
  return !(
    p.videoCodec === "h264" &&
    p.pixFmt === "yuv420p" &&
    p.fps === fps &&
    !p.vfr &&
    (p.transfer === undefined || p.transfer === "bt709" || p.transfer === "unknown") &&
    !p.rotation &&
    (!p.hasAudio || (p.audioCodec === "aac" && p.sampleRate === 48_000))
  );
}

/**
 * 快速指纹：文件大小 + 头尾各 1MB 的 sha256。
 * 用来给缓存文件命名、检测素材是否被替换；不读整个文件，几百 MB 的素材也是瞬间完成。
 */
export async function fingerprint(file: string): Promise<string> {
  const st = await stat(file);
  const fh = await open(file, "r");
  try {
    const n = Math.min(1 << 20, st.size);
    const head = Buffer.alloc(n);
    const tail = Buffer.alloc(n);
    await fh.read(head, 0, n, 0);
    await fh.read(tail, 0, n, Math.max(0, st.size - n));
    return createHash("sha256")
      .update(String(st.size))
      .update(head)
      .update(tail)
      .digest("hex")
      .slice(0, 16);
  } finally {
    await fh.close();
  }
}

export type ImportedAsset = { asset: Asset; probe: MediaProbe; created: string[] };

export type ImportOptions = {
  fps?: number;
  /** 生成预览代理（界面拖动用），CLI 导出时不需要 */
  proxy?: boolean;
  peaks?: boolean;
  onLog?: (line: string) => void;
};

/** 导入一个素材：返回可以直接放进 asset.add 的 Asset 对象（缓存路径相对工程目录） */
export async function importMedia(
  dir: string,
  file: string,
  opts: ImportOptions = {},
): Promise<ImportedAsset> {
  const fps = opts.fps ?? 30;
  const probe = await probeMedia(file);
  if (probe.transfer && HDR_TRANSFER.has(probe.transfer)) {
    throw new MwError("MEDIA", `素材是 HDR（${probe.transfer}），目前还不支持`, {
      hint: "在 iPhone 设置里关闭 HDR 视频后重新拍摄，或先用其他工具转成 SDR（PLAN 第 8 节）",
    });
  }
  const fp = await fingerprint(file);
  const media = projectFiles(dir).media;
  const created: string[] = [];
  const cache: NonNullable<Asset["cache"]> = {};
  const rel = (abs: string) => relative(dir, abs);

  if (probe.kind === "video" || probe.kind === "audio") {
    if (probe.kind === "video" && needsNormalize(probe, fps)) {
      const mez = join(media, `${fp}.mez.mp4`);
      if (!(await exists(mez))) {
        opts.onLog?.(`转换标准化文件：${file}`);
        await ffmpegTo(mez, ["-i", file, ...mezArgs(probe, fps)]);
        created.push(mez);
      }
      cache.mez = rel(mez);
    }
    if (probe.kind === "video" && opts.proxy !== false) {
      const proxy = join(media, `${fp}.proxy.mp4`);
      if (!(await exists(proxy))) {
        opts.onLog?.(`生成预览代理：${file}`);
        await ffmpegTo(proxy, ["-i", file, ...proxyArgs(probe, fps)]);
        created.push(proxy);
      }
      cache.proxy = rel(proxy);
    }
    if (probe.hasAudio && opts.peaks !== false) {
      const peaks = join(media, `${fp}.peaks.json`);
      if (!(await exists(peaks))) {
        await atomicWrite(peaks, JSON.stringify(await computePeaks(file)));
        created.push(peaks);
      }
      cache.peaks = rel(peaks);
    }
  }

  const asset: Asset = {
    kind: probe.kind,
    path: file,
    fingerprint: fp,
    probe: {
      durationMs: probe.durationMs,
      ...(probe.width ? { width: probe.width, height: probe.height } : {}),
      ...(probe.fps ? { fps: probe.fps } : {}),
      hasAudio: probe.hasAudio,
    },
    ...(Object.keys(cache).length > 0 ? { cache } : {}),
  };
  return { asset, probe, created };
}

const COLOR = ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"];

/** 标准化：H.264 8-bit、恒定帧率、bt709、AAC 48k；旋转由 ffmpeg 自动应用 */
function mezArgs(p: MediaProbe, fps: number): string[] {
  return [
    "-map",
    "0:v:0",
    ...(p.hasAudio ? ["-map", "0:a:0"] : []),
    "-vf",
    `fps=${fps},format=yuv420p`,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-g",
    String(fps),
    ...COLOR,
    ...(p.hasAudio ? ["-c:a", "aac", "-ar", "48000", "-b:a", "192k"] : []),
    "-movflags",
    "+faststart",
  ];
}

/** 预览代理：540 宽、GOP 15 帧（拖动定位快） */
function proxyArgs(p: MediaProbe, fps: number): string[] {
  return [
    "-map",
    "0:v:0",
    ...(p.hasAudio ? ["-map", "0:a:0"] : []),
    "-vf",
    `fps=${fps},scale=540:-2,format=yuv420p`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-g",
    "15",
    ...COLOR,
    ...(p.hasAudio ? ["-c:a", "aac", "-ar", "48000", "-b:a", "128k"] : []),
    "-movflags",
    "+faststart",
  ];
}

/** 先写到临时文件，成功后再改名：中途失败不会留下半个缓存文件被当成完整的 */
async function ffmpegTo(out: string, args: string[]): Promise<void> {
  const tmp = `${out}.part${extname(out)}`;
  try {
    await runFfmpeg(["-hide_banner", "-v", "error", "-y", ...args, tmp]);
    await rename(tmp, out);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin(), args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d: Buffer) => {
      err = (err + d.toString()).slice(-4000);
    });
    child.on("error", (e) =>
      reject(
        new MwError("MEDIA", "找不到 ffmpeg", { hint: `${e.message}；可以用 MW_FFMPEG 指定路径` }),
      ),
    );
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new MwError("MEDIA", "ffmpeg 处理失败", { hint: err.trim().slice(-600) })),
    );
  });
}

export type Peaks = { msPerPeak: number; peaks: number[] };

/** 波形：每 10ms 取一个峰值（0–1），时间线上显示，帮助找停顿 */
export async function computePeaks(file: string, msPerPeak = 10): Promise<Peaks> {
  const rate = 8000;
  const { stdout } = await run(
    ffmpegBin(),
    ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(rate), "-f", "s16le", "-"],
    { maxBuffer: 1 << 30, encoding: "buffer" },
  );
  const samples = new Int16Array(
    stdout.buffer,
    stdout.byteOffset,
    Math.floor(stdout.byteLength / 2),
  );
  const per = (rate * msPerPeak) / 1000;
  const peaks: number[] = [];
  for (let i = 0; i < samples.length; i += per) {
    let m = 0;
    for (let j = i; j < Math.min(i + per, samples.length); j++)
      m = Math.max(m, Math.abs(samples[j] ?? 0));
    peaks.push(Math.round((m / 32768) * 1000) / 1000);
  }
  return { msPerPeak, peaks };
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false,
  );
}
