import { useEffect, useState } from "react";
import { timecode } from "../../lib/timeline";
import { useStore } from "../../store";

/**
 * 未选中元素时的项目概览（docs/decisions/0015 第 7 条）：先让人确认在看哪个工程，
 * 再往下才是章节和质检。保存路径只有服务端知道，所以从项目接口单独取一次。
 */
export function ProjectOverview() {
  const name = useStore((s) => s.name);
  const project = useStore((s) => s.project);
  const timeline = useStore((s) => s.preview?.timeline);
  const api = useStore((s) => s.api);
  const [dir, setDir] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api
      .project()
      .then((r) => {
        if (alive) setDir(r.dir ?? null);
      })
      .catch(() => {
        // 路径只是概览里的附加信息，取不到不影响其它内容
      });
    return () => {
      alive = false;
    };
  }, [api]);

  if (!project || !timeline) return null;
  const captionCount = project.tracks.reduce(
    (n, t) => n + (t.kind === "caption" ? t.items.length : 0),
    0,
  );
  return (
    <section>
      <h3 className="panel-title">项目</h3>
      <dl className="facts">
        <dt>工程</dt>
        <dd>{name || "未命名"}</dd>
        <dt>时长</dt>
        <dd className="mono">{timecode(timeline.durationInFrames, timeline.fps)}</dd>
        <dt>画布</dt>
        <dd>
          {timeline.width} × {timeline.height} · {ratio(timeline.width, timeline.height)}
        </dd>
        <dt>帧率</dt>
        <dd>{timeline.fps} fps</dd>
        <dt>素材</dt>
        <dd>{Object.keys(project.assets).length} 个</dd>
        <dt>字幕</dt>
        <dd>{captionCount} 句</dd>
        <dt>路径</dt>
        <dd
          className="mono"
          style={{ fontSize: 11, wordBreak: "break-all" }}
          title={dir ?? "示例工程没有保存路径"}
        >
          {dir ?? "（示例工程）"}
        </dd>
      </dl>
    </section>
  );
}

/** 画布比例：1080×1920 → 9:16 */
function ratio(width: number, height: number): string {
  const g = gcd(Math.round(width), Math.round(height)) || 1;
  return `${Math.round(width) / g}:${Math.round(height) / g}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
