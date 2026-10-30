import type { Project, Track } from "../../core/schema";

export type ItemRef = { track: Track; item: Track["items"][number] };

export function findItem(project: Project, id: string): ItemRef | null {
  for (const track of project.tracks) {
    const item = track.items.find((i) => i.id === id);
    if (item) return { track, item };
  }
  return null;
}

/** 条目类型的中文名 */
export function kindLabel(ref: ItemRef): string {
  const { track, item } = ref;
  if (track.kind === "caption") return "字幕";
  if (track.kind === "overlay") return "标题 / 卡片";
  if (track.kind === "audio") return "音频";
  if ("type" in item && item.type === "image") return "图片";
  return track.kind === "video" && track.main ? "主轨片段" : "画中画";
}
