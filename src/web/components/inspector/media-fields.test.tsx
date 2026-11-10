import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ASPECTS } from "../../../core/aspect";
import { FULL_CROP, roundCrop } from "../../../core/crop";
import { PreservePitchControl } from "./clip";
import {
  commitGainDb,
  commitSpeed,
  cropEditDecision,
  gainSliderValue,
  hasProxyCache,
  speedDurationLabel,
  speedDurationSeconds,
  UNSUPPORTED_PROJECT_CONTROLS,
} from "./media-fields";
import { UnsupportedProjectControls } from "./project";

describe("变速和音量的确认边界", () => {
  it("旧倍速按原值算时长，确认时才收进 0.1–10", () => {
    const legacy = 15;
    const sourceMs = 15_000;
    const shown = speedDurationSeconds(sourceMs, legacy);
    const committed = commitSpeed(legacy);
    expect(committed).toBe(10);
    expect(shown).toBe(speedDurationSeconds(sourceMs, legacy));
    expect(speedDurationLabel(sourceMs, legacy)).toBe("1.0");
    expect(speedDurationLabel(sourceMs, committed ?? legacy)).toBe("1.5");
    expect(shown).not.toBe(speedDurationSeconds(sourceMs, committed ?? legacy));
  });

  it("非正数和无效倍速不提交", () => {
    expect(commitSpeed(0)).toBeNull();
    expect(commitSpeed(-1)).toBeNull();
    expect(commitSpeed(Number.NaN)).toBeNull();
    expect(commitSpeed(Number.POSITIVE_INFINITY)).toBeNull();
    expect(speedDurationSeconds(1000, 0)).toBeNull();
    expect(speedDurationSeconds(1000, Number.NaN)).toBeNull();
  });

  it("新倍速保留两位并夹在 schema 范围内", () => {
    expect(commitSpeed(1.234)).toBe(1.23);
    expect(commitSpeed(0.04)).toBe(0.1);
    expect(commitSpeed(1)).toBe(1);
    expect(commitSpeed(10)).toBe(10);
  });

  it("新音量在确认时取整并夹在 −20 到 +20，滑杆只钳位置", () => {
    expect(commitGainDb(3.6)).toBe(4);
    expect(commitGainDb(25)).toBe(20);
    expect(commitGainDb(-80)).toBe(-20);
    expect(commitGainDb(0)).toBe(0);
    expect(commitGainDb(Number.NaN)).toBeNull();
    expect(commitGainDb(Number.POSITIVE_INFINITY)).toBeNull();
    expect(gainSliderValue(25, 0)).toBe(20);
    expect(gainSliderValue(Number.NaN, 7)).toBe(7);
    expect(gainSliderValue(Number.NaN, -60)).toBe(-20);
    expect(gainSliderValue(12.4, 0)).toBe(12.4);
    expect(commitGainDb(12.4)).toBe(12);
  });
});

describe("裁切草稿和完成", () => {
  it("拖动没有 op，完成只提交一次", () => {
    const rect = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    const drag = cropEditDecision("drag", "c1", rect);
    expect(drag.ops).toEqual([]);
    expect(drag.draft).toEqual(rect);

    const finish = cropEditDecision("finish", "c1", rect);
    expect(finish.ops).toEqual([{ op: "item.update", id: "c1", set: { crop: roundCrop(rect) } }]);
  });

  it("铺满素材时完成写入 crop null", () => {
    const finish = cropEditDecision("finish", "c1", FULL_CROP);
    expect(finish.ops).toEqual([{ op: "item.update", id: "c1", set: { crop: null } }]);
    expect(finish.stored).toBeNull();
  });
});

describe("项目面板只读事实", () => {
  it("代理缓存只看素材上的 cache.proxy", () => {
    expect(
      hasProxyCache({
        assets: { a: { cache: { proxy: "cache/a.mp4" } }, b: {} },
      }),
    ).toBe(true);
    expect(hasProxyCache({ assets: { b: { cache: { proxy: "" } } } })).toBe(false);
    expect(hasProxyCache({ assets: { b: {} } })).toBe(false);
  });

  it("可编辑画幅只有 9:16 和 16:9，其余控件禁用", () => {
    expect(ASPECTS).toEqual(["9:16", "16:9"]);
    const labels = UNSUPPORTED_PROJECT_CONTROLS.map((item) => item.label).join("\n");
    for (const name of [
      "重命名",
      "搬迁",
      "HDR",
      "浮点链接",
      "自由层级",
      "代理",
      "时间线",
      "1:1",
      "4:3",
      "分辨率",
      "帧率",
    ]) {
      expect(labels.includes(name)).toBe(true);
    }
    const html = renderToStaticMarkup(<UnsupportedProjectControls />);
    expect(html.includes("disabled")).toBe(true);
    expect(html.match(/<button/g)?.length).toBe(UNSUPPORTED_PROJECT_CONTROLS.length);
    for (const item of UNSUPPORTED_PROJECT_CONTROLS) {
      expect(html.includes(item.label)).toBe(true);
      expect(html.includes(item.reason)).toBe(true);
    }
  });

  it("保持音调没有字段，控件禁用", () => {
    const html = renderToStaticMarkup(<PreservePitchControl />);
    expect(html.includes("保持音调")).toBe(true);
    expect(html.includes("未支持")).toBe(true);
    expect(html.includes("disabled")).toBe(true);
    expect(html.includes("checked")).toBe(false);
  });
});
