import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { type AsrToken, alignChars } from "../core/align";
import { MwError } from "../core/errors";
import type { Op } from "../core/ops";
import type { Caption, Project } from "../core/schema";
import { mwHome } from "./paths";

// 识音（docs/decisions/0005）：本地离线跑 SenseVoice（sherpa-onnx），只用来拿每个字的时间。
// 字幕文字以 SRT / 人工校对的为准，识别出的文字不写回工程。

export const ASR_MODEL = {
  name: "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
  files: ["model.int8.onnx", "tokens.txt"],
} as const;

const SAMPLE_RATE = 16_000;
/** 每句前后多截一点音频：SRT 的起止常常压着字，截太紧会漏掉首尾字 */
const PAD_MS = 300;

const ffmpegBin = () => process.env.MW_FFMPEG ?? "ffmpeg";

/** 模型目录，默认 <MW_HOME>/models，用 MW_MODELS_DIR 修改 */
export function modelsDir(): string {
  return process.env.MW_MODELS_DIR ? resolve(process.env.MW_MODELS_DIR) : join(mwHome(), "models");
}

export function asrModelDir(): string {
  return join(modelsDir(), ASR_MODEL.name);
}

export function hasAsrModel(): boolean {
  return ASR_MODEL.files.every((f) => existsSync(join(asrModelDir(), f)));
}

/** 下载并解压识音模型（约 230MB）。已经有了就直接返回 */
export async function fetchAsrModel(onLog?: (s: string) => void): Promise<string> {
  const dir = asrModelDir();
  if (hasAsrModel()) return dir;
  const tmp = join(modelsDir(), `.tmp-${process.pid}`);
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  onLog?.(`下载识音模型：${ASR_MODEL.url}`);
  try {
    const res = await fetch(ASR_MODEL.url);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    await new Promise<void>((ok, bad) => {
      const tar = spawn("tar", ["xjf", "-", "-C", tmp], { stdio: ["pipe", "ignore", "pipe"] });
      let err = "";
      tar.stderr.on("data", (d) => {
        err += d;
      });
      tar.on("error", bad);
      tar.on("close", (code) => (code === 0 ? ok() : bad(new Error(err || `tar 退出码 ${code}`))));
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]).pipe(tar.stdin);
    });
    await rm(dir, { recursive: true, force: true });
    await rename(join(tmp, ASR_MODEL.name), dir);
  } catch (e) {
    throw new MwError("MEDIA", "识音模型下载失败", { hint: String((e as Error).message ?? e) });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  if (!hasAsrModel()) throw new MwError("MEDIA", "识音模型解压后缺少文件", { path: dir });
  return dir;
}

type SherpaResult = { text: string; tokens: string[]; timestamps: number[] };
type Recognizer = {
  createStream(): { acceptWaveform(w: { sampleRate: number; samples: Float32Array }): void };
  decode(stream: unknown): void;
  getResult(stream: unknown): SherpaResult;
};

function createRecognizer(): Recognizer {
  if (!hasAsrModel()) {
    throw new MwError("MEDIA", "还没有识音模型", {
      path: asrModelDir(),
      hint: "先运行 mw models --fetch 下载（约 230MB，只需一次）",
    });
  }
  let sherpa: { OfflineRecognizer: new (config: unknown) => Recognizer };
  try {
    sherpa = createRequire(import.meta.url)("sherpa-onnx-node");
  } catch (e) {
    throw new MwError("MEDIA", "识音引擎加载失败", {
      hint: `${(e as Error).message.split("\n")[0]}；运行 pnpm install 重新安装依赖`,
    });
  }
  const dir = asrModelDir();
  return new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      senseVoice: {
        model: join(dir, "model.int8.onnx"),
        language: "zh",
        // 不做数字规整：要和字幕原文逐字对齐（「二十」不能变成「20」）
        useInverseTextNormalization: 0,
      },
      tokens: join(dir, "tokens.txt"),
      numThreads: 2,
      provider: "cpu",
      debug: 0,
    },
  });
}

