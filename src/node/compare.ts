import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { transformAt } from "../core/animate";
import {
  captionBandLines,
  compareCaptionWrap,
  compareCutPoints,
  type FaceBox,
  faceCenterDelta,
  fitTiming,
  loudnessEnvelope,
  matchCaptionLines,
  type TimingFit,
  transformFaceBoxToCanvas,
} from "../core/compare";
import { compile, layoutMainTrack } from "../core/compile";
import { MwError } from "../core/errors";
import { isMainClip, type Project } from "../core/schema";
import { frameToMs, msToFrame } from "../core/time";
import { detectFaces, readFaces } from "./faces";
import { decodeAudioSamples, probeMedia } from "./media";
import { recognizeText } from "./ocr";
import { projectFiles } from "./paths";
import { renderStills } from "./render";
import { loadProject } from "./store";

const run = promisify(execFile);
const ffmpegBin = () => process.env.MW_FFMPEG ?? "ffmpeg";

export type CompareProjectOptions = {
  atMs?: number;
  out?: string;
  sceneThreshold?: number;
  cutToleranceMs?: number;
  faceIntervalMs?: number;
  onLog?: (message: string) => void;
};

type CaptionShot = {
  id: string;
  text: string;
  frame: number;
  atMs: number;
  /** 参考成片里说到同一处的时间（按音频对齐估的；估不出来时和 atMs 一样） */
  referenceAtMs: number;
  expectedY?: number;
};

const SHEET_COUNT = 6;

