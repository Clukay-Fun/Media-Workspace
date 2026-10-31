import { loadFont } from "@remotion/fonts";
import { Video } from "@remotion/media";
import type React from "react";
import { AbsoluteFill, Freeze, Img, Sequence, useCurrentFrame } from "remotion";
import { type AnimState, ease, elementState, outwardDirection, transformAt } from "../core/animate";
import type { PreviewProps } from "../core/api";
import {
  cardShownAt,
  type FrameSpan,
  type FullTransform,
  mainLiftTransform,
  type ResolvedCaption,
  type ResolvedImage,
  type ResolvedOverlay,
  type ResolvedTimeline,
  type ResolvedTransition,
  type ResolvedVideo,
} from "../core/compile";
import { BUILTIN_STYLES } from "../core/presets";
import type { Anim, TextStyle } from "../core/text-style";
import { overlaySize, TEMPLATES } from "../templates";
import { TextBlock } from "./TextBlock";

// 预览和导出共用的合成组件（PLAN 9）：输入是 compile 的结果，不再做任何毫秒 → 帧换算。

/** 结构定义在 core/api（PreviewProps），网页预览和导出共用 */
export type MainProps = PreviewProps;

const loaded = new Set<string>();
function useFonts(fonts: MainProps["fonts"]) {
  for (const f of fonts) {
    const key = `${f.css}|${f.weight}|${f.url}`;
    if (loaded.has(key)) continue;
    loaded.add(key);
    // loadFont 自己会 delayRender，字体加载完才开始截帧
    loadFont({ family: f.css, url: f.url, weight: String(f.weight) });
  }
}

const dbToGain = (db: number) => 10 ** (db / 20);

function cssTransform(t: FullTransform, width: number, height: number): React.CSSProperties {
  return {
    transform: `translate(${t.x - width / 2}px, ${t.y - height / 2}px) scale(${t.scale}) rotate(${t.rotation}deg)`,
    opacity: t.opacity,
    borderRadius: t.radius,
    overflow: t.radius > 0 ? "hidden" : undefined,
  };
}

/**
 * 图片和视频的动画状态：滑动从画面外进出（位移取画面宽高），没写方向时从最近的边缘进出
 */
function visualState(
  v: Pick<ResolvedImage, "animIn" | "animOut" | "animLoop" | "durationInFrames">,
  t: FullTransform,
  frame: number,
  fps: number,
  width: number,
  height: number,
): AnimState {
  const outward = (a: Anim | null): Anim | null =>
    a?.preset === "slide" && !a.direction
      ? { ...a, direction: outwardDirection(t.x, t.y, width, height) }
      : a;
  return elementState(
    { in: outward(v.animIn), out: outward(v.animOut), loop: v.animLoop },
    (frame * 1000) / fps,
    (v.durationInFrames * 1000) / fps,
    Math.min(width, height) * 0.2,
    (dir) => (dir === "left" || dir === "right" ? width : height),
  );
}

/** 图片和视频共用：变换（含关键帧）上再叠入场 / 出场 / 循环动画的位移、缩放、旋转、透明度、模糊 */
function animatedStyle(
  t: FullTransform,
  a: AnimState,
  width: number,
  height: number,
): React.CSSProperties {
  return {
    ...cssTransform(
      {
        ...t,
        x: t.x + a.dx,
        y: t.y + a.dy,
        scale: t.scale * a.scale,
        rotation: t.rotation + a.rotation,
      },
      width,
      height,
    ),
    opacity: t.opacity * a.opacity,
    filter: a.blur > 0 ? `blur(${a.blur}px)` : undefined,
  };
}

