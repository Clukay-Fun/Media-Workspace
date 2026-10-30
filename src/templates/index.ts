import type React from "react";
import type { z } from "zod";
import type { ResolvedOverlay } from "../core/compile";
import type { Box } from "../core/lint";
import type { CardSize } from "../core/schema";
import type { TextStyle } from "../core/text-style";
import { bounds as nameBarBounds } from "./name-bar/bounds";
import { NameBar } from "./name-bar/component";
import { meta as nameBarMeta } from "./name-bar/meta";
import { NameBarProps } from "./name-bar/schema";
import { bounds as screenshotBounds } from "./screenshot/bounds";
import { Screenshot } from "./screenshot/component";
import { meta as screenshotMeta } from "./screenshot/meta";
import { ScreenshotProps } from "./screenshot/schema";
import { bounds as textCardBounds } from "./text-card/bounds";
import { TextCard } from "./text-card/component";
import { meta as textCardMeta } from "./text-card/meta";
import { TextCardProps } from "./text-card/schema";
import { bounds as tipBarBounds } from "./tip-bar/bounds";
import { TipBar } from "./tip-bar/component";
import { meta as tipBarMeta } from "./tip-bar/meta";
import { TipBarProps } from "./tip-bar/schema";
import { bounds as titleBarBounds } from "./title-bar/bounds";
import { TitleBar } from "./title-bar/component";
import { meta as titleBarMeta } from "./title-bar/meta";
import { TitleBarProps } from "./title-bar/schema";
import type { TemplateMeta, TemplateProps } from "./types";

export type TemplateBounds = { text: Box[]; shapes: Box[] };

// 新模板的写法见 docs/template-guide.md
export type TemplateEntry = {
  meta: TemplateMeta;
  schema: z.ZodType;
  // 各模板的 props 类型不同；注册表里统一先用 schema 校验，再把结果传给组件
  Component: React.FC<TemplateProps<any>>;
  /** 质检用：模板画出来占的区域（props 已经过 schema 校验） */
  bounds?: (
    props: any,
    style: TextStyle,
    width: number,
    height: number,
    size: CardSize,
  ) => TemplateBounds;
  /** 用到的素材 ID（图片等）：渲染时只把这些素材换成地址 */
  assets?: (props: any) => string[];
};

export const TEMPLATES: Record<string, TemplateEntry> = {
  "title-bar": {
    meta: titleBarMeta,
    schema: TitleBarProps,
    Component: TitleBar,
    bounds: titleBarBounds,
  },
  "text-card": {
    meta: textCardMeta,
    schema: TextCardProps,
    Component: TextCard,
    bounds: textCardBounds,
  },
  "name-bar": {
    meta: nameBarMeta,
    schema: NameBarProps,
    Component: NameBar,
    bounds: nameBarBounds,
  },
  "tip-bar": {
    meta: tipBarMeta,
    schema: TipBarProps,
    Component: TipBar,
    bounds: tipBarBounds,
  },
  screenshot: {
    meta: screenshotMeta,
    schema: ScreenshotProps,
    Component: Screenshot,
    bounds: screenshotBounds,
    assets: (p: ScreenshotProps) => [p.image],
  },
};

export const TEMPLATE_NAMES = Object.keys(TEMPLATES);

/** 叠加层实际用的尺寸：卡片必须写 size（校验时检查），没写时按第一个尺寸画 */
export function overlaySize(tpl: TemplateEntry, size: CardSize | null): CardSize {
  return size ?? tpl.meta.sizes[0] ?? "small";
}

/** 叠加层占的区域（还没套用叠加层自己的 transform）；模板或参数不对时为空 */
export function overlayBounds(
  o: Pick<ResolvedOverlay, "template" | "props" | "size">,
  style: TextStyle,
  width: number,
  height: number,
): TemplateBounds {
  const tpl = TEMPLATES[o.template];
  const props = tpl?.schema.safeParse(o.props);
  if (!tpl?.bounds || !props?.success) return { text: [], shapes: [] };
  return tpl.bounds(props.data, style, width, height, overlaySize(tpl, o.size));
}

/** 叠加层引用的素材 ID；参数不对时为空（参数错误由渲染前的校验报） */
export function overlayAssets(o: Pick<ResolvedOverlay, "template" | "props">): string[] {
  const tpl = TEMPLATES[o.template];
  const props = tpl?.schema.safeParse(o.props);
  return tpl?.assets && props?.success ? tpl.assets(props.data) : [];
}
