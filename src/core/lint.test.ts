import { describe, expect, it } from "vitest";
import { estimateLines, type FaceTrack, lintProject, type OverlayBounds } from "./lint";
import { BUILTIN_STYLES } from "./presets";
import { Project, Track } from "./schema";
import { TextStyle } from "./text-style";
import { PROJECT_FORMAT_VERSION } from "./version";

const caption = BUILTIN_STYLES["caption-word-yellow"];
const styles: Record<string, TextStyle> = {
  ...BUILTIN_STYLES,
  tiny: TextStyle.parse({ ...caption, font: { ...caption.font, size: 30 } }),
  low: TextStyle.parse({ ...caption, layout: { ...caption.layout, y: 1800 } }),
};

function make(captions: object[], overlays: object[] = []) {
  return Project.parse({
    version: PROJECT_FORMAT_VERSION,
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
  it("自然折行的单行、双行安全区与真正越界", () => {
    const fit = TextStyle.parse({
      ...caption,
      layout: { ...caption.layout, maxWidth: 840, x: 540 },
    });
    const shifted = TextStyle.parse({ ...fit, layout: { ...fit.layout, x: 600 } });
    const testStyles = { ...styles, fit, shifted };
    expect(
      lintProject(make([cap("single", 0, "一".repeat(10), "fit")]), { styles: testStyles }).some(
        (i) => i.code === "TEXT_OUTSIDE_SAFE_AREA",
      ),
    ).toBe(false);
    expect(
      lintProject(make([cap("two", 0, "一".repeat(16), "fit")]), { styles: testStyles }).some(
        (i) => i.code === "TEXT_OUTSIDE_SAFE_AREA",
      ),
    ).toBe(false);
    expect(
      lintProject(make([cap("outside", 0, "一".repeat(10), "shifted")]), {
        styles: testStyles,
      }).some((i) => i.code === "TEXT_OUTSIDE_SAFE_AREA"),
    ).toBe(true);
  });

  it("超过建议行数才提示", () => {
    const fit = TextStyle.parse({
      ...caption,
      layout: { ...caption.layout, maxWidth: 840, maxLines: 2 },
    });
    const testStyles = { ...styles, fit };
    expect(
      lintProject(make([cap("ok", 0, "一".repeat(20), "fit")]), { styles: testStyles }).some(
        (i) => i.code === "CAPTION_OVERFLOW",
      ),
    ).toBe(false);
    expect(
      lintProject(make([cap("long", 0, "一".repeat(21), "fit")]), { styles: testStyles }).some(
        (i) => i.code === "CAPTION_OVERFLOW",
      ),
    ).toBe(true);
  });
  it.each([
    [9999, false],
    [10000, true],
    [10001, true],
  ])("封面时间 %i ms 的越界检查", (atMs, outOfRange) => {
    const p = make([]);
    p.cover = { atMs };
    const issue = lintProject(p, { styles }).find((i) => i.code === "COVER_OUT_OF_RANGE");
    expect(Boolean(issue)).toBe(outOfRange);
    if (issue) expect(issue.message).toContain(`${atMs}ms 超出主轨时长 10000ms`);
  });

  it.each([
    [["拿到海外身份", "卖房款怎么出去"], null],
    [["一二三四五六七八九", "甲乙丙丁戊己庚辛壬"], true],
    [["第一行", "第二行", "第三行"], true],
    [["一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六"], true],
  ])("封面标题行数估算 %j", (lines, overflow) => {
    const p = make([]);
    p.cover = { atMs: 1000, title: { template: "title-bar", style: "cover", props: { lines } } };
    const cover = TextStyle.parse({
      ...styles["title-bar-yellow"],
      font: { ...styles["title-bar-yellow"]?.font, size: 120 },
      layout: { ...styles["title-bar-yellow"]?.layout, maxWidth: 1040, maxLines: 2 },
    });
    const issue = lintProject(p, { styles: { ...styles, cover } }).find(
      (i) => i.code === "COVER_TITLE_TRUNCATED",
    );
    if (overflow === null) expect(issue).toBeUndefined();
    else expect(issue?.message).toContain("文字不会裁掉");
  });
  it("提示无法占据输出帧的主轨片段", () => {
    const p = Project.parse({
      version: PROJECT_FORMAT_VERSION,
      revision: 0,
      canvas: {},
      assets: { a1: { kind: "video", path: "/a.mp4", probe: { durationMs: 2000 } } },
      tracks: [
        {
          id: "main",
          kind: "video",
          main: true,
          items: [
            { id: "long", type: "clip", asset: "a1", inMs: 0, outMs: 1000 },
            { id: "tiny", type: "clip", asset: "a1", inMs: 1000, outMs: 1001 },
          ],
        },
      ],
    });
    expect(lintProject(p, { styles })).toContainEqual(
      expect.objectContaining({ code: "ZERO_FRAME_CLIP", id: "tiny", atMs: 1000 }),
    );
  });
  it("估算行数：中文按一个字号宽", () => {
    expect(estimateLines("一句", caption).lines).toBe(1);
    // 12 × 84 = 1008 > 859
    expect(estimateLines("一二三四五六七八九十一二", caption).lines).toBe(2);
  });

  it("有卡时字幕不显示，不算重叠；不是卡片的叠加层照样算", () => {
    const ov = (size?: string) => ({
      id: "k",
      template: "x",
      ...(size ? { size } : {}),
      at: { ms: 0 },
      durationMs: 1000,
      props: {},
    });
    // 盖住字幕位置（约 1115–1215）
    const bounds: OverlayBounds = () => ({
      text: [],
      shapes: [{ x0: 54, y0: 1000, x1: 1026, y1: 1766 }],
    });
    const p = (size?: string) => make([cap("s1", 0, "一句")], [ov(size)]);
    expect(codes(p("half"), { overlayBounds: bounds })).toEqual([]);
    expect(codes(p("small"), { overlayBounds: bounds })).toEqual([]);
    expect(codes(p(), { overlayBounds: bounds })).toEqual(["OVERLAP:k"]);
  });

  it("全屏卡盖住标题条不算遮挡", () => {
    const ov = (id: string, size?: string) => ({
      id,
      template: "x",
      ...(size ? { size } : {}),
      at: { ms: 0 },
      durationMs: 1000,
      props: {},
    });
    const bounds: OverlayBounds = () => ({
      text: [{ x0: 100, y0: 200, x1: 900, y1: 300 }],
      shapes: [],
    });
    expect(codes(make([], [ov("t"), ov("f", "full")]), { overlayBounds: bounds })).toEqual([]);
    expect(codes(make([], [ov("t"), ov("f")]), { overlayBounds: bounds })).toEqual(["OVERLAP:f"]);
  });

  it("卡片太多：10 秒的视频最多 2 张", () => {
    const ov = (id: string, ms: number) => ({
      id,
      template: "x",
      size: "small",
      at: { ms },
      durationMs: 1000,
      props: {},
    });
    expect(codes(make([], [ov("a", 0), ov("b", 3000)]))).toEqual([]);
    expect(codes(make([], [ov("a", 0), ov("b", 3000), ov("c", 6000)]))).toEqual([
      "TOO_MANY_CARDS:c",
    ]);
  });

  it("正常字幕没有问题", () => {
    expect(codes(make([cap("s1", 0, "一句")]))).toEqual([]);
  });

  it("主轨裁切后按可见人脸位置检查遮挡，并忽略裁切外的人脸", () => {
    const crop = { x: 0.5, y: 0, width: 0.5, height: 1 };
    const p = make(
      [],
      [{ id: "title", template: "x", at: { ms: 0 }, durationMs: 1000, props: {} }],
    );
    const main = p.tracks.find((track) => track.kind === "video" && track.main);
    if (!main || main.kind !== "video") throw new Error("缺少主轨");
    (main.items[0] as { crop?: typeof crop }).crop = crop;
    const faces: FaceTrack = {
      intervalMs: 500,
      frames: [{ ms: 500, boxes: [{ x: 0.55, y: 0.4, w: 0.1, h: 0.1 }] }],
    };
    const overlayBounds: OverlayBounds = () => ({
      text: [{ x0: 340, y0: 770, x1: 410, y1: 950 }],
      shapes: [],
    });
    expect(codes(p, { faces: { a1: faces }, overlayBounds })).toContain("FACE_COVERED:title");

    faces.frames[0]!.boxes = [{ x: 0.1, y: 0.4, w: 0.1, h: 0.1 }];
    expect(codes(p, { faces: { a1: faces }, overlayBounds })).not.toContain("FACE_COVERED:title");
  });

  it("半屏卡盖住人物上半身时提示，即使没有直接压到人脸框", () => {
    const p = make(
      [],
      [
        {
          id: "half-card",
          template: "x",
          size: "half",
          at: { ms: 0 },
          durationMs: 2000,
          props: {},
        },
      ],
    );
    const faces: FaceTrack = {
      intervalMs: 500,
      frames: [{ ms: 1000, boxes: [{ x: 0.4, y: 0.25, w: 0.2, h: 0.2 }] }],
    };
    const overlayBounds: OverlayBounds = () => ({
      text: [],
      shapes: [{ x0: 108, y0: 902, x1: 972, y1: 1517 }],
    });
    expect(codes(p, { faces: { a1: faces }, overlayBounds })).toContain("PERSON_COVERED:half-card");
  });

  it("画中画与文字的遮挡框按裁切后的可见区域计算", () => {
    const base = make(
      [],
      [{ id: "title", template: "x", at: { ms: 0 }, durationMs: 1000, props: {} }],
    );
    const overlayBounds: OverlayBounds = () => ({
      text: [{ x0: 300, y0: 300, x1: 400, y1: 400 }],
      shapes: [],
    });
    const withPip = (crop?: object) =>
      Project.parse({
        ...base,
        tracks: [
          ...base.tracks,
          {
            id: "pip",
            kind: "video",
            items: [
              {
                id: "p1",
                type: "clip",
                asset: "a1",
                at: { ms: 0 },
                inMs: 0,
                outMs: 1000,
                ...(crop ? { crop } : {}),
              },
            ],
          },
        ],
      });
    const rightHalf = { x: 0.5, y: 0, width: 0.5, height: 1 };
    expect(codes(withPip(rightHalf), { overlayBounds })).toContain("OVERLAP:p1");
    expect(codes(withPip(), { overlayBounds })).toContain("OVERLAP:p1");
    const leftText: OverlayBounds = () => ({
      text: [{ x0: 0, y0: 300, x1: 100, y1: 400 }],
      shapes: [],
    });
    expect(codes(withPip(rightHalf), { overlayBounds: leftText })).not.toContain("OVERLAP:p1");
    expect(codes(withPip(), { overlayBounds: leftText })).toContain("OVERLAP:p1");
  });

  it("字幕放不下、字太小、出安全区", () => {
    const p = make([
      cap("long", 0, "一".repeat(25)),
      cap("small", 2000, "一句", "tiny"),
      cap("low", 4000, "一句", "low"),
    ]);
    expect(codes(p)).toEqual([
      "CAPTION_OVERFLOW:long",
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

  it("图片、画中画压住字幕；按 contain 后的真实画面算，带关键帧时跟着位置走", () => {
    const withImage = (item: object) => {
      const p = make([cap("s1", 0, "一句")]);
      p.assets.img = {
        kind: "image",
        path: "/a.png",
        probe: { durationMs: 0, width: 1920, height: 1080 },
      };
      p.tracks.push(Track.parse({ id: "pip", kind: "video", items: [item] }));
      return p;
    };
    const img = { id: "i1", type: "image", asset: "img", at: { ms: 0 }, durationMs: 1000 };
    // 默认铺满：横图 contain 后在画面中间 1080×607，压住字幕（y≈1170）
    expect(codes(withImage({ ...img, transform: { y: 1170 } }))).toContain("OVERLAP:i1");
    // 缩小一半挪到上面（y 348–652），不压字幕
    expect(codes(withImage({ ...img, transform: { y: 500, scale: 0.5 } }))).not.toContain(
      "OVERLAP:i1",
    );
    // 开始在顶上，关键帧移到字幕位置
    const moving = {
      ...img,
      transform: { scale: 0.5 },
      keyframes: [
        { atMs: 0, transform: { y: 500 } },
        { atMs: 900, transform: { y: 1170 } },
      ],
    };
    expect(codes(withImage(moving))).toContain("OVERLAP:i1");
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

describe("质检：账号版式", () => {
  const face: FaceTrack = {
    intervalMs: 500,
    frames: [250, 750, 1250].map((ms) => ({ ms, boxes: [{ x: 0.4, y: 0.4, w: 0.2, h: 0.1 }] })),
  };
  const layout = (f: { cx: number; top: number; bottom: number }) => ({
    face: f,
    captionStyle: null,
    titleStyle: null,
  });

  it("人物位置偏离版式时报 FACE_OFF_LAYOUT，按版式摆好就不报", () => {
    const p = make([]);
    // 没缩放时脸在 x 中心 0.5、上沿 0.4、高 0.1
    expect(
      codes(p, { faces: { a1: face }, layout: layout({ cx: 0.5, top: 0.4, bottom: 0.5 }) }),
    ).toEqual([]);
    const off = lintProject(p, {
      styles,
      faces: { a1: face },
      layout: layout({ cx: 0.5, top: 0.36, bottom: 0.5 }),
    });
    expect(off.map((i) => i.code)).toEqual(["FACE_OFF_LAYOUT"]);
    expect(off[0]?.message).toContain("偏下");
    expect(off[0]?.message).toContain("脸小了 29%");
  });

  it("主轨倍速和账号设置不一致时提示", () => {
    const p = make([]);
    const r = lintProject(p, {
      styles,
      layout: { face: null, captionStyle: null, titleStyle: null, speed: 1.1 },
    });
    expect(r.find((i) => i.code === "SPEED_NOT_LAYOUT")).toMatchObject({ id: "c1", level: "hint" });
    expect(
      codes(p, { layout: { face: null, captionStyle: null, titleStyle: null, speed: 1 } }),
    ).toEqual([]);
  });

  it("有账号版式时安全区仍是硬边界；字幕样式和版式不一致时提示", () => {
    const p = make([cap("s1", 0, "一句", "low")]);
    const plain = lintProject(p, { styles });
    expect(plain.find((i) => i.code === "TEXT_OUTSIDE_SAFE_AREA")?.level).toBeUndefined();
    const withLayout = lintProject(p, {
      styles,
      layout: { face: null, captionStyle: "caption-word-yellow", titleStyle: null },
    });
    expect(withLayout.find((i) => i.code === "TEXT_OUTSIDE_SAFE_AREA")?.level).toBeUndefined();
    expect(withLayout.find((i) => i.code === "STYLE_NOT_LAYOUT")).toMatchObject({
      id: "s1",
      level: "hint",
    });
  });
});
