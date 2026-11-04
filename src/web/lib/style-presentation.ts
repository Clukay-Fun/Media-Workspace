export type StylePresentation = { name: string; description?: string };

const DEFAULT_TEMPLATE_STYLES: Record<string, { name: string; templateId: string }> = {
  "1029-caption-puhui-v1": {
    name: "默认模板字幕",
    templateId: "default-template-caption",
  },
  "1029-title-puhui-v1": {
    name: "默认模板标题",
    templateId: "default-template-title",
  },
};

/** 套用到工程时保留原 ID；“存为模板”建议新的合法 ASCII ID。 */
export function stylePresentation(name: string, description?: string): StylePresentation {
  const friendly = DEFAULT_TEMPLATE_STYLES[name];
  const displayDescription = friendly ? description?.replace(/^1029/, "默认模板") : description;
  return {
    name: friendly?.name ?? name,
    ...(displayDescription ? { description: displayDescription } : {}),
  };
}

/** 模板库 ID 只允许 ASCII 字母、数字、连字符和下划线。 */
export function styleTemplateId(name: string): string {
  return DEFAULT_TEMPLATE_STYLES[name]?.templateId ?? name;
}
