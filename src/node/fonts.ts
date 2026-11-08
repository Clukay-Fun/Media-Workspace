import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { FontWarning } from "../core/api";
import { MwError } from "../core/errors";
import { FONT_FAMILIES, type FontFace, nearestWeight } from "../core/fonts";
import type { TextStyle } from "../core/text-style";

const execFileAsync = promisify(execFile);

export type FontSource = "project" | "system";

export type FontLicenseInfo = {
  level?: "A" | "B" | "C";
  status: "已确认" | "未知" | "需付费" | "未登记";
  source: "docs/font-licenses.md";
  note?: string;
};

/** 运行时字体索引；path 只留在 Node 进程内，不会写入工程或 API 响应。 */
export type FontCatalogItem = {
  /** 新目录标识：字体族名 + 来源；id 保留旧 registry ID 兼容。 */
  key: string;
  id: string;
  family: string;
  style: string;
  weight: number;
  source: FontSource;
  available: boolean;
  exportable: boolean;
  license?: FontLicenseInfo;
  path?: string;
};

export type FontCatalog = {
  platform: NodeJS.Platform;
  scannedAt: string;
  items: FontCatalogItem[];
  warnings: { code: string; message: string }[];
};

export type FontStyleUse = {
  styleId: string;
  style: Pick<TextStyle, "font">;
  elements: string[];
};

export type SoftFontFace = FontFace & {
  path: string;
  source: "project" | "system";
};

export type SoftFontResolution = {
  faces: SoftFontFace[];
  warnings: FontWarning[];
};

type FontCache = { catalog: FontCatalog; at: number };
let cache: FontCache | null = null;
let licenseCache: Map<string, FontLicenseInfo> | null = null;

const WEIGHT_LABEL: Record<number, string> = {
  100: "Thin",
  200: "ExtraLight",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "SemiBold",
  700: "Bold",
  800: "Heavy",
  900: "Black",
};

function cssWeight(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 400;
  // fontconfig 的权重不是 CSS 数值：80=regular、200=bold、210=black。
  if (n >= 205) return 900;
  if (n >= 180) return 800;
  if (n >= 160) return 700;
  if (n >= 140) return 600;
  if (n >= 100) return 500;
  if (n >= 70) return 400;
  if (n >= 50) return 300;
  if (n >= 30) return 200;
  return 100;
}

function firstFamily(value: string): string {
  return value.split(",", 1)[0]?.trim() || value.trim();
}

/** 解析 fc-list 的 TSV 输出，单独导出供跨平台扫描测试使用。 */
export function parseFontconfigList(output: string): FontCatalogItem[] {
  const items: FontCatalogItem[] = [];
  for (const line of output.split(/\r?\n/)) {
    const [path, family, style, rawWeight] = line.split("\t");
    if (!path || !family) continue;
    const readable = existsSync(path);
    items.push({
      key: `system:${firstFamily(family)}`,
      id: `system:${firstFamily(family)}`,
      family: firstFamily(family),
      style: style?.trim() || "Regular",
      weight: cssWeight(rawWeight ?? "80"),
      source: "system",
      available: readable,
      exportable: readable,
      path,
    });
  }
  return items;
}

function projectItems(): FontCatalogItem[] {
  return Object.entries(FONT_FAMILIES).flatMap(([id, family]) =>
    Object.entries(family.faces).map(([rawWeight, file]) => {
      const weight = Number(rawWeight);
      const path = join(fontsDir(), family.dir, file);
      const available = existsSync(path);
      return {
        key: `project:${family.css}`,
        id,
        family: family.css,
        style: WEIGHT_LABEL[weight] ?? `Weight ${weight}`,
        weight,
        source: "project" as const,
        available,
        exportable: available,
        path,
      };
    }),
  );
}