/** 比较工程与参考成片，输出同一时刻并排图及可解析的差异 JSON。 */
export async function compareProject(
  dir: string,
  referenceFile: string,
  options: CompareProjectOptions = {},
) {
  const sceneThreshold = options.sceneThreshold ?? 0.3;
  const cutToleranceMs = options.cutToleranceMs ?? 500;
  const faceIntervalMs = options.faceIntervalMs ?? 1000;
  if (!Number.isFinite(sceneThreshold) || sceneThreshold <= 0 || sceneThreshold > 1)
    throw new MwError("USAGE", "sceneThreshold 必须大于 0 且不超过 1");
  if (!Number.isInteger(cutToleranceMs) || cutToleranceMs < 0)
    throw new MwError("USAGE", "cutToleranceMs 必须是非负整数");
  if (!Number.isInteger(faceIntervalMs) || faceIntervalMs < 250)
    throw new MwError("USAGE", "faceIntervalMs 必须是至少 250 毫秒的整数");

  const reference = resolve(referenceFile);
  const [project, referenceProbe] = await Promise.all([loadProject(dir), probeMedia(reference)]);
  if (referenceProbe.kind !== "video") throw new MwError("MEDIA", "参考成片必须是视频文件");
  const timeline = compile(project);
  const projectDurationMs = Math.round(frameToMs(timeline.durationInFrames, timeline.fps));
  const comparisonEndMs = Math.min(projectDurationMs, referenceProbe.durationMs);
  if (comparisonEndMs <= 0) throw new MwError("MEDIA", "工程或参考成片没有可比较的画面");
  const requestedAtMs = options.atMs ?? Math.floor(comparisonEndMs / 2);
  if (!Number.isInteger(requestedAtMs) || requestedAtMs < 0)
    throw new MwError("USAGE", "atMs 必须是非负整数");
  const atMs = Math.min(requestedAtMs, comparisonEndMs - 1);
  const atFrame = Math.min(timeline.durationInFrames - 1, msToFrame(atMs, timeline.fps));
  const renderedAtMs = Math.round(frameToMs(atFrame, timeline.fps));
  options.onLog?.("用音频对齐估计起点和倍速");
  const timing = await compareTiming(dir, project, reference, referenceProbe.durationMs);
  const toReferenceMs = (atMsInProject: number) => {
    const fit = timing.reference;
    const sourceMs = projectSourceMs(project, atMsInProject);
    if (!fit || fit.score < 0.4 || sourceMs === null) return atMsInProject;
    return Math.round((sourceMs - fit.sourceStartMs) / fit.speed);
  };
  const captionShots = collectCaptionShots(project, timeline)
    .map((shot) => ({ ...shot, referenceAtMs: toReferenceMs(shot.atMs) }))
    .filter(
      (shot) =>
        shot.atMs < comparisonEndMs &&
        shot.referenceAtMs >= 0 &&
        shot.referenceAtMs < referenceProbe.durationMs,
    );
  // 并排小图：均匀取几处，同一成片时间
  const sheetFrames = Array.from({ length: SHEET_COUNT }, (_, i) =>
    msToFrame(Math.round((comparisonEndMs * (i + 0.5)) / SHEET_COUNT), timeline.fps),
  );
  const sheetTimes = sheetFrames.map((f) => Math.round(frameToMs(f, timeline.fps)));
  const frames = [...new Set([atFrame, ...sheetFrames, ...captionShots.map((shot) => shot.frame)])];
  const sampleTimes = [
    ...new Set([renderedAtMs, ...sheetTimes, ...captionShots.map((shot) => shot.referenceAtMs)]),
  ];
  const temp = await mkdtemp(join(tmpdir(), "mw-compare-"));
  const projectFramesDir = join(temp, "project-frames");
  const referenceFramesDir = join(temp, "reference-frames");
  const faceWorkDir = join(temp, "face-work");
  await Promise.all([mkdir(referenceFramesDir), mkdir(faceWorkDir)]);
  try {
    options.onLog?.(`渲染工程画面：${frames.length} 帧`);
    const projectFrames = await renderStills(dir, project, frames, projectFramesDir, options.onLog);
    const projectFrameByNumber = new Map(
      frames.map((frame, index) => [frame, projectFrames[index] ?? ""]),
    );
    const referenceFrameByTime = new Map<number, string>();
    await Promise.all(
      sampleTimes.map(async (time) => {
        const output = join(referenceFramesDir, `frame-${time}.png`);
        await extractFrame(reference, time, output);
        referenceFrameByTime.set(time, output);
      }),
    );

    const image = options.out
      ? resolve(options.out)
      : join(projectFiles(dir).renders, `compare-r${project.revision}.png`);
    await mkdir(dirname(image), { recursive: true });
    await combineFrames(
      projectFrameByNumber.get(atFrame) ?? "",
      referenceFrameByTime.get(renderedAtMs) ?? "",
      image,
      timeline.height,
    );
    const sheet = image.replace(/\.png$/i, "") + "-sheet.png";
    await combineSheet(
      sheetFrames.map((f, i) => [
        projectFrameByNumber.get(f) ?? "",
        referenceFrameByTime.get(sheetTimes[i] ?? 0) ?? "",
      ]),
      sheet,
    );

    options.onLog?.("检测参考成片剪切点");
    const [referenceCutPoints, faces, captionWrap] = await Promise.all([
      detectSceneCuts(reference, sceneThreshold),
      compareFacePositions(
        dir,
        project,
        timeline,
        reference,
        referenceProbe,
        faceWorkDir,
        faceIntervalMs,
      ),
      compareCaptionWraps(captionShots, projectFrameByNumber, referenceFrameByTime),
    ]);
    const projectCutPoints = layoutMainTrack(project)
      .slice(1)
      .map((segment) => Math.round(segment.startMs));
    const cuts = compareCutPoints(projectCutPoints, referenceCutPoints, cutToleranceMs);
    // 参考成片里没对上的画面变化，能判断的标上是什么，免得当成漏剪
    const outroMs = project.outro
      ? (project.assets[project.outro.asset]?.probe?.durationMs ?? 0)
      : 0;
    const referenceOnlyNotes = cuts.referenceOnly.map((ms) => ({
      ms,
      note:
        ms < 300
          ? "开头的画面变化（标题等出现），不是剪辑"
          : outroMs > 0 && Math.abs(referenceProbe.durationMs - ms - outroMs) < 400
            ? "大概是接片尾的地方"
            : null,
    }));

    return {
      ok: true as const,
      project: dir,
      reference,
      comparisonImage: image,
      comparisonImageSides: { left: "project", right: "reference" },
      sample: { atMs: renderedAtMs, requestedAtMs },
      duration: {
        projectMs: projectDurationMs,
        referenceMs: referenceProbe.durationMs,
        deltaMs: projectDurationMs - referenceProbe.durationMs,
      },
      cutPoints: {
        projectMs: projectCutPoints,
        referenceMs: referenceCutPoints,
        referenceDetection: {
          algorithm: "ffmpeg scene-change threshold",
          threshold: sceneThreshold,
          caveat: "只检测明显的画面变化，同机位剪辑可能无法识别",
        },
        toleranceMs: cutToleranceMs,
        ...cuts,
        referenceOnlyNotes,
      },
      timing,
      comparisonSheet: sheet,
      comparisonSheetTimesMs: sheetTimes,
      faces,
      captionWrap,
    };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

function collectCaptionShots(
  project: Project,
  timeline: ReturnType<typeof compile>,
): CaptionShot[] {
  const shots = new Map<string, CaptionShot>();
  for (const caption of timeline.captions) {
    if (caption.partial || shots.has(caption.id) || caption.durationInFrames <= 0) continue;
    const frame = caption.from + Math.floor((caption.durationInFrames - 1) * 0.8);
    const style = caption.style ? project.styles[caption.style] : undefined;
    shots.set(caption.id, {
      id: caption.id,
      text: caption.text,
      frame,
      atMs: Math.round(frameToMs(frame, timeline.fps)),
      referenceAtMs: Math.round(frameToMs(frame, timeline.fps)),
      ...(style ? { expectedY: style.layout.y / project.canvas.height } : {}),
    });
  }
  return [...shots.values()];
}

async function extractFrame(video: string, atMs: number, output: string) {
  await run(ffmpegBin(), [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    String(atMs / 1000),
    "-i",
    video,
    "-frames:v",
    "1",
    "-update",
    "1",
    output,
  ]);
}

async function combineFrames(
  projectFrame: string,
  referenceFrame: string,
  output: string,
  height: number,
) {
  if (!projectFrame || !referenceFrame) throw new MwError("RENDER", "没有找到用于合成的对比帧");
  const h = Math.max(2, Math.floor(height / 2) * 2);
  const filter =
    `[0:v]scale=-2:${h}:flags=lanczos,setsar=1[left];` +
    `[1:v]scale=-2:${h}:flags=lanczos,setsar=1[right];` +
    "[left][right]hstack=inputs=2[out]";
  try {
    await run(
      ffmpegBin(),
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        projectFrame,
        "-i",
        referenceFrame,
        "-filter_complex",
        filter,
        "-map",
        "[out]",
        "-frames:v",
        "1",
        output,
      ],
      { maxBuffer: 1 << 24 },
    );
  } catch (e) {
    throw new MwError("MEDIA", "无法合成对比图", {
      hint: String((e as Error).message).slice(0, 300),
    });
  }
}

async function detectSceneCuts(video: string, threshold: number): Promise<number[]> {
  const filter = `select='gt(scene,${threshold})',showinfo`;
  try {
    const { stderr } = await run(
      ffmpegBin(),
      ["-hide_banner", "-i", video, "-vf", filter, "-an", "-fps_mode", "vfr", "-f", "null", "-"],
      { maxBuffer: 1 << 26 },
    );
    const found = [...stderr.matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g)].map((m) =>
      Math.round(Number(m[1]) * 1000),
    );
    return found.filter(
      (ms, index) => ms > 0 && (index === 0 || ms - (found[index - 1] ?? 0) >= 40),
    );
  } catch (e) {
    throw new MwError("MEDIA", "无法分析参考成片的场景剪切点", {
      hint: String((e as Error).message).slice(0, 300),
    });
  }
}

