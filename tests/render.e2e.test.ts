import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compile } from "../src/core/compile";
import { coverView } from "../src/core/cover";
import { BUILTIN_STYLES } from "../src/core/presets";
import { attachOutro, coverProject, removeOutro } from "../src/node/actions";
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

// 阶段 D 的画面能力（docs/decisions/0017）：主轨转场、画中画（横屏素材 + 关键帧）、图片（入场动画 + 关键帧），
// 每一项都在动的那几帧上比对截图和导出。
describe("画面能力", () => {
  let vdir: string;
  const lavfi = (src: string, out: string, extra: string[] = []) =>
    execFileSync(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", src, ...extra, out]);

  const build = async (type: "slide" | "push") => {
    const d = join(root, `v-${type}.mwproj`);
    await initProject(d);
    const imp = (f: string) => importMedia(d, f, { proxy: false, peaks: false, faces: false });
    const [m, v, i] = [await imp(media.main), await imp(media.pip), await imp(media.png)];
    await applyToProject(d, {
      baseRevision: 0,
      source: "cli",
      actor: "test",
      ops: [
        { op: "asset.add", id: "m", asset: m.asset },
        { op: "asset.add", id: "v", asset: v.asset },
        { op: "asset.add", id: "i", asset: i.asset },
        { op: "canvas.update", set: { width: 540, height: 960 } },
        {
          op: "item.add",
          track: "main",
          item: { id: "c1", type: "clip", asset: "m", inMs: 0, outMs: 2000 },
        },
        {
          op: "item.add",
          track: "main",
          item: {
            id: "c2",
            type: "clip",
            asset: "m",
            inMs: 2000,
            outMs: 4000,
            transitionIn: { type, direction: "left", durationMs: 500 },
          },
        },
        { op: "track.add", track: { id: "pip", kind: "video", items: [] } },
        {
          op: "item.add",
          track: "pip",
          item: {
            id: "p1",
            type: "clip",
            asset: "v",
            at: { ms: 0 },
            inMs: 0,
            outMs: 3000,
            gainDb: -60,
            transform: { scale: 0.4 },
            // 视频的入场动画要有位移和缩放（不只是透明度）；循环呼吸（v6）
            animIn: { preset: "pop", durationMs: 800 },
            animLoop: { preset: "breathe", durationMs: 1000, intensity: 3 },
            keyframes: [
              { atMs: 0, transform: { x: 150, y: 200 } },
              { atMs: 3000, transform: { x: 390, y: 760, radius: 24 } },
            ],
          },
        },
        {
          op: "item.add",
          track: "pip",
          item: {
            id: "i1",
            type: "image",
            asset: "i",
            at: { ms: 500 },
            durationMs: 2500,
            transform: { scale: 0.3 },
            animIn: { preset: "fade-up", durationMs: 600 },
            keyframes: [
              { atMs: 0, transform: { y: 480, rotation: 0 } },
              { atMs: 2500, transform: { y: 300, rotation: 20 } },
            ],
          },
        },
      ],
    });
    return d;
  };

  const media = { main: "", pip: "", png: "" };

  beforeAll(async () => {
    media.main = join(root, "main.mp4");
    media.pip = join(root, "pip.mp4");
    media.png = join(root, "img.png");
    lavfi("testsrc2=size=540x960:rate=30:duration=4", media.main, ["-pix_fmt", "yuv420p"]);
    // 横屏素材做画中画：检查 contain 缩放后的位置
    lavfi("smptebars=size=960x540:rate=30:duration=4", media.pip, ["-pix_fmt", "yuv420p"]);
    lavfi("testsrc=size=400x300", media.png, ["-frames:v", "1"]);
    vdir = await build("slide");
  }, 120_000);

  it("转场、画中画、图片动起来的帧：截图和导出一致", async () => {
    const p = await loadProject(vdir);
    const tl = compile(p);
    // 主轨转场不占时间（0019）：4000ms → 120 帧；转场在第 60–75 帧
    expect(tl.durationInFrames).toBe(120);
    const out = join(root, "visual.mp4");
    await exportVideo(vdir, p, { out, concurrency: 2 });
    // 第 20 帧：图片和画中画入场动画中；第 66 帧：转场中、画中画和图片在关键帧之间；第 95 帧：转场后
    const frames = [20, 66, 95];
    const stills = await renderStills(vdir, p, frames, join(root, "visual-stills"));
    frames.forEach((f, k) => {
      expect(psnr(out, stills[k] ?? "", f), `第 ${f} 帧`).toBeGreaterThan(35);
    });
    // 错一帧时明显对不上，说明上面比的确实是在动的画面
    expect(psnr(out, stills[1] ?? "", 72)).toBeLessThan(psnr(out, stills[1] ?? "", 66));
  });

  it("slide 和 push 画面不同：slide 的旧画面不动，push 的旧画面被推走", async () => {
    const pushDir = await build("push");
    const [a] = await renderStills(vdir, await loadProject(vdir), [66], join(root, "s-slide"));
    const [b] = await renderStills(pushDir, await loadProject(pushDir), [66], join(root, "s-push"));
    const r = spawnSync(
      ffmpeg,
      ["-i", a ?? "", "-i", b ?? "", "-filter_complex", "psnr", "-f", "null", "-"],
      { encoding: "utf8" },
    );
    expect(Number(/average:([0-9.]+|inf)/.exec(r.stderr)?.[1] ?? 0)).toBeLessThan(25);
  }, 120_000);
});

// 阶段 E 的卡片框架（docs/decisions/0022）：半屏卡出现时主画面上移；封面只有主画面和封面标题
describe("卡片和封面", () => {
  let d: string;
  const crop = (a: string, b: string, filter: string) => {
    const r = spawnSync(
      ffmpeg,
      [
        "-i",
        a,
        "-i",
        b,
        "-filter_complex",
        `[0]${filter}[x];[1]${filter}[y];[x][y]psnr`,
        "-f",
        "null",
        "-",
      ],
      { encoding: "utf8" },
    );
    const v = /average:([0-9.]+|inf)/.exec(r.stderr)?.[1] ?? "0";
    return v === "inf" ? Number.POSITIVE_INFINITY : Number(v);
  };
  const setSize = async (size: "half" | "small") => {
    const p = await loadProject(d);
    await applyToProject(d, {
      baseRevision: p.revision,
      source: "cli",
      actor: "test",
      ops: [{ op: "item.update", id: "k1", set: { size } }],
    });
    return loadProject(d);
  };

  beforeAll(async () => {
    d = join(root, "card.mwproj");
    await initProject(d);
    const src = join(root, "card-src.mp4");
    execFileSync(ffmpeg, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=540x960:rate=30:duration=3",
      "-pix_fmt",
      "yuv420p",
      src,
    ]);
    const m = await importMedia(d, src, { proxy: false, peaks: false, faces: false });
    const cap = noto(BUILTIN_STYLES["caption-word-yellow"]);
    await applyToProject(d, {
      baseRevision: 0,
      source: "cli",
      actor: "test",
      ops: [
        { op: "asset.add", id: "m", asset: m.asset },
        { op: "canvas.update", set: { width: 540, height: 960 } },
        {
          op: "item.add",
          track: "main",
          item: { id: "c1", type: "clip", asset: "m", inMs: 0, outMs: 3000 },
        },
        {
          op: "style.add",
          id: "cap",
          style: { ...cap, layout: { ...cap.layout, x: 270, y: 600, maxWidth: 480 } },
        },
        { op: "style.add", id: "card", style: noto(BUILTIN_STYLES["card-white"]) },
        { op: "style.add", id: "title", style: noto(BUILTIN_STYLES["title-bar-yellow"]) },
        { op: "track.update", id: "captions", set: { style: "cap" } },
        {
          op: "caption.import",
          track: "captions",
          timebase: "source",
          asset: "m",
          srt: "1\n00:00:00,000 --> 00:00:03,000\n封面上不该有这句\n",
        },
        {
          op: "item.add",
          track: "titles",
          item: {
            id: "k1",
            template: "text-card",
            size: "half",
            at: { ms: 1000 },
            durationMs: 1500,
            style: "card",
            props: { title: "要点", body: "半屏卡" },
          },
        },
        {
          op: "cover.update",
          set: {
            atMs: 1500,
            title: { template: "title-bar", style: "title", props: { lines: ["封面"] } },
          },
        },
      ],
    });
  }, 120_000);

  it("半屏卡：主画面上移的帧截图和导出一致，上半屏和小卡时不同", async () => {
    const p = await loadProject(d);
    const tl = compile(p);
    // 第 30–75 帧是半屏卡，前后各 12 帧上移 / 回落
    expect(tl.mainShifts).toEqual([{ from: 30, to: 75, rampFrames: 12 }]);
    const out = join(root, "card.mp4");
    await exportVideo(d, p, { out, concurrency: 2 });
    const frames = [20, 36, 55];
    const stills = await renderStills(d, p, frames, join(root, "card-stills"));
    frames.forEach((f, k) => {
      expect(psnr(out, stills[k] ?? "", f), `第 ${f} 帧`).toBeGreaterThan(35);
    });
    // 上半屏卡片盖不到：上移了画面就不同，没上移就一样
    const small = await renderStills(d, await setSize("small"), [20, 55], join(root, "card-small"));
    const top = "crop=540:300:0:0";
    expect(crop(stills[2] ?? "", small[1] ?? "", top)).toBeLessThan(25);
    expect(crop(stills[0] ?? "", small[0] ?? "", top)).toBeGreaterThan(40);
    await setSize("half");
  }, 180_000);

  it("封面：只有主画面和封面标题，没有字幕和卡片", async () => {
    const p = await loadProject(d);
    const r = await coverProject(d, { out: join(root, "cover.png") });
    expect(r.frame).toBe(45);
    const [clean] = await renderStills(d, coverView(p), [45], join(root, "cover-clean"));
    const [full] = await renderStills(d, p, [45], join(root, "cover-full"));
    expect(crop(r.file, clean ?? "", "null")).toBeGreaterThan(40);
    // 完整画面在第 45 帧有字幕和半屏卡，下半屏明显不同
    expect(crop(r.file, full ?? "", "crop=540:480:0:480")).toBeLessThan(25);
  }, 180_000);

  it("接片尾：导入文件、叠化接在主轨后面；再接一次复用同一个素材", async () => {
    const file = join(root, "outro-src.mp4");
    execFileSync(ffmpeg, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "smptebars=size=540x960:rate=30:duration=1",
      "-pix_fmt",
      "yuv420p",
      file,
    ]);
    const who = { source: "cli" as const, actor: "test" };
    const r = await attachOutro(d, { ...who, file });
    expect(r.outro).toBe("outro");
    const tl = compile(await loadProject(d));
    // 主轨 90 帧，片尾 30 帧，叠化 300ms（9 帧）重叠
    expect(tl.outro).toMatchObject({ asset: "outro", from: 81 });
    expect(tl.durationInFrames).toBe(111);
    expect((await attachOutro(d, { ...who, file, fadeMs: 0 })).outro).toBe("outro");
    expect(Object.keys((await loadProject(d)).assets)).toEqual(["m", "outro"]);
    await removeOutro(d, who);
    expect((await loadProject(d)).outro).toBeNull();
  }, 120_000);
});