async function systemItems(): Promise<{ items: FontCatalogItem[]; warning?: string }> {
  try {
    const { stdout } = await execFileAsync(
      "fc-list",
      ["--format=%{file}\\t%{family}\\t%{style}\\t%{weight}\\n"],
      {
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    return { items: parseFontconfigList(stdout) };
  } catch (e) {
    return {
      items: [],
      warning: `未找到可用的 fontconfig（fc-list）：${String((e as Error)?.message ?? e).slice(0, 240)}`,
    };
  }
}

function parseLicenseTable(markdown: string): Map<string, FontLicenseInfo> {
  const licenses = new Map<string, FontLicenseInfo>();
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith("| **")) continue;
    const cells = line
      .slice(1, line.endsWith("|") ? -1 : undefined)
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length < 7) continue;
    const id = cells[0]?.replace(/^\*\*|\*\*$/g, "");
    const level = cells[1]?.replace(/^\*\*|\*\*$/g, "") as "A" | "B" | "C" | undefined;
    if (!id || !level || !["A", "B", "C"].includes(level)) continue;
    const video = cells[4] ?? "";
    const status = video.includes("需付费")
      ? "需付费"
      : video.startsWith("允许")
        ? "已确认"
        : video.includes("未知")
          ? "未知"
          : "未登记";
    licenses.set(id, {
      level,
      status,
      source: "docs/font-licenses.md",
      note: `${video}；证据：${cells[6] ?? "未登记"}`,
    });
  }
  return licenses;
}

async function getFontLicenses(): Promise<Map<string, FontLicenseInfo>> {
  if (licenseCache) return licenseCache;
  try {
    const markdown = await readFile(
      resolve(import.meta.dirname, "..", "..", "docs", "font-licenses.md"),
      "utf8",
    );
    licenseCache = parseLicenseTable(markdown);
  } catch {
    licenseCache = new Map();
  }
  return licenseCache;
}

/** 清空运行时缓存；下次 getFontCatalog 会重新扫描。 */
export function refreshFontCatalog(): void {
  cache = null;
}

/** 读取项目字体和本机字体目录。默认只在进程首次调用时扫描，refresh=true 可手动刷新。 */
export async function getFontCatalog(refresh = false): Promise<FontCatalog> {
  if (!refresh && cache) return cache.catalog;
  const system = await systemItems();
  const licenses = await getFontLicenses();
  const warnings = system.warning
    ? [{ code: "SYSTEM_SCAN_UNAVAILABLE", message: system.warning }]
    : [];
  const items = [...projectItems(), ...system.items].map((item) => ({
    ...item,
    license:
      licenses.get(item.id) ??
      ({ status: "未登记", source: "docs/font-licenses.md" } satisfies FontLicenseInfo),
  }));
  const catalog: FontCatalog = {
    platform: process.platform,
    scannedAt: new Date().toISOString(),
    items,
    warnings,
  };
  cache = { catalog, at: Date.now() };
  return catalog;
}

/** API/网页只返回安全元数据，不暴露本机绝对路径。 */
export function publicFontCatalog(catalog: FontCatalog) {
  return {
    platform: catalog.platform,
    scannedAt: catalog.scannedAt,
    warnings: catalog.warnings,
    fonts: catalog.items.map(({ path: _path, ...item }) => ({
      ...item,
      license: item.license ?? {
        status: "未登记" as const,
        source: "docs/font-licenses.md" as const,
      },
    })),
  };
}

function systemMatch(catalog: FontCatalog, family: string, weight: number): FontCatalogItem | null {
  const candidates = catalog.items.filter(
    (item) => item.source === "system" && item.available && item.family === family,
  );
  return (
    candidates.toSorted((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight))[0] ??
    null
  );
}

function licenseForFamily(catalog: FontCatalog, family: string) {
  return catalog.items.find((item) => item.family === family && item.license)?.license;
}