const VideoLayer: React.FC<{
  v: ResolvedVideo;
  src: string;
  width: number;
  height: number;
  fps: number;
}> = ({ v, src, fps, width, height }) => {
  const frame = useCurrentFrame();
  const t = transformAt(v.transform, v.keyframes, frame);
  const anim = visualState(v, t, frame, fps, width, height);
  if (v.kind === "audio") {
    return v.muted ? null : (
      <Video
        src={src}
        trimBefore={v.trimBeforeFrames}
        playbackRate={v.speed}
        preservePitch
        volume={dbToGain(v.gainDb)}
        style={{ display: "none" }}
      />
    );
  }
  return (
    <AbsoluteFill
      style={{
        ...animatedStyle(t, anim, width, height),
        visibility: v.hidden ? "hidden" : "visible",
      }}
    >
      <Video
        src={src}
        trimBefore={v.trimBeforeFrames}
        playbackRate={v.speed}
        preservePitch
        muted={v.muted}
        volume={dbToGain(v.gainDb)}
        objectFit="contain"
        // 不给宽高时按素材自然尺寸贴在左上角，横屏素材不会上下居中（和图片的 contain 不一致）
        style={{ width: "100%", height: "100%" }}
      />
    </AbsoluteFill>
  );
};

const ImageLayer: React.FC<{
  img: ResolvedImage;
  src: string;
  width: number;
  height: number;
  fps: number;
}> = ({ img, src, width, height, fps }) => {
  const frame = useCurrentFrame();
  const t = transformAt(img.transform, img.keyframes, frame);
  const a = visualState(img, t, frame, fps, width, height);
  return (
    <AbsoluteFill style={animatedStyle(t, a, width, height)}>
      <Img src={src} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
    </AbsoluteFill>
  );
};

const CaptionLayer: React.FC<{ c: ResolvedCaption; style: TextStyle; fps: number }> = ({
  c,
  style,
  fps,
}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <TextBlock
        text={c.text}
        style={style}
        highlights={c.highlights}
        frame={frame}
        durationInFrames={c.durationInFrames}
        fps={fps}
        leadFrames={c.leadFrames}
        charStartMs={c.charStartMs}
      />
    </AbsoluteFill>
  );
};

const OverlayLayer: React.FC<{
  o: ResolvedOverlay;
  style: TextStyle;
  srcs: Record<string, string>;
  fps: number;
  width: number;
  height: number;
}> = ({ o, style, srcs, fps, width, height }) => {
  const frame = useCurrentFrame();
  const tpl = TEMPLATES[o.template];
  if (!tpl) return null;
  const props = tpl.schema.parse(o.props);
  // 和图片、画中画一样：整层以画布中心为原点平移、缩放（core/lint 和界面点选按同样的方式换算位置）
  return (
    <AbsoluteFill style={cssTransform(o.transform, width, height)}>
      <tpl.Component
        props={props}
        style={style}
        size={overlaySize(tpl, o.size)}
        src={(id) => srcs[id]}
        frame={frame}
        durationInFrames={o.durationInFrames}
        fps={fps}
        width={width}
        height={height}
      />
    </AbsoluteFill>
  );
};

/**
 * 转场时两层的样式，新画面在上面；direction 是画面往哪边走（往左走 = 新画面从右边进来）。
 * fade：新画面渐显；slide：新画面滑进来盖住旧画面；push：新画面把旧画面推走。
 */
function transitionStyles(
  t: ResolvedTransition,
  p: number,
  width: number,
  height: number,
): { enter: React.CSSProperties; exit: React.CSSProperties } {
  const e = ease("ease-in-out", Math.min(1, Math.max(0, p)));
  if (t.type === "fade") return { enter: { opacity: e }, exit: {} };
  const DIR = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const;
  const [dx, dy] = DIR[t.direction];
  const shift = (k: number): React.CSSProperties => ({
    transform: `translate(${dx * k * width}px, ${dy * k * height}px)`,
  });
  return { enter: shift(e - 1), exit: t.type === "push" ? shift(e) : {} };
}

