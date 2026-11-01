import type { Project, Track } from "./schema";

// 两个版本之间改了什么，给人核对 AI 的修改用（审片台「AI 改动」、mw history --rev、MCP history）。
// 只做展示：值都转成短的中文文字，不保证能反推回原数据。

export type FieldChange = { field: string; label: string; before: string; after: string };

export type EntityChange = {
  id: string;
  entity: "item" | "track" | "asset" | "style" | "project";
  /** 中文类别：字幕、主轨片段、画中画、图片、标题 / 卡片、轨道、素材、样式、画布… */
  kind: string;
  /** 给人看的名字：字幕文字、素材文件名、卡片文字 */
  name: string;
  status: "added" | "removed" | "updated";
  fields: FieldChange[];
};

type Entity = { entity: EntityChange["entity"]; kind: string; name: string; value: unknown };

const LABEL: Record<string, string> = {
  text: "文字",
  startMs: "开始",
  endMs: "结束",
  inMs: "入点",
  outMs: "出点",
  speed: "倍速",
  gainDb: "音量",
  transform: "位置 / 缩放",
  keyframes: "关键帧",
  animIn: "入场动画",
  animOut: "出场动画",
  animLoop: "循环动画",
  transitionIn: "转场",
  cutBefore: "剪辑说明",
  at: "出现时间",
  durationMs: "时长",
  style: "样式",
  slot: "位置",
  template: "模板",
  size: "尺寸",
  highlights: "高亮",
  charStartMs: "逐字时间",
  asset: "素材",
  path: "文件",
  name: "名字",
  locked: "锁定",
  hidden: "隐藏",
  muted: "静音",
  order: "层级",
  atMs: "时间点",
  title: "标题",
  width: "宽",
  height: "高",
  fps: "帧率",
  background: "背景色",
  safeArea: "安全区",
  accent: "主题色",
  font: "字体",
  chapters: "章节",
  crop: "裁切",
};

/** 卡片的哪个字段最能代表它，按顺序取第一个有值的 */
const NAME_PROPS = ["lines", "title", "text", "name", "label", "body", "caption", "items"];

const PROP_LABEL: Record<string, string> = {
  lines: "文字",
  title: "标题",
  text: "文字",
  items: "要点",
  name: "名字",
  label: "说明",
  body: "正文",
  source: "出处",
  caption: "图注",
  image: "图片",
  from: "起始数",
  to: "目标数",
  prefix: "前缀",
  suffix: "单位",
  align: "对齐",
};

/** 动画、转场的中文名，和属性栏里的叫法一致 */
const PRESET_LABEL: Record<string, string> = {
  none: "无",
  fade: "淡入",
  "fade-up": "上浮淡入",
  slide: "滑入",
  pop: "弹出",
  "scale-punch": "放大强调",
  bounce: "弹跳",
  slam: "砸入",
  wave: "波浪",
  typewriter: "打字机",
  "blur-in": "模糊淡入",
  "zoom-in": "放大",
  "color-sweep": "颜色扫过",
  pulse: "脉冲",
  glow: "发光",
  "color-shift": "变色",
  shake: "抖动",
  "underline-sweep": "下划线扫过",
  "zoom-out": "缩小",
  "scale-out": "缩小淡出",
  breathe: "呼吸",
};

const TRANSITION_LABEL: Record<string, string> = { fade: "叠化", slide: "滑入", push: "推开" };

const MS_FIELDS = new Set(["startMs", "endMs", "inMs", "outMs", "durationMs", "atMs"]);

/** 比较两个版本，返回有变化的元素；顺序：工程设置、轨道、素材、样式，再按新版本里的轨道顺序列元素 */
export function diffProjects(before: Project, after: Project): EntityChange[] {
  const a = entities(before);
  const b = entities(after);
  const out: EntityChange[] = [];
  // 「跟随字幕」写字幕文字比写 id 好认；删掉的字幕从旧版本里找
  const ctx: Ctx = {
    captions: new Map([...captionTexts(before), ...captionTexts(after)]),
    assets: new Map(
      [...Object.entries(before.assets), ...Object.entries(after.assets)].map(([id, a]) => [
        id,
        fileName(a.path),
      ]),
    ),
  };
  const ids = [...new Set([...b.keys(), ...a.keys()])];
  for (const key of ids) {
    const x = a.get(key);
    const y = b.get(key);
    const id = key.slice(key.indexOf(":") + 1);
    if (!x && y) out.push({ id, ...pick(y), status: "added", fields: [] });
    else if (x && !y) out.push({ id, ...pick(x), status: "removed", fields: [] });
    else if (x && y) {
      const fields = diffFields(ctx, x.value, y.value);
      if (fields.length) out.push({ id, ...pick(y), status: "updated", fields });
    }
  }
  const rank = { project: 0, track: 1, asset: 2, style: 3, item: 4 } as const;
  return out.sort((p, q) => rank[p.entity] - rank[q.entity]);
}

