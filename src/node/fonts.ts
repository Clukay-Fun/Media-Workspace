import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { MwError } from "../core/errors";
import { FONT_FAMILIES, type FontFace } from "../core/fonts";

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
      hint: "运行 pnpm fonts:check 查看缺哪些；普惠体从官方下载，测试字体运行 pnpm fonts:fetch-test",
    });
  }
  return out;
}
