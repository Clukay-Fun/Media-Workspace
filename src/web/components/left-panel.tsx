import { Player } from "@remotion/player";
import type React from "react";
import { useState } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { TextBlock } from "../../composition/TextBlock";
import type { Project } from "../../core/schema";
import type { TextStyle } from "../../core/text-style";
import { findItem } from "../lib/project";
import { type LeftTab, useStore } from "../store";
import { CommentCard } from "./comment-card";
import { Icon } from "./icons";

const TABS: { id: LeftTab; label: string }[] = [
  { id: "comments", label: "批注" },
  { id: "styles", label: "样式" },
  { id: "assets", label: "素材" },
];

export function LeftPanel() {
  const tab = useStore((s) => s.leftTab);
  const review = useStore((s) => s.review);
  const open = review?.comments.filter((c) => c.status === "open").length ?? 0;
  return (
    <aside className="left-panel">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "tab active" : "tab"}
            onClick={() => useStore.getState().setLeftTab(t.id)}
          >
            {t.label}
            {t.id === "comments" && open > 0 && <span className="count">{open}</span>}
          </button>
        ))}
      </div>
      <div className="panel-scroll">
        {tab === "comments" && <Comments />}
        {tab === "styles" && <Styles />}
        {tab === "assets" && <Assets />}
      </div>
    </aside>
  );
}

