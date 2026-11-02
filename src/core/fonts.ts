// 字体目录：字体 ID → 每个字重对应的文件（相对 assets/fonts/）。
// 字体文件不进仓库（AGENTS.md），由 node/fonts 检查是否存在、提供给渲染器。

export type FontFamily = {
  /** CSS 里使用的字体名 */
  css: string;
  /** 选择器里的分组 */
  group: string;
  dir: string;
  /** 字重 → 文件名 */
  faces: Record<number, string>;
};

export const FONT_FAMILIES: Record<string, FontFamily> = {
  "alibaba-puhuiti-3": {
    css: "Alibaba PuHuiTi 3",
    group: "常用",
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
    group: "常用",
    dir: "noto-sans-sc",
    faces: {
      400: "NotoSansSC-Regular.otf",
      700: "NotoSansSC-Bold.otf",
      900: "NotoSansSC-Black.otf",
    },
  },
  "alibaba-puhuiti-1": {
    css: "阿里巴巴普惠体 1.0",
    group: "常用",
    dir: "B站免费商用字体合集/05 阿里巴巴普惠体 AlibabaPuHuiTi",
    faces: {
      300: "8_1_1_阿里巴巴普惠体-Light.ttf",
      400: "8_1_2_阿里巴巴普惠体-Regular.ttf",
      500: "8_1_3_阿里巴巴普惠体-Medium.ttf",
      700: "8_1_4_阿里巴巴普惠体-Bold.ttf",
      900: "8_1_5_阿里巴巴普惠体-Heavy.ttf",
    },
  },
  "source-han-sans-sc": {
    css: "思源黑体（简体）",
    group: "思源系列",
    dir: "B站免费商用字体合集/01 思源黑体 SourceHanSansSC",
    faces: {
      200: "SourceHanSansSC-ExtraLight.otf",
      300: "SourceHanSansSC-Light.otf",
      350: "SourceHanSansSC-Normal.otf",
      400: "SourceHanSansSC-Regular.otf",
      500: "SourceHanSansSC-Medium.otf",
      700: "SourceHanSansSC-Bold.otf",
      900: "SourceHanSansSC-Heavy.otf",
    },
  },
  "source-han-serif-sc": {
    css: "思源宋体（简体）",
    group: "思源系列",
    dir: "B站免费商用字体合集/02 思源宋体 SourceHanSerifSC",
    faces: {
      200: "SourceHanSerifSC-ExtraLight.otf",
      300: "SourceHanSerifSC-Light.otf",
      400: "SourceHanSerifSC-Regular.otf",
      500: "SourceHanSerifSC-Medium.otf",
      600: "SourceHanSerifSC-SemiBold.otf",
      700: "SourceHanSerifSC-Bold.otf",
      900: "SourceHanSerifSC-Heavy.otf",
    },
  },
  "genjyuu-gothic": {
    css: "源柔ゴシック（圆体）",
    group: "思源系列",
    dir: "B站免费商用字体合集/03 思源柔黑 GenJyuuGothic",
    faces: {
      200: "GenJyuuGothic-ExtraLight.ttf",
      300: "GenJyuuGothic-Light.ttf",
      350: "GenJyuuGothic-Normal.ttf",
      400: "GenJyuuGothic-Regular.ttf",
      500: "GenJyuuGothic-Medium.ttf",
      700: "GenJyuuGothic-Bold.ttf",
      900: "GenJyuuGothic-Heavy.ttf",
    },
  },
  "genshin-gothic": {
    css: "源真ゴシック",
    group: "思源系列",
    dir: "B站免费商用字体合集/04 思源真黑 GenShinGothic",
    faces: {
      200: "GenShinGothic-ExtraLight.ttf",
      300: "GenShinGothic-Light.ttf",
      350: "GenShinGothic-Normal.ttf",
      400: "GenShinGothic-Regular.ttf",
      500: "GenShinGothic-Medium.ttf",
      700: "GenShinGothic-Bold.ttf",
      900: "GenShinGothic-Heavy.ttf",
    },
  },
  // 源 TTC 包含多个地区字形；提取独立 TTF（TW）供渲染器按字重加载。
  "genyo-min-tw": {
    css: "源样明体（TW）",
    group: "思源系列",
    dir: "commercial-webfonts/genyo-min-tw",
    faces: {
      200: "GenYoMin2-EL.ttf",
      300: "GenYoMin2-L.ttf",
      400: "GenYoMin2-R.ttf",
      500: "GenYoMin2-M.ttf",
      600: "GenYoMin2-SB.ttf",
      700: "GenYoMin2-B.ttf",
      900: "GenYoMin2-H.ttf",
    },
  },
  "genryu-min-tw": {
    css: "源流明体（TW）",
    group: "思源系列",
    dir: "commercial-webfonts/genryu-min-tw",
    faces: {
      200: "GenRyuMin2-EL.ttf",
      300: "GenRyuMin2-L.ttf",
      400: "GenRyuMin2-R.ttf",
      500: "GenRyuMin2-M.ttf",
      600: "GenRyuMin2-SB.ttf",
      700: "GenRyuMin2-B.ttf",
      900: "GenRyuMin2-H.ttf",
    },
  },
  "genwan-min-tw": {
    css: "源云明体（TW）",
    group: "思源系列",
    dir: "commercial-webfonts/genwan-min-tw",
    faces: {
      200: "GenWanMin2-EL.ttf",
      300: "GenWanMin2-L.ttf",
      400: "GenWanMin2-R.ttf",
      500: "GenWanMin2-M.ttf",
      600: "GenWanMin2-SB.ttf",
    },
  },
  "zcool-xiaowei": {
    css: "站酷小薇 LOGO 体",
    group: "站酷系列",
    dir: "B站免费商用字体合集/06 站酷系列 ZCOOL",
    faces: { 400: "3_1_站酷小薇LOGO体-Regular.otf" },
  },
  "zcool-gdh": {
    css: "站酷高端黑",
    group: "站酷系列",
    dir: "B站免费商用字体合集/06 站酷系列 ZCOOL",
    faces: { 400: "3_2_站酷高端黑-Regular.ttf" },
  },
  "zcool-kuhei": {
    css: "站酷酷黑体",
    group: "站酷系列",
    dir: "B站免费商用字体合集/06 站酷系列 ZCOOL",
    faces: { 400: "3_3_站酷酷黑体-Regular.ttf" },
  },
  "zcool-happy": {
    css: "站酷快乐体",
    group: "站酷系列",
    dir: "B站免费商用字体合集/06 站酷系列 ZCOOL",
    faces: { 400: "3_4_站酷快乐体-Regular.ttf" },
  },
  "zcool-qingke-butter": {
    css: "站酷庆科黄油体",
    group: "站酷系列",
    dir: "B站免费商用字体合集/06 站酷系列 ZCOOL",
    faces: { 400: "3_5_站酷庆科黄油体-Regular.ttf" },
  },
  "zcool-wenyi": {
    css: "站酷文艺体",
    group: "站酷系列",
    dir: "B站免费商用字体合集/06 站酷系列 ZCOOL",
    faces: { 400: "3_6_站酷文艺体-Regular.ttf" },
  },
  "pangmen-title": {
    css: "庞门正道标题体",
    group: "庞门正道",
    dir: "B站免费商用字体合集/07 庞门正道 PangMenZhengDao",
    faces: { 400: "2_1_庞门正道标题体-Regular.ttf" },
  },
  "pangmen-cushu": {
    css: "庞门正道粗书体",
    group: "庞门正道",
    dir: "B站免费商用字体合集/07 庞门正道 PangMenZhengDao",
    faces: { 400: "2_2_庞门正道粗书体-Regular.ttf" },
  },
  "fandol-braille": {
    css: "Fandol 盲文",
    group: "Fandol",
    dir: "B站免费商用字体合集/09 Fandol 破产字体",
    faces: { 400: "FandolBraille-Regular.otf" },
  },
  "fandol-braille-display": {
    css: "Fandol 盲文（展示）",
    group: "Fandol",
    dir: "B站免费商用字体合集/09 Fandol 破产字体",
    faces: { 400: "FandolBraille-Display.otf" },
  },
  "fandol-fang": {
    css: "Fandol 仿宋",
    group: "Fandol",
    dir: "B站免费商用字体合集/09 Fandol 破产字体",
    faces: { 400: "FandolFang-Regular.otf" },
  },
  "fandol-hei": {
    css: "Fandol 黑体",
    group: "Fandol",
    dir: "B站免费商用字体合集/09 Fandol 破产字体",
    faces: {
      400: "FandolHei-Regular.otf",
      700: "FandolHei-Bold.otf",
    },
  },
  "fandol-kai": {
    css: "Fandol 楷体",
    group: "Fandol",
    dir: "B站免费商用字体合集/09 Fandol 破产字体",
    faces: { 400: "FandolKai-Regular.otf" },
  },
  "fandol-song": {
    css: "Fandol 宋体",
    group: "Fandol",
    dir: "B站免费商用字体合集/09 Fandol 破产字体",
    faces: {
      400: "FandolSong-Regular.otf",
      700: "FandolSong-Bold.otf",
    },
  },
  "seto-font": {
    css: "濑户字体",
    group: "手写与装饰",
    dir: "B站免费商用字体合集/10 濑户字体 SetoFont",
    faces: { 400: "SetoFont-Regular.ttf" },
  },
  "soukous-mincho": {
    css: "装甲明朝",
    group: "手写与装饰",
    dir: "B站免费商用字体合集/11 装甲明朝·源界明朝",
    faces: { 400: "1_2_2_2_装甲明朝体-Regular.ttf" },
  },
  "genkai-mincho": {
    css: "源界明朝",
    group: "手写与装饰",
    dir: "B站免费商用字体合集/11 装甲明朝·源界明朝",
    faces: { 700: "1_2_2_1_源界明朝体-Regular.ttf" },
  },
  "wenquanyi-microhei": {
    css: "文泉驿微米黑",
    group: "文泉驿",
    dir: "commercial-webfonts/wenquanyi-microhei",
    faces: { 400: "WenQuanYi-MicroHei-Regular.ttf" },
  },
  "wenquanyi-zenhei": {
    css: "文泉驿正黑",
    group: "文泉驿",
    dir: "commercial-webfonts/wenquanyi-zenhei",
    faces: { 400: "WenQuanYi-ZenHei-Regular.ttf" },
  },
  "hanwang-fangsong": {
    css: "王汉宗中仿宋（繁体）",
    group: "王汉宗自由字型",
    dir: "B站免费商用字体合集/13 王汉宗自由字型 HanWang",
    faces: { 500: "HanWangFangSongMedium-Gb5.ttf" },
  },
  "hanwang-kai": {
    css: "王汉宗粗楷体（繁体）",
    group: "王汉宗自由字型",
    dir: "B站免费商用字体合集/13 王汉宗自由字型 HanWang",
    faces: { 700: "HanWangKaiBold-Gb5.ttf" },
  },
  "hanwang-sinsong": {
    css: "王汉宗细新宋（繁体）",
    group: "王汉宗自由字型",
    dir: "B站免费商用字体合集/13 王汉宗自由字型 HanWang",
    faces: { 300: "HanWangSinSongThin-Gb5.ttf" },
  },
  "hanwang-weibei": {
    css: "王汉宗中魏碑（繁体）",
    group: "王汉宗自由字型",
    dir: "B站免费商用字体合集/13 王汉宗自由字型 HanWang",
    faces: { 500: "HanWangWeiBeiMedium-Gb5.ttf" },
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
