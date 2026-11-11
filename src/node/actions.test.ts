import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Caption, type MainClip, Project } from "../core/schema";
import { PROJECT_FORMAT_VERSION } from "../core/version";
import { coverProject, facesProject, protectCaptionSpeechRanges, restoreCut } from "./actions";
import { applyToProject, initProject, loadProject } from "./store";

let root: string;
let dir: string;

const start = Project.parse({
  version: PROJECT_FORMAT_VERSION,
  revision: 0,
  canvas: {},
  assets: { a1: { kind: "video", path: "/raw.mov", probe: { durationMs: 20_000 } } },
  tracks: [
    {
      id: "main",
      kind: "video",
      main: true,
      items: [{ id: "c1", type: "clip", asset: "a1", inMs: 0, outMs: 10_000 }],
    },
    {
      id: "cap",
      kind: "caption",
      items: [
        { id: "s1", asset: "a1", startMs: 1000, endMs: 2000, text: "第一句话" },
        {
          id: "s2",
          asset: "a1",
          startMs: 2100,
          endMs: 3000,
          text: "第二句",
          charStartMs: [2100, 2400, 2700],
          highlights: [{ text: "二" }],
        },
        { id: "s3", asset: "a1", startMs: 4000, endMs: 5000, text: "第三句" },
      ],
    },
  ],
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mw-actions-"));
  dir = join(root, "demo.mwproj");
  await initProject(dir, start);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const cutS2 = (base: number) =>
  applyToProject(dir, {
    ops: [{ op: "cut.removeCaptions", ids: ["s2"] }],
    baseRevision: base,
    source: "cli",
    actor: "test",
  });

describe("静音剪切与字幕发音范围", () => {
  it("按逐字时间留出首字前和末字后的余量；没有逐字时间时保护整条字幕", () => {
    expect(
      protectCaptionSpeechRanges(
        [
          { startMs: 900, endMs: 1400 },
          { startMs: 1500, endMs: 1900 },
        ],
        [
          { startMs: 1000, endMs: 1200, charStartMs: [1050, 1100] },
          { startMs: 1600, endMs: 1700 },
        ],
      ),
    ).toEqual([
      { startMs: 900, endMs: 1000 },
      { startMs: 1350, endMs: 1400 },
      { startMs: 1500, endMs: 1600 },
      { startMs: 1700, endMs: 1900 },
    ]);
  });
});

describe("封面时间", () => {
  it("越界时明确报错且不渲染、不覆盖已有输出", async () => {
    await applyToProject(dir, {
      ops: [{ op: "cover.update", set: { atMs: 10_000 } }],
      baseRevision: 0,
      source: "cli",
      actor: "test",
    });
    const out = join(root, "existing.png");
    await writeFile(out, "existing cover");
    const onLog = vi.fn();
    await expect(coverProject(dir, { out, onLog })).rejects.toMatchObject({
      code: "TIME_RANGE",
      message: expect.stringContaining("10000ms"),
    });
    expect(await readFile(out, "utf8")).toBe("existing cover");
    expect(onLog).not.toHaveBeenCalled();
  });
});

describe("恢复剪辑点", () => {
  it("接回画面，并从历史里找回随删句删掉的字幕（逐字时间、高亮都在），一次提交", async () => {
    await cutS2(0);
    const r = await restoreCut(dir, "c1-1", { source: "ui", actor: "user" });
    expect(r).toMatchObject({ revision: 2, restoredMs: [2100, 3000], captions: ["s2"] });
    const p = await loadProject(dir);
    const clips = p.tracks[0]?.items as MainClip[];
    expect(clips.map((c) => [c.inMs, c.outMs])).toEqual([
      [0, 3000],
      [3000, 10_000],
    ]);
    const caps = p.tracks[1]?.items as Caption[];
    expect(caps.map((c) => c.id)).toEqual(["s1", "s2", "s3"]);
    expect(caps[1]).toMatchObject({
      charStartMs: [2100, 2400, 2700],
      highlights: [{ text: "二" }],
    });
  });

  it("找回的字幕和现有字幕重叠时不放回，列在 skipped 里", async () => {
    await cutS2(0);
    await applyToProject(dir, {
      ops: [
        {
          op: "item.add",
          track: "cap",
          item: { id: "s9", asset: "a1", startMs: 2200, endMs: 2800, text: "新写的" },
          index: 1,
        },
      ],
      baseRevision: 1,
      source: "cli",
      actor: "test",
    });
    const r = await restoreCut(dir, "c1-1", { source: "ui", actor: "user" });
    expect(r).toMatchObject({ captions: [], skipped: ["s2"] });
  });

  it("字幕在剪切前已经合并时，uncut 不把合并掉的旧 ID 列为 skipped", async () => {
    const split = await applyToProject(dir, {
      ops: [{ op: "caption.split", id: "s3", at: 1 }],
      baseRevision: 0,
      source: "cli",
      actor: "test",
    });
    const staleId = split.changed.find((id) => id !== "s3");
    expect(staleId).toBeDefined();
    await applyToProject(dir, {
      ops: [{ op: "caption.merge", ids: ["s3", staleId] }],
      baseRevision: 1,
      source: "cli",
      actor: "test",
    });
    await applyToProject(dir, {
      ops: [
        {
          op: "cut.removeSilence",
          asset: "a1",
          ranges: [{ startMs: 4500, endMs: 4600 }],
        },
      ],
      baseRevision: 2,
      source: "cli",
      actor: "test",
    });

    const r = await restoreCut(dir, "c1-1", { source: "ui", actor: "user" });
    expect(r).toMatchObject({ captions: [], skipped: [] });
  });

  it("dry-run 不写入", async () => {
    await cutS2(0);
    await restoreCut(dir, "c1-1", { source: "cli", actor: "test", dryRun: true });
    expect((await loadProject(dir)).revision).toBe(1);
  });
});

describe("faces 检测回执", () => {
  it("已有人脸缓存的素材带原因列在 skipped", async () => {
    await applyToProject(dir, {
      ops: [{ op: "asset.cache", id: "a1", set: { faces: "cache/media/a1.faces.json" } }],
      baseRevision: 0,
      source: "cli",
      actor: "test",
    });
    const r = await facesProject(dir, { source: "cli", actor: "test" });
    expect(r).toMatchObject({
      revision: 1,
      detected: [],
      skipped: [{ asset: "a1", reason: "已有人脸数据" }],
    });
  });
});