async function compareFacePositions(
  dir: string,
  project: Project,
  timeline: ReturnType<typeof compile>,
  reference: string,
  referenceProbe: Awaited<ReturnType<typeof probeMedia>>,
  workDir: string,
  intervalMs: number,
) {
  const mainTrack = project.tracks.find((track) => track.kind === "video" && track.main);
  const mainAssets =
    mainTrack?.kind === "video"
      ? [...new Set(mainTrack.items.filter(isMainClip).map((item) => item.asset))]
      : [];
  const faces = new Map<string, Awaited<ReturnType<typeof readFaces>>>();
  const assetDimensions = new Map<string, { width: number; height: number }>();
  const warnings: string[] = [];
  for (const id of mainAssets) {
    const asset = project.assets[id];
    if (!asset) continue;
    let track = asset.cache?.faces ? await readFaces(resolve(dir, asset.cache.faces)) : null;
    if (!track && asset.cache?.faces) warnings.push(`项目素材 ${id} 的人脸缓存不可读`);
    if (!track) {
      try {
        track = await detectFaces(resolve(dir, asset.path), workDir, intervalMs);
      } catch (e) {
        warnings.push(`项目素材 ${id} 人脸检测失败：${String((e as Error).message).slice(0, 160)}`);
      }
    }
    faces.set(id, track);
    let width = asset.probe?.width;
    let height = asset.probe?.height;
    if (!width || !height) {
      try {
        const media = await probeMedia(resolve(dir, asset.path));
        width = media.width;
        height = media.height;
      } catch {
        // Without source dimensions the frame boxes can still be reported in source-relative units.
      }
    }
    if (width && height) assetDimensions.set(id, { width, height });
  }

  let referenceFaces: Awaited<ReturnType<typeof detectFaces>> = null;
  try {
    referenceFaces = await detectFaces(reference, workDir, intervalMs);
  } catch (e) {
    warnings.push(`参考成片人脸检测失败：${String((e as Error).message).slice(0, 160)}`);
  }
  const allProjectAvailable = mainAssets.every((id) => Boolean(faces.get(id)));
  const available = Boolean(referenceFaces) && allProjectAvailable;
  if (!available) {
    if (!referenceFaces) warnings.push("参考成片的人脸框不可用（当前仅支持安装 swiftc 的 macOS）");
    if (!allProjectAvailable) warnings.push("一个或多个工程素材没有可用的人脸框");
    return { available: false, intervalMs, samples: [], meanDelta: null, warnings };
  }

  const segments = layoutMainTrack(project);
  const durationMs = Math.min(
    frameToMs(timeline.durationInFrames, timeline.fps),
    referenceProbe.durationMs,
  );
  const samples: {
    atMs: number;
    projectBoxes: FaceBox[];
    referenceBoxes: FaceBox[];
    matches: {
      projectBox: FaceBox;
      referenceBox: FaceBox;
      delta: { dx: number; dy: number; distance: number };
    }[];
    projectOnly: FaceBox[];
    referenceOnly: FaceBox[];
  }[] = [];
  for (let atMs = 0; atMs < durationMs; atMs += intervalMs) {
    const segment = segments.find((entry) => atMs >= entry.startMs && atMs < entry.endMs);
    const projectBoxes: FaceBox[] = [];
    if (segment) {
      const sourceMs = segment.clip.inMs + (atMs - segment.startMs) * segment.clip.speed;
      const track = faces.get(segment.clip.asset);
      const frame = nearestFaceFrame(track?.frames ?? [], sourceMs);
      const video = timeline.videos.find((item) => item.id === segment.clip.id);
      const asset = project.assets[segment.clip.asset];
      const dims = assetDimensions.get(segment.clip.asset);
      if (frame && video && asset && dims) {
        const localFrame = msToFrame(atMs, timeline.fps) - video.from;
        const transform = transformAt(video.transform, video.keyframes, localFrame);
        projectBoxes.push(
          ...frame.boxes.map((box) =>
            transformFaceBoxToCanvas(box, dims, project.canvas, transform),
          ),
        );
      } else if (frame) {
        projectBoxes.push(...frame.boxes);
      }
    }
    const referenceFrame = nearestFaceFrame(referenceFaces?.frames ?? [], atMs);
    const referenceBoxes = referenceFrame?.boxes ?? [];
    const { matches, projectOnly, referenceOnly } = pairFaces(projectBoxes, referenceBoxes);
    samples.push({ atMs, projectBoxes, referenceBoxes, matches, projectOnly, referenceOnly });
  }
  const deltas = samples.flatMap((sample) => sample.matches.map((match) => match.delta));
  const meanDelta = deltas.length
    ? {
        dx: deltas.reduce((sum, value) => sum + value.dx, 0) / deltas.length,
        dy: deltas.reduce((sum, value) => sum + value.dy, 0) / deltas.length,
        distance: deltas.reduce((sum, value) => sum + value.distance, 0) / deltas.length,
      }
    : null;
  return { available: true, intervalMs, samples, meanDelta, warnings };
}

