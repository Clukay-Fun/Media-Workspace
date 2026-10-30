import { Player } from "@remotion/player";
import type React from "react";
import { useEffect, useState } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { TextBlock } from "../../composition/TextBlock";
import type { LibraryStyle } from "../../core/api";
import type { Project } from "../../core/schema";
import type { TextStyle } from "../../core/text-style";
import { ApiFailure } from "../data/client";
import { placeAsset } from "../lib/pip";
import { findItem } from "../lib/project";
import { msOfFrame } from "../lib/timeline";
import { type LeftTab, useStore } from "../store";
import { Icon } from "./icons";

const TABS: { id: LeftTab; label: string }[] = [
  { id: "assets", label: "素材" },
  { id: "styles", label: "样式" },
];

/** 左栏：素材和样式库。选中元素的属性在右栏 */
export function LeftPanel() {
  const tab = useStore((s) => s.leftTab);
  const open = useStore((s) => s.leftOpen);
  const { setLeftTab, setLeftOpen } = useStore.getState();

  return (
    <aside className={open ? "left-panel panel open" : "left-panel panel"} aria-label="素材和样式">
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
        {tab === "assets" && <Assets />}
        {tab === "styles" && <Styles />}
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
  const [q, setQ] = useState("");
  const [library, setLibrary] = useState<LibraryStyle[] | null>(null);
  const reload = () =>
    void useStore
      .getState()
      .api.libraryStyles()
      .then((r) => setLibrary(r.styles))
      .catch(() => setLibrary([]));
  useEffect(reload, []);
  if (!project) return null;
  const ref = selected ? findItem(project, selected) : null;
  const target = ref && (ref.track.kind === "caption" || ref.track.kind === "overlay") ? ref : null;
  const st = useStore.getState();
  const apply = (name: string) => {
    if (!target || !selected) return;
    void st.submit(
      [
        target.track.kind === "caption"
          ? { op: "caption.update", id: selected, set: { style: name } }
          : { op: "item.update", id: selected, set: { style: name } },
      ],
      `已把「${name}」套用到 ${selected}`,
    );
  };
  const save = async (name: string) => {
    // 内置样式的名字不能占用，改过的内置样式存成「名字-mine」；库里已有的问一下要不要覆盖
    const builtin = library?.some((l) => l.builtin && l.name === name);
    const as = builtin ? `${name}-mine` : name;
    const send = (overwrite: boolean) => st.api.saveLibraryStyle({ style: name, as, overwrite });
    try {
      await send(false).catch(async (e) => {
        if (!(e instanceof ApiFailure && e.code === "DUPLICATE_ID")) throw e;
        if (!window.confirm(`模板库里已经有「${as}」，覆盖它吗？`)) throw null;
        await send(true);
      });
      st.toast(`已把「${name}」存进模板库（${as}），其他工程也能用`);
      reload();
    } catch (e) {
      if (e) st.toast(e instanceof Error ? e.message : String(e), "error");
    }
  };
  const addToProject = (l: LibraryStyle) =>
    void st.submit(
      [{ op: "style.add", id: l.name, style: l.style }],
      `已把「${l.name}」加入本工程`,
    );

  const own = Object.entries(project.styles).filter(([name, style]) =>
    matches(q, name, describeStyle(style)),
  );
  const more = (library ?? []).filter(
    (l) => !(l.name in project.styles) && matches(q, l.name, l.description, describeStyle(l.style)),
  );
  return (
    <div className="styles">
      <SearchBox value={q} onChange={setQ} />
      <h4 className="list-head">本工程</h4>
      {own.map(([name, style]) => (
        <StyleCard key={name} name={name} style={style}>
          <button
            type="button"
            className="icon-btn ghost"
            title="存为模板：以后在其他工程里也能用"
            aria-label={`把 ${name} 存为模板`}
            onClick={() => void save(name)}
          >
            <Icon name="save" size={13} />
          </button>
          <button
            type="button"
            className="mini-btn"
            disabled={!target}
            title={target ? `套用到 ${selected}` : "先选中一句字幕或标题"}
            onClick={() => apply(name)}
          >
            套用
          </button>
        </StyleCard>
      ))}
      <h4 className="list-head">模板库</h4>
      {library === null ? (
        <p className="muted empty-note">载入中…</p>
      ) : more.length === 0 ? (
        <p className="muted empty-note">模板库里的样式都已经在本工程里了</p>
      ) : (
        more.map((l) => (
          <StyleCard key={l.name} name={l.name} style={l.style} note={l.description}>
            <button
              type="button"
              className="mini-btn"
              title="复制一份到本工程，之后就能套用"
              onClick={() => addToProject(l)}
            >
              加入工程
            </button>
          </StyleCard>
        ))
      )}
    </div>
  );
}

function StyleCard({
  name,
  style,
  note,
  children,
}: {
  name: string;
  style: TextStyle;
  note?: string;
  children: React.ReactNode;
}) {
  const fonts = useStore((s) => s.preview?.fonts);
  const [hover, setHover] = useState(false);
  return (
    <div
      className="style-card"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="style-sample">
        {hover && fonts ? (
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
          <span className="muted">{note || describeStyle(style)}</span>
        </div>
        <div className="style-actions">{children}</div>
      </div>
    </div>
  );
}

const sampleText = (name: string) => (name.startsWith("title") ? "标题这样显示" : "字幕这样出现");

export function swatch(s: TextStyle): React.CSSProperties {
  return {
    color: s.fill,
    fontWeight: s.font.weight,
    WebkitTextStroke: s.stroke
      ? `${Math.max(1, s.stroke.width / 3)}px ${s.stroke.color}`
      : undefined,
    paintOrder: "stroke fill",
    fontFamily: `"${s.font.family}", ${s.font.fallback.map((f) => `"${f}"`).join(", ")}, sans-serif`,
    // 背景框按字号 84 缩到色块大小（大约 1/4）
    ...(s.box
      ? {
          background: s.box.color,
          borderRadius: s.box.radius / 4,
          padding: `${s.box.padding[0] / 4}px ${s.box.padding[1] / 4}px`,
        }
      : {}),
    // 渐变和背景框都用 background，同时有时只显示背景框
    ...(s.gradient && !s.box
      ? {
          color: "transparent",
          backgroundImage: `linear-gradient(180deg, ${s.gradient.colors.join(", ")})`,
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
        }
      : {}),
    textShadow: s.glow ? `0 0 ${s.glow.blur / 4}px ${s.glow.color}` : undefined,
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

  const place = () => {
    const st = useStore.getState();
    const fps = st.preview?.timeline.fps ?? 30;
    try {
      const { ops, itemId } = placeAsset(project, id, msOfFrame(st.frame, fps));
      void st.submit(ops, `已把「${name}」放到画面上`).then((ok) => {
        if (ok) st.select(itemId);
      });
    } catch (e) {
      st.toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

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
          {a.kind !== "audio" && (
            <button
              type="button"
              className="mini-btn"
              title="在播放头处放到画面上；视频默认右上角小窗"
              onClick={place}
            >
              放到画面上
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
