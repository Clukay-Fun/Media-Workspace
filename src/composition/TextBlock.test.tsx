import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TextStyle } from "../core/text-style";
import { TextBlock } from "./TextBlock";

const base = {
  font: { family: "noto-sans-sc", size: 80 },
  fill: "#FFFFFF",
  layout: { x: 540, y: 960, maxWidth: 900 },
  animation: { unit: "char", stagger: { eachMs: 100 } },
};

// 30fps，第 n 帧 = n * 33.3ms；逐字每 100ms 出现一个
const html = (style: object, frame: number, highlights: { text: string }[] = []) =>
  renderToStaticMarkup(
    <TextBlock
      text="一二三四"
      style={TextStyle.parse({ ...base, ...style })}
      highlights={highlights}
      frame={frame}
      durationInFrames={60}
      fps={30}
    />,
  );

describe("TextBlock 装饰（格式 v5）", () => {
  it("当前词色块只垫在正在念的字后面", () => {
    const style = {
      highlight: { mode: "keyword", fill: "#FFFF00", activeBox: { color: "#FF0000", radius: 8 } },
    };
    // 第 7 帧 ≈ 233ms：第 3 个字刚开始念
    const out = html(style, 7);
    expect(out.match(/background:#FF0000/g)).toHaveLength(1);
    const deco = out.slice(0, out.indexOf("background:#FF0000"));
    expect(deco).toContain(">三<");
  });

  it("下划线只画在关键词下面，跟着出现的进度从左往右画", () => {
    const style = {
      highlight: { fill: "#FFFF00", underline: { color: "#00FF00", drawMs: 200 } },
    };
    expect(html(style, 0, [{ text: "二" }])).not.toContain("#00FF00");
    const mid = html(style, 6, [{ text: "二" }]); // 二从 100ms 开始画，200ms 时画了一半
    expect(mid).toMatch(/width:50%;[^"]*background:#00FF00/);
    expect(html(style, 30, [{ text: "二" }]).match(/background:#00FF00/g)).toHaveLength(1);
  });

  it("渐变用背景裁切到文字上；高亮的字用高亮渐变", () => {
    const style = {
      gradient: { colors: ["#FFFFFF", "#888888"] },
      highlight: { fill: "#FFFF00", gradient: { colors: ["#FFFF00", "#FF8800"] } },
    };
    const out = html(style, 30, [{ text: "四" }]);
    expect(out.match(/linear-gradient\(180deg, #FFFFFF, #888888\)/g)).toHaveLength(3);
    expect(out.match(/linear-gradient\(180deg, #FFFF00, #FF8800\)/g)).toHaveLength(1);
  });

  it("发光画在最外层：有描边时在描边层，高亮的字用高亮发光", () => {
    const style = {
      stroke: { color: "#000000", width: 4 },
      glow: { color: "#0000FF", blur: 20 },
      highlight: { fill: "#FFFF00", glow: { color: "#FF00FF", blur: 30 } },
    };
    const out = html(style, 30, [{ text: "一" }]);
    expect(out.match(/drop-shadow\(0 0 10px #0000FF\)/g)).toHaveLength(3);
    expect(out.match(/drop-shadow\(0 0 15px #FF00FF\)/g)).toHaveLength(1);
    // 文字层（最后一层）上没有发光
    const fill = out.slice(out.lastIndexOf('<div style="position:relative">'));
    expect(fill).not.toContain("drop-shadow");
  });
});

describe("TextBlock 逐字入场时长（inSlot）", () => {
  const opacityOf = (out: string, ch: string) => {
    const m = new RegExp(`opacity:([0-9.]+)[^>]*>${ch}<`).exec(out);
    return m ? Number(m[1]) : null;
  };
  it("入场按到下一个字出现的时间算，in.durationMs 是上限", () => {
    const style = {
      animation: {
        in: { preset: "fade", durationMs: 1000, easing: "linear" },
        unit: "char",
        stagger: { eachMs: 100 },
        inSlot: 0.5,
      },
    };
    // 时间槽 100ms，淡入 50ms：第 1 帧（33ms）时第一个字到 2/3
    expect(opacityOf(html(style, 1), "一")).toBeCloseTo(2 / 3, 2);
    // 没有 inSlot 时淡入 1000ms
    const fixed = { animation: { ...style.animation, inSlot: null } };
    expect(opacityOf(html(fixed, 1), "一")).toBeCloseTo(1 / 30, 2);
  });
});