/**
 * 主轨的一段。转场不占时间（docs/decisions/0019）：前一段播完，这一段开头的几帧里，
 * 底下垫着前一段停住的最后一帧（静音），按转场的样式过渡；声音直接硬切，一个字都不丢。
 * 接片尾时片尾盖上来，这一段的最后几帧按 exit 样式走。
 */
const MainClipLayer: React.FC<{
  v: ResolvedVideo;
  prev: ResolvedVideo | null;
  exit: ResolvedTransition | null;
  srcs: Record<string, string>;
  width: number;
  height: number;
  fps: number;
}> = ({ v, prev, exit, srcs, width, height, fps }) => {
  const frame = useCurrentFrame();
  const tin = prev ? v.transitionIn : null;
  const enter =
    tin && frame < tin.durationInFrames
      ? transitionStyles(tin, frame / tin.durationInFrames, width, height)
      : null;
  const left = v.durationInFrames - frame;
  const leave =
    exit && left <= exit.durationInFrames
      ? transitionStyles(exit, 1 - left / exit.durationInFrames, width, height)
      : null;
  const src = srcs[v.asset];
  const prevSrc = prev ? srcs[prev.asset] : undefined;
  return (
    <AbsoluteFill>
      {enter && prev && prevSrc ? (
        <AbsoluteFill style={enter.exit}>
          <Freeze frame={prev.durationInFrames - 1}>
            <VideoLayer
              v={{ ...prev, muted: true }}
              src={prevSrc}
              width={width}
              height={height}
              fps={fps}
            />
          </Freeze>
        </AbsoluteFill>
      ) : null}
      {src ? (
        <AbsoluteFill style={{ ...enter?.enter, ...leave?.exit }}>
          <VideoLayer v={v} src={src} width={width} height={height} fps={fps} />
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};

/** 半屏卡出现时主轨整体上移让位（docs/decisions/0022）；用全局帧号，跨段时不跳 */
const MainShift: React.FC<{
  tl: Pick<ResolvedTimeline, "mainShifts" | "height">;
  children: React.ReactNode;
}> = ({ tl, children }) => {
  const { lift, scale } = mainLiftTransform(tl, useCurrentFrame());
  return (
    <AbsoluteFill
      style={
        lift > 0
          ? { transform: `translateY(${-lift}px) scale(${scale})`, transformOrigin: "50% 0" }
          : undefined
      }
    >
      {children}
    </AbsoluteFill>
  );
};

/** 有卡片时字幕不显示（docs/decisions/0022）：只是看不见，逐字动画照常按时间走 */
const CardGate: React.FC<{ spans: FrameSpan[]; children: React.ReactNode }> = ({
  spans,
  children,
}) => (cardShownAt(spans, useCurrentFrame()) ? null : <AbsoluteFill>{children}</AbsoluteFill>);

const OutroLayer: React.FC<{
  outro: NonNullable<ResolvedTimeline["outro"]>;
  src: string;
  width: number;
  height: number;
}> = ({ outro, src, width, height }) => {
  const frame = useCurrentFrame();
  const t = outro.transitionIn;
  const style =
    t && frame < t.durationInFrames
      ? transitionStyles(t, frame / t.durationInFrames, width, height).enter
      : undefined;
  return (
    <AbsoluteFill style={style}>
      <Video
        src={src}
        volume={dbToGain(outro.gainDb)}
        objectFit="contain"
        style={{ width: "100%", height: "100%" }}
      />
    </AbsoluteFill>
  );
};

export const Main: React.FC<MainProps> = ({ timeline, styles, srcs, fonts }) => {
  useFonts(fonts);
  const { width, height, fps } = timeline;
  // 没指定样式时用工程里的同名默认样式（新建工程时从内置样式复制进来，可能被改过），工程里没有才用内置的
  const styleOf = (id: string | null, fallback: keyof typeof BUILTIN_STYLES) =>
    styles[id ?? fallback] ?? styles[fallback] ?? BUILTIN_STYLES[fallback];

  const mains = timeline.videos.filter((v) => v.main);
  const mainZ = mains[0]?.z ?? 0;
  const layers: { z: number; key: string; node: React.ReactNode }[] = [];

  const outro = timeline.outro;
  const premount = Math.round(fps);
  mains.forEach((v, i) => {
    const last = i === mains.length - 1;
    layers.push({
      z: mainZ,
      key: v.id,
      node: (
        <MainShift tl={timeline}>
          <Sequence
            key={v.id}
            from={v.from}
            durationInFrames={v.durationInFrames}
            premountFor={premount}
          >
            <MainClipLayer
              v={v}
              prev={mains[i - 1] ?? null}
              exit={last ? (outro?.transitionIn ?? null) : null}
              srcs={srcs}
              width={width}
              height={height}
              fps={fps}
            />
          </Sequence>
        </MainShift>
      ),
    });
  });
  const outroSrc = outro ? srcs[outro.asset] : undefined;
  if (outro && outroSrc) {
    layers.push({
      // 片尾盖在主轨上面（转场时和主轨最后一段重叠），其它轨道之下
      z: mainZ + 0.5,
      key: "outro",
      node: (
        <Sequence
          key="outro"
          from={outro.from}
          durationInFrames={outro.durationInFrames}
          premountFor={premount}
        >
          <OutroLayer outro={outro} src={outroSrc} width={width} height={height} />
        </Sequence>
      ),
    });
  }

  for (const v of timeline.videos) {
    if (v.main) continue;
    const src = srcs[v.asset];
    if (!src || (v.hidden && v.kind === "video")) continue;
    layers.push({
      z: v.z,
      key: v.id,
      node: (
        <Sequence
          key={v.id}
          from={v.from}
          durationInFrames={v.durationInFrames}
          premountFor={premount}
        >
          <VideoLayer v={v} src={src} width={width} height={height} fps={fps} />
        </Sequence>
      ),
    });
  }
  for (const img of timeline.images) {
    const src = srcs[img.asset];
    if (!src || img.hidden) continue;
    layers.push({
      z: img.z,
      key: img.id,
      node: (
        <Sequence
          key={img.id}
          from={img.from}
          durationInFrames={img.durationInFrames}
          premountFor={premount}
        >
          <ImageLayer img={img} src={src} width={width} height={height} fps={fps} />
        </Sequence>
      ),
    });
  }
  for (const c of timeline.captions) {
    if (c.hidden) continue;
    layers.push({
      z: c.z,
      key: `${c.id}-${c.part}`,
      node: (
        <CardGate spans={timeline.cardSpans}>
          <Sequence key={`${c.id}-${c.part}`} from={c.from} durationInFrames={c.durationInFrames}>
            <CaptionLayer c={c} style={styleOf(c.style, "caption-word-yellow")} fps={fps} />
          </Sequence>
        </CardGate>
      ),
    });
  }
  for (const o of timeline.overlays) {
    if (o.hidden) continue;
    const def = TEMPLATES[o.template]?.meta.defaultStyle as keyof typeof BUILTIN_STYLES | undefined;
    layers.push({
      // 全屏卡盖住同一层的标题条
      z: o.size === "full" ? o.z + 0.5 : o.z,
      key: o.id,
      node: (
        <Sequence key={o.id} from={o.from} durationInFrames={o.durationInFrames}>
          <OverlayLayer
            o={o}
            style={styleOf(o.style, def ?? "title-bar-yellow")}
            srcs={srcs}
            fps={fps}
            width={width}
            height={height}
          />
        </Sequence>
      ),
    });
  }

  return (
    <AbsoluteFill style={{ background: timeline.background }}>
      {layers
        .toSorted((a, b) => a.z - b.z)
        .map((l) => (
          <AbsoluteFill key={l.key}>{l.node}</AbsoluteFill>
        ))}
    </AbsoluteFill>
  );
};
