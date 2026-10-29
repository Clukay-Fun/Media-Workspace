import { Player } from "@remotion/player";
import type React from "react";
import { useEffect, useState } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { TextBlock } from "../../composition/TextBlock";
import type { Comment } from "../../core/review";
import type { Project } from "../../core/schema";
import type { TextStyle } from "../../core/text-style";
import { findItem } from "../lib/project";
import { frameOfMs, timecode } from "../lib/timeline";
import { type PanelTab, useStore } from "../store";
import { CommentCard } from "./comment-card";
import { Icon } from "./icons";
import { Composer, SelectionView } from "./inspector";

const TABS: { id: PanelTab; label: string }[] = [
  { id: "comments", label: "批注" },
  { id: "styles", label: "样式" },
  { id: "assets", label: "素材" },
];

/**
 * 宽屏是左栏（批注 / 样式 / 素材），右栏另放选中信息。
 * 窄屏（和 AI 对话框并排时常见）合并成一个侧栏：多一页「选中」，批注输入框固定在底部。
 */
export function LeftPanel({ merged = false }: { merged?: boolean }) {
  const current = useStore((s) => s.panelTab);
  const review = useStore((s) => s.review);
  const reveal = useStore((s) => s.revealNonce);
  const { setPanelTab } = useStore.getState();
  const open = review?.comments.filter((c) => c.status === "open").length ?? 0;
  const tabs = merged ? [{ id: "selection" as const, label: "选中" }, ...TABS] : TABS;
  // 宽屏没有「选中」页，从窄屏拉宽时退回批注
  const tab = !merged && current === "selection" ? "comments" : current;

  useEffect(() => {
    if (merged && reveal > 0) setPanelTab("selection");
  }, [merged, reveal, setPanelTab]);

  return (
    <aside className={merged ? "left-panel merged" : "left-panel"}>
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "tab active" : "tab"}
            onClick={() => setPanelTab(t.id)}
          >
            {t.label}
            {t.id === "comments" && open > 0 && <span className="count">{open}</span>}
          </button>
        ))}
      </div>
      <div className="panel-scroll">
        {tab === "selection" && <SelectionView />}
        {tab === "comments" && <Comments />}
        {tab === "styles" && <Styles />}
        {tab === "assets" && <Assets />}
      </div>
      {merged && <Composer />}
    </aside>
  );
}

function Comments() {
  const review = useStore((s) => s.review);
  const [showDone, setShowDone] = useState(false);
  const all = review?.comments ?? [];
  const open = all.filter((c) => c.status === "open").toReversed();
  const done = all.filter((c) => c.status === "resolved").toReversed();
  const fps = useStore((s) => s.preview?.timeline.fps ?? 30);
  const handOff = async () => {
    const { toast } = useStore.getState();
    try {
      await navigator.clipboard.writeText(handOffText(open.toReversed(), fps));
      toast("已复制，粘贴到和 AI 的对话里");
    } catch {
      toast("复制失败，浏览器没给剪贴板权限", "error");
    }
  };
  return (
    <div className="comments">
      {open.length > 0 && (
        <div className="handoff">
          <span>{open.length} 条等 AI 处理，复制到对话里就能让它现在改。</span>
          <button type="button" className="mini-btn" onClick={() => void handOff()}>
            <Icon name="spark" size={12} />
            复制给 AI
          </button>
        </div>
      )}
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

/** 粘贴到对话里的一段话：批注原文带上时间和目标，再告诉 AI 怎么回写结果 */
function handOffText(open: Comment[], fps: number): string {
  const lines = open.map((c) => {
    const at = c.atMs !== undefined ? ` ${timecode(frameOfMs(c.atMs, fps), fps)}` : "";
    const target = c.target ? ` [${c.target}]` : "";
    return `- ${c.id}${at}${target}：${c.text}`;
  });
  return [
    `审片台有 ${open.length} 条批注，请逐条处理：`,
    ...lines,
    "",
    "完整上下文用 comments 查看；改完一条就用 resolve 标记，并在 note 里写改了什么（不改也写原因）。",
  ].join("\n");
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
