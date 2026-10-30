import { useEffect, useState } from "react";
import type { Op } from "../../../core/ops";
import { BUILTIN_STYLES } from "../../../core/presets";
import type { Project } from "../../../core/schema";
import { frameOfMs, msOfFrame, timecode } from "../../lib/timeline";
import { useStore } from "../../store";
import { Field } from "./common";

type Cover = NonNullable<Project["cover"]>;
type CoverTitle = NonNullable<Cover["title"]>;

/** 封面标题的 props.lines；数据不对时当空 */
function linesOf(title: CoverTitle | undefined): string[] {
  const lines = (title?.props as { lines?: unknown } | undefined)?.lines;
  return Array.isArray(lines) ? lines.filter((x): x is string => typeof x === "string") : [];
}

/**
 * 封面入口（阶段 E）：封面时间、标题文字和样式、导出。改动都走 cover.update；
 * 标题模板固定 title-bar（docs/decisions/0022）。
 */
export function CoverPanel() {
  const project = useStore((s) => s.project);
  const frame = useStore((s) => s.frame);
  const fps = useStore((s) => s.preview?.timeline.fps ?? 30);
  const api = useStore((s) => s.api);

  const cover = project?.cover ?? null;
  const title = cover?.title;
  const [lines, setLines] = useState(linesOf(title).join("\n"));
  const [styleId, setStyleId] = useState(title?.style ?? "");
  const [out, setOut] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 外部改了封面（AI / 撤销）时同步表单；标题和样式一起看
  const titleKey = JSON.stringify({ lines: linesOf(title), style: title?.style ?? "" });
  useEffect(() => {
    const next = JSON.parse(titleKey) as { lines: string[]; style: string };
    setLines(next.lines.join("\n"));
    setStyleId(next.style);
  }, [titleKey]);

  if (!project) return null;
  const styles = { ...BUILTIN_STYLES, ...project.styles };
  const atMs = cover?.atMs ?? 1000;

  const commit = (next: Cover, label: string) => {
    const ops: Op[] = [];
    const style = next.title?.style;
    // 内置样式没复制进工程时先复制，否则 validate 会报样式不存在
    if (style && !project.styles[style] && BUILTIN_STYLES[style as keyof typeof BUILTIN_STYLES]) {
      ops.push({
        op: "style.add",
        id: style,
        style: BUILTIN_STYLES[style as keyof typeof BUILTIN_STYLES],
      });
    }
    ops.push({ op: "cover.update", set: next });
    void useStore.getState().submit(ops, label);
    setOut(null);
  };

  const submitTitle = (text: string, style: string) => {
    const nextLines = text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3);
    const at = cover?.atMs ?? msOfFrame(frame, fps);
    if (nextLines.length === 0) {
      if (cover) commit({ atMs: at }, "封面标题已清空");
      return;
    }
    const next: CoverTitle = {
      template: "title-bar",
      ...(style ? { style } : {}),
      props: { lines: nextLines },
    };
    commit({ atMs: at, title: next }, "封面标题已更新");
  };

  const usePlayhead = () => {
    commit(
      { atMs: msOfFrame(frame, fps), ...(title ? { title } : {}) },
      "封面时间改成播放头的位置",
    );
  };

  const exportCover = async () => {
    setBusy(true);
    try {
      const r = await api.cover();
      setOut(r.file);
      useStore.getState().toast("封面已导出");
    } catch (e) {
      useStore.getState().toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h3 className="panel-title">封面</h3>
      <dl className="facts">
        <dt>时间</dt>
        <dd className="mono">
          {timecode(frameOfMs(atMs, fps), fps)}
          {!cover && <span className="muted"> 默认</span>}
        </dd>
      </dl>
      <div className="tags">
        <button type="button" className="mini-btn" onClick={usePlayhead}>
          用播放头的位置
        </button>
      </div>
      <Field label="标题">
        <textarea
          className="caption-text"
          rows={3}
          value={lines}
          placeholder="封面标题，1–3 行"
          disabled={!project}
          onChange={(e) => setLines(e.target.value)}
          onBlur={() => submitTitle(lines, styleId)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setLines(linesOf(title).join("\n"));
              e.currentTarget.blur();
            }
          }}
        />
        <select
          className="select"
          value={styleId}
          disabled={!title}
          title={title ? "封面标题样式" : "先写标题，再选样式"}
          onChange={(e) => {
            const next = e.target.value;
            setStyleId(next);
            submitTitle(lines, next);
          }}
        >
          <option value="">默认样式</option>
          {Object.keys(styles).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </Field>
      <div className="tags">
        <button
          type="button"
          className="mini-btn"
          disabled={busy}
          onClick={() => void exportCover()}
        >
          {busy ? "导出中…" : "导出封面"}
        </button>
        {out && <p className="panel-note mono path">{out}</p>}
      </div>
    </section>
  );
}
