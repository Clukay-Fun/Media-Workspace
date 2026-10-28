import type { z } from "zod";
import { compile } from "./compile";
import type { Issue } from "./errors";
import { isMainClip, Project } from "./schema";

export type ValidateOptions = {
  /** 已注册的模板名；不传时不检查模板 */
  templates?: readonly string[];
};

export type ValidateResult =
  | { ok: true; project: Project; errors: []; warnings: Issue[] }
  | { ok: false; project: null; errors: Issue[]; warnings: Issue[] };

/** zod 的错误转成统一格式；不认识的字段单独给 UNKNOWN_FIELD（D25） */
export function zodIssues(error: z.ZodError, prefix = ""): Issue[] {
  return error.issues.flatMap((i): Issue[] => {
    const path = joinPath(prefix, i.path);
    if (i.code === "unrecognized_keys") {
      return i.keys.map((k) => ({
        code: "UNKNOWN_FIELD",
        path: joinPath(path, [k]),
        message: `不认识的字段「${k}」`,
        hint: "检查字段名是否拼错，或者用 mw guide 查看格式说明",
      }));
    }
    return [{ code: "VALIDATION", path, message: i.message }];
  });
}

function joinPath(prefix: string, parts: readonly PropertyKey[]): string {
  return parts.reduce<string>(
    (acc, p) => (typeof p === "number" ? `${acc}[${p}]` : acc ? `${acc}.${String(p)}` : String(p)),
    prefix,
  );
}

/**
 * validate：schema + 引用 + 时间范围，出错时阻止写入（PLAN 6.3）。
 * 警告（lint）不阻止写入：目前是 compile 给出的被剪掉的字幕 / 锚点。
 */
export function validate(input: unknown, opts: ValidateOptions = {}): ValidateResult {
  const parsed = Project.safeParse(input);
  if (!parsed.success) {
    return { ok: false, project: null, errors: zodIssues(parsed.error), warnings: [] };
  }
  const p = parsed.data;
  const errors: Issue[] = [];
  const err = (code: string, path: string, message: string, hint?: string) =>
    errors.push({ code, path, message, ...(hint ? { hint } : {}) });

  const ids = new Map<string, string>();
  const claim = (id: string, path: string) => {
    const prev = ids.get(id);
    if (prev) err("DUPLICATE_ID", path, `ID「${id}」重复，已经用在 ${prev}`);
    else ids.set(id, path);
  };
  const asset = (id: string, path: string, kinds: readonly string[]) => {
    const a = p.assets[id];
    if (!a) {
      err("REF_MISSING", path, `素材「${id}」不存在`, "先用 asset.add 导入素材");
      return undefined;
    }
    if (!kinds.includes(a.kind))
      err("REF_MISSING", path, `素材「${id}」是 ${a.kind}，这里需要 ${kinds.join(" / ")}`);
    return a;
  };

  const style = (id: string | undefined, path: string) => {
    if (id !== undefined && !p.styles[id]) err("REF_MISSING", path, `样式「${id}」不存在`);
  };
  const range = (inMs: number, outMs: number, durationMs: number | undefined, path: string) => {
    if (outMs <= inMs) err("TIME_RANGE", path, `出点 ${outMs}ms 必须大于入点 ${inMs}ms`);
    else if (durationMs !== undefined && outMs > durationMs)
      err("TIME_RANGE", path, `出点 ${outMs}ms 超过了素材时长 ${durationMs}ms`);
  };

  const mains = p.tracks.filter((t) => t.kind === "video" && t.main);
  if (mains.length > 1) err("VALIDATION", "tracks", "只能有一条主轨");

  p.tracks.forEach((t, ti) => {
    const tp = `tracks[${ti}]`;
    claim(t.id, tp);
    if (t.kind === "caption") style(t.style, `${tp}.style`);
    t.items.forEach((item, ii) => {
      const path = `${tp}.items[${ii}]`;
      claim(item.id, path);
      if (t.kind === "caption") {
        const c = item as (typeof t.items)[number];
        const a = asset(c.asset, `${path}.asset`, ["video", "audio"]);
        range(c.startMs, c.endMs, a?.probe?.durationMs, path);
        style(c.style, `${path}.style`);
        return;
      }
      if (t.kind === "overlay") {
        const o = item as (typeof t.items)[number];
        style(o.style, `${path}.style`);
        if (opts.templates && !opts.templates.includes(o.template))
          err(
            "REF_MISSING",
            `${path}.template`,
            `模板「${o.template}」不存在`,
            "用 mw inspect --templates 查看可用模板",
          );
        return;
      }
      if (t.kind === "video" && t.main !== isMainClip(item as (typeof t.items)[number])) {
        err(
          "VALIDATION",
          path,
          t.main ? "主轨上的片段首尾相连，不能写 at" : "普通轨道上的条目必须写 at（开始位置）",
        );
        return;
      }
      const v = item as { type: string; asset: string; inMs?: number; outMs?: number };
      if (v.type === "image") {
        asset(v.asset, `${path}.asset`, ["image"]);
        return;
      }
      const a = asset(
        v.asset,
        `${path}.asset`,
        t.kind === "audio" ? ["audio", "video"] : ["video"],
      );
      range(v.inMs ?? 0, v.outMs ?? 0, a?.probe?.durationMs, path);
    });
  });

  if (p.outro) asset(p.outro.asset, "outro.asset", ["video", "image"]);
  if (p.cover?.title && !ids.has(p.cover.title))
    err("REF_MISSING", "cover.title", `封面标题引用的叠加层「${p.cover.title}」不存在`);

  // 锚点引用的对象必须存在；存在但被剪掉只是警告（由 compile 给出）
  p.tracks.forEach((t, ti) => {
    if (t.kind === "caption" || (t.kind === "video" && t.main)) return;
    t.items.forEach((item, ii) => {
      const at = (item as { at?: { caption?: string; clip?: string } }).at;
      const ref = at?.caption ?? at?.clip;
      if (ref !== undefined && !ids.has(ref))
        err("REF_MISSING", `tracks[${ti}].items[${ii}].at`, `锚点「${ref}」不存在`);
    });
  });

  if (errors.length > 0) return { ok: false, project: null, errors, warnings: [] };
  return { ok: true, project: p, errors: [], warnings: compile(p).warnings };
}
