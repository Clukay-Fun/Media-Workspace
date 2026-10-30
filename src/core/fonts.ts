// 字体目录：字体 ID → 每个字重对应的文件（相对 assets/fonts/）。
// 字体文件不进仓库（AGENTS.md），由 node/fonts 检查是否存在、提供给渲染器。

export type FontFamily = {
  /** CSS 里使用的字体名 */
  css: string;
  dir: string;
  /** 字重 → 文件名 */
  faces: Record<number, string>;
};

export const FONT_FAMILIES: Record<string, FontFamily> = {
  "alibaba-puhuiti-3": {
    css: "Alibaba PuHuiTi 3",
    dir: "alibaba-puhuiti-3",
    // 官方没有 Medium（500）；请求 500 时按最接近的字重取
    faces: {
      100: "AlibabaPuHuiTi-3-35-Thin.woff2",
      300: "AlibabaPuHuiTi-3-45-Light.woff2",
      400: "AlibabaPuHuiTi-3-55-Regular.woff2",
      600: "AlibabaPuHuiTi-3-75-SemiBold.woff2",
      700: "AlibabaPuHuiTi-3-85-Bold.woff2",
      800: "AlibabaPuHuiTi-3-105-Heavy.woff2",
      900: "AlibabaPuHuiTi-3-115-Black.woff2",
    },
  },
  "noto-sans-sc": {
    css: "Noto Sans SC",
    dir: "noto-sans-sc",
    faces: {
      400: "NotoSansSC-Regular.otf",
      700: "NotoSansSC-Bold.otf",
      900: "NotoSansSC-Black.otf",
    },
  },
};

/** 取最接近的字重；距离相同时取更粗的（标题、字幕宁粗勿细） */
export function nearestWeight(family: FontFamily, weight: number): number {
  const weights = Object.keys(family.faces).map(Number);
  return weights.reduce((best, w) => {
    const d = Math.abs(w - weight);
    const bd = Math.abs(best - weight);
    return d < bd || (d === bd && w > best) ? w : best;
  });
}

export type FontFace = { id: string; css: string; weight: number; file: string };

/** 一个样式需要加载的字体文件：主字体 + 后备字体，各取最接近的字重 */
export function facesFor(style: {
  font: { family: string; fallback: string[]; weight: number };
}): FontFace[] {
  return [style.font.family, ...style.font.fallback].flatMap((id) => {
    const fam = FONT_FAMILIES[id];
    if (!fam) return [];
    const w = nearestWeight(fam, style.font.weight);
    return [{ id, css: fam.css, weight: w, file: `${fam.dir}/${fam.faces[w]}` }];
  });
}

/** CSS font-family：主字体、后备字体，不写系统字体（D26） */
export function cssFontStack(style: { font: { family: string; fallback: string[] } }): string {
  return [style.font.family, ...style.font.fallback]
    .map((id) => FONT_FAMILIES[id]?.css ?? id)
    .map((n) => JSON.stringify(n))
    .join(", ");
}
