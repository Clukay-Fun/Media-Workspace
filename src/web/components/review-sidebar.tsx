import { useEffect, useState } from "react";
import type { HistoryEntry } from "../../core/api";
import type { Comment } from "../../core/review";
import { aiChanges } from "../lib/changes";
import { frameOfMs, itemFrames, timecode } from "../lib/timeline";
import { type SideTab, useStore } from "../store";
import { CommentCard } from "./comment-card";
import { Icon } from "./icons";
import { Composer, SelectionCard } from "./selection";

/**
 * 审阅中心：质检问题、AI 改动、批注三页共用一块区域，选中元素时换成它的详情。
 * 批注输入框固定在底部。
 */
export function ReviewSidebar() {
  const tab = useStore((s) => s.sideTab);
  const open = useStore((s) => s.sideOpen);
  const selected = useStore((s) => s.selected);
  const reveal = useStore((s) => s.revealNonce);
  const issues = useStore((s) => s.lint?.issues.length ?? 0);
  const comments = useStore(
    (s) => s.review?.comments.filter((c) => c.status === "open").length ?? 0,
  );
  const history = useStore((s) => s.history);
  const reviewedRev = useStore((s) => s.reviewedRev);
  const pending = aiChanges(history, reviewedRev).pending.length;
  const { setSideTab, setSideOpen } = useStore.getState();

  // 在画面、时间线上点了元素就显示它的详情；点标签回到列表（选中保留）
  const [detail, setDetail] = useState(false);
  useEffect(() => {
    if (reveal > 0) setDetail(true);
  }, [reveal]);
  const showDetail = detail && selected !== null;

  const tabs: { id: SideTab; label: string; count: number; tone: string }[] = [
    { id: "issues", label: "问题", count: issues, tone: "warn" },
    { id: "changes", label: "AI 改动", count: pending, tone: "ai" },
    { id: "comments", label: "批注", count: comments, tone: "comment" },
  ];

  return (
    <aside className={open ? "sidebar open" : "sidebar"} aria-label="审阅">
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={!showDetail && tab === t.id}
            className={!showDetail && tab === t.id ? "tab active" : "tab"}
            onClick={() => {
              setDetail(false);
              setSideTab(t.id);
            }}
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
        {showDetail ? (
          <SelectionCard />
        ) : (
          <>
            {tab === "issues" && <IssueList />}
            {tab === "changes" && <ChangeList />}
            {tab === "comments" && <Comments />}
          </>
        )}
      </div>
      <Composer />
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

function IssueList() {
  const lint = useStore((s) => s.lint);
  const fps = useStore((s) => s.preview?.timeline.fps ?? 30);
  const issues = lint?.issues ?? [];
  if (issues.length === 0) return <Empty text="质检没有发现问题" />;
  return (
    <div className="card-list">
      {issues.map((i, n) => (
        <article key={`${i.id}-${n}`} className="card issue">
          <button type="button" className="card-main" onClick={() => jumpTo(i.id, i.atMs)}>
            <div className="card-meta">
              <Icon name="warn" size={12} />
              <span className="mono">{timecode(frameOfMs(i.atMs, fps), fps)}</span>
              {i.id && <span className="target">{i.id}</span>}
            </div>
            <p>{i.message}</p>
          </button>
          <div className="card-actions">
            <button
              type="button"
              className="link"
              onClick={() =>
                void useStore.getState().addComment({
                  text: `质检：${i.message}`,
                  atMs: i.atMs,
                  ...(i.id ? { target: i.id } : {}),
                })
              }
            >
              <Icon name="spark" size={12} />
              交给 AI
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function ChangeList() {
  const history = useStore((s) => s.history);
  const reviewedRev = useStore((s) => s.reviewedRev);
  const project = useStore((s) => s.project);
  const { all, pending } = aiChanges(history, reviewedRev);
  const { confirmAiChanges, undo } = useStore.getState();
  if (all.length === 0) return <Empty text="AI 还没有改过这个工程" />;
  const latest = all[0];
  const canUndoLatest = latest?.revision === project?.revision && history?.undo;
  return (
    <>
      {pending.length > 0 && (
        <div className="confirm-bar">
          <span>{pending.length} 次待确认</span>
          {canUndoLatest && (
            <button type="button" className="mini-btn" onClick={() => void undo("undo")}>
              撤销
            </button>
          )}
          <button type="button" className="mini-btn primary" onClick={confirmAiChanges}>
            <Icon name="check" size={12} />
            确认
          </button>
        </div>
      )}
      <div className="card-list">
        {all.slice(0, 30).map((e) => (
          <ChangeCard key={e.revision} entry={e} pending={pending.includes(e)} />
        ))}
      </div>
    </>
  );
}

const OP_LABEL: Record<string, string> = {
  "canvas.update": "改画布",
  "outro.set": "设片尾",
  "asset.add": "导入素材",
  "track.add": "加轨道",
  "track.update": "改轨道",
  "item.add": "加元素",
  "item.update": "改元素",
  "item.move": "移动元素",
  "item.remove": "删元素",
  "clip.split": "分割",
  "clip.trim": "裁剪",
  "keyframe.set": "改关键帧",
  "caption.import": "导入字幕",
  "caption.update": "改字幕",
  "caption.remove": "删字幕",
  "caption.merge": "合并字幕",
  "caption.split": "拆字幕",
  "cut.removeCaptions": "删句",
  "cut.removePauses": "去停顿",
  "style.add": "加样式",
  "style.update": "改样式",
};

function ChangeCard({ entry: e, pending }: { entry: HistoryEntry; pending: boolean }) {
  const ops = [...new Set(e.ops.map((o) => OP_LABEL[o] ?? o))].join("、");
  const kind =
    e.kind === "undo" ? "撤销" : e.kind === "redo" ? "重做" : e.kind === "revert" ? "回退" : ops;
  return (
    <article className={pending ? "card change pending" : "card change"}>
      <div className="card-meta">
        {pending && <span className="dot" aria-label="待确认" />}
        <b>{e.actor}</b>
        <span>第 {e.revision} 版</span>
        <span className="when">{hhmm(e.at)}</span>
      </div>
      <p>{kind || "修改"}</p>
      {e.changed.length > 0 && (
        <div className="tags">
          {e.changed.slice(0, 12).map((id) => (
            <button type="button" key={id} className="tag link-tag" onClick={() => jumpTo(id)}>
              {id}
            </button>
          ))}
          {e.changed.length > 12 && <span className="tag dim">+{e.changed.length - 12}</span>}
        </div>
      )}
    </article>
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
