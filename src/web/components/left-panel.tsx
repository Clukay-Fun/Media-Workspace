import { Player } from "@remotion/player";
import type React from "react";
import { useState } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { TextBlock } from "../../composition/TextBlock";
import type { Project } from "../../core/schema";
import type { TextStyle } from "../../core/text-style";
import { findItem } from "../lib/project";
import { type LeftTab, useStore } from "../store";
import { Icon } from "./icons";
import { SelectionCard } from "./selection";

const TABS: { id: LeftTab; label: string }[] = [
  { id: "selection", label: "选中" },
  { id: "styles", label: "样式" },
  { id: "assets", label: "素材" },
];

/** 左栏：选中元素的详情、样式库、素材。批注、质检、AI 改动在右边审阅栏 */
export function LeftPanel() {
  const tab = useStore((s) => s.leftTab);
  const open = useStore((s) => s.leftOpen);
  const selected = useStore((s) => s.selected);
  const { setLeftTab, setLeftOpen } = useStore.getState();

  return (
    <aside className={open ? "left-panel open" : "left-panel"} aria-label="编辑">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "tab active" : "tab"}
            onClick={() => setLeftTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          className="icon-btn ghost drawer-close"
          aria-label="收起左栏"
          onClick={() => setLeftOpen(false)}
        >
          <Icon name="close" size={12} />
        </button>
      </div>
      <div className="panel-scroll">
        {tab === "selection" &&
          (selected ? (
            <SelectionCard />
          ) : (
            <div className="empty small">
              <Icon name="target" size={18} />
              <p>还没有选中</p>
              <span>在画面或时间线上点一句字幕、标题或片段</span>
            </div>
          ))}
        {tab === "styles" && <Styles />}
        {tab === "assets" && <Assets />}
      </div>
    </aside>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="search">
      <Icon name="search" size={13} />
      <input
        type="search"
        value={value}
        placeholder="搜索"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onChange("")}
      />
    </label>
  );
}

const matches = (q: string, ...fields: (string | undefined)[]) => {
  const k = q.trim().toLowerCase();
  return !k || fields.some((f) => f?.toLowerCase().includes(k));
};

function Styles() {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selected);
  const fonts = useStore((s) => s.preview?.fonts);
  const [hover, setHover] = useState<string | null>(null);
  const [q, setQ] = useState("");
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
      <SearchBox value={q} onChange={setQ} />
      {Object.entries(project.styles)
        .filter(([name, style]) => matches(q, name, describeStyle(style)))
        .map(([name, style]) => (
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
                title={target ? `套用到 ${selected}` : "先选中一句字幕或标题"}
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
  const [q, setQ] = useState("");
  if (!project) return null;
  return (
    <div className="assets">
      <SearchBox value={q} onChange={setQ} />
      {Object.entries(project.assets)
        .filter(([id, a]) => matches(q, id, a.path))
        .map(([id]) => (
          <AssetRow
            key={id}
            id={id}
            project={project}
            noFaces={lint?.noFaceData.includes(id) ?? false}
          />
        ))}
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