function nearestFaceFrame(
  frames: { ms: number; boxes: FaceBox[] }[],
  atMs: number,
): { ms: number; boxes: FaceBox[] } | null {
  let best: { ms: number; boxes: FaceBox[] } | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const frame of frames) {
    const candidate = Math.abs(frame.ms - atMs);
    if (candidate < distance) {
      best = frame;
      distance = candidate;
    }
  }
  return best;
}

function pairFaces(project: FaceBox[], reference: FaceBox[]) {
  const used = new Set<number>();
  const matches: {
    projectBox: FaceBox;
    referenceBox: FaceBox;
    delta: { dx: number; dy: number; distance: number };
  }[] = [];
  const projectOnly: FaceBox[] = [];
  for (const projectBox of project) {
    let nearest = -1;
    let distance = Number.POSITIVE_INFINITY;
    reference.forEach((referenceBox, index) => {
      if (used.has(index)) return;
      const delta = faceCenterDelta(projectBox, referenceBox);
      if (delta && delta.distance < distance) {
        nearest = index;
        distance = delta.distance;
      }
    });
    const referenceBox = reference[nearest];
    const delta = referenceBox ? faceCenterDelta(projectBox, referenceBox) : null;
    if (nearest >= 0 && referenceBox && delta) {
      used.add(nearest);
      matches.push({ projectBox, referenceBox, delta });
    } else {
      projectOnly.push(projectBox);
    }
  }
  return {
    matches,
    projectOnly,
    referenceOnly: reference.filter((_, index) => !used.has(index)),
  };
}

