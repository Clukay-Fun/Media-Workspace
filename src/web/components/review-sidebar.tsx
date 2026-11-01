import { useState } from "react";
import type { Comment } from "../../core/review";
import { aiChanges } from "../lib/changes";
import { frameOfMs, itemFrames, timecode } from "../lib/timeline";
import { type SideTab, useStore } from "../store";
import { AiChanges } from "./ai-changes";
import { CommentCard } from "./comment-card";
import { Icon } from "./icons";
import { SelectionCard } from "./inspector";
import { ProjectOverview } from "./inspector/project";

/**
 * 右栏：属性 / 批注 / AI 改动。属性页给选中元素能直接点的选项，点不出来的在底部输入框告诉 AI。
 * 没选中时属性页是章节和质检问题。
 */
export function ReviewSidebar() {
  const tab = useStore((s) => s.sideTab);
  const open = useStore((s) => s.sideOpen);
  const comments = useStore(
    (s) => s.review?.comments.filter((c) => c.status === "open").length ?? 0,
  );
  const history = useStore((s) => s.history);
  const reviewedRev = useStore((s) => s.reviewedRev);
  const pending = aiChanges(history, reviewedRev).pending.length;
  const { setSideTab, setSideOpen } = useStore.getState();

  const tabs: { id: SideTab; label: string; count: number; tone: string }[] = [
    // 质检数量只在顶栏 ⚠ 上显示（问题 8）
    { id: "props", label: "属性", count: 0, tone: "warn" },
    { id: "comments", label: "批注", count: comments, tone: "comment" },
    { id: "changes", label: "AI 改动", count: pending, tone: "ai" },
  ];

  return (
    <aside className={open ? "sidebar panel open" : "sidebar panel"} aria-label="属性和审阅">
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "tab active" : "tab"}
            onClick={() => setSideTab(t.id)}
          >
            {t.label}
            {t.count > 0 && <span className={`count tone-${t.tone}`}>{t.count}</span>}
          </button>
        ))}
        <button
          type="button"
          className="icon-btn ghost drawer-close"
          aria-label="收起审阅栏"
          onClick={() => setSideOpen(false)}
        >
          <Icon name="close" size={12} />
        </button>
      </div>
      <div className="panel-scroll">
        {tab === "props" && <Properties />}
        {tab === "changes" && <AiChanges />}
        {tab === "comments" && <Comments />}
      </div>
    </aside>
  );
}

const jumpTo = (id: string | undefined, ms?: number) => {
  const s = useStore.getState();
  const tl = s.preview?.timeline;
  if (!tl) return;
  if (id) s.select(id, { reveal: false });
  const range = id ? itemFrames(tl, id) : null;
  if (ms !== undefined) s.seek(frameOfMs(ms, tl.fps));
  else if (range) s.seek(range.from);
};

function Properties() {
  const selected = useStore((s) => s.selected);
  const project = useStore((s) => s.project);
  if (selected && project) {
    return <SelectionCard />;
  }
  return (
    <>
      <ProjectOverview />
      <Chapters />
    </>
  );
}

/** 没选中时的概览：章节目录，点一章跳过去 */
function Chapters() {
  const tl = useStore((s) => s.preview?.timeline);
  const frame = useStore((s) => s.frame);
  if (!tl) return null;
  const { chapters, fps } = tl;
  return (
    <>
      <h3 className="panel-title">章节</h3>
      {chapters.length === 0 ? (
        <p className="panel-note">还没分章节。AI 粗剪后会按内容分好，也可以写批注让它分。</p>
      ) : (
        <ol className="chapter-list">
          {chapters.map((c, i) => {
            const next = chapters[i + 1]?.from ?? tl.mainEndFrame;
            const on = frame >= c.from && frame < next;
            return (
              <li key={`${c.title}-${c.from}`}>
                <button
                  type="button"
                  className={on ? "chapter-row on" : "chapter-row"}
                  onClick={() => useStore.getState().seek(c.from)}
                >
                  <span className="chapter-no mono">{String(i + 1).padStart(2, "0")}</span>
                  <span className="chapter-title">{c.title}</span>
                  <span className="mono muted">{timecode(c.from, fps)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

function Comments() {
  const review = useStore((s) => s.review);
  const fps = useStore((s) => s.preview?.timeline.fps ?? 30);
  const [showDone, setShowDone] = useState(false);
  const all = review?.comments ?? [];
  const open = all.filter((c) => c.status === "open").toReversed();
  const done = all.filter((c) => c.status === "resolved").toReversed();
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
    <>
      {open.length > 0 ? (
        <>
          <div className="handoff">
            <span>{open.length} 条等 AI 处理</span>
            <button type="button" className="mini-btn" onClick={() => void handOff()}>
              <Icon name="spark" size={12} />
              复制给 AI
            </button>
          </div>
          <div className="comment-list">
            {open.map((c) => (
              <CommentCard key={c.id} comment={c} />
            ))}
          </div>
        </>
      ) : (
        <Empty text="没有待处理的批注 · 按 C 写一条" />
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
    </>
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

function Empty({ text }: { text: string }) {
  return (
    <div className="empty small">
      <p>{text}</p>
    </div>
  );
}
