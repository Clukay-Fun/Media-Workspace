import { layoutMainTrack, mapTimelineMs } from "./compile";
import type { Caption, Project } from "./schema";

export type SrtCue = { index: number; startMs: number; endMs: number; text: string };

export class SrtError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
  }
}

const TIME = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/;

function parseTime(s: string, line: number): number {
  const m = TIME.exec(s.trim());
  if (!m) throw new SrtError(`第 ${line} 行的时间格式不对：${s.trim()}`, line);
  const [, h, mi, se, ms] = m;
  return (
    ((Number(h) * 60 + Number(mi)) * 60 + Number(se)) * 1000 + Number((ms ?? "0").padEnd(3, "0"))
  );
}

/** 宽松解析：容忍 BOM、CRLF、序号缺失、多余空行；时间格式错误时报出行号 */
export function parseSrt(text: string): SrtCue[] {
  const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const cues: SrtCue[] = [];
  let i = 0;
  while (i < lines.length) {
    while (i < lines.length && (lines[i] ?? "").trim() === "") i++;
    if (i >= lines.length) break;
    if (/^\d+$/.test((lines[i] ?? "").trim()) && (lines[i + 1] ?? "").includes("-->")) i++;
    const timeLine = lines[i] ?? "";
    if (!timeLine.includes("-->")) {
      throw new SrtError(`第 ${i + 1} 行应该是时间轴（00:00:01,000 --> 00:00:02,000）`, i + 1);
    }
    const [a = "", b = ""] = timeLine.split("-->");
    const startMs = parseTime(a, i + 1);
    // 时间轴后面可能跟着位置参数（X1:… Y1:…），只取第一段
    const endMs = parseTime(b.trim().split(/\s+/)[0] ?? "", i + 1);
    if (endMs < startMs) throw new SrtError(`第 ${i + 1} 行的结束时间早于开始时间`, i + 1);
    i++;
    const body: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() !== "") body.push((lines[i++] ?? "").trim());
    cues.push({ index: cues.length + 1, startMs, endMs, text: body.join("\n") });
  }
  return cues;
}

export function formatSrt(cues: { startMs: number; endMs: number; text: string }[]): string {
  const fmt = (ms: number) => {
    const p = (n: number, w = 2) => String(Math.floor(n)).padStart(w, "0");
    return `${p(ms / 3_600_000)}:${p((ms / 60_000) % 60)}:${p((ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  return cues
    .map((c, i) => `${i + 1}\n${fmt(c.startMs)} --> ${fmt(c.endMs)}\n${c.text}\n`)
    .join("\n");
}

export type CaptionImportOptions =
  /** SRT 对应某个原片 */
  | { timebase: "source"; asset: string }
  /** SRT 对应当前成片时间线，按主轨映射反算回源时间 */
  | { timebase: "timeline" };

export type CaptionImportResult = {
  captions: Omit<Caption, "id">[];
  /** 落在主轨以外（例如片尾）的字幕，没有导入 */
  skipped: SrtCue[];
};

export function cuesToCaptions(
  project: Project,
  cues: SrtCue[],
  opts: CaptionImportOptions,
): CaptionImportResult {
  if (opts.timebase === "source") {
    return {
      captions: cues.map((c) => ({
        asset: opts.asset,
        startMs: c.startMs,
        endMs: c.endMs,
        text: c.text,
        highlights: [],
      })),
      skipped: [],
    };
  }
  const segments = layoutMainTrack(project);
  const captions: Omit<Caption, "id">[] = [];
  const skipped: SrtCue[] = [];
  for (const cue of cues) {
    const start = mapTimelineMs(segments, cue.startMs);
    if (!start) {
      skipped.push(cue);
      continue;
    }
    const seg = segments.find((s) => s.clip.id === start.clip);
    if (!seg) continue;
    // 结束点按起点所在片段换算；跨到下一个片段的部分截到这个片段的出点
    // （不能直接映射结束点：恰好落在片段边界上时会映射到下一个片段的入点）
    const endMs =
      cue.endMs <= seg.endMs
        ? seg.clip.inMs + (cue.endMs - seg.startMs) * seg.clip.speed
        : seg.clip.outMs;
    captions.push({
      asset: start.asset,
      startMs: Math.round(start.srcMs),
      endMs: Math.round(endMs),
      text: cue.text,
      highlights: [],
    });
  }
  return { captions, skipped };
}
