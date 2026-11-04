import { describe, expect, it } from "vitest";
import { stylePresentation, styleTemplateId } from "./style-presentation";

describe("样式库显示名称", () => {
  it("为默认模板的兼容 ID 提供友好名称和说明", () => {
    expect(stylePresentation("1029-caption-puhui-v1", "旧字幕说明")).toEqual({
      name: "默认模板字幕",
      description: "旧字幕说明",
    });
    expect(stylePresentation("1029-title-puhui-v1", "旧标题说明")).toEqual({
      name: "默认模板标题",
      description: "旧标题说明",
    });
  });

  it("只替换说明开头的旧编号，保留其余真实内容", () => {
    expect(
      stylePresentation(
        "1029-caption-puhui-v1",
        "1029口播基线：普惠体3.0 600，84px，逐词短淡入；仅本机制作",
      ).description,
    ).toBe("默认模板口播基线：普惠体3.0 600，84px，逐词短淡入；仅本机制作");
    expect(stylePresentation("1029-title-puhui-v1", "负责人已更新的说明").description).toBe(
      "负责人已更新的说明",
    );
  });

  it("保留其他样式的名称和说明", () => {
    expect(stylePresentation("my-caption", "自定义字幕样式")).toEqual({
      name: "my-caption",
      description: "自定义字幕样式",
    });
  });

  it("为默认模板给出符合模板库 ID 格式的保存建议", () => {
    expect(styleTemplateId("1029-caption-puhui-v1")).toBe("default-template-caption");
    expect(styleTemplateId("1029-title-puhui-v1")).toBe("default-template-title");
    expect(styleTemplateId("custom-style")).toBe("custom-style");
    expect(styleTemplateId("1029-caption-puhui-v1")).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });
});