type Ctx = { captions: Map<string, string>; assets: Map<string, string> };

function captionTexts(p: Project): [string, string][] {
  return p.tracks.flatMap((t) =>
    t.kind === "caption" ? t.items.map((c): [string, string] => [c.id, c.text]) : [],
  );
}

const pick = (e: Entity) => ({ entity: e.entity, kind: e.kind, name: e.name });

function entities(p: Project): Map<string, Entity> {
  const m = new Map<string, Entity>();
  m.set("project:canvas", { entity: "project", kind: "画布", name: "画布", value: p.canvas });
  m.set("project:theme", { entity: "project", kind: "主题", name: "主题", value: p.theme });
  m.set("project:cover", { entity: "project", kind: "封面", name: "封面", value: p.cover });
  m.set("project:outro", { entity: "project", kind: "片尾", name: "片尾", value: p.outro });
  m.set("project:chapters", {
    entity: "project",
    kind: "章节",
    name: "章节",
    value: { chapters: p.chapters },
  });
  p.tracks.forEach((t, order) => {
    const { items: _items, ...rest } = t;
    m.set(`track:${t.id}`, {
      entity: "track",
      kind: "轨道",
      name: t.name ?? trackKind(t),
      value: { ...rest, order },
    });
  });
  for (const [id, asset] of Object.entries(p.assets))
    m.set(`asset:${id}`, {
      entity: "asset",
      kind: "素材",
      name: fileName(asset.path),
      value: { path: asset.path },
    });
  for (const [id, style] of Object.entries(p.styles))
    m.set(`style:${id}`, { entity: "style", kind: "样式", name: id, value: style });
  for (const t of p.tracks)
    for (const item of t.items)
      m.set(`item:${item.id}`, {
        entity: "item",
        kind: itemKind(t, item),
        name: itemName(p, item),
        value: item,
      });
  return m;
}

function trackKind(t: Track): string {
  if (t.kind === "caption") return "字幕轨";
  if (t.kind === "overlay") return "标题轨";
  if (t.kind === "audio") return "音频轨";
  return t.main ? "主轨" : "画中画轨";
}

function itemKind(t: Track, item: Track["items"][number]): string {
  if (t.kind === "caption") return "字幕";
  if (t.kind === "overlay") return "标题 / 卡片";
  if (t.kind === "audio") return "音频";
  if ("type" in item && item.type === "image") return "图片";
  return t.main ? "主轨片段" : "画中画";
}

function itemName(p: Project, item: Track["items"][number]): string {
  if ("text" in item) return short(item.text, 16);
  if ("props" in item) return propsText(item.props) ?? item.template;
  const file = fileName(p.assets[item.asset]?.path ?? item.asset);
  // 主轨剪成很多段后文件名都一样，带上素材里的时间段才分得清
  if (item.type === "clip")
    return `${file} ${round(item.inMs / 1000)}–${round(item.outMs / 1000)} 秒`;
  return file;
}

function propsText(props: Record<string, unknown>): string | null {
  for (const k of NAME_PROPS) {
    const v = props[k];
    if (typeof v === "string") return short(v, 16);
    if (Array.isArray(v) && v.length) return short(v.map(fmtLoose).join(" "), 16);
  }
  return null;
}

const fileName = (path: string) => path.split("/").at(-1) ?? path;

function diffFields(ctx: Ctx, x: unknown, y: unknown): FieldChange[] {
  // 封面、片尾从无到有：当成空对象比，逐项列出新设的值
  if (x === null && isObj(y)) x = {};
  if (y === null && isObj(x)) y = {};
  if (!isObj(x) || !isObj(y)) {
    return same(x, y)
      ? []
      : [{ field: "", label: "内容", before: fmt(ctx, "", x), after: fmt(ctx, "", y) }];
  }
  const out: FieldChange[] = [];
  for (const k of [...new Set([...Object.keys(x), ...Object.keys(y)])]) {
    if (k === "id") continue;
    const u = x[k];
    const v = y[k];
    if (same(u, v)) continue;
    // 卡片内容按字段分开列，改了一行字也能看出是哪一项
    if (k === "props" && isObj(u) && isObj(v)) {
      for (const pk of [...new Set([...Object.keys(u), ...Object.keys(v)])]) {
        if (same(u[pk], v[pk])) continue;
        out.push({
          field: `props.${pk}`,
          label: `内容 · ${PROP_LABEL[pk] ?? pk}`,
          before: fmt(ctx, pk, u[pk]),
          after: fmt(ctx, pk, v[pk]),
        });
      }
      continue;
    }
    if (k === "charStartMs") {
      out.push({ field: k, label: LABEL[k] ?? k, ...charTimes(u, v) });
      continue;
    }
    out.push({ field: k, label: LABEL[k] ?? k, before: fmt(ctx, k, u), after: fmt(ctx, k, v) });
  }
  return out;
}

