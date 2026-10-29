import { loadFont } from "@remotion/fonts";
import { Video } from "@remotion/media";
import { linearTiming, type TransitionPresentation, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import type React from "react";
import { AbsoluteFill, Img, Sequence, useCurrentFrame } from "remotion";
import { elementState, transformAt } from "../core/animate";
import type { PreviewProps } from "../core/api";
import type {
  FullTransform,
  ResolvedCaption,
  ResolvedImage,
  ResolvedOverlay,
  ResolvedTimeline,
  ResolvedTransition,
  ResolvedVideo,
} from "../core/compile";
import { BUILTIN_STYLES } from "../core/presets";
import type { TextStyle } from "../core/text-style";
import { TEMPLATES } from "../templates";
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

const VideoLayer: React.FC<{
  v: ResolvedVideo;
  src: string;
  width: number;
  height: number;
  fps: number;
}> = ({ v, src, fps, width, height }) => {
  const frame = useCurrentFrame();
  const t = transformAt(v.transform, v.keyframes, frame);
  const anim = elementState(
    { in: v.animIn, out: v.animOut, loop: null },
    (frame * 1000) / fps,
    (v.durationInFrames * 1000) / fps,
    Math.min(width, height) * 0.2,
  );
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
        ...cssTransform(t, width, height),
        opacity: t.opacity * anim.opacity,
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
  const a = elementState(
    { in: img.animIn, out: img.animOut, loop: null },
    (frame * 1000) / fps,
    (img.durationInFrames * 1000) / fps,
    Math.min(width, height) * 0.2,
  );
  return (
    <AbsoluteFill
      style={{
        ...cssTransform(
          { ...t, scale: t.scale * a.scale, x: t.x + a.dx, y: t.y + a.dy },
          width,
          height,
        ),
        opacity: t.opacity * a.opacity,
        filter: a.blur > 0 ? `blur(${a.blur}px)` : undefined,
      }}
    >
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
  fps: number;
  width: number;
  height: number;
}> = ({ o, style, fps, width, height }) => {
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
        frame={frame}
        durationInFrames={o.durationInFrames}
        fps={fps}
        width={width}
        height={height}
      />
    </AbsoluteFill>
  );
};

function presentation(t: ResolvedTransition): TransitionPresentation<Record<string, unknown>> {
  if (t.type === "fade") return fade() as TransitionPresentation<Record<string, unknown>>;
  // 方向是「画面往哪边走」：往上走 = 新画面从下面进来
  const from = {
    up: "from-bottom",
    down: "from-top",
    left: "from-right",
    right: "from-left",
  } as const;
  return slide({ direction: from[t.direction] }) as TransitionPresentation<Record<string, unknown>>;
}

export const Main: React.FC<MainProps> = ({ timeline, styles, srcs, fonts }) => {
  useFonts(fonts);
  const { width, height, fps } = timeline;
  // 没指定样式时用工程里的同名默认样式（新建工程时从内置样式复制进来，可能被改过），工程里没有才用内置的
  const styleOf = (id: string | null, fallback: keyof typeof BUILTIN_STYLES) =>
    styles[id ?? fallback] ?? styles[fallback] ?? BUILTIN_STYLES[fallback];

  const mains = timeline.videos.filter((v) => v.main);
  const mainZ = mains[0]?.z ?? 0;
  const layers: { z: number; key: string; node: React.ReactNode }[] = [];

  // 主轨和片尾放在同一个 TransitionSeries 里，转场的重叠由它处理（和 compile 的帧计算一致）
  const series: React.ReactNode[] = [];
  mains.forEach((v) => {
    if (v.transitionIn) {
      series.push(
        <TransitionSeries.Transition
          key={`${v.id}-t`}
          presentation={presentation(v.transitionIn)}
          timing={linearTiming({ durationInFrames: v.transitionIn.durationInFrames })}
        />,
      );
    }
    series.push(
      <TransitionSeries.Sequence key={v.id} durationInFrames={v.durationInFrames}>
        {srcs[v.asset] ? (
          <VideoLayer v={v} src={srcs[v.asset] ?? ""} width={width} height={height} fps={fps} />
        ) : null}
      </TransitionSeries.Sequence>,
    );
  });
  const outro = timeline.outro;
  if (outro) {
    if (mains.length === 0 && outro.from > 0) {
      series.push(
        <TransitionSeries.Sequence key="gap" durationInFrames={outro.from}>
          {null}
        </TransitionSeries.Sequence>,
      );
    }
    if (outro.transitionIn) {
      series.push(
        <TransitionSeries.Transition
          key="outro-t"
          presentation={presentation(outro.transitionIn)}
          timing={linearTiming({ durationInFrames: outro.transitionIn.durationInFrames })}
        />,
      );
    }
    series.push(
      <TransitionSeries.Sequence key="outro" durationInFrames={outro.durationInFrames}>
        <AbsoluteFill>
          <Video
            src={srcs[outro.asset] ?? ""}
            volume={dbToGain(outro.gainDb)}
            objectFit="contain"
          />
        </AbsoluteFill>
      </TransitionSeries.Sequence>,
    );
  }
  if (series.length > 0) {
    layers.push({
      z: mainZ,
      key: "main",
      node: <TransitionSeries key="main">{series}</TransitionSeries>,
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
        <Sequence key={v.id} from={v.from} durationInFrames={v.durationInFrames}>
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
        <Sequence key={img.id} from={img.from} durationInFrames={img.durationInFrames}>
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
        <Sequence key={`${c.id}-${c.part}`} from={c.from} durationInFrames={c.durationInFrames}>
          <CaptionLayer c={c} style={styleOf(c.style, "caption-word-yellow")} fps={fps} />
        </Sequence>
      ),
    });
  }
  for (const o of timeline.overlays) {
    if (o.hidden) continue;
    const def = TEMPLATES[o.template]?.meta.defaultStyle as keyof typeof BUILTIN_STYLES | undefined;
    layers.push({
      z: o.z,
      key: o.id,
      node: (
        <Sequence key={o.id} from={o.from} durationInFrames={o.durationInFrames}>
          <OverlayLayer
            o={o}
            style={styleOf(o.style, def ?? "title-bar-yellow")}
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