/** 解析一个样式的项目/系统字体。严格 resolveFaces 保留给 fonts:check。 */
export function resolveStyleFaces(
  style: Pick<TextStyle, "font">,
  catalog: FontCatalog,
): SoftFontResolution {
  const ids = [style.font.family, ...style.font.fallback];
  const faces: SoftFontFace[] = [];
  const warnings: FontWarning[] = [];
  let primary: {
    css: string;
    available: boolean;
    source: "project" | "system" | "missing";
  } | null = null;
  let firstAvailable: { css: string; source: "project" | "system" } | null = null;

  for (const id of ids) {
    const family = FONT_FAMILIES[id];
    const css = family?.css ?? id;
    const weight = family ? nearestWeight(family, style.font.weight) : style.font.weight;
    const file = family ? `${family.dir}/${family.faces[weight]}` : null;
    const projectPath = file ? join(fontsDir(), file) : null;
    const projectAvailable = projectPath ? existsSync(projectPath) : false;
    const machine = projectAvailable ? null : systemMatch(catalog, css, weight);
    const source = projectAvailable ? "project" : machine ? "system" : "missing";
    if (id === style.font.family) primary = { css, available: source !== "missing", source };
    if (source !== "missing" && !firstAvailable) firstAvailable = { css, source };
    if (source === "project" && projectPath) {
      faces.push({ id, css, weight, file: file!, path: projectPath, source: "project" });
    } else if (source === "system" && machine?.path) {
      faces.push({
        id,
        css: machine.family,
        weight: machine.weight,
        file: machine.path,
        path: machine.path,
        source: "system",
      });
    }
  }

  if (primary && !primary.available) {
    const actual = firstAvailable?.css ?? null;
    warnings.push({
      code: actual ? "FONT_FALLBACK" : "FONT_MISSING",
      requested: primary.css,
      actual,
      weight: style.font.weight,
      source: firstAvailable?.source ?? "missing",
      elements: [],
      license: licenseForFamily(catalog, actual ?? primary.css),
      message: actual
        ? `字体「${primary.css}」缺失，已回退到「${actual}」；布局以预览和导出为准`
        : `字体「${primary.css}」及其后备字体均不可用；将使用 CSS 系统回退，布局以预览和导出为准`,
    });
  }
  return { faces, warnings };
}

/** 按样式使用位置附加元素 ID，供预览、导出、lint、CLI/MCP 复用。 */
export function fontWarningsForStyles(uses: FontStyleUse[], catalog: FontCatalog): FontWarning[] {
  return uses.flatMap(({ style, elements }) =>
    resolveStyleFaces(style, catalog).warnings.map((warning) => ({
      ...warning,
      elements: [...elements],
    })),
  );
}

/** 字体根目录：仓库里的 assets/fonts/（不进 git），可以用 MW_FONTS_DIR 修改 */
export function fontsDir(): string {
  return process.env.MW_FONTS_DIR
    ? resolve(process.env.MW_FONTS_DIR)
    : resolve(import.meta.dirname, "..", "..", "assets", "fonts");
}

export async function checkFonts(): Promise<
  { id: string; weight: number; path: string; ok: boolean }[]
> {
  return Object.entries(FONT_FAMILIES).flatMap(([id, fam]) =>
    Object.entries(fam.faces).map(([w, file]) => {
      const path = join(fontsDir(), fam.dir, file);
      return { id, weight: Number(w), path, ok: existsSync(path) };
    }),
  );
}

/** 渲染前检查：缺少字体文件时报 FONT_MISSING，而不是悄悄换成别的字体 */
export function resolveFaces(faces: FontFace[]): (FontFace & { path: string })[] {
  const missing: string[] = [];
  const out = faces.map((f) => {
    const path = join(fontsDir(), f.file);
    if (!existsSync(path)) missing.push(path);
    return { ...f, path };
  });
  if (missing.length > 0) {
    throw new MwError("FONT_MISSING", `缺少字体文件：${missing.join("、")}`, {
      hint: [
        "运行 pnpm fonts:check 查看缺哪些；按字体包说明将字体放入 assets/fonts/ 对应目录",
        "测试字体运行 pnpm fonts:fetch-test",
      ].join("；"),
    });
  }
  return out;
}
