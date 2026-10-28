import type React from "react";
import type { z } from "zod";
import { TitleBar } from "./title-bar/component";
import { meta as titleBarMeta } from "./title-bar/meta";
import { TitleBarProps } from "./title-bar/schema";
import type { TemplateProps } from "./types";

export type TemplateEntry = {
  meta: { name: string; label: string; description: string; defaultStyle: string };
  schema: z.ZodType;
  // 各模板的 props 类型不同；注册表里统一先用 schema 校验，再把结果传给组件
  Component: React.FC<TemplateProps<any>>;
};

export const TEMPLATES: Record<string, TemplateEntry> = {
  "title-bar": { meta: titleBarMeta, schema: TitleBarProps, Component: TitleBar },
};

export const TEMPLATE_NAMES = Object.keys(TEMPLATES);
