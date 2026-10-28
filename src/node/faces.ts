import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { FaceTrack } from "../core/lint";
import { mwHome } from "./paths";

// 人脸检测（质检挡脸用，docs/decisions/0007）：用 macOS 自带的 Vision 框架，不装模型、不联网。
// 其他系统上跳过（质检不检查挡脸），不报错。

const run = promisify(execFile);
const ffmpegBin = () => process.env.MW_FFMPEG ?? "ffmpeg";

const SWIFT = `import Foundation
import Vision
import AppKit
// 每个参数是一张图片，每张输出一行 JSON：[{x,y,w,h}]，0–1 比例，原点在左上角
for path in CommandLine.arguments.dropFirst() {
  guard let img = NSImage(contentsOfFile: path),
        let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { print("[]"); continue }
  let req = VNDetectFaceRectanglesRequest()
  try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
  let boxes = (req.results ?? []).map { f -> String in
    let b = f.boundingBox
    return String(format: "{\\"x\\":%.4f,\\"y\\":%.4f,\\"w\\":%.4f,\\"h\\":%.4f}",
                  b.origin.x, 1 - b.origin.y - b.size.height, b.size.width, b.size.height)
  }
  print("[" + boxes.joined(separator: ",") + "]")
}
`;

/** 编译一次检测程序，放在 <MW_HOME>/tools 下复用（解释执行每次要编译约 8 秒） */
async function detector(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  const hash = createHash("sha1").update(SWIFT).digest("hex").slice(0, 10);
  const dir = join(mwHome(), "tools");
  const bin = join(dir, `faces-${hash}`);
  if (existsSync(bin)) return bin;
  await mkdir(dir, { recursive: true });
  const src = join(dir, `faces-${hash}.swift`);
  await writeFile(src, SWIFT);
  try {
    await run("swiftc", ["-O", "-o", bin, src]);
  } catch {
    // 没装 Xcode 命令行工具：跳过人脸检测
    return null;
  } finally {
    await rm(src, { force: true });
  }
  return bin;
}

/**
 * 每 intervalMs 抽一帧检测人脸。用代理文件抽帧（小、快），坐标是比例，和分辨率无关。
 * 返回 null 表示这台机器上做不了（不是 macOS 或没有 swiftc）。
 */
export async function detectFaces(
  video: string,
  workDir: string,
  intervalMs = 500,
): Promise<FaceTrack | null> {
  const bin = await detector();
  if (!bin) return null;
  const tmp = join(workDir, `faces-${process.pid}-${Date.now()}`);
  await mkdir(tmp, { recursive: true });
  try {
    await run(ffmpegBin(), [
      ...["-v", "error", "-i", video, "-vf", `fps=${1000 / intervalMs},scale=360:-2`],
      join(tmp, "%06d.png"),
    ]);
    const { readdir } = await import("node:fs/promises");
    const pngs = (await readdir(tmp)).filter((n) => n.endsWith(".png")).sort();
    const frames: FaceTrack["frames"] = [];
    // 一次传一批，避免命令行太长
    for (let i = 0; i < pngs.length; i += 200) {
      const batch = pngs.slice(i, i + 200);
      const { stdout } = await run(
        bin,
        batch.map((n) => join(tmp, n)),
        { maxBuffer: 1 << 24 },
      );
      stdout
        .trim()
        .split("\n")
        .forEach((line, j) => {
          // fps 滤镜输出的第 n 帧对应 n × 间隔的位置（取间隔中点更接近实际抽到的帧）
          frames.push({
            ms: Math.round((i + j) * intervalMs + intervalMs / 2),
            boxes: JSON.parse(line),
          });
        });
    }
    return { intervalMs, frames };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export async function readFaces(file: string): Promise<FaceTrack | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as FaceTrack;
  } catch {
    return null;
  }
}
