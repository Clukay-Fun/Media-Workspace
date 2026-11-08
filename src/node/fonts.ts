import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { MwError } from "../core/errors";
import { FONT_FAMILIES, type FontFace } from "../core/fonts";

const execFileAsync = promisify(execFile);

export type FontSource = "project" | "system";

/** 运行时字体索引；path 只留在 Node 进程内，不会写入工程或 API 响应。 */
export type FontCatalogItem = {
  id: string;
  family: string;
  style: string;
  weight: number;
  source: FontSource;
  available: boolean;
  exportable: boolean;
  path?: string;
};

export type FontCatalog = {
  platform: NodeJS.Platform;
  scannedAt: string;
  items: FontCatalogItem[];
  warnings: { code: string; message: string }[];
};

type FontCache = { catalog: FontCatalog; at: number };
let cache: FontCache | null = null;

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

/** 清空运行时缓存；下次 getFontCatalog 会重新扫描。 */
export function refreshFontCatalog(): void {
  cache = null;
}

/** 读取项目字体和本机字体目录。默认只在进程首次调用时扫描，refresh=true 可手动刷新。 */
export async function getFontCatalog(refresh = false): Promise<FontCatalog> {
  if (!refresh && cache) return cache.catalog;
  const system = await systemItems();
  const warnings = system.warning
    ? [{ code: "SYSTEM_SCAN_UNAVAILABLE", message: system.warning }]
    : [];
  const items = [...projectItems(), ...system.items];
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
    fonts: catalog.items.map(({ path: _path, ...item }) => item),
  };
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
