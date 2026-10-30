import type React from "react";
import {
  type AnimState,
  combine,
  elementState,
  enterState,
  highlightMask,
  IDLE,
  markerProgress,
  splitUnits,
  sweepProgress,
  unitStarts,
} from "../core/animate";
import { cssFontStack } from "../core/fonts";
import type { TextStyle } from "../core/text-style";

// 文本样式引擎的渲染部分（PLAN 5.4）：字幕、标题、卡片文字都用它。
// 排版在一开始就按全文确定，逐字出现时只改透明度和变换，文字不会跳动（和剪映一致）。

export type TextBlockProps = {
  text: string;
  style: TextStyle;
  highlights?: { text: string; nth?: number }[];
  /** 本地帧号：从元素出现开始算 */
  frame: number;
  durationInFrames: number;
  fps: number;
  /** 提前出现的帧数：逐字动画从这里开始 */
  leadFrames?: number;
  /** 识音得到的每个字开始出现的时间（毫秒，相对逐字动画开始） */
  charStartMs?: number[] | null;
};

const HAN = /\p{Script=Han}/u;

export const TextBlock: React.FC<TextBlockProps> = ({
  text,
  style,
  highlights = [],
  frame,
  durationInFrames,
  fps,
  leadFrames = 0,
  charStartMs = null,
}) => {
  const ms = (frame * 1000) / fps;
  const totalMs = (durationInFrames * 1000) / fps;
  const revealMs = ms - (leadFrames * 1000) / fps;
  const { font, layout, animation } = style;
  const units = splitUnits(text, animation.unit);
  const inMs = animation.in?.durationMs ?? 0;
  const starts = unitStarts(
    units,
    animation.stagger,
    totalMs - (leadFrames * 1000) / fps,
    inMs,
    charStartMs,
  );
  const mask = highlightMask(text, highlights);
  const hl = style.highlight;
  const revealEndMs = totalMs - (leadFrames * 1000) / fps;
  const sweep =
    hl?.mode === "sweep"
      ? sweepProgress(text, units, starts, revealMs, revealEndMs, charStartMs)
      : null;
  const marker = hl?.marker
    ? markerProgress(mask, units, starts, revealMs, hl.marker.drawMs)
    : null;
  const underline = hl?.underline
    ? markerProgress(mask, units, starts, revealMs, hl.underline.drawMs)
    : null;
  // 荧光笔、下划线、当前词色块都画在文字后面的装饰层上
  const deco = marker !== null || underline !== null || Boolean(hl?.activeBox);
  /** 一个 span 覆盖的字的平均进度（英文整词放一个 span） */
  const avg = (arr: number[], from: number, to: number) =>
    to > from ? arr.slice(from, to).reduce((a, b) => a + b, 0) / (to - from) : 0;

  // 当前正在出现的单位：最后一个已经开始出现、且不是标点的单位
  let current = -1;
  units.forEach((u, i) => {
    if (!u.silent && (starts[i] ?? 0) <= revealMs) current = i;
  });

  // 整体的出场 / 循环（入场按单位逐个算）
  const whole = elementState(
    { in: null, out: animation.out, loop: animation.loop },
    ms,
    totalMs,
    font.size,
  );

  const frac =
    typeof animation.stagger === "object" && "fraction" in animation.stagger
      ? animation.stagger.fraction
      : 1;
  /** 入场时长：设了 inSlot 时按到下一个单位出现的时间算，in.durationMs 是上限 */
  const enterMs = (i: number) => {
    const max = animation.in?.durationMs ?? 0;
    if (animation.inSlot === null) return max;
    const s = starts[i] ?? 0;
    // fraction 节奏下最后一个单位的时间槽到「出完」为止，而不是字幕结束
    const next = starts.slice(i + 1).find((x) => x > s) ?? revealEndMs * frac;
    return Math.max(1, Math.min(max, (next - s) * animation.inSlot));
  };
  const pieces = units.map((u, i) => {
    const t = revealMs - (starts[i] ?? 0);
    const state: AnimState = animation.in
      ? t < 0
        ? { ...IDLE, opacity: 0 }
        : enterState(animation.in, Math.min(1, t / enterMs(i)), font.size)
      : IDLE;
    const keyword = mask.slice(u.start, u.end).some(Boolean);
    const lit =
      hl !== null &&
      (keyword ||
        (hl.mode === "current" && i === current) ||
        (hl.mode === "trail" && i <= current && t >= 0));
    return { u, state, lit, active: i === current };
  });

  const box: React.CSSProperties = {
    position: "absolute",
    width: layout.maxWidth,
    left:
      layout.align === "left"
        ? layout.x
        : layout.align === "right"
          ? layout.x - layout.maxWidth
          : layout.x - layout.maxWidth / 2,
    top: layout.y,
    transform: `translateY(${layout.anchor === "top" ? "0" : layout.anchor === "bottom" ? "-100%" : "-50%"})`,
    textAlign: layout.align,
    fontFamily: cssFontStack(style),
    fontWeight: font.weight,
    fontSize: font.size,
    lineHeight: font.lineHeight,
    letterSpacing: font.letterSpacing,
    whiteSpace: "pre-wrap",
    opacity: whole.opacity,
  };

  const strokeW = style.stroke?.width ?? 0;
  // 阴影画在描边层上（阴影包含描边的轮廓）；没有描边时画在文字层上
  const shadow = style.shadow
    ? `drop-shadow(${style.shadow.x}px ${style.shadow.y}px ${style.shadow.blur / 2}px ${style.shadow.color})`
    : undefined;
  // 发光画在最外面一层文字上：有描边时是描边层
  const outer = strokeW > 0 ? "stroke" : "fill";
  /** 文字本身的颜色：纯色，或者用背景渐变裁切到文字上 */
  const ink = (lit: boolean): React.CSSProperties => {
    const g = lit ? hl?.gradient : style.gradient;
    if (!g) return { color: lit ? hl?.fill : style.fill };
    return {
      color: "transparent",
      backgroundImage: `linear-gradient(180deg, ${g.colors.join(", ")})`,
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
    };
  };
  const layer = (kind: "deco" | "stroke" | "fill") => (
    <div
      style={{
        ...(kind === "deco"
          ? { position: "absolute", inset: 0, color: "transparent" }
          : kind === "stroke"
            ? {
                position: "absolute",
                inset: 0,
                WebkitTextStroke: `${strokeW * 2}px ${style.stroke?.color}`,
                color: style.stroke?.color,
                filter: shadow,
              }
            : { position: "relative", filter: strokeW > 0 ? undefined : shadow }),
      }}
    >
      {pieces.map(({ u, state, lit, active }, i) => {
        const s = combine(state, { ...whole, opacity: 1 });
        const color: React.CSSProperties =
          kind === "deco"
            ? { color: "transparent" }
            : kind === "stroke"
              ? { color: lit && hl?.stroke ? hl.stroke.color : style.stroke?.color }
              : ink(lit);
        const glow = kind === outer ? (lit && hl?.glow ? hl.glow : style.glow) : null;
        const filter = [
          s.blur > 0 ? `blur(${s.blur}px)` : "",
          // 两层不同半径的光晕叠起来，中间亮、外面柔
          glow
            ? `drop-shadow(0 0 ${glow.blur / 2}px ${glow.color}) drop-shadow(0 0 ${glow.blur}px ${glow.color})`
            : "",
        ]
          .filter(Boolean)
          .join(" ");
        const scale = s.scale * (lit && hl ? hl.scale : 1);
        const paint = (from: number, to: number): React.CSSProperties => {
          if (kind === "deco" && marker && hl?.marker) {
            const p = avg(marker, from, to);
            if (p <= 0) return {};
            // 色块从字形的底部往上画（行框底部还留有约 (行高-1)/2 个字号的空白），高度按字号算
            const bottom = ((font.lineHeight - 1) / 2 / font.lineHeight) * 100 + 4;
            const top = Math.min(100, bottom + (hl.marker.height / font.lineHeight) * 100);
            const c = hl.marker.color;
            return {
              backgroundImage: `linear-gradient(to top, transparent ${bottom}%, ${c} ${bottom}%, ${c} ${top}%, transparent ${top}%)`,
              backgroundSize: `${p * 100}% 100%`,
              backgroundRepeat: "no-repeat",
            };
          }
          if (kind === "fill" && sweep && hl && !lit) {
            const p = avg(sweep, from, to);
            if (p >= 1) return ink(true);
            if (p <= 0) return {};
            // 卡拉 OK：已经念过的部分换成高亮色，用渐变裁切到文字上
            return {
              color: "transparent",
              backgroundImage: `linear-gradient(90deg, ${hl.fill} ${p * 100}%, ${style.fill} ${p * 100}%)`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
            };
          }
          return {};
        };
        /** 装饰层上的色块和下划线；first / last 是这个字在单位里的头尾，色块只在头尾留边距和圆角 */
        const ornaments = (from: number, to: number, first: boolean, last: boolean) => {
          if (kind !== "deco") return null;
          const b = active ? hl?.activeBox : null;
          const ul = underline && hl?.underline ? hl.underline : null;
          const p = ul && underline ? avg(underline, from, to) : 0;
          const r = b?.radius ?? 0;
          return (
            <>
              {b ? (
                <span
                  style={{
                    position: "absolute",
                    // 色块以字号为高，竖直方向对齐行框中心；相邻的字多盖 0.5px，避免缝
                    top: `calc(50% - ${font.size / 2 + b.padding[0]}px)`,
                    height: font.size + b.padding[0] * 2,
                    left: first ? -b.padding[1] : 0,
                    right: last ? -b.padding[1] : -0.5,
                    background: b.color,
                    borderRadius: `${first ? r : 0}px ${last ? r : 0}px ${last ? r : 0}px ${first ? r : 0}px`,
                  }}
                />
              ) : null}
              {ul && p > 0 ? (
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    width: `${p * 100}%`,
                    top: `calc(50% + ${font.size * (0.5 + ul.offset)}px)`,
                    height: Math.max(1, font.size * ul.thickness),
                    background: ul.color,
                  }}
                />
              ) : null}
            </>
          );
        };
        const span = (
          content: string,
          key: string,
          from: number,
          to: number,
          first: boolean,
          last: boolean,
        ) => (
          <span
            key={key}
            style={{
              position: kind === "deco" ? "relative" : undefined,
              display: "inline-block",
              whiteSpace: "pre",
              ...color,
              ...paint(from, to),
              opacity: s.opacity,
              transform: `translate(${s.dx}px, ${s.dy}px) scale(${scale}) rotate(${s.rotation}deg)`,
              filter: filter || undefined,
              textShadow:
                kind === "fill" && s.glow > 0 && !sweep
                  ? `0 0 ${24 * s.glow}px ${hl?.fill ?? style.fill}`
                  : undefined,
            }}
          >
            {content}
            {ornaments(from, to, first, last)}
          </span>
        );
        // 中文按字放 inline-block，这样词中间也能换行（和剪映一致）；其他文字整词放一起，避免单词被拆开
        const chars = HAN.test(u.text) ? [...u.text] : [u.text];
        return (
          <span key={`${u.start}`}>
            {u.breakBefore ? <br /> : null}
            {chars.length > 1 || HAN.test(u.text)
              ? chars.map((c, j) =>
                  span(
                    c,
                    `${i}-${j}`,
                    u.start + j,
                    u.start + j + 1,
                    j === 0,
                    j === chars.length - 1,
                  ),
                )
              : chars.map((c, j) => span(c, `${i}-${j}`, u.start, u.end, true, true))}
          </span>
        );
      })}
    </div>
  );

  const bg = style.box;
  return (
    <div style={box}>
      <div
        style={{
          position: "relative",
          display: "inline-block",
          maxWidth: "100%",
          background: bg?.color,
          borderRadius: bg?.radius,
          padding: bg ? `${bg.padding[0]}px ${bg.padding[1]}px` : undefined,
        }}
      >
        <div style={{ position: "relative" }}>
          {deco ? layer("deco") : null}
          {strokeW > 0 ? layer("stroke") : null}
          {layer("fill")}
        </div>
      </div>
    </div>
  );
};
