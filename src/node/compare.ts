import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { transformAt } from "../core/animate";
import {
  compareCaptionWrap,
  compareCutPoints,
  type FaceBox,
  faceCenterDelta,
  matchCaptionLines,
  transformFaceBoxToCanvas,
} from "../core/compare";
import { compile, layoutMainTrack } from "../core/compile";
import { MwError } from "../core/errors";
import { isMainClip, type Project } from "../core/schema";
import { frameToMs, msToFrame } from "../core/time";
import { detectFaces, readFaces } from "./faces";
import { probeMedia } from "./media";
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
  expectedY?: number;
};

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
  const captionShots = collectCaptionShots(project, timeline).filter(
    (shot) => shot.atMs < comparisonEndMs,
  );
  const frames = [...new Set([atFrame, ...captionShots.map((shot) => shot.frame)])];
  const sampleTimes = [...new Set([renderedAtMs, ...captionShots.map((shot) => shot.atMs)])];
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
        ...compareCutPoints(projectCutPoints, referenceCutPoints, cutToleranceMs),
      },
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
  if (shots.length === 0) return { available: true, compared: 0, differences: [], warnings: [] };
  const images = shots.flatMap((shot) => [
    projectFrameByNumber.get(shot.frame) ?? "",
    referenceFrameByTime.get(shot.atMs) ?? "",
  ]);
  const recognizedByFrame = await recognizeText(images);
  if (!recognizedByFrame) {
    return {
      available: false,
      compared: 0,
      differences: [],
      warnings: ["字幕 OCR 使用 macOS Vision，仅在支持 swiftc 的 macOS 上可用"],
    };
  }
  const differences = shots.map((shot, index) => {
    const projectRows = recognizedByFrame[index * 2] ?? [];
    const referenceRows = recognizedByFrame[index * 2 + 1] ?? [];
    const projectLines = matchCaptionLines(projectRows, shot.text, shot.expectedY);
    const referenceLines = matchCaptionLines(referenceRows, shot.text);
    const wrap = compareCaptionWrap(projectLines, referenceLines);
    const recognizedProject = projectLines.length > 0;
    const recognizedReference = referenceLines.length > 0;
    const wrapComparable = recognizedProject && recognizedReference && wrap.sameText;
    return {
      id: shot.id,
      atMs: shot.atMs,
      text: shot.text,
      projectLines,
      referenceLines,
      ...wrap,
      sameWrap: wrapComparable && wrap.sameWrap,
      wrapComparable,
      recognizedProject,
      recognizedReference,
    };
  });
  const recognizedPairs = differences.filter(
    (row) => row.recognizedProject && row.recognizedReference,
  );
  const warnings: string[] = [];
  const unrecognizedCount = differences.length - recognizedPairs.length;
  const textMismatchCount = recognizedPairs.filter((row) => !row.sameText).length;
  if (unrecognizedCount > 0)
    warnings.push(`${unrecognizedCount} 条字幕至少一侧 OCR 未匹配，已跳过换行比较`);
  if (textMismatchCount > 0)
    warnings.push(`${textMismatchCount} 条字幕 OCR 文本不一致，无法可靠判断换行`);
  return {
    available: true,
    compared: differences.filter((row) => row.wrapComparable).length,
    recognized: recognizedPairs.length,
    differences,
    warnings,
  };
}