function Comments() {
  const review = useStore((s) => s.review);
  const [showDone, setShowDone] = useState(false);
  const all = review?.comments ?? [];
  const open = all.filter((c) => c.status === "open").toReversed();
  const done = all.filter((c) => c.status === "resolved").toReversed();
  return (
    <div className="comments">
      {open.length === 0 ? (
        <div className="empty small">
          <p>没有待处理的批注</p>
          <span>看片时按 C，或在右下角写下意见，AI 下次工作时会先处理。</span>
        </div>
      ) : (
        <div className="comment-list">
          {open.map((c) => (
            <CommentCard key={c.id} comment={c} />
          ))}
        </div>
      )}
      {done.length > 0 && (
        <>
          <button type="button" className="section-toggle" onClick={() => setShowDone(!showDone)}>
            AI 已处理 {done.length}
            <Icon name="next" size={12} className={showDone ? "rot" : undefined} />
          </button>
          {showDone && (
            <div className="comment-list">
              {done.map((c) => (
                <CommentCard key={c.id} comment={c} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Styles() {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selected);
  const fonts = useStore((s) => s.preview?.fonts);
  const [hover, setHover] = useState<string | null>(null);
  if (!project) return null;
  const ref = selected ? findItem(project, selected) : null;
  const target = ref && (ref.track.kind === "caption" || ref.track.kind === "overlay") ? ref : null;
  const apply = (name: string) => {
    if (!target || !selected) return;
    void useStore
      .getState()
      .submit(
        [
          target.track.kind === "caption"
            ? { op: "caption.update", id: selected, set: { style: name } }
            : { op: "item.update", id: selected, set: { style: name } },
        ],
        `已把「${name}」套用到 ${selected}`,
      );
  };
  return (
    <div className="styles">
      <p className="panel-note">
        {target ? (
          <>
            点「套用」改到 <b>{selected}</b>
          </>
        ) : (
          "先在画面上选中一句字幕或标题，再套用样式"
        )}
      </p>
      {Object.entries(project.styles).map(([name, style]) => (
        <div
          key={name}
          className="style-card"
          onMouseEnter={() => setHover(name)}
          onMouseLeave={() => setHover(null)}
        >
          <div className="style-sample">
            {hover === name && fonts ? (
              <StylePlayer style={style} />
            ) : (
              <span className="swatch" style={swatch(style)}>
                {sampleText(name)}
              </span>
            )}
          </div>
          <div className="style-info">
            <div>
              <b>{name}</b>
              <span className="muted">{describeStyle(style)}</span>
            </div>
            <button
              type="button"
              className="mini-btn"
              disabled={!target}
              onClick={() => apply(name)}
            >
              套用
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

const sampleText = (name: string) => (name.startsWith("title") ? "标题这样显示" : "字幕这样出现");

function swatch(s: TextStyle): React.CSSProperties {
  return {
    color: s.fill,
    fontWeight: s.font.weight,
    WebkitTextStroke: s.stroke
      ? `${Math.max(1, s.stroke.width / 3)}px ${s.stroke.color}`
      : undefined,
    paintOrder: "stroke fill",
    fontFamily: `"${s.font.family}", ${s.font.fallback.map((f) => `"${f}"`).join(", ")}, sans-serif`,
  };
}

const ANIM: Record<string, string> = {
  fade: "淡入",
  "fade-up": "上浮",
  pop: "弹出",
  slide: "滑入",
  typewriter: "打字",
  "blur-in": "模糊淡入",
  "zoom-in": "放大",
  bounce: "弹跳",
  slam: "砸入",
};
const UNIT: Record<string, string> = { char: "逐字", word: "逐词", line: "整句" };
const MODE: Record<string, string> = {
  keyword: "关键词高亮",
  current: "当前字高亮",
  trail: "念过留亮",
  sweep: "卡拉 OK 扫色",
};

function describeStyle(s: TextStyle): string {
  const parts = [`${s.font.size}px`];
  const a = s.animation;
  if (a.in) parts.push(`${UNIT[a.unit] ?? ""}${ANIM[a.in.preset] ?? a.in.preset}`);
  if (s.highlight) parts.push(s.highlight.marker ? "荧光笔" : (MODE[s.highlight.mode] ?? ""));
  return parts.filter(Boolean).join(" · ");
}

/** 悬停时播放样式的真实效果：用和成片相同的 TextBlock，画布裁成一条 */
const PREVIEW_W = 1080;
const PREVIEW_H = 400;
const PREVIEW_FRAMES = 75;

function StylePreview({ style }: { style: TextStyle }) {
  const frame = useCurrentFrame();
  const centered: TextStyle = {
    ...style,
    layout: {
      ...style.layout,
      x: PREVIEW_W / 2,
      y: PREVIEW_H / 2,
      anchor: "center",
      align: "center",
    },
  };
  return (
    <AbsoluteFill style={{ background: "transparent" }}>
      <TextBlock
        text="钱都花在了小额消费上"
        highlights={[{ text: "小额消费" }]}
        style={centered}
        frame={frame}
        durationInFrames={PREVIEW_FRAMES}
        fps={30}
      />
    </AbsoluteFill>
  );
}

function StylePlayer({ style }: { style: TextStyle }) {
  return (
    <Player
      component={StylePreview}
      inputProps={{ style }}
      durationInFrames={PREVIEW_FRAMES}
      compositionWidth={PREVIEW_W}
      compositionHeight={PREVIEW_H}
      fps={30}
      autoPlay
      loop
      style={{ width: "100%", height: "100%" }}
    />
  );
}

function Assets() {
  const project = useStore((s) => s.project);
  const lint = useStore((s) => s.lint);
  if (!project) return null;
  return (
    <div className="assets">
      {Object.entries(project.assets).map(([id, a]) => (
        <AssetRow
          key={id}
          id={id}
          project={project}
          noFaces={lint?.noFaceData.includes(id) ?? false}
        />
      ))}
      <p className="panel-note">导入新素材：让 AI 调用 import，或者运行 mw import。</p>
    </div>
  );
}

function AssetRow({ id, project, noFaces }: { id: string; project: Project; noFaces: boolean }) {
  const a = project.assets[id];
  if (!a) return null;
  const p = a.probe;
  const name = a.path.split("/").at(-1) ?? id;
  const isOutro = project.outro?.asset === id;
  return (
    <div className="asset">
      <div className="asset-icon">
        <Icon name={a.kind === "image" ? "image" : "film"} />
      </div>
      <div className="asset-info">
        <b title={a.path}>{name}</b>
        <span className="muted mono">
          {id}
          {p?.durationMs ? ` · ${(p.durationMs / 1000).toFixed(1)}s` : ""}
          {p?.width ? ` · ${p.width}×${p.height}` : ""}
        </span>
        <div className="tags">
          {isOutro && <span className="tag">片尾</span>}
          {a.kind === "video" &&
            (noFaces ? (
              <span className="tag dim">未检测人脸</span>
            ) : (
              <span className="tag ok">人脸已检测</span>
            ))}
        </div>
      </div>
    </div>
  );
}
