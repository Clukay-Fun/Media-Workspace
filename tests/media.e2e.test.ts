import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importAsset } from "../src/node/actions";
import { setLayout } from "../src/node/library";
import { importMedia, needsNormalize, probeMedia } from "../src/node/media";
import { initProject, loadProject } from "../src/node/store";

let root: string;
let dir: string;
const ffmpeg = process.env.MW_FFMPEG ?? "ffmpeg";

/** 用 ffmpeg 生成测试素材，测试不依赖用户的真实素材 */
function make(out: string, args: string[]) {
  execFileSync(ffmpeg, ["-v", "error", "-y", ...args, out]);
  return out;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "mw-media-"));
  dir = join(root, "demo.mwproj");
  await initProject(dir);
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("素材导入", () => {
  it("25fps、44.1k 的素材需要标准化，转换后是 30fps H.264 + AAC 48k", async () => {
    const src = make(join(root, "in25.mp4"), [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=360x640:rate=25:duration=2",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=44100:duration=2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
    ]);
    const p = await probeMedia(src);
    expect(p).toMatchObject({ kind: "video", width: 360, height: 640, fps: 25, hasAudio: true });
    expect(needsNormalize(p)).toBe(true);

    const r = await importMedia(dir, src);
    expect(r.asset.cache?.mez).toMatch(/^cache\/media\/[0-9a-f]{16}\.mez\.mp4$/);
    expect(r.asset.cache?.proxy).toBeDefined();
    const mez = await probeMedia(join(dir, r.asset.cache?.mez ?? ""));
    expect(mez).toMatchObject({
      videoCodec: "h264",
      pixFmt: "yuv420p",
      fps: 30,
      audioCodec: "aac",
      sampleRate: 48_000,
    });
    expect(needsNormalize(mez)).toBe(false);
    expect(Math.abs(mez.durationMs - 2000)).toBeLessThan(100);

    const peaks = JSON.parse(await readFile(join(dir, r.asset.cache?.peaks ?? ""), "utf8"));
    expect(peaks.msPerPeak).toBe(10);
    expect(peaks.peaks.length).toBeGreaterThan(190);

    // 重复导入直接复用缓存
    const again = await importMedia(dir, src);
    expect(again.created).toEqual([]);
    expect(again.asset.fingerprint).toBe(r.asset.fingerprint);
  });

  it("已经是标准格式的素材不转换", async () => {
    const src = make(join(root, "in30.mp4"), [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=360x640:rate=30:duration=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-shortest",
    ]);
    const r = await importMedia(dir, src, { proxy: false });
    expect(r.asset.cache?.mez).toBeUndefined();
    expect(r.asset.kind).toBe("video");
  });

  it("mw import：主轨空着时视频整段放上主轨，倍速按账号设置；主轨有片段后只导入", async () => {
    const home = process.env.MW_HOME;
    process.env.MW_HOME = join(root, "home");
    try {
      await setLayout({ speed: 1.2 });
      const proj = join(root, "auto-main.mwproj");
      await initProject(proj);
      const src = make(join(root, "auto.mp4"), [
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=360x640:rate=30:duration=1",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
      ]);
      const who = { source: "cli" as const, actor: "test" };
      const first = await importAsset(proj, src, { ...who, proxy: false });
      expect(first).toMatchObject({ asset: "a1", mainClip: "c1", speed: 1.2 });
      const second = await importAsset(proj, src, { ...who, proxy: false });
      expect(second).not.toHaveProperty("mainClip");
      const p = await loadProject(proj);
      const main = p.tracks.find((t) => t.kind === "video" && t.main);
      expect(main?.items).toEqual([
        expect.objectContaining({ id: "c1", asset: "a1", inMs: 0, speed: 1.2 }),
      ]);
    } finally {
      if (home === undefined) delete process.env.MW_HOME;
      else process.env.MW_HOME = home;
    }
  });

  it("图片只记录尺寸", async () => {
    const src = make(join(root, "img.png"), [
      "-f",
      "lavfi",
      "-i",
      "color=red:size=200x100",
      "-frames:v",
      "1",
    ]);
    const r = await importMedia(dir, src);
    expect(r.asset).toMatchObject({
      kind: "image",
      probe: { width: 200, height: 100, durationMs: 0 },
    });
    expect(r.asset.cache).toBeUndefined();
  });

  it("读不了的文件报 MEDIA", async () => {
    await expect(probeMedia(join(root, "nope.mp4"))).rejects.toMatchObject({ code: "MEDIA" });
  });
});
