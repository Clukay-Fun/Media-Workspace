import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { frameAtRatio, markerLeftPercent, PlayerChromeV7 } from "./player-chrome-v7";

describe("播放器 V7 进度", () => {
  it("把点击比例换成最后一帧以内的帧号", () => {
    expect(frameAtRatio(0, 301)).toBe(0);
    expect(frameAtRatio(0.5, 301)).toBe(150);
    expect(frameAtRatio(1, 301)).toBe(300);
    expect(frameAtRatio(-2, 10)).toBe(0);
    expect(frameAtRatio(Number.NaN, 10)).toBe(0);
  });

  it("批注标记按成片帧落在进度条上", () => {
    expect(markerLeftPercent(0, 30, 301)).toBe(0);
    expect(markerLeftPercent(1000, 30, 301)).toBe(10);
    expect(markerLeftPercent(99_000, 30, 301)).toBe(100);
  });
});

describe("播放器 V7 底栏", () => {
  it("显示真实时间和未解决批注，不带设计稿示例句", () => {
    const html = renderToStaticMarkup(
      <PlayerChromeV7
        frame={30}
        fps={30}
        total={301}
        width={1080}
        height={1920}
        playing={false}
        loop={false}
        comments={[
          { id: "k3", text: "开头需要确认", status: "open", atMs: 1000 },
          { id: "k4", text: "这条已经处理", status: "resolved", atMs: 2000 },
        ]}
        onLoopChange={() => undefined}
        onFullscreen={() => undefined}
      />,
    );

    expect(html).toContain("00:01.0");
    expect(html).toContain("1080×1920");
    expect(html).toContain("开头需要确认");
    expect(html).toContain("添加批注");
    expect(html).not.toContain("这条已经处理");
    expect(html).not.toContain("以前对敲换过汇");
    expect(html).toContain('aria-pressed="false"');
  });
});
