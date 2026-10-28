import { describe, expect, it } from "vitest";
import { estimateLines, type FaceTrack, lintProject, type OverlayBounds } from "./lint";
import { BUILTIN_STYLES } from "./presets";
import { Project } from "./schema";
import { TextStyle } from "./text-style";

const caption = BUILTIN_STYLES["caption-word-yellow"];
const styles: Record<string, TextStyle> = {
  ...BUILTIN_STYLES,
  tiny: TextStyle.parse({ ...caption, font: { ...caption.font, size: 30 } }),
  low: TextStyle.parse({ ...caption, layout: { ...caption.layout, y: 1800 } }),
};

function make(captions: object[], overlays: object[] = []) {
  return Project.parse({
    version: 3,
    revision: 0,
    canvas: {},
    assets: {
      a1: {
        kind: "video",
        path: "/raw.mov",
        probe: { durationMs: 10_000, width: 1080, height: 1920 },
      },
    },
    tracks: [
      {
        id: "main",
        kind: "video",
        main: true,
        items: [{ id: "c1", type: "clip", asset: "a1", inMs: 0, outMs: 10_000 }],
      },
      { id: "cap", kind: "caption", items: captions },
      { id: "ov", kind: "overlay", items: overlays },
    ],
  });
}

const cap = (id: string, startMs: number, text: string, style?: string) => ({
  id,
  asset: "a1",
  startMs,
  endMs: startMs + 1000,
  text,
  ...(style ? { style } : {}),
});

const codes = (p: Project, extra: Partial<Parameters<typeof lintProject>[1]> = {}) =>
  lintProject(p, { styles, ...extra }).map((i) => `${i.code}:${i.id}`);

describe("质检", () => {
  it("估算行数：中文按一个字号宽", () => {
    expect(estimateLines("一句", caption).lines).toBe(1);
    // 12 × 84 = 1008 > 859
    expect(estimateLines("一二三四五六七八九十一二", caption).lines).toBe(2);
  });

  it("正常字幕没有问题", () => {
    expect(codes(make([cap("s1", 0, "一句")]))).toEqual([]);
  });

  it("字幕放不下、字太小、出安全区", () => {
    const p = make([
      cap("long", 0, "一".repeat(25)),
      cap("small", 2000, "一句", "tiny"),
      cap("low", 4000, "一句", "low"),
    ]);
    expect(codes(p)).toEqual([
      "CAPTION_OVERFLOW:long",
      // 满行 859 宽居中，右边到 969.5，超过「all」安全区的右边界 910
      "TEXT_OUTSIDE_SAFE_AREA:long",
      "TEXT_TOO_SMALL:small",
      "TEXT_OUTSIDE_SAFE_AREA:low",
    ]);
  });

  it("同时出现的叠加层压住字幕", () => {
    const p = make(
      [cap("s1", 0, "一句")],
      [{ id: "o1", template: "card", at: { ms: 500 }, durationMs: 1000 }],
    );
    const overlayBounds: OverlayBounds = () => ({
      text: [],
      shapes: [{ x0: 300, y0: 1100, x1: 800, y1: 1300 }],
    });
    const issues = lintProject(p, { styles, overlayBounds });
    expect(issues).toMatchObject([{ code: "OVERLAP", id: "o1", other: "s1", atMs: 500 }]);
    // 时间不重叠就没事
    const later = make(
      [cap("s1", 0, "一句")],
      [{ id: "o1", template: "card", at: { ms: 3000 }, durationMs: 1000 }],
    );
    expect(lintProject(later, { styles, overlayBounds })).toEqual([]);
  });

  it("字幕挡脸：人脸坐标按主轨的缩放换算到画面", () => {
    const face = (y: number): FaceTrack => ({
      intervalMs: 500,
      frames: [0, 500, 1000].map((ms) => ({ ms, boxes: [{ x: 0.4, y, w: 0.2, h: 0.06 }] })),
    });
    const p = make([cap("s1", 0, "一句")]);
    // 脸在 y≈1114–1229，字幕在 1115–1215
    expect(codes(p, { faces: { a1: face(0.58) } })).toEqual(["FACE_COVERED:s1"]);
    // 脸在画面上方
    expect(codes(p, { faces: { a1: face(0.2) } })).toEqual([]);
  });
});
