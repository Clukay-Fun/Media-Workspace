// 一次性工具：把「剪辑后」的成片对齐回「剪辑前」的原片，推算出剪辑参数，
// 并把对应成片时间的 SRT 换算成对应原片时间的 SRT，作为阶段 A 的测试数据。
//
// 用法：pnpm tsx scripts/align-edit.ts <原片> <成片> <成片SRT> <输出目录>
//
// 模型：成片内容 = 原片从 rawIn 开始、按固定倍速 speed 播放，即 raw = speed * edit + rawIn。
// 变速会保持音调，波形本身对不上，所以用对数响度包络做相关来拟合。
// 1029 样片拟合结果：speed ≈ 1.10，相关系数 0.93，逐秒相关都在 0.77 以上，没有中间剪切。
// 如果以后的样片有中间剪切，逐秒相关会在剪切点之后明显下降，脚本会提示。

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RATE = 16000;
const HOP = 80; // 5ms 一个包络点
const DT = (HOP / RATE) * 1000;

function envelope(file: string): Float64Array {
  const ffmpeg = process.env.MW_FFMPEG ?? "ffmpeg";
  const buf = execFileSync(
    ffmpeg,
    ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"],
    { maxBuffer: 1 << 30 },
  );
  const x = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return Float64Array.from({ length: Math.floor(x.length / HOP) }, (_, k) => {
    let s = 0;
    for (let i = k * HOP; i < (k + 1) * HOP; i++) s += (x[i] ?? 0) ** 2;
    return Math.log10(Math.sqrt(s / HOP) + 1e-4);
  });
}

function makeScorer(raw: Float64Array, edit: Float64Array) {
  const rawAt = (ms: number) => {
    const p = ms / DT;
    const i = Math.floor(p);
    const f = p - i;
    return (raw[i] ?? -4) * (1 - f) + (raw[i + 1] ?? -4) * f;
  };
  // [fromMs, toMs) 区间内，成片包络和按模型取样的原片包络的皮尔逊相关
  return (speed: number, rawIn: number, fromMs: number, toMs: number) => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let ms = fromMs; ms < toMs; ms += DT) {
      xs.push(edit[Math.round(ms / DT)] ?? -4);
      ys.push(rawAt(speed * ms + rawIn));
    }
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
    const my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let d = 0;
    let vx = 0;
    let vy = 0;
    for (let i = 0; i < xs.length; i++) {
      const p = (xs[i] ?? 0) - mx;
      const q = (ys[i] ?? 0) - my;
      d += p * q;
      vx += p * p;
      vy += q * q;
    }
    return d / Math.sqrt(vx * vy + 1e-12);
  };
}

type Cue = { startMs: number; endMs: number; text: string };

function parseSrt(text: string): Cue[] {
  const toMs = (t: string) => {
    const [h, m, rest] = t.trim().split(":");
    const [s, ms] = (rest ?? "0,0").split(",");
    return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(ms);
  };
  return text
    .replace(/\r/g, "")
    .trim()
    .split(/\n\n+/)
    .map((block) => {
      const [, time, ...lines] = block.split("\n");
      const [a, b] = (time ?? "").split("-->");
      return { startMs: toMs(a ?? ""), endMs: toMs(b ?? ""), text: lines.join("\n") };
    });
}

function formatSrt(cues: Cue[]): string {
  const fmt = (ms: number) => {
    const p = (n: number, w = 2) => String(Math.floor(n)).padStart(w, "0");
    return `${p(ms / 3600000)}:${p((ms / 60000) % 60)}:${p((ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  return cues.map((c, i) => `${i + 1}\n${fmt(c.startMs)} --> ${fmt(c.endMs)}\n${c.text}\n`).join("\n");
}

function main() {
  const [rawFile, editFile, srtFile, outDir] = process.argv.slice(2);
  if (!rawFile || !editFile || !srtFile || !outDir) {
    console.error("用法：tsx scripts/align-edit.ts <原片> <成片> <成片SRT> <输出目录>");
    process.exit(2);
  }
  const raw = envelope(rawFile);
  const edit = envelope(editFile);
  const score = makeScorer(raw, edit);
  const cues = parseSrt(readFileSync(srtFile, "utf8"));
  // 拟合区间：字幕覆盖的范围，避开片尾
  const fitFrom = Math.max(0, (cues[0]?.startMs ?? 0) - 200);
  const fitTo = cues.at(-1)?.endMs ?? edit.length * DT;

  // 先粗搜，再细搜
  let best = { speed: 1, rawIn: 0, corr: -2 };
  const maxIn = raw.length * DT - fitTo;
  for (let speed = 0.8; speed <= 1.5; speed += 0.002) {
    for (let rawIn = 0; rawIn <= maxIn; rawIn += 10) {
      const corr = score(speed, rawIn, fitFrom, fitTo);
      if (corr > best.corr) best = { speed, rawIn, corr };
    }
  }
  const coarse = { ...best };
  for (let speed = coarse.speed - 0.003; speed <= coarse.speed + 0.003; speed += 0.0002) {
    for (let rawIn = coarse.rawIn - 30; rawIn <= coarse.rawIn + 30; rawIn += 1) {
      const corr = score(speed, rawIn, fitFrom, fitTo);
      if (corr > best.corr) best = { speed, rawIn, corr };
    }
  }

  const perSecond: number[] = [];
  for (let a = fitFrom; a + 1000 <= fitTo; a += 1000) {
    perSecond.push(Number(score(best.speed, best.rawIn, a, a + 1000).toFixed(2)));
  }
  const weak = perSecond.filter((c) => c < 0.6).length;

  const speed = Number(best.speed.toFixed(4));
  const rawIn = Math.round(best.rawIn);
  const toRaw = (ms: number) => Math.round(speed * ms + rawIn);
  const report = {
    model: "raw = speed * edit + rawInMs",
    speed,
    rawInMs: rawIn,
    rawOutMs: toRaw(fitTo),
    contentEndMs: fitTo,
    corr: Number(best.corr.toFixed(3)),
    perSecondCorr: perSecond,
    warning:
      weak > 0 ? `${weak} 个 1 秒窗口相关系数低于 0.6，成片可能有中间剪切，单一倍速模型不够` : null,
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "edl.json"), `${JSON.stringify(report, null, 2)}\n`);
  const rawCues = cues.map((c) => ({ ...c, startMs: toRaw(c.startMs), endMs: toRaw(c.endMs) }));
  writeFileSync(join(outDir, "source.srt"), formatSrt(rawCues));
  console.log(JSON.stringify(report, null, 2));
}

main();
