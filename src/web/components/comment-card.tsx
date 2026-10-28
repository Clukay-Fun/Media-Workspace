import type { Comment } from "../../core/review";
import { frameOfMs, timecode } from "../lib/timeline";
import { useStore } from "../store";
import { Icon } from "./icons";

const when = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function CommentCard({
  comment: c,
  compact = false,
}: {
  comment: Comment;
  compact?: boolean;
}) {
  const fps = useStore((s) => s.preview?.timeline.fps ?? 30);
  const selected = useStore((s) => s.selected);
  const { select, seek, setCommentStatus } = useStore.getState();
  const resolved = c.status === "resolved";
  const jump = () => {
    if (c.target) select(c.target);
    if (c.atMs !== undefined) seek(frameOfMs(c.atMs, fps));
  };

  return (
    <article
      className={[
        "comment",
        resolved ? "resolved" : "",
        !compact && c.target && c.target === selected ? "current" : "",
      ].join(" ")}
    >
      <button type="button" className="comment-main" onClick={jump}>
        <div className="comment-meta">
          <span className="comment-no">#{c.id.replace(/^k/, "")}</span>
          {c.atMs !== undefined && (
            <span className="mono">{timecode(frameOfMs(c.atMs, fps), fps)}</span>
          )}
          {!compact && c.target && <span className="target">{c.target}</span>}
          <span className="when">{when(c.createdAt)}</span>
        </div>
        <p className="comment-text">{c.text}</p>
      </button>
      {resolved && c.resolution && (
        <div className="resolution">
          <Icon name="check" size={12} />
          <p>
            <b>{c.resolution.by}</b>
            {c.resolution.note ? `：${c.resolution.note}` : " 已处理"}
          </p>
        </div>
      )}
      <div className="comment-actions">
        {resolved ? (
          <button
            type="button"
            className="link"
            onClick={() => void setCommentStatus(c.id, "open")}
          >
            <Icon name="reopen" size={12} />
            没改好，重新打开
          </button>
        ) : (
          <button
            type="button"
            className="link"
            onClick={() => void setCommentStatus(c.id, "resolved")}
          >
            <Icon name="check" size={12} />
            不用改了
          </button>
        )}
      </div>
    </article>
  );
}
