import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { mwHome } from "./paths";

const run = promisify(execFile);

const SWIFT = `import Foundation
import Vision
import AppKit
for path in CommandLine.arguments.dropFirst() {
  guard let img = NSImage(contentsOfFile: path),
        let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { print("[]"); continue }
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.usesLanguageCorrection = false
  req.recognitionLanguages = ["zh-Hans", "en-US"]
  try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
  let rows = (req.results ?? []).compactMap { row -> [String: Any]? in
    guard let text = row.topCandidates(1).first?.string else { return nil }
    let b = row.boundingBox
    return ["text": text,
            "x": b.origin.x,
            "y": 1 - b.origin.y - b.size.height,
            "w": b.size.width,
            "h": b.size.height]
  }
  let data = try! JSONSerialization.data(withJSONObject: rows)
  print(String(data: data, encoding: .utf8)!)
}
`;

export type OCRLine = { text: string; x: number; y: number; w: number; h: number };

/** 使用 macOS Vision 的内置 OCR；非 macOS 或没有 swiftc 时返回 null，不装额外模型。 */
export async function recognizeText(images: string[]): Promise<OCRLine[][] | null> {
  if (images.length === 0) return [];
  if (process.platform !== "darwin") return null;
  const bin = await detector();
  if (!bin) return null;
  const lines: OCRLine[][] = [];
  for (let start = 0; start < images.length; start += 100) {
    const batch = images.slice(start, start + 100);
    const { stdout } = await run(bin, batch, { maxBuffer: 1 << 26 });
    const rows = stdout.trim().split("\n");
    batch.forEach((_, index) => {
      const parsed = JSON.parse(rows[index] ?? "[]") as OCRLine[];
      lines.push(
        parsed
          .filter((line) => line.text.trim().length > 0)
          .toSorted((a, b) => (Math.abs(a.y - b.y) > 0.015 ? a.y - b.y : a.x - b.x)),
      );
    });
  }
  return lines;
}

async function detector(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  const hash = createHash("sha1").update(SWIFT).digest("hex").slice(0, 10);
  const dir = join(mwHome(), "tools");
  const bin = join(dir, `ocr-${hash}`);
  if (existsSync(bin)) return bin;
  await mkdir(dir, { recursive: true });
  const src = join(dir, `ocr-${hash}.swift`);
  await writeFile(src, SWIFT);
  try {
    await run("swiftc", ["-O", "-o", bin, src]);
    return bin;
  } catch {
    return null;
  } finally {
    await rm(src, { force: true });
  }
}