/** 截一段音频，转成 16k 单声道 float */
function decodePcm(file: string, fromMs: number, toMs: number): Promise<Float32Array> {
  return new Promise((ok, bad) => {
    const child = spawn(
      ffmpegBin(),
      [
        ...["-v", "error", "-ss", String(fromMs / 1000), "-to", String(toMs / 1000)],
        ...["-i", file, "-vn", "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", "-"],
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const chunks: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("error", (e) =>
      bad(
        new MwError("MEDIA", "找不到 ffmpeg", { hint: `${e.message}；可以用 MW_FFMPEG 指定路径` }),
      ),
    );
    child.on("close", (code) => {
      if (code !== 0) return bad(new MwError("MEDIA", "读取音频失败", { hint: err.slice(0, 800) }));
      const buf = Buffer.concat(chunks);
      // 拷贝一份：Buffer 的偏移不一定按 4 字节对齐
      const out = new Float32Array(buf.length >> 2);
      for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
      ok(out);
    });
  });
}

export type AlignReport = {
  id: string;
  text: string;
  heard: string;
  /** 识别出的字里和字幕对上的比例；太低说明这句可能没对准，值得人工看一下 */
  match: number;
};

/**
 * 给字幕识音，生成写入逐字时间的 ops（caption.update）。
 * 不直接改工程：由调用方通过 store 提交，和其他修改一样有 revision 和历史。
 */
export async function alignCaptions(
  dir: string,
  project: Project,
  opts: { ids?: string[]; onLog?: (s: string) => void } = {},
): Promise<{ ops: Op[]; report: AlignReport[] }> {
  const caps: Caption[] = project.tracks.flatMap((t) =>
    t.kind === "caption" ? t.items.filter((c) => !opts.ids || opts.ids.includes(c.id)) : [],
  );
  if (opts.ids) {
    const missing = opts.ids.filter((id) => !caps.some((c) => c.id === id));
    if (missing.length > 0) throw new MwError("NOT_FOUND", `字幕不存在：${missing.join("、")}`);
  }
  const rec = createRecognizer();
  const ops: Op[] = [];
  const report: AlignReport[] = [];
  for (const [i, cap] of caps.entries()) {
    const a = project.assets[cap.asset];
    if (!a) throw new MwError("REF_MISSING", `素材「${cap.asset}」不存在`);
    const file = a.cache?.mez ? join(dir, a.cache.mez) : a.path;
    const abs = isAbsolute(file) ? file : resolve(dir, file);
    const from = Math.max(0, cap.startMs - PAD_MS);
    const to = cap.endMs + PAD_MS;
    const samples = await decodePcm(abs, from, to);
    const stream = rec.createStream();
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples });
    rec.decode(stream);
    const r = rec.getResult(stream);
    // 去掉语种、情绪之类的标签和 SentencePiece 的词首标记
    const tokens: AsrToken[] = r.tokens.flatMap((text, k) =>
      /^<\|.*\|>$/.test(text)
        ? []
        : [
            {
              text: text.replace(/▁/g, ""),
              startMs: from + Math.round((r.timestamps[k] ?? 0) * 1000),
            },
          ],
    );
    const charStartMs = alignChars(cap.text, tokens, cap.startMs, cap.endMs);
    ops.push({ op: "caption.update", id: cap.id, set: { charStartMs } });
    report.push({ id: cap.id, text: cap.text, heard: r.text, match: matchRatio(cap.text, r.text) });
    opts.onLog?.(`识音 ${i + 1}/${caps.length} ${cap.id}：${r.text}`);
  }
  return { ops, report };
}

/** 字幕和识别结果的公共字比例（忽略标点），只用来提示哪些句子可能没对准 */
function matchRatio(text: string, heard: string): number {
  const clean = (s: string) => [...s.toLowerCase()].filter((c) => /[\p{L}\p{N}]/u.test(c));
  const a = clean(text);
  const b = clean(heard);
  if (a.length === 0) return 1;
  const pool = new Map<string, number>();
  for (const c of b) pool.set(c, (pool.get(c) ?? 0) + 1);
  let hit = 0;
  for (const c of a) {
    const n = pool.get(c) ?? 0;
    if (n > 0) {
      hit++;
      pool.set(c, n - 1);
    }
  }
  return Math.round((hit / a.length) * 100) / 100;
}
