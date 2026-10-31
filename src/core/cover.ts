import type { Project } from "./schema";

// 封面（v7，docs/decisions/0022）：只留主轨画面，字幕、画中画、图片、叠加层都不要，再压上封面标题。
// 标题从第 0 帧开始显示、一直到主轨结束，截 atMs 那一帧时入场动画已经播完（atMs 不要小于 1 秒）。

export const COVER_TITLE_ID = "cover-title";

/** 渲染封面用的工程：不写盘，只给 renderStills 用 */
export function coverView(p: Project): Project {
  const main = p.tracks.filter((t) => t.kind === "video" && t.main);
  const title = p.cover?.title;
  return {
    ...p,
    outro: null,
    tracks: [
      ...main,
      ...(title
        ? [
            {
              id: "cover",
              kind: "overlay" as const,
              locked: false,
              hidden: false,
              muted: false,
              items: [
                {
                  id: COVER_TITLE_ID,
                  template: title.template,
                  ...(title.style ? { style: title.style } : {}),
                  at: { ms: 0 },
                  durationMs: "toEnd" as const,
                  props: title.props,
                },
              ],
            },
          ]
        : []),
    ],
  };
}
