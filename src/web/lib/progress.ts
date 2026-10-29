import type { Project } from "../../core/schema";
import { isMainClip } from "../../core/schema";

// 顶栏的工程进度：从工程内容推断每一步做没做，不另存状态。
// 让人一眼看出 AI 做到哪一步、下一步该让它做什么。

export type Step = { key: string; label: string; done: boolean; detail?: string };

export function projectSteps(project: Project, exported: boolean): Step[] {
  const main = project.tracks.find((t) => t.kind === "video" && t.main);
  const clips = main?.kind === "video" ? main.items.filter(isMainClip) : [];
  const captions = project.tracks.flatMap((t) => (t.kind === "caption" ? t.items : []));
  const unaligned = captions.filter((c) => !c.charStartMs).length;
  const titles = project.tracks.some((t) => t.kind === "overlay" && t.items.length > 0);
  return [
    { key: "import", label: "导入", done: clips.length > 0 },
    {
      key: "captions",
      label: "字幕",
      done: captions.length > 0 && unaligned === 0,
      ...(captions.length > 0 && unaligned > 0 ? { detail: `${unaligned} 句未对齐` } : {}),
    },
    { key: "cut", label: "粗剪", done: clips.length > 1 || clips.some((c) => c.cutBefore) },
    { key: "chapters", label: "章节", done: project.chapters.length > 0 },
    { key: "titles", label: "标题", done: titles },
    { key: "export", label: "导出", done: exported },
  ];
}
