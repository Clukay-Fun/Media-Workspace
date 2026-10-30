import { z } from "zod";
import { layoutMainTrack } from "./compile";
import { MwError } from "./errors";
import {
  Anchor,
  Asset,
  Canvas,
  type Caption,
  Chapter,
  Cover,
  Id,
  Keyframe,
  Outro,
  type Project,
  Theme,
  type Track,
  Transform,
} from "./schema";
import { type CaptionImportOptions, cuesToCaptions, parseSrt, SrtError } from "./srt";
import { Easing, TextStyle } from "./text-style";
import { validate } from "./validate";

// 操作协议（PLAN 6）：所有修改都通过这里，一批操作要么全部生效，要么全部不生效。
// 纯函数：输入旧工程，返回新工程；写盘、加锁、revision 检查在 node/store 里。

const Patch = z.record(z.string(), z.unknown());
const AnyObj = z.record(z.string(), z.unknown());

export const Op = z.discriminatedUnion("op", [
  // 工程
  z.strictObject({ op: z.literal("canvas.update"), set: Canvas.partial() }),
  z.strictObject({ op: z.literal("theme.update"), set: Theme.partial() }),
  z.strictObject({ op: z.literal("cover.update"), set: Cover.nullable() }),
  z.strictObject({ op: z.literal("outro.set"), outro: Outro }),
  z.strictObject({ op: z.literal("outro.remove") }),
  /** 整体替换章节列表 */
  z.strictObject({ op: z.literal("chapters.set"), chapters: z.array(Chapter) }),
  // 素材
  z.strictObject({ op: z.literal("asset.add"), id: Id.optional(), asset: Asset }),
  z.strictObject({
    op: z.literal("asset.relink"),
    id: Id,
    path: z.string().min(1),
    fingerprint: z.string().optional(),
  }),
  z.strictObject({ op: z.literal("asset.remove"), id: Id }),
  /** 更新素材的缓存文件（例如补做人脸检测）；字段写 null 表示删掉 */
  z.strictObject({
    op: z.literal("asset.cache"),
    id: Id,
    set: z.partialRecord(z.enum(["mez", "proxy", "peaks", "faces"]), z.string().min(1).nullable()),
  }),
  // 轨道
  z.strictObject({ op: z.literal("track.add"), track: AnyObj, index: z.number().int().optional() }),
  z.strictObject({ op: z.literal("track.update"), id: Id, set: Patch }),
  z.strictObject({ op: z.literal("track.move"), id: Id, index: z.number().int().nonnegative() }),
  z.strictObject({ op: z.literal("track.remove"), id: Id }),
  // 条目（片段、图片、字幕、叠加层）
  z.strictObject({
    op: z.literal("item.add"),
    track: Id,
    item: AnyObj,
    index: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({ op: z.literal("item.update"), id: Id, set: Patch }),
  z.strictObject({
    op: z.literal("item.move"),
    id: Id,
    track: Id.optional(),
    index: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({ op: z.literal("item.remove"), id: Id }),
  /** atMs 是成片时间线上的毫秒（主轨片段）或相对片段开头的毫秒（普通轨道片段） */
  z.strictObject({ op: z.literal("clip.split"), id: Id, atMs: z.number().nonnegative() }),
  z.strictObject({
    op: z.literal("clip.trim"),
    id: Id,
    inMs: z.number().int().nonnegative().optional(),
    outMs: z.number().int().nonnegative().optional(),
  }),
  // 关键帧
  z.strictObject({
    op: z.literal("keyframe.set"),
    item: Id,
    atMs: z.number().int().nonnegative(),
    transform: Transform,
    easing: Easing.optional(),
  }),
  z.strictObject({
    op: z.literal("keyframe.remove"),
    item: Id,
    atMs: z.number().int().nonnegative(),
  }),
  // 字幕
  z.strictObject({
    op: z.literal("caption.import"),
    track: Id,
    /** SRT 文本。CLI 里可以写 srtFile，由 CLI 读出文件内容再提交 */
    srt: z.string(),
    timebase: z.enum(["source", "timeline"]),
    asset: Id.optional(),
    /** replace = 清空这条轨道原有的字幕 */
    mode: z.enum(["append", "replace"]).default("replace"),
  }),
  z.strictObject({ op: z.literal("caption.update"), id: Id, set: Patch }),
  z.strictObject({ op: z.literal("caption.remove"), ids: z.array(Id).min(1) }),
  z.strictObject({ op: z.literal("caption.merge"), ids: z.array(Id).min(2) }),
  z.strictObject({
    op: z.literal("caption.split"),
    id: Id,
    /** 从第几个字（Unicode 字符）处断开 */
    at: z.number().int().positive(),
    /** 不写时按字数比例估算 */
    atMs: z.number().int().nonnegative().optional(),
  }),
  // 字幕快剪
  z.strictObject({
    op: z.literal("cut.removeCaptions"),
    ids: z.array(Id).min(1),
    /** 同时删掉字幕本身（默认）；false 时只剪掉画面 */
    removeCaptions: z.boolean().default(true),
  }),
  z.strictObject({
    op: z.literal("cut.removePauses"),
    /** 按这条字幕轨道找停顿：相邻两句之间的空隙 */
    track: Id,
    minGapMs: z.number().int().positive().default(400),
    /** 每个停顿两边各保留的余量 */
    keepMs: z.number().int().nonnegative().default(120),
  }),
  /**
   * 恢复一个剪辑点：主轨片段 clip 前面剪掉的那段源时间接回来（前一个片段延长到 clip 的入点）。
   * 只恢复画面和声音；随删句一起删掉的字幕由 node 层从历史里找回，再用 item.add 加回去（docs/decisions/0016）
   */
  z.strictObject({ op: z.literal("cut.restore"), clip: Id }),
  // 样式
  z.strictObject({ op: z.literal("style.add"), id: Id, style: AnyObj }),
  z.strictObject({ op: z.literal("style.update"), id: Id, set: Patch }),
  z.strictObject({ op: z.literal("style.remove"), id: Id }),
]);
export type Op = z.infer<typeof Op>;
export const Ops = z.array(Op);

export type ApplyResult = {
  project: Project;
  /** 新建或修改过的对象 ID */
  changed: string[];
  warnings: { code: string; path: string; message: string }[];
};

export type ApplyOptions = { templates?: readonly string[] };

/** 应用一批操作。任何一步失败都抛 MwError，旧工程不受影响 */
export function applyOps(project: Project, rawOps: unknown, opts: ApplyOptions = {}): ApplyResult {
  const parsed = Ops.safeParse(rawOps);
  if (!parsed.success) {
    throw new MwError("INVALID_OP", "操作格式不对", {
      issues: parsed.error.issues.map((i) => ({
        code: i.code === "unrecognized_keys" ? "UNKNOWN_FIELD" : "INVALID_OP",
        path: `ops${i.path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("")}`,
        message: i.message,
      })),
    });
  }
  const draft = structuredClone(project);
  const ctx = new Ctx(draft);
  parsed.data.forEach((op, i) => {
    try {
      run(ctx, op);
    } catch (e) {
      if (e instanceof MwError) {
        throw new MwError(e.code, `第 ${i + 1} 个操作（${op.op}）失败：${e.message}`, {
          issues: e.issues.map((x) => ({ ...x, path: `ops[${i}]${x.path ? `: ${x.path}` : ""}` })),
        });
      }
      throw e;
    }
  });
  const result = validate(draft, opts);
  if (!result.ok) {
    throw new MwError(
      result.errors[0]?.code === "UNKNOWN_FIELD" ? "UNKNOWN_FIELD" : "VALIDATION",
      "操作后的工程不合法",
      {
        issues: result.errors,
      },
    );
  }
  return { project: result.project, changed: [...ctx.changed], warnings: result.warnings };
}

// 操作过程中的工程是「半成品」，条目类型是好几种的联合，逐个收窄很啰嗦。
// 所以这里用宽松的类型改草稿，最后整体再过一遍 validate（schema + 引用），以它为准。
type Item = { id: string; [k: string]: unknown };
type ClipLike = Item & {
  type: "clip";
  asset: string;
  inMs: number;
  outMs: number;
  speed: number;
  keyframes: Keyframe[];
  at?: Anchor;
  transitionIn?: unknown;
  cutBefore?: string;
  animIn?: unknown;
  animOut?: unknown;
};
type LooseTrack = {
  id: string;
  kind: Track["kind"];
  main?: boolean;
  name?: string;
  locked: boolean;
  style?: string;
  items: Item[];
};
type Located = { track: LooseTrack; trackIndex: number; index: number; item: Item };

function asClip(item: Item, id: string): ClipLike {
  if (item.type !== "clip") throw new MwError("INVALID_OP", `「${id}」不是视频 / 音频片段`);
  return item as ClipLike;
}

class Ctx {
  readonly changed = new Set<string>();
  constructor(readonly p: Project) {}

  get tracks(): LooseTrack[] {
    return this.p.tracks as unknown as LooseTrack[];
  }

  allIds(): Set<string> {
    const ids = new Set<string>([...Object.keys(this.p.assets), ...Object.keys(this.p.styles)]);
    for (const t of this.tracks) {
      ids.add(t.id);
      for (const it of t.items) ids.add(it.id);
    }
    return ids;
  }

  /** 生成不重复的 ID：前缀 + 递增数字，结果是确定的，方便测试和回放 */
  newId(prefix: string): string {
    const ids = this.allIds();
    for (let n = 1; ; n++) {
      const id = `${prefix}${n}`;
      if (!ids.has(id)) return id;
    }
  }

  track(id: string): { track: LooseTrack; index: number } {
    const index = this.tracks.findIndex((t) => t.id === id);
    const track = this.tracks[index];
    if (!track) throw new MwError("NOT_FOUND", `轨道「${id}」不存在`);
    return { track, index };
  }

  find(id: string): Located {
    for (const [trackIndex, track] of this.tracks.entries()) {
      const index = track.items.findIndex((it) => it.id === id);
      const item = track.items[index];
      if (item) return { track, trackIndex, index, item };
    }
    throw new MwError("NOT_FOUND", `条目「${id}」不存在`);
  }

  /** 锁定的轨道上的修改一律拒绝，无论来自人还是 AI（D18） */
  unlocked(track: LooseTrack): void {
    if (track.locked) {
      throw new MwError("TRACK_LOCKED", `轨道「${track.name ?? track.id}」已锁定`, {
        hint: "先在工作台里解锁，或者用 track.update 把 locked 改成 false",
      });
    }
  }

  mainTrack(): LooseTrack {
    const t = this.tracks.find((x) => x.kind === "video" && x.main);
    if (!t) throw new MwError("NOT_FOUND", "工程里没有主轨");
    return t;
  }

  /** 在主轨上剪掉某个素材的一段源时间：重叠的片段被裁短或一分为二 */
  cutSource(asset: string, from: number, to: number): void {
    const main = this.mainTrack();
    this.unlocked(main);
    const next: Item[] = [];
    for (const raw of main.items) {
      const item = raw as ClipLike;
      if (item.type !== "clip" || item.asset !== asset || to <= item.inMs || from >= item.outMs) {
        next.push(raw);
        continue;
      }
      const before = from > item.inMs ? { ...item, outMs: from } : null;
      const after = to < item.outMs ? { ...item, inMs: to } : null;
      if (before) next.push(before);
      if (after) {
        // 关键帧时间是相对片段开头的：后半段的开头往后挪了，关键帧跟着往前挪
        const shift = (to - item.inMs) / item.speed;
        const keyframes = after.keyframes
          .map((k) => ({ ...k, atMs: Math.round(k.atMs - shift) }))
          .filter((k) => k.atMs >= 0);
        if (before) {
          // 中间被剪掉：后半段是新片段，没有转场
          const { transitionIn: _t, cutBefore: _c, ...rest } = after;
          const id = this.newId(`${item.id}-`);
          next.push({ ...rest, id, keyframes });
          this.changed.add(id);
        } else {
          next.push({ ...after, keyframes });
        }
      }
      this.changed.add(item.id);
    }
    main.items = next;
  }
}

function run(ctx: Ctx, op: Op): void {
  const p = ctx.p;
  switch (op.op) {
    case "canvas.update":
      Object.assign(p.canvas, op.set);
      return;
    case "theme.update":
      Object.assign(p.theme, op.set);
      return;
    case "cover.update":
      p.cover = op.set;
      return;
    case "outro.set":
      p.outro = op.outro;
      return;
    case "outro.remove":
      p.outro = null;
      return;
    case "chapters.set":
      p.chapters = op.chapters;
      return;

    case "asset.add": {
      const id = op.id ?? ctx.newId("a");
      if (ctx.allIds().has(id)) throw new MwError("DUPLICATE_ID", `ID「${id}」已经存在`);
      p.assets[id] = op.asset;
      ctx.changed.add(id);
      return;
    }
    case "asset.relink": {
      const a = p.assets[op.id];
      if (!a) throw new MwError("NOT_FOUND", `素材「${op.id}」不存在`);
      a.path = op.path;
      if (op.fingerprint !== undefined) a.fingerprint = op.fingerprint;
      ctx.changed.add(op.id);
      return;
    }
    case "asset.cache": {
      const a = p.assets[op.id];
      if (!a) throw new MwError("NOT_FOUND", `素材「${op.id}」不存在`);
      const cache: Record<string, string> = { ...a.cache };
      for (const [k, v] of Object.entries(op.set)) {
        if (v === null) delete cache[k];
        else cache[k] = v;
      }
      a.cache = cache;
      ctx.changed.add(op.id);
      return;
    }
    case "asset.remove": {
      if (!p.assets[op.id]) throw new MwError("NOT_FOUND", `素材「${op.id}」不存在`);
      const used =
        p.outro?.asset === op.id ||
        ctx.tracks.some((t) => t.items.some((it) => it.asset === op.id));
      if (used)
        throw new MwError("IN_USE", `素材「${op.id}」还在使用中`, { hint: "先删除引用它的条目" });
      delete p.assets[op.id];
      return;
    }

    case "track.add": {
      const id = typeof op.track.id === "string" ? op.track.id : ctx.newId("t");
      if (ctx.allIds().has(id)) throw new MwError("DUPLICATE_ID", `ID「${id}」已经存在`);
      const track = { items: [], ...op.track, id } as unknown as LooseTrack;
      ctx.tracks.splice(op.index ?? ctx.tracks.length, 0, track);
      ctx.changed.add(id);
      return;
    }
    case "track.update": {
      const { track } = ctx.track(op.id);
      if ("id" in op.set || "items" in op.set || "kind" in op.set)
        throw new MwError("INVALID_OP", "track.update 不能修改 id、kind、items");
      // 锁定的轨道仍然可以解锁、隐藏、静音（和剪映一致），其他修改要先解锁
      const onlyFlags = Object.keys(op.set).every((k) => ["locked", "hidden", "muted"].includes(k));
      if (!onlyFlags) ctx.unlocked(track);
      Object.assign(track, op.set);
      ctx.changed.add(op.id);
      return;
    }
    case "track.move": {
      const { track, index } = ctx.track(op.id);
      ctx.unlocked(track);
      ctx.tracks.splice(index, 1);
      ctx.tracks.splice(Math.min(op.index, ctx.tracks.length), 0, track);
      ctx.changed.add(op.id);
      return;
    }
    case "track.remove": {
      const { track, index } = ctx.track(op.id);
      ctx.unlocked(track);
      ctx.tracks.splice(index, 1);
      return;
    }

    case "item.add": {
      const { track } = ctx.track(op.track);
      ctx.unlocked(track);
      const prefix = track.kind === "caption" ? "s" : track.kind === "overlay" ? "o" : "c";
      const id = typeof op.item.id === "string" ? op.item.id : ctx.newId(prefix);
      if (ctx.allIds().has(id)) throw new MwError("DUPLICATE_ID", `ID「${id}」已经存在`);
      track.items.splice(op.index ?? track.items.length, 0, { ...op.item, id });
      ctx.changed.add(id);
      return;
    }
    case "item.update":
    case "caption.update": {
      const { track, item } = ctx.find(op.id);
      ctx.unlocked(track);
      if ("id" in op.set) throw new MwError("INVALID_OP", "不能修改 id");
      // 改了字幕文字、字数变了，原来的逐字时间对不上了，去掉（之后可以重新 mw align）
      const text = op.set.text;
      if (
        typeof text === "string" &&
        !("charStartMs" in op.set) &&
        Array.isArray(item.charStartMs) &&
        item.charStartMs.length !== [...text].length
      ) {
        delete item.charStartMs;
      }
      // null 表示去掉这个字段（条目上没有可以为 null 的字段）：HTTP 提交时 undefined 会被 JSON 丢掉，
      // 只能用 null 表达「去掉转场、去掉变换」
      for (const [k, v] of Object.entries(op.set)) {
        if (v === null) delete (item as Record<string, unknown>)[k];
        else (item as Record<string, unknown>)[k] = v;
      }
      ctx.changed.add(op.id);
      return;
    }
    case "item.move": {
      const from = ctx.find(op.id);
      ctx.unlocked(from.track);
      const to = op.track ? ctx.track(op.track).track : from.track;
      ctx.unlocked(to);
      if (to.kind !== from.track.kind)
        throw new MwError("INVALID_OP", `不能把条目从 ${from.track.kind} 轨道移到 ${to.kind} 轨道`);
      from.track.items.splice(from.index, 1);
      to.items.splice(Math.min(op.index ?? to.items.length, to.items.length), 0, from.item);
      ctx.changed.add(op.id);
      return;
    }
    case "item.remove": {
      const { track, index } = ctx.find(op.id);
      ctx.unlocked(track);
      track.items.splice(index, 1);
      return;
    }

    case "clip.split":
      return splitClip(ctx, op.id, op.atMs);
    case "clip.trim": {
      const { track, item } = ctx.find(op.id);
      ctx.unlocked(track);
      const clip = asClip(item, op.id);
      if (op.inMs !== undefined) clip.inMs = op.inMs;
      if (op.outMs !== undefined) clip.outMs = op.outMs;
      ctx.changed.add(op.id);
      return;
    }

    case "keyframe.set": {
      const { track, item } = ctx.find(op.item);
      ctx.unlocked(track);
      const kfs = keyframesOf(item, op.item);
      const kf = Keyframe.parse({ atMs: op.atMs, transform: op.transform, easing: op.easing });
      item.keyframes = [...kfs.filter((k) => k.atMs !== op.atMs), kf].sort(
        (a, b) => a.atMs - b.atMs,
      );
      ctx.changed.add(op.item);
      return;
    }
    case "keyframe.remove": {
      const { track, item } = ctx.find(op.item);
      ctx.unlocked(track);
      const kfs = keyframesOf(item, op.item);
      const rest = kfs.filter((k) => k.atMs !== op.atMs);
      if (rest.length === kfs.length)
        throw new MwError("NOT_FOUND", `「${op.item}」在 ${op.atMs}ms 处没有关键帧`);
      item.keyframes = rest;
      ctx.changed.add(op.item);
      return;
    }

    case "caption.import":
      return importCaptions(ctx, op);
    case "caption.remove":
      for (const id of op.ids) {
        const { track, index } = ctx.find(id);
        ctx.unlocked(track);
        track.items.splice(index, 1);
      }
      return;
    case "caption.merge":
      return mergeCaptions(ctx, op.ids);
    case "caption.split":
      return splitCaption(ctx, op.id, op.at, op.atMs);

    case "cut.removeCaptions": {
      const caps = op.ids.map((id) => captionOf(ctx, id));
      for (const { cap } of caps) ctx.cutSource(cap.asset, cap.startMs, cap.endMs);
      if (op.removeCaptions) {
        for (const { track, cap } of caps) {
          ctx.unlocked(track);
          track.items.splice(
            track.items.findIndex((c) => c.id === cap.id),
            1,
          );
        }
      }
      return;
    }
    case "cut.restore": {
      const main = ctx.mainTrack();
      ctx.unlocked(main);
      const k = main.items.findIndex((i) => i.id === op.clip);
      if (k < 0) throw new MwError("NOT_FOUND", `主轨上没有片段「${op.clip}」`);
      const clip = main.items[k] as ClipLike;
      const prev = main.items[k - 1] as ClipLike | undefined;
      if (
        !prev ||
        prev.type !== "clip" ||
        clip.type !== "clip" ||
        prev.asset !== clip.asset ||
        prev.outMs >= clip.inMs
      ) {
        throw new MwError("INVALID_OP", `「${op.clip}」前面不是剪辑点，没有可以恢复的内容`, {
          hint: "剪辑点 = 同一个素材的前后两段之间被剪掉了一截",
        });
      }
      // 延长前一段而不是合并：后一段自己的变换、音量、关键帧都原样保留
      prev.outMs = clip.inMs;
      delete clip.cutBefore;
      ctx.changed.add(prev.id);
      ctx.changed.add(clip.id);
      return;
    }
    case "cut.removePauses": {
      const { track } = ctx.track(op.track);
      if (track.kind !== "caption") throw new MwError("INVALID_OP", `「${op.track}」不是字幕轨道`);
      // 按素材分组、按源时间排序，找相邻两句之间的空隙。从后往前剪，前面的源时间不受影响
      const byAsset = new Map<string, Caption[]>();
      for (const item of track.items) {
        const c = item as Caption;
        byAsset.set(c.asset, [...(byAsset.get(c.asset) ?? []), c]);
      }
      for (const [asset, caps] of byAsset) {
        const sorted = caps.toSorted((a, b) => a.startMs - b.startMs);
        const gaps: [number, number][] = [];
        for (let i = 1; i < sorted.length; i++) {
          const a = sorted[i - 1];
          const b = sorted[i];
          if (!a || !b) continue;
          const from = a.endMs + op.keepMs;
          const to = b.startMs - op.keepMs;
          if (b.startMs - a.endMs >= op.minGapMs && to > from) gaps.push([from, to]);
        }
        for (const [from, to] of gaps.reverse()) ctx.cutSource(asset, from, to);
      }
      return;
    }

    case "style.add": {
      if (p.styles[op.id]) throw new MwError("DUPLICATE_ID", `样式「${op.id}」已经存在`);
      p.styles[op.id] = parseStyle(op.style);
      ctx.changed.add(op.id);
      return;
    }
    case "style.update": {
      const cur = p.styles[op.id];
      if (!cur) throw new MwError("NOT_FOUND", `样式「${op.id}」不存在`);
      p.styles[op.id] = parseStyle(deepMerge(cur, op.set));
      ctx.changed.add(op.id);
      return;
    }
    case "style.remove": {
      if (!p.styles[op.id]) throw new MwError("NOT_FOUND", `样式「${op.id}」不存在`);
      const used = ctx.tracks.some(
        (t) => t.style === op.id || t.items.some((it) => it.style === op.id),
      );
      if (used) throw new MwError("IN_USE", `样式「${op.id}」还在使用中`);
      delete p.styles[op.id];
      return;
    }
  }
}

function keyframesOf(item: Item, id: string): Keyframe[] {
  if (!Array.isArray(item.keyframes)) throw new MwError("INVALID_OP", `「${id}」不支持关键帧`);
  return item.keyframes as Keyframe[];
}

function parseStyle(input: unknown): TextStyle {
  const r = TextStyle.safeParse(input);
  if (!r.success) {
    throw new MwError("VALIDATION", "样式格式不对", {
      issues: r.error.issues.map((i) => ({
        code: i.code === "unrecognized_keys" ? "UNKNOWN_FIELD" : "VALIDATION",
        path: `style.${i.path.join(".")}`,
        message: i.message,
      })),
    });
  }
  return r.data;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 样式按字段深度合并：style.update 只写要改的那几个字段 */
function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(out[k], v);
  return out;
}

function captionOf(ctx: Ctx, id: string): { track: LooseTrack; cap: Caption } {
  const { track, item } = ctx.find(id);
  if (track.kind !== "caption") throw new MwError("INVALID_OP", `「${id}」不是字幕`);
  return { track, cap: item as unknown as Caption };
}

function splitClip(ctx: Ctx, id: string, atMs: number): void {
  const { track, index, item } = ctx.find(id);
  ctx.unlocked(track);
  const clip = asClip(item, id);
  // 主轨：atMs 是时间线时间；普通轨道：atMs 相对片段开头
  let offsetMs = atMs;
  if (track.main) {
    const seg = layoutMainTrack(ctx.p).find((s) => s.clip.id === id);
    if (!seg) throw new MwError("NOT_FOUND", `「${id}」不在主轨上`);
    offsetMs = atMs - seg.startMs;
  }
  const srcMs = Math.round(clip.inMs + offsetMs * clip.speed);
  if (srcMs <= clip.inMs || srcMs >= clip.outMs)
    throw new MwError("TIME_RANGE", `分割点不在片段「${id}」的范围内`);

  const newId = ctx.newId(`${id}-`);
  // 后半段：没有入场转场和入场动画；关键帧按新的开头平移
  const { transitionIn: _t, cutBefore: _c, animIn: _a, ...rest } = clip;
  const second: ClipLike = {
    ...rest,
    id: newId,
    inMs: srcMs,
    keyframes: clip.keyframes
      .filter((k) => k.atMs > offsetMs)
      .map((k) => ({ ...k, atMs: Math.round(k.atMs - offsetMs) })),
  };
  // 普通轨道的后半段：沿用前半段的锚点，往后偏移
  if (clip.at) {
    const shift = Math.round(offsetMs);
    const at = clip.at;
    second.at = "ms" in at ? { ms: at.ms + shift } : { ...at, offsetMs: at.offsetMs + shift };
  }
  clip.outMs = srcMs;
  clip.keyframes = clip.keyframes.filter((k) => k.atMs <= offsetMs);
  delete clip.animOut;
  track.items.splice(index + 1, 0, second);
  ctx.changed.add(id);
  ctx.changed.add(newId);
}

function importCaptions(ctx: Ctx, op: Extract<Op, { op: "caption.import" }>): void {
  const { track } = ctx.track(op.track);
  if (track.kind !== "caption") throw new MwError("INVALID_OP", `「${op.track}」不是字幕轨道`);
  ctx.unlocked(track);
  let cues: ReturnType<typeof parseSrt>;
  try {
    cues = parseSrt(op.srt);
  } catch (e) {
    if (e instanceof SrtError) throw new MwError("SRT_PARSE", e.message, { path: `srt:${e.line}` });
    throw e;
  }
  let opts: CaptionImportOptions;
  if (op.timebase === "source") {
    if (!op.asset)
      throw new MwError("INVALID_OP", "timebase 为 source 时必须指定 asset（SRT 对应的原片）");
    opts = { timebase: "source", asset: op.asset };
  } else {
    opts = { timebase: "timeline" };
  }
  const { captions, skipped } = cuesToCaptions(ctx.p, cues, opts);
  if (captions.length === 0 && skipped.length > 0)
    throw new MwError("TIME_RANGE", "所有字幕都落在主轨以外，没有导入任何字幕", {
      hint: "timeline 时间基准需要先把视频放到主轨上",
    });
  if (op.mode === "replace") track.items = [];
  for (const c of captions) {
    const id = ctx.newId("s");
    track.items.push({ ...c, id });
    ctx.changed.add(id);
  }
}

function mergeCaptions(ctx: Ctx, ids: string[]): void {
  const caps = ids.map((id) => captionOf(ctx, id));
  const first = caps[0];
  if (!first) return;
  const { track } = first;
  ctx.unlocked(track);
  if (caps.some((c) => c.track !== track || c.cap.asset !== first.cap.asset))
    throw new MwError("INVALID_OP", "只能合并同一条轨道、同一个素材上的字幕");
  const sorted = caps.map((c) => c.cap).toSorted((a, b) => a.startMs - b.startMs);
  const head = sorted[0] as Caption;
  // 高亮按文字匹配，拼接后仍然有效；nth 是按句内出现次数算的，合并后可能指向别处，所以去掉
  const merged: Caption = {
    ...head,
    endMs: Math.max(...sorted.map((c) => c.endMs)),
    text: sorted.map((c) => c.text).join(""),
    highlights: sorted.flatMap((c) => c.highlights.map(({ nth: _n, ...h }) => h)),
  };
  // 逐字时间：每句都有才能拼起来，否则去掉
  delete merged.charStartMs;
  if (sorted.every((c) => c.charStartMs))
    merged.charStartMs = sorted.flatMap((c) => c.charStartMs ?? []);
  track.items = track.items.filter((c) => !ids.includes(c.id) || c.id === head.id);
  track.items[track.items.findIndex((c) => c.id === head.id)] = merged;
  ctx.changed.add(head.id);
}

function splitCaption(ctx: Ctx, id: string, at: number, atMs?: number): void {
  const { track, cap } = captionOf(ctx, id);
  ctx.unlocked(track);
  const chars = [...cap.text];
  if (at >= chars.length)
    throw new MwError("INVALID_OP", `第 ${at} 个字已经是句末，不能在这里断开`);
  // 有逐字时间时，默认在后半句第一个字开始念的时候断开
  const splitMs =
    atMs ??
    cap.charStartMs?.[at] ??
    Math.round(cap.startMs + ((cap.endMs - cap.startMs) * at) / chars.length);
  if (splitMs <= cap.startMs || splitMs >= cap.endMs)
    throw new MwError("TIME_RANGE", "断开的时间点必须在这句字幕的时间范围内");
  const a = chars.slice(0, at).join("");
  const b = chars.slice(at).join("");
  const newId = ctx.newId("s");
  const index = track.items.findIndex((c) => c.id === id);
  track.items.splice(
    index,
    1,
    {
      ...cap,
      endMs: splitMs,
      text: a,
      highlights: cap.highlights.filter((h) => a.includes(h.text)),
      ...(cap.charStartMs ? { charStartMs: cap.charStartMs.slice(0, at) } : {}),
    },
    {
      ...cap,
      id: newId,
      startMs: splitMs,
      text: b,
      highlights: cap.highlights.filter((h) => b.includes(h.text)),
      ...(cap.charStartMs ? { charStartMs: cap.charStartMs.slice(at) } : {}),
    },
  );
  ctx.changed.add(id);
  ctx.changed.add(newId);
}
