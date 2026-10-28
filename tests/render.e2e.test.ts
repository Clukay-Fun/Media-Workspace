import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compile } from "../src/core/compile";
import { BUILTIN_STYLES } from "../src/core/presets";
import { importMedia } from "../src/node/media";
import { exportVideo, renderStills } from "../src/node/render";
import { applyToProject, initProject, loadProject } from "../src/node/store";

// 渲染端到端：生成素材 → 用操作搭工程 → 导出 → 截图和导出的对应帧一致（黄金帧测试）。
// 只用 Noto Sans SC（pnpm fonts:fetch-test），不依赖普惠体。

const ffmpeg = process.env.MW_FFMPEG ?? "ffmpeg";
let root: string;
let dir: string;

const noto = <T extends { font: { family: string; fallback: string[] } }>(s: T): T => ({
  ...s,
  font: { ...s.font, family: "noto-sans-sc", fallback: [] },
});

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "mw-render-"));
  dir = join(root, "r.mwproj");
  await initProject(dir);
  const src = join(root, "src.mp4");
  execFileSync(ffmpeg, [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=540x960:rate=25:duration=4",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=44100:duration=4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    src,
  ]);
  const a = await importMedia(dir, src, { proxy: false, peaks: false });
  await applyToProject(dir, {
    baseRevision: 0,
    source: "cli",
    actor: "test",
    ops: [
      { op: "asset.add", id: "a1", asset: a.asset },
      { op: "canvas.update", set: { width: 540, height: 960 } },
      {
        op: "item.add",
        track: "main",
        item: { id: "c1", type: "clip", asset: "a1", inMs: 500, outMs: 3500, speed: 1.5 },
      },
      { op: "style.add", id: "cap", style: noto(BUILTIN_STYLES["caption-word-yellow"]) },
      { op: "style.add", id: "title", style: noto(BUILTIN_STYLES["title-bar-yellow"]) },
      { op: "track.update", id: "captions", set: { style: "cap" } },
      {
        op: "caption.import",
        track: "captions",
        timebase: "source",
        asset: "a1",
        srt: "1\n00:00:00,600 --> 00:00:02,000\n测试字幕高亮\n\n2\n00:00:02,000 --> 00:00:03,400\n第二句\n",
      },
      {
        op: "item.add",
        track: "titles",
        item: {
          id: "t1",
          template: "title-bar",
          at: { ms: 0 },
          durationMs: "toEnd",
          style: "title",
          props: { lines: ["标题"] },
        },
      },
    ],
  });
}, 120_000);
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function psnr(a: string, b: string, frame: number): number {
  // ffmpeg 把 psnr 统计写到 stderr
  const r = spawnSync(
    ffmpeg,
    [
      "-i",
      a,
      "-i",
      b,
      "-filter_complex",
      `[0]select=eq(n\\,${frame}),setpts=N[x];[1]setpts=N[y];[x][y]psnr`,
      "-frames:v",
      "1",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  return Number(/average:([0-9.]+|inf)/.exec(r.stderr)?.[1] ?? 0);
}

describe("渲染", () => {
  it("导出的帧数和 compile 一致；截图和导出的对应帧一致", async () => {
    const p = await loadProject(dir);
    const tl = compile(p);
    // (3500 - 500) / 1.5 = 2000ms → 60 帧
    expect(tl.durationInFrames).toBe(60);
    const out = join(root, "out.mp4");
    const r = await exportVideo(dir, p, { out, concurrency: 2 });
    expect(r.frames).toBe(60);
    const n = Number(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-count_frames",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=nb_read_frames",
          "-of",
          "csv=p=0",
          out,
        ],
        {
          encoding: "utf8",
        },
      ).trim(),
    );
    expect(n).toBe(60);
    const [still] = await renderStills(dir, p, [20], join(root, "stills"));
    // 导出是 H.264 有损压缩，截图是 PNG；35dB 以上说明画面内容一致（错一帧或字幕位置不同会明显更低）
    expect(psnr(out, still ?? "", 20)).toBeGreaterThan(35);
    expect(psnr(out, still ?? "", 35)).toBeLessThan(psnr(out, still ?? "", 20));
  });
});
