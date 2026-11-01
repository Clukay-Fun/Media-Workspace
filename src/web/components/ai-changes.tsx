import { useEffect, useState } from "react";
import type { HistoryEntry } from "../../core/api";
import type { EntityChange } from "../../core/diff";
import { aiChanges } from "../lib/changes";
import { blockSeekFrame } from "../lib/seek";
import { itemFrames } from "../lib/timeline";
import { useStore } from "../store";
import { Icon } from "./icons";

// 右栏「AI 改动」：每次 AI 修改一张卡片，展开看每个元素的前后值（问题 7）。
// 前后值由服务端比较两版工程得到（core/diff），这里只负责显示和跳转。

/** 已经取过的改动；版本写进去之后不会再变，按 revision 缓存 */
const diffs = new Map<number, EntityChange[]>();

export function AiChanges() {
  const history = useStore((s) => s.history);
  const reviewedRev = useStore((s) => s.reviewedRev);
  const project = useStore((s) => s.project);
  const { all, pending } = aiChanges(history, reviewedRev);
  const { confirmAiChanges, undo } = useStore.getState();
  if (all.length === 0) return <Empty text="AI 还没有改过这个工程" />;
  const latest = all[0];
  // 只能撤销最近一次：再早的改动之后可能有人接着改过，单独撤回会把后面的也弄乱
  const canUndoLatest = latest?.revision === project?.revision && history?.undo;
  return (
    <>
      {pending.length > 0 && (
        <div className="confirm-bar">
          <span>{pending.length} 次待确认</span>
          {canUndoLatest && (
            <button
              type="button"
              className="mini-btn"
              title="撤销最近这一次修改"
              onClick={() => void undo("undo")}
            >
              撤销最近一次
            </button>
          )}
          <button type="button" className="mini-btn primary" onClick={confirmAiChanges}>
            <Icon name="check" size={12} />
            确认
          </button>
        </div>
      )}
      <div className="card-list">
        {all.slice(0, 30).map((e, i) => (
          <ChangeCard
            key={e.revision}
            entry={e}
            pending={pending.includes(e)}
            initiallyOpen={i === 0}
          />
        ))}
      </div>
    </>
  );
}

function ChangeCard({
  entry: e,
  pending,
  initiallyOpen,
}: {
  entry: HistoryEntry;
  pending: boolean;
  initiallyOpen: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const ops = [...new Set(e.ops.map((o) => OP_LABEL[o] ?? o))].join("、");
  const kind =
    e.kind === "undo" ? "撤销" : e.kind === "redo" ? "重做" : e.kind === "revert" ? "回退" : ops;
  return (
    <article className={pending ? "card change pending" : "card change"}>
      <button
        type="button"
        className="change-head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <div className="card-meta">
          {pending && <span className="dot" aria-label="待确认" />}
          <b>{e.actor}</b>
          <span>第 {e.revision} 版</span>
          <span className="when">{hhmm(e.at)}</span>
        </div>
        <p>
          <span className={open ? "chevron open" : "chevron"} aria-hidden>
            <Icon name="next" size={11} />
          </span>
          {kind || "修改"}
          {e.changed.length > 0 && <span className="change-count">{e.changed.length} 处</span>}
        </p>
      </button>
      {open && <ChangeDetail revision={e.revision} />}
    </article>
  );
}

/** 一次改了很多条（导入字幕、剪静音）时先只列前几条 */
const FIRST = 8;

function ChangeDetail({ revision }: { revision: number }) {
  const [changes, setChanges] = useState(() => diffs.get(revision) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    if (diffs.has(revision)) return;
    let live = true;
    useStore
      .getState()
      .api.revision(revision)
      .then((r) => {
        diffs.set(revision, r.changes);
        if (live) setChanges(r.changes);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : "读取改动失败");
      });
    return () => {
      live = false;
    };
  }, [revision]);

  if (error) return <p className="change-note">{error}</p>;
  if (!changes) return <p className="change-note">读取中…</p>;
  if (changes.length === 0) return <p className="change-note">这一版和上一版内容相同</p>;
  const shown = all ? changes : changes.slice(0, FIRST);
  return (
    <div className="change-detail">
      {changes.length > FIRST && <p className="change-note">{summary(changes)}</p>}
      <ul>
        {shown.map((c) => (
          <ChangeRow key={`${c.entity}:${c.id}`} change={c} />
        ))}
      </ul>
      {changes.length > FIRST && (
        <button type="button" className="link" onClick={() => setAll(!all)}>
          {all ? "收起" : `展开全部 ${changes.length} 项`}
        </button>
      )}
    </div>
  );
}

const STATUS = { added: "新增", removed: "删除", updated: "修改" } as const;

function ChangeRow({ change: c }: { change: EntityChange }) {
  // 删掉的元素已经不在时间线上，没法跳过去
  const canJump = c.entity === "item" && c.status !== "removed";
  const name = (
    <>
      <span className="change-kind">{c.kind}</span>
      {/* 封面、片尾、章节这类名字就是类别本身，不重复写 */}
      {c.name !== c.kind && <span className="change-name">{c.name}</span>}
    </>
  );
  return (
    <li className={`change-row ${c.status}`}>
      <div className="change-row-head">
        <span className={`change-status ${c.status}`}>{STATUS[c.status]}</span>
        {canJump ? (
          <button type="button" className="change-target" title={c.id} onClick={() => jump(c)}>
            {name}
          </button>
        ) : (
          <span className="change-target" title={c.id}>
            {name}
          </span>
        )}
      </div>
      {c.fields.length > 0 && (
        <dl className="change-fields">
          {c.fields.map((f) => (
            <div key={f.field}>
              <dt>{f.label}</dt>
              <dd>
                <s>{f.before}</s>
                <span aria-hidden>→</span>
                <b>{f.after}</b>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

function jump(c: EntityChange) {
  const s = useStore.getState();
  const tl = s.preview?.timeline;
  if (!tl) return;
  s.select(c.id, { reveal: false });
  const range = itemFrames(tl, c.id);
  // 和点时间线、字幕列表一样：字幕跳到快念完的地方，能看到整句
  if (range)
    s.seek(blockSeekFrame(range.from, range.to, c.kind === "字幕" ? "caption" : undefined));
}

/** 「新增 字幕 ×42、修改 主轨片段 ×3」 */
function summary(changes: EntityChange[]): string {
  const counts = new Map<string, number>();
  for (const c of changes) {
    const k = `${STATUS[c.status]} ${c.kind}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join("、");
}

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function Empty({ text }: { text: string }) {
  return (
    <div className="empty small">
      <p>{text}</p>
    </div>
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
  "caption.add": "加字幕",
  "caption.update": "改字幕",
  "caption.remove": "删字幕",
  "caption.merge": "合并字幕",
  "caption.split": "拆字幕",
  "cut.removeCaptions": "删句",
  "cut.removePauses": "去停顿",
  "cut.restore": "恢复剪辑点",
  "style.add": "加样式",
  "style.update": "改样式",
  "style.remove": "删样式",
  "theme.update": "改主题",
  "cover.update": "改封面",
  "outro.remove": "去掉片尾",
  "chapters.set": "分章节",
  "asset.relink": "重新关联素材",
  "asset.cache": "更新素材缓存",
  "asset.remove": "删素材",
  "track.move": "调轨道顺序",
  "track.remove": "删轨道",
  "keyframe.remove": "删关键帧",
  "caption.reflow": "重排字幕",
  "cut.removeSilence": "剪静音",
};
