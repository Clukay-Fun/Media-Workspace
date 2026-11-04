import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BUILTIN_STYLES } from "../../core/presets";
import { StyleCard } from "./left-panel";

describe("样式库卡片", () => {
  it("以友好名称和说明展示默认模板，不把内部 ID 露在卡片上", () => {
    const html = renderToStaticMarkup(
      <StyleCard
        name="1029-caption-puhui-v1"
        note="1029口播基线：普惠体3.0 600，84px，逐词短淡入；仅本机制作，字体文件不随模板分发"
        style={BUILTIN_STYLES["caption-word-yellow"]!}
      >
        <button type="button">加入工程</button>
      </StyleCard>,
    );

    expect(html).toContain("默认模板字幕");
    expect(html).toContain("默认模板口播基线：普惠体3.0 600，84px，逐词短淡入");
    expect(html).toContain("字体文件不随模板分发");
    expect(html).not.toContain("1029-caption-puhui-v1");
    expect(html).not.toContain("1029口播基线");
  });
});