async function compareCaptionWraps(
  shots: CaptionShot[],
  projectFrameByNumber: Map<number, string>,
  referenceFrameByTime: Map<number, string>,
) {
  if (shots.length === 0)
    return { available: true, total: 0, compared: 0, same: [], differences: [], warnings: [] };
  const images = shots.flatMap((shot) => [
    projectFrameByNumber.get(shot.frame) ?? "",
    referenceFrameByTime.get(shot.referenceAtMs) ?? "",
  ]);
  const recognizedByFrame = await recognizeText(images);
  if (!recognizedByFrame) {
    return {
      available: false,
      total: shots.length,
      compared: 0,
      same: [],
      differences: [],
      warnings: ["字幕 OCR 使用 macOS Vision，仅在支持 swiftc 的 macOS 上可用"],
    };
  }
  const rows = shots.map((shot, index) => {
    const projectRows = recognizedByFrame[index * 2] ?? [];
    const referenceRows = recognizedByFrame[index * 2 + 1] ?? [];
    const projectLines = matchCaptionLines(projectRows, shot.text, shot.expectedY);
    // 参考成片的断句可能和工程不同：对不上工程的字时，直接取字幕那一带识别出的文字
    const matched = matchCaptionLines(referenceRows, shot.text);
    const band =
      matched.length === 0 && shot.expectedY !== undefined
        ? captionBandLines(referenceRows, shot.expectedY)
        : [];
    const referenceLines = matched.length > 0 ? matched : band;
    const wrap = compareCaptionWrap(projectLines, referenceLines);
    const recognizedProject = projectLines.length > 0;
    const recognizedReference = referenceLines.length > 0;
    const wrapComparable = recognizedProject && recognizedReference && wrap.sameText;
    return {
      id: shot.id,
      atMs: shot.atMs,
      referenceAtMs: shot.referenceAtMs,
      text: shot.text,
      projectLines,
      referenceLines,
      ...wrap,
      sameWrap: wrapComparable && wrap.sameWrap,
      wrapComparable,
      recognizedProject,
      recognizedReference,
      /** 参考这一侧的字和工程这句对不上，是按字幕位置取的原文 */
      referenceFromBand: matched.length === 0 && band.length > 0,
    };
  });
  const differences = rows.filter((row) => !row.sameWrap);
  const recognizedPairs = rows.filter((row) => row.recognizedProject && row.recognizedReference);
  const warnings: string[] = [];
  const unrecognizedCount = rows.length - recognizedPairs.length;
  const textMismatchCount = recognizedPairs.filter((row) => !row.sameText).length;
  if (unrecognizedCount > 0)
    warnings.push(`${unrecognizedCount} 条字幕至少一侧 OCR 没认出来，已跳过换行比较`);
  if (textMismatchCount > 0)
    warnings.push(
      `${textMismatchCount} 条两边的字不一样（参考成片断句不同，或 OCR 认错字），看 referenceLines`,
    );
  return {
    available: true,
    total: rows.length,
    compared: rows.filter((row) => row.wrapComparable).length,
    recognized: recognizedPairs.length,
    /** 两边字和换行都一样的字幕 */
    same: rows.filter((row) => row.sameWrap).map((row) => row.id),
    /** 只列不一样或没法比的 */
    differences,
    warnings,
  };
}