/** 逐字时间一长串数字没法看，只说有没有、几个字、是不是重新对齐过 */
function charTimes(u: unknown, v: unknown): { before: string; after: string } {
  const n = (x: unknown) => (Array.isArray(x) ? `${x.length} 个字` : "按字数估算");
  if (Array.isArray(u) && Array.isArray(v) && u.length === v.length)
    return { before: n(u), after: `${n(v)}，重新对齐` };
  return { before: n(u), after: n(v) };
}

function fmt(ctx: Ctx, key: string, v: unknown): string {
  if (v === undefined || v === null) return "无";
  if (typeof v === "boolean") return v ? "是" : "否";
  if (typeof v === "number") {
    if (MS_FIELDS.has(key)) return seconds(v);
    if (key === "speed") return `${round(v)}×`;
    if (key === "gainDb") return `${round(v)} dB`;
    return String(round(v));
  }
  if (typeof v === "string") {
    if (key === "asset") return ctx.assets.get(v) ?? v;
    // 路径太长时留后半截，文件名比前面的目录要紧
    if (key === "path") return shortTail(v, 30);
    return short(v, 30);
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return "无";
    if (key === "lines" || key === "items" || key === "chapters")
      return short(v.map((x) => fmtLoose(x)).join(" / "), 30);
    if (key === "highlights")
      return v.length ? short(v.map((h) => (isObj(h) ? String(h.text) : "")).join("、"), 30) : "无";
    return v.length ? `${v.length} 个` : "无";
  }
  if (isObj(v)) {
    if (key === "transform") return transform(v);
    if (key === "crop") return crop(v);
    if (key === "at") return anchor(ctx, v);
    if (key === "safeArea" && typeof v.preset === "string") return v.preset;
    if (typeof v.preset === "string") return PRESET_LABEL[v.preset] ?? v.preset;
    if (key === "transitionIn" && typeof v.type === "string")
      return TRANSITION_LABEL[v.type] ?? v.type;
    // 封面标题：{ template, props }，显示文字
    if (typeof v.template === "string" && isObj(v.props)) return propsText(v.props) ?? v.template;
    return short(JSON.stringify(v), 40);
  }
  return short(String(v), 30);
}

function fmtLoose(x: unknown): string {
  if (typeof x === "string") return x;
  if (isObj(x)) return String(x.text ?? x.title ?? x.label ?? JSON.stringify(x));
  return String(x);
}

function transform(t: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof t.x === "number") parts.push(`x ${Math.round(t.x)}`);
  if (typeof t.y === "number") parts.push(`y ${Math.round(t.y)}`);
  if (typeof t.scale === "number") parts.push(`缩放 ${round(t.scale)}`);
  if (typeof t.rotation === "number" && t.rotation) parts.push(`旋转 ${round(t.rotation)}°`);
  if (typeof t.opacity === "number" && t.opacity !== 1)
    parts.push(`不透明 ${Math.round(t.opacity * 100)}%`);
  if (typeof t.radius === "number" && t.radius) parts.push(`圆角 ${Math.round(t.radius)}`);
  return parts.join(" · ") || "默认";
}

/** 裁切按素材的百分比说：从哪里开始、保留多少 */
function crop(c: Record<string, unknown>): string {
  const pct = (v: unknown) => (typeof v === "number" ? `${Math.round(v * 100)}%` : "?");
  return `左 ${pct(c.x)} 上 ${pct(c.y)} · 保留 ${pct(c.width)} × ${pct(c.height)}`;
}

function anchor(ctx: Ctx, a: Record<string, unknown>): string {
  if (typeof a.ms === "number") return `第 ${seconds(a.ms)}`;
  const off =
    typeof a.offsetMs === "number" && a.offsetMs
      ? ` ${a.offsetMs > 0 ? "+" : ""}${seconds(a.offsetMs)}`
      : "";
  if (typeof a.caption === "string") {
    const text = ctx.captions.get(a.caption);
    const who = text === undefined ? a.caption : `「${short(text, 10)}」`;
    const char = typeof a.char === "number" ? ` 第 ${a.char + 1} 个字` : "";
    return `跟随字幕${who}${char}${off}`;
  }
  if (typeof a.clip === "string") return `跟随片段 ${a.clip}${off}`;
  return short(JSON.stringify(a), 40);
}

const seconds = (ms: number) => `${round(ms / 1000)} 秒`;
const round = (v: number) => Math.round(v * 100) / 100;

function short(s: string, n: number): string {
  const chars = [...s];
  return chars.length > n ? `${chars.slice(0, n).join("")}…` : s;
}

function shortTail(s: string, n: number): string {
  const chars = [...s];
  return chars.length > n ? `…${chars.slice(-n).join("")}` : s;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
