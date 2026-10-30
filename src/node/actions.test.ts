import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Caption, type MainClip, Project } from "../core/schema";
import { restoreCut } from "./actions";
import { applyToProject, initProject, loadProject } from "./store";

let root: string;
let dir: string;

const start = Project.parse({
  version: 6,
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

  it("dry-run 不写入", async () => {
    await cutS2(0);
    await restoreCut(dir, "c1-1", { source: "cli", actor: "test", dryRun: true });
    expect((await loadProject(dir)).revision).toBe(1);
  });
});