/** 工程成片某一时刻放的是原片的哪一毫秒（主轨上不是视频时为 null） */
function projectSourceMs(project: Project, atMs: number): number | null {
  const segment = layoutMainTrack(project).find((s) => atMs >= s.startMs && atMs < s.endMs);
  if (!segment) return null;
  return segment.clip.inMs + (atMs - segment.startMs) * segment.clip.speed;
}

/**
 * 用音频对齐估计参考成片从原片哪里开始、几倍速，和工程主轨的第一段对照。
 * 假设参考成片中间没有剪；score 低说明有剪辑或音频不是同一段
 */
async function compareTiming(
  dir: string,
  project: Project,
  reference: string,
  referenceDurationMs: number,
) {
  const segments = layoutMainTrack(project);
  const first = segments[0];
  const asset = first ? project.assets[first.clip.asset] : undefined;
  const projectFit = first
    ? {
        sourceStartMs: Math.round(first.clip.inMs),
        speed: first.clip.speed,
        segments: segments.length,
      }
    : null;
  if (!first || !asset) return { available: false as const, project: projectFit, reference: null };
  const outroMs = project.outro ? (project.assets[project.outro.asset]?.probe?.durationMs ?? 0) : 0;
  let fit: TimingFit | null = null;
  try {
    const rate = 8000;
    const [source, edited] = await Promise.all([
      decodeAudioSamples(resolve(dir, asset.path), rate),
      decodeAudioSamples(reference, rate),
    ]);
    fit = fitTiming(loudnessEnvelope(source, rate), loudnessEnvelope(edited, rate), {
      // 避开片尾：至少去掉和工程片尾一样长的一段
      usedMs: Math.max(3000, referenceDurationMs - Math.max(outroMs, 2000)),
    });
  } catch {
    fit = null;
  }
  return {
    available: fit !== null,
    project: projectFit,
    reference: fit,
    ...(fit && projectFit
      ? {
          startDeltaMs: projectFit.sourceStartMs - fit.sourceStartMs,
          speedDelta: Math.round((projectFit.speed - fit.speed) * 100) / 100,
        }
      : {}),
    caveat: "按整段线性对齐估的：参考成片中间有剪时只对前面一段准，score 低于 0.4 不可信",
  };
}

/** 几处同一时刻的并排小图（每对左边是工程、右边是参考），排成 3 列 */
async function combineSheet(pairs: [string, string][], output: string) {
  if (pairs.some(([a, b]) => !a || !b)) throw new MwError("RENDER", "没有找到用于合成的对比帧");
  const h = 480;
  const inputs = pairs.flat().flatMap((file) => ["-i", file]);
  const scaled = pairs
    .flat()
    .map((_, i) => `[${i}:v]scale=-2:${h}:flags=lanczos,setsar=1[v${i}]`)
    .join(";");
  const pairsFilter = pairs
    .map((_, i) => `[v${i * 2}][v${i * 2 + 1}]hstack=inputs=2[p${i}]`)
    .join(";");
  const cols = 3;
  const layout = pairs
    .map(
      (_, i) =>
        `${i % cols === 0 ? "0" : Array.from({ length: i % cols }, (_, k) => `w${k}`).join("+")}_${Math.floor(i / cols) === 0 ? "0" : "h0"}`,
    )
    .join("|");
  const filter = `${scaled};${pairsFilter};${pairs.map((_, i) => `[p${i}]`).join("")}xstack=inputs=${pairs.length}:layout=${layout}[out]`;
  try {
    await run(
      ffmpegBin(),
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        ...inputs,
        "-filter_complex",
        filter,
        "-map",
        "[out]",
        "-frames:v",
        "1",
        output,
      ],
      { maxBuffer: 1 << 24 },
    );
  } catch (e) {
    throw new MwError("MEDIA", "无法合成对比小图", {
      hint: String((e as Error).message).slice(0, 300),
    });
  }
}
