import { type ReactNode, useEffect, useRef, useState } from "react";
import { TextBlock } from "../../../composition/TextBlock";
import { builtinStyles } from "../../../core/aspect";
import { FONT_FAMILIES } from "../../../core/fonts";
import type { Caption, Project } from "../../../core/schema";
import { effectiveStyleId, type StyleScope } from "../../../core/style-scope";
import type { Anim, TextStyle } from "../../../core/text-style";
import { ApiFailure } from "../../data/client";
import type { ItemRef } from "../../lib/project";
import { stylePresentation, styleTemplateId } from "../../lib/style-presentation";
import { itemFrames } from "../../lib/timeline";
import { useStore } from "../../store";
import { Icon } from "../icons";
import { allCaptionStyleOps, captionStyleTargets, underlineEditable } from "./caption-batch";
import { editStyle, Field, isImeComposing } from "./common";
import { type FontCatalogEntry, fontChoices } from "./font-choice";
import { numberInputWidth } from "./number-draft";
import { allTitleStyleOps, titleStyleTargets } from "./overlay-fields";
import { ParameterSlider } from "./parameter-slider";

type TextStyleSection = "edit" | "style" | "motion";

type TextStyleEditorProps = {
  project: Project;
  id: string;
  ref_: ItemRef;
  fallback: string;
  showHighlight?: boolean;
  elementLabel: string;
  /** 字幕四页里的一页。不传时保持原来的内部分页。 */
  section?: TextStyleSection;
  content?: ReactNode;
  /** 不传就用 store 里的字体目录。测试可以直接把目录传进来。 */
  catalog?: readonly FontCatalogEntry[];
};

const ANIMATIONS: { value: Anim["preset"] | "none"; label: string; disabled?: boolean }[] = [
  { value: "none", label: "无" },
  { value: "fade", label: "淡入" },
  { value: "fade-up", label: "上浮淡入" },
  { value: "pop", label: "弹出" },
  { value: "typewriter", label: "打字机" },
];

type CaptionAnimationPreset = {
  label: string;
  note: string;
  animation: Pick<TextStyle["animation"], "in" | "unit" | "stagger" | "inSlot">;
};

export const CAPTION_ANIMATION_PRESETS: CaptionAnimationPreset[] = [
  {
    label: "默认模板逐词短淡入",
    note: "逐词出现，前快后慢；淡入 300 毫秒。",
    animation: {
      in: { preset: "fade", durationMs: 300, easing: "ease-out" },
      unit: "word",
      stagger: { fraction: 0.75 },
      inSlot: 0.6,
    },
  },
  {
    label: "跟随语音",
    note: "字幕含 charStartMs 时跟随真实发音；否则按句长平均。",
    animation: {
      in: { preset: "fade", durationMs: 220, easing: "ease-out" },
      unit: "word",
      stagger: "spread",
      inSlot: 0.8,
    },
  },
  {
    label: "整行淡入",
    note: "整行同时淡入 200 毫秒。",
    animation: {
      in: { preset: "fade", durationMs: 200, easing: "ease-out" },
      unit: "line",
      stagger: "spread",
      inSlot: null,
    },
  },
];

export const CAPTION_MOTION_CHOICES: {
  id: string;
  label: string;
  enabled: boolean;
  animation: Record<string, unknown> | null;
}[] = [
  { id: "none", label: "无", enabled: true, animation: { in: null } },
  {
    id: "word-fade",
    label: "逐词淡入",
    enabled: true,
    animation: CAPTION_ANIMATION_PRESETS[0]?.animation ?? null,
  },
  {
    id: "speech",
    label: "跟随语音",
    enabled: true,
    animation: CAPTION_ANIMATION_PRESETS[1]?.animation ?? null,
  },
  {
    id: "line-fade",
    label: "整行淡入",
    enabled: true,
    animation: CAPTION_ANIMATION_PRESETS[2]?.animation ?? null,
  },
  {
    id: "fade",
    label: "淡入",
    enabled: true,
    animation: { in: { preset: "fade", durationMs: 300, easing: "ease-out" } },
  },
  {
    id: "slide",
    label: "滑入",
    enabled: true,
    animation: { in: { preset: "slide", durationMs: 300, easing: "ease-out" } },
  },
  {
    id: "blur",
    label: "模糊",
    enabled: true,
    animation: { in: { preset: "blur-in", durationMs: 300, easing: "ease-out" } },
  },
  {
    id: "zoom",
    label: "缩放",
    enabled: true,
    animation: { in: { preset: "zoom-in", durationMs: 300, easing: "ease-out" } },
  },
  {
    id: "bounce",
    label: "弹跳",
    enabled: true,
    animation: { in: { preset: "bounce", durationMs: 300, easing: "ease-out" } },
  },
  { id: "spin", label: "旋转入场", enabled: false, animation: null },
  { id: "path", label: "路径动画", enabled: false, animation: null },
];

/** 未实现的动效返回 null，调用方不得提交。 */
export function motionChoicePatch(id: string): { animation: Record<string, unknown> } | null {
  const choice = CAPTION_MOTION_CHOICES.find((item) => item.id === id);
  if (!choice?.enabled || !choice.animation) return null;
  return { animation: choice.animation };
}

export function animationOptionsFor(currentPreset: Anim["preset"] | null) {
  if (currentPreset !== "color-sweep") return ANIMATIONS;
  return [
    ...ANIMATIONS,
    { value: "color-sweep" as const, label: "颜色扫过（旧值，已停用）", disabled: true },
  ];
}

const ANIM_UNITS = [
  { value: "char", label: "逐字" },
  { value: "word", label: "逐词" },
  { value: "line", label: "整行" },
] as const;

type TextStylePage = "home" | "text" | "layout" | "animation" | "advanced";
type TextStyleSubpage = Exclude<TextStylePage, "home">;
type AdvancedEffect = "stroke" | "box" | "shadow" | "glow" | "gradient";

const TEXT_STYLE_PAGES: { id: TextStyleSubpage; label: string }[] = [
  { id: "text", label: "字体与文字" },
  { id: "layout", label: "位置与排列" },
  { id: "animation", label: "动画" },
  { id: "advanced", label: "高级外观" },
];

const ADVANCED_EFFECTS: { id: AdvancedEffect; label: string }[] = [
  { id: "stroke", label: "描边" },
  { id: "box", label: "背景框" },
  { id: "shadow", label: "阴影" },
  { id: "glow", label: "发光" },
  { id: "gradient", label: "渐变" },
];

function textStylePageLabel(page: TextStylePage): string {
  return TEXT_STYLE_PAGES.find((entry) => entry.id === page)?.label ?? "样式设置";
}

function advancedEffectLabel(effect: AdvancedEffect): string {
  return ADVANCED_EFFECTS.find((entry) => entry.id === effect)?.label ?? "高级外观";
}

function advancedEffectEnabled(style: TextStyle, effect: AdvancedEffect): boolean {
  switch (effect) {
    case "stroke":
      return style.stroke !== null;
    case "box":
      return style.box !== null;
    case "shadow":
      return style.shadow !== null;
    case "glow":
      return style.glow !== null;
    case "gradient":
      return style.gradient !== null;
  }
}

function textStylePageSummary(page: TextStyleSubpage, style: TextStyle): string {
  const summaries: Record<TextStyleSubpage, string> = {
    text: `${style.font.size}px · ${FONT_FAMILIES[style.font.family]?.css ?? style.font.family}`,
    layout: `${style.layout.align} · ${style.layout.maxWidth}px 宽`,
    animation: `${style.animation.in?.preset ?? "无入场动画"} · ${style.animation.unit}`,
    advanced:
      [
        style.stroke && "描边",
        style.box && "背景",
        style.shadow && "阴影",
        style.glow && "发光",
        style.gradient && "渐变",
      ]
        .filter(Boolean)
        .join("、") || "描边、背景、阴影等",
  };
  return summaries[page];
}

/** 1029 样片的首批预设：只列这条样片用到的两套，其他动画先不往这里放 */
const PRESETS: { id: string; label: string; note: string; caption: boolean; title: boolean }[] = [
  {
    id: "caption-word-yellow",
    label: "默认模板字幕",
    note: "白字黑边，当前词柠檬黄，逐词短淡入",
    caption: true,
    title: false,
  },
  {
    id: "title-bar-yellow",
    label: "默认模板标题",
    note: "金黄、重黑边，静态不加入场",
    caption: false,
    title: true,
  },
];

export function TextStyleEditor({
  project,
  id,
  ref_,
  fallback,
  showHighlight = false,
  elementLabel,
  section,
  content,
  catalog,
}: TextStyleEditorProps) {
  const [page, setPage] = useState<"home" | "text" | "layout" | "animation" | "advanced">("home");
  const [advancedEffect, setAdvancedEffect] = useState<AdvancedEffect | null>(null);
  const activeStyleId = effectiveStyleId(project, id, fallback);
  const builtins = builtinStyles(project.canvas);
  const style =
    project.styles[activeStyleId] ??
    builtins[activeStyleId] ??
    builtins[fallback] ??
    builtins["caption-word-yellow"]!;
  const locked = ref_.track.locked;
  const [target, setTarget] = useState<StyleScope | "all" | "titles">("item");
  const captionTargets = captionStyleTargets(project);
  const titleTargets = titleStyleTargets(project);
  const isOverlay = ref_.track.kind === "overlay";
  const family = FONT_FAMILIES[style.font.family] ?? FONT_FAMILIES["alibaba-puhuiti-3"]!;
  const weights = [...new Set([...Object.keys(family.faces).map(Number), style.font.weight])].sort(
    (a, b) => a - b,
  );
  const animIn = style.animation.in;
  const [motionPhase, setMotionPhase] = useState<"in" | "out">("in");
  const [fontQuery, setFontQuery] = useState("");
  const storeCatalog = useStore((s) => s.fontCatalog);
  const fontCatalog = catalog ?? storeCatalog;
  const tl = useStore((s) => s.preview?.timeline);
  const fps = tl?.fps ?? 30;
  const range = tl ? itemFrames(tl, id) : null;
  const duration = Math.max(1, Math.min(range ? range.to - range.from : 60, 300));
  const isCaption = ref_.track.kind === "caption";
  const previewText = textForPreview(ref_);
  const previewHighlights =
    "highlights" in ref_.item ? ((ref_.item as Caption).highlights ?? []) : [];
  const presets = PRESETS.filter((p) => (isCaption ? p.caption : p.title));
  const fonts = fontChoices(FONT_FAMILIES, fontCatalog, {
    family: style.font.family,
    weight: style.font.weight,
  });
  const visibleFonts = fonts.filter((font) => {
    const q = fontQuery.trim().toLowerCase();
    return (
      !q ||
      font.family.toLowerCase().includes(q) ||
      font.group.toLowerCase().includes(q) ||
      font.value.toLowerCase().includes(q)
    );
  });

  useEffect(() => {
    setTarget("item");
    setPage("home");
    setAdvancedEffect(null);
    setFontQuery("");
  }, [id, section]);

  const commitStyle = (patch: Record<string, unknown>, label?: string) => {
    if (target === "all" || target === "titles") {
      const st = useStore.getState();
      if (!st.project) return;
      try {
        const planned =
          target === "all"
            ? allCaptionStyleOps(st.project, patch, fallback)
            : allTitleStyleOps(st.project, patch, fallback);
        if (planned.ops.length === 0) {
          st.toast(
            target === "all"
              ? `没有可改的字幕，跳过锁定 ${planned.skipped} 句`
              : `没有可改的标题，跳过锁定 ${planned.skipped} 个`,
          );
          return;
        }
        void st.submit(
          planned.ops,
          label ??
            (target === "all"
              ? `已改 ${planned.count} 句字幕，跳过锁定 ${planned.skipped} 句`
              : `已改 ${planned.count} 个标题，跳过锁定 ${planned.skipped} 个`),
        );
      } catch (e) {
        st.toast(e instanceof Error ? e.message : String(e), "error");
      }
      return;
    }
    editStyle(id, patch, target, fallback, label);
  };

  const update = (patch: Record<string, unknown>) => commitStyle(patch);

  const chooseFont = (value: string) => {
    const next = fonts.find((font) => font.value === value);
    if (!next) return;
    const available = next.weights.sort((a, b) => a - b);
    const weight = available.includes(style.font.weight)
      ? style.font.weight
      : available.reduce(
          (best, w) =>
            Math.abs(w - style.font.weight) < Math.abs(best - style.font.weight) ? w : best,
          available[0] ?? style.font.weight,
        );
    update({ font: { family: value, weight } });
  };

  const applyPreset = (presetId: string, label: string) => {
    const preset = builtins[presetId];
    if (!preset) return;
    commitStyle(preset as unknown as Record<string, unknown>, `已套用「${label}」`);
  };

  const saveAsTemplate = async () => {
    const st = useStore.getState();
    const requested = window.prompt("模板名称", styleTemplateId(activeStyleId))?.trim();
    if (!requested) return;

    try {
      const library = await st.api.libraryStyles();
      const builtin = library.styles.some((entry) => entry.builtin && entry.name === requested);
      const as = builtin ? `${requested}-mine` : requested;
      const send = (overwrite: boolean) =>
        st.api.saveLibraryStyle({ style: activeStyleId, as, overwrite });
      try {
        await send(false);
      } catch (e) {
        if (!(e instanceof ApiFailure && e.code === "DUPLICATE_ID")) throw e;
        if (!window.confirm(`模板库里已经有「${as}」，覆盖它吗？`)) return;
        await send(true);
      }
      st.toast(`已把当前样式存为模板「${as}」`);
    } catch (e) {
      st.toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const setAnimation = (value: string) => {
    if (value === "none") {
      update({ animation: { in: null } });
      return;
    }
    update({
      animation: {
        in: {
          preset: value as Anim["preset"],
          durationMs: animIn?.durationMs ?? 300,
          easing: animIn?.easing ?? "ease-out",
          ...(animIn?.direction ? { direction: animIn.direction } : {}),
          ...(animIn?.intensity ? { intensity: animIn.intensity } : {}),
        },
      },
    });
  };

  if (section === "motion") {
    const active = style.animation[motionPhase];
    const specialized =
      motionPhase === "in"
        ? CAPTION_MOTION_CHOICES.find((choice) => {
            const animation = choice.animation;
            const incoming = animation?.in as Partial<Anim> | undefined;
            return (
              animation?.unit !== undefined &&
              incoming?.preset === active?.preset &&
              incoming?.durationMs === active?.durationMs &&
              animation.unit === style.animation.unit &&
              animation.inSlot === style.animation.inSlot &&
              JSON.stringify(animation.stagger) === JSON.stringify(style.animation.stagger)
            );
          })?.id
        : undefined;
    return (
      <div className="text-style-editor design-motion-editor">
        <div className="design-motion-tabs" role="tablist" aria-label="动效阶段">
          {(
            [
              ["in", "入场"],
              ["out", "出场"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={motionPhase === value}
              className={motionPhase === value ? "on" : undefined}
              onClick={() => setMotionPhase(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="design-motion-grid">
          {CAPTION_MOTION_CHOICES.filter(
            (choice) =>
              motionPhase === "in" || !["word-fade", "speech", "line-fade"].includes(choice.id),
          ).map((choice) => {
            const patch = motionChoicePatch(choice.id);
            const animation = patch?.animation;
            const preset =
              animation?.in && typeof animation.in === "object" && "preset" in animation.in
                ? animation.in.preset
                : null;
            const selected = specialized
              ? choice.id === specialized
              : (choice.id === "none" && !active) ||
                (choice.id !== "none" &&
                  preset === active?.preset &&
                  !["word-fade", "speech", "line-fade"].includes(choice.id));
            return (
              <button
                key={choice.id}
                type="button"
                disabled={locked || !choice.enabled}
                className={selected ? "on" : undefined}
                aria-pressed={selected}
                title={!choice.enabled ? "暂不支持" : choice.label}
                onClick={() => {
                  if (!animation) return;
                  update(
                    motionPhase === "in" ? { animation } : { animation: { out: animation.in } },
                  );
                }}
              >
                <span className={choice.id === "none" ? "design-motion-none" : undefined}>
                  {choice.id === "none" ? <Icon name="close" size={24} /> : "Aa"}
                </span>
                <small>
                  {motionPhase === "out"
                    ? choice.label
                        .replace("淡入", "淡出")
                        .replace("滑入", "滑出")
                        .replace("入场", "出场")
                    : choice.label}
                </small>
              </button>
            );
          })}
        </div>
        <NumberControl
          label="动画时长（毫秒）"
          value={active?.durationMs ?? 300}
          min={1}
          max={10000}
          step={50}
          slider
          disabled={locked || !active}
          onCommit={(durationMs) => update({ animation: { [motionPhase]: { durationMs } } })}
        />
        {isCaption && !(ref_.item as Caption).charStartMs?.length && (
          <p className="hint">按句长估算</p>
        )}
      </div>
    );
  }

  return (
    <div className="text-style-editor">
      {section ? (
        <Field label="修改范围">
          <div className="design-scope-options" role="radiogroup" aria-label="样式修改范围">
            {(
              [
                ["item", `仅当前${elementLabel}`],
                ["shared", `同样式${elementLabel}`],
                ...(isCaption ? [["all", "全部字幕"]] : isOverlay ? [["titles", "全部标题"]] : []),
              ] as const
            ).map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name={`style-scope-${id}-${section}`}
                  checked={target === value}
                  disabled={locked}
                  onChange={() => setTarget(value as StyleScope | "all" | "titles")}
                />
                {label}
              </label>
            ))}
          </div>
        </Field>
      ) : (
        <Field label="修改范围">
          <select
            className="select"
            value={target}
            disabled={locked}
            aria-label="样式修改范围"
            onChange={(e) => setTarget(e.target.value as StyleScope | "all" | "titles")}
          >
            <option value="item">仅当前{elementLabel}</option>
            <option value="shared">应用到所有用这个样式的</option>
            {isCaption && (
              <option value="all">
                全部字幕（{captionTargets.count} 句，跳过锁定 {captionTargets.skipped}）
              </option>
            )}
            {isOverlay && (
              <option value="titles">
                全部标题（{titleTargets.count} 个，跳过锁定 {titleTargets.skipped}）
              </option>
            )}
          </select>
        </Field>
      )}
      {content}

      {!section && page !== "home" && (
        <div className="text-style-subhead">
          <button
            type="button"
            className="text-style-back"
            onClick={() =>
              page === "advanced" && advancedEffect ? setAdvancedEffect(null) : setPage("home")
            }
          >
            <Icon name="prev" size={14} />
            {page === "advanced" && advancedEffect ? "返回高级外观" : "返回文字样式"}
          </button>
          <h3>
            {page === "advanced" && advancedEffect
              ? advancedEffectLabel(advancedEffect)
              : textStylePageLabel(page)}
          </h3>
        </div>
      )}

      {!section && page === "home" && (
        <>
          <TextPreview
            text={previewText}
            style={style}
            highlights={previewHighlights}
            durationInFrames={duration}
            fps={fps}
            canvasWidth={project.canvas.width}
            canvasHeight={project.canvas.height}
            label={elementLabel}
          />
          {presets.length > 0 && (
            <Field label="常用预设" note="默认模板样式">
              <div className="preset-row">
                {presets.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="preset-chip"
                    disabled={locked}
                    onClick={() => applyPreset(p.id, p.label)}
                  >
                    <b>{p.label}</b>
                    <span>{p.note}</span>
                  </button>
                ))}
              </div>
            </Field>
          )}
          <Field label="样式设置">
            <div className="text-style-nav">
              {TEXT_STYLE_PAGES.map((entry) => (
                <button key={entry.id} type="button" onClick={() => setPage(entry.id)}>
                  <span>
                    <b>{entry.label}</b>
                    <small>{textStylePageSummary(entry.id, style)}</small>
                  </span>
                  <Icon name="next" size={14} />
                </button>
              ))}
            </div>
          </Field>
          <Field label="模板">
            <button type="button" className="mini-btn" disabled={locked} onClick={saveAsTemplate}>
              存为模板
            </button>
          </Field>
        </>
      )}

      {(section === "edit" || (!section && page === "text")) && (
        <Field label="字体" note={section ? undefined : `${visibleFonts.length} 个`}>
          {section ? (
            <select
              className="select"
              aria-label="字体"
              value={style.font.family}
              disabled={locked}
              onChange={(e) => chooseFont(e.currentTarget.value)}
            >
              {fonts.map((font) => (
                <option key={`${font.source}:${font.value}`} value={font.value}>
                  {font.family}
                </option>
              ))}
            </select>
          ) : (
            <>
              <label className="search">
                <input
                  type="search"
                  value={fontQuery}
                  placeholder="搜索字体名称或分组"
                  aria-label="搜索字体"
                  onChange={(e) => setFontQuery(e.currentTarget.value)}
                />
              </label>
              <div className="font-list">
                {visibleFonts.map((font) => (
                  <button
                    key={`${font.source}:${font.value}`}
                    type="button"
                    className={style.font.family === font.value ? "font-option on" : "font-option"}
                    disabled={locked}
                    aria-pressed={style.font.family === font.value}
                    onClick={() => chooseFont(font.value)}
                  >
                    <span>{font.family}</span>
                  </button>
                ))}
              </div>
              {visibleFonts.length === 0 && <p className="hint style-empty">没有匹配的字体</p>}
            </>
          )}
        </Field>
      )}

      {(section === "edit" || (!section && page === "text")) && (
        <div className="insp-grid">
          <NumberControl
            label="字号"
            slider={section === "edit"}
            parameterSlider
            value={style.font.size}
            min={1}
            max={400}
            disabled={locked}
            onCommit={(size) => update({ font: { size } })}
          />
          <NumberControl
            label="字间距"
            value={style.font.letterSpacing}
            disabled={locked}
            onCommit={(letterSpacing) => update({ font: { letterSpacing } })}
          />
          <NumberControl
            label="行间距"
            value={style.font.lineHeight}
            min={0.5}
            step={0.05}
            disabled={locked}
            onCommit={(lineHeight) => update({ font: { lineHeight } })}
          />
          <label className="insp-control">
            <span>字重</span>
            <select
              className="select font-weight-select"
              value={style.font.weight}
              disabled={locked}
              onChange={(e) => update({ font: { weight: Number(e.currentTarget.value) } })}
            >
              {weights.map((weight) => (
                <option key={weight} value={weight}>
                  {weight}
                </option>
              ))}
            </select>
          </label>
          {section === "edit" && (
            <div className="design-format-row">
              <span>样式</span>
              <div>
                <button
                  type="button"
                  aria-label="粗体"
                  className={style.font.weight >= 600 ? "mini-btn on" : "mini-btn"}
                  disabled={locked}
                  aria-pressed={style.font.weight >= 600}
                  onClick={() => update({ font: { weight: style.font.weight >= 600 ? 400 : 700 } })}
                >
                  B
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  aria-label="下划线"
                  disabled={locked || !underlineEditable(style)}
                  title={underlineEditable(style) ? "下划线" : "当前样式未支持下划线"}
                  onClick={() =>
                    style.highlight &&
                    update({
                      highlight: {
                        underline: style.highlight.underline
                          ? null
                          : { color: style.highlight.fill, thickness: 0.08 },
                      },
                    })
                  }
                >
                  <u>U</u>
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  disabled
                  title="暂不支持斜体"
                  aria-label="斜体"
                >
                  <i>I</i>
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  disabled
                  title="暂不支持删除线"
                  aria-label="删除线"
                >
                  <s>S</s>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {(section === "edit" || (!section && page === "text")) && (
        <div className="insp-grid">
          <ColorControl
            label="填充色"
            value={style.fill}
            disabled={locked}
            onCommit={(fill) => update({ fill })}
          />
          {showHighlight && !section && (
            <ColorControl
              label="高亮色"
              value={style.highlight?.fill ?? "#FFD400"}
              disabled={locked}
              onCommit={(fill) => update({ highlight: { fill } })}
            />
          )}
        </div>
      )}

      {(section === "edit" || (!section && page === "layout")) && (
        <Field label={section ? "对齐方式" : "位置与排列"}>
          <div className="insp-grid">
            {!section && (
              <>
                <NumberControl
                  label="X"
                  value={style.layout.x}
                  disabled={locked}
                  onCommit={(x) => update({ layout: { x } })}
                />
                <NumberControl
                  label="Y"
                  value={style.layout.y}
                  disabled={locked}
                  onCommit={(y) => update({ layout: { y } })}
                />
                <NumberControl
                  label="最大宽度"
                  value={style.layout.maxWidth}
                  min={1}
                  disabled={locked}
                  onCommit={(maxWidth) => update({ layout: { maxWidth } })}
                />
              </>
            )}
            <label className="insp-control">
              <span>对齐</span>
              <select
                className="select"
                value={style.layout.align}
                disabled={locked}
                onChange={(e) => update({ layout: { align: e.currentTarget.value } })}
              >
                <option value="left">左对齐</option>
                <option value="center">居中</option>
                <option value="right">右对齐</option>
              </select>
            </label>
          </div>
        </Field>
      )}

      {!section && page === "animation" && (
        <Field label="入场动画">
          <select
            className="select"
            value={animIn?.preset ?? "none"}
            disabled={locked}
            onChange={(e) => setAnimation(e.currentTarget.value)}
          >
            {animationOptionsFor(animIn?.preset ?? null).map((a) => (
              <option key={a.value} value={a.value} disabled={a.disabled}>
                {a.label}
              </option>
            ))}
          </select>
          {isCaption && !section && (
            <>
              <p className="hint">快捷选项只改动画参数，不会更改字体、颜色、位置或高亮。</p>
              <div className="preset-row">
                {CAPTION_ANIMATION_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="preset-chip"
                    disabled={locked}
                    onClick={() => update({ animation: preset.animation })}
                  >
                    <b>{preset.label}</b>
                    <span>{preset.note}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </Field>
      )}

      {!section && page === "animation" && (
        <div className="insp-grid">
          <label className="insp-control">
            <span>出现单位</span>
            <select
              className="select"
              value={style.animation.unit}
              disabled={locked}
              onChange={(e) => update({ animation: { unit: e.currentTarget.value } })}
            >
              {ANIM_UNITS.map((unit) => (
                <option key={unit.value} value={unit.value}>
                  {unit.label}
                </option>
              ))}
            </select>
          </label>
          <NumberControl
            label="入场时长（毫秒）"
            value={animIn?.durationMs ?? 300}
            min={1}
            max={10_000}
            step={50}
            disabled={locked || animIn === null}
            onCommit={(durationMs) => update({ animation: { in: { durationMs } } })}
          />
        </div>
      )}

      {(section === "style" || (!section && page === "advanced")) &&
        (section !== "style" && advancedEffect === null ? (
          <div className="text-style-nav" aria-label="高级外观设置">
            {ADVANCED_EFFECTS.map((effect) => (
              <button key={effect.id} type="button" onClick={() => setAdvancedEffect(effect.id)}>
                <span>
                  <b>{effect.label}</b>
                  <small>{advancedEffectEnabled(style, effect.id) ? "已启用" : "未启用"}</small>
                </span>
                <Icon name="next" size={14} />
              </button>
            ))}
          </div>
        ) : (
          <div className="advanced-effect-editor">
            {section === "style" && (
              <OptionalEffect label="混合" enabled={false} disabled unavailable onToggle={() => {}}>
                <NumberControl
                  label="不透明度"
                  value={100}
                  min={0}
                  max={100}
                  disabled
                  onCommit={() => {}}
                />
              </OptionalEffect>
            )}

            {(section === "style" || advancedEffect === "stroke") && (
              <OptionalEffect
                label="描边"
                showHeading={section === "style"}
                enabled={style.stroke !== null}
                disabled={locked}
                onToggle={(enabled) =>
                  update({ stroke: enabled ? { color: "#000000", width: 4 } : null })
                }
              >
                {style.stroke && (
                  <>
                    <ColorControl
                      label="颜色"
                      value={style.stroke.color}
                      disabled={locked}
                      onCommit={(color) => update({ stroke: { color } })}
                    />
                    <NumberControl
                      label="粗细"
                      value={style.stroke.width}
                      min={0}
                      max={40}
                      step={0.5}
                      disabled={locked}
                      onCommit={(width) => update({ stroke: { width } })}
                    />
                  </>
                )}
              </OptionalEffect>
            )}

            {(section === "style" || advancedEffect === "shadow") && (
              <OptionalEffect
                label="阴影"
                showHeading={section === "style"}
                enabled={style.shadow !== null}
                disabled={locked}
                onToggle={(enabled) =>
                  update({
                    shadow: enabled ? { color: "#00000080", blur: 6, x: 0, y: 2 } : null,
                  })
                }
              >
                {style.shadow && (
                  <>
                    <ColorControl
                      label="颜色"
                      value={style.shadow.color}
                      disabled={locked}
                      onCommit={(color) => update({ shadow: { color } })}
                    />
                    <NumberControl
                      label="模糊"
                      value={style.shadow.blur}
                      min={0}
                      disabled={locked}
                      onCommit={(blur) => update({ shadow: { blur } })}
                    />
                    <NumberControl
                      label="X 偏移"
                      value={style.shadow.x}
                      disabled={locked}
                      onCommit={(x) => update({ shadow: { x } })}
                    />
                    <NumberControl
                      label="Y 偏移"
                      value={style.shadow.y}
                      disabled={locked}
                      onCommit={(y) => update({ shadow: { y } })}
                    />
                  </>
                )}
              </OptionalEffect>
            )}

            {(section === "style" || advancedEffect === "box") && (
              <OptionalEffect
                label="背景框"
                showHeading={section === "style"}
                enabled={style.box !== null}
                disabled={locked}
                onToggle={(enabled) =>
                  update({
                    box: enabled ? { color: "#000000AA", radius: 12, padding: [8, 16] } : null,
                  })
                }
              >
                {style.box && (
                  <>
                    <ColorControl
                      label="颜色"
                      value={style.box.color}
                      disabled={locked}
                      onCommit={(color) => update({ box: { color } })}
                    />
                    <NumberControl
                      label="圆角"
                      value={style.box.radius}
                      min={0}
                      disabled={locked}
                      onCommit={(radius) => update({ box: { radius } })}
                    />
                    <NumberControl
                      label="上下内边距"
                      value={style.box.padding[0]}
                      min={0}
                      disabled={locked}
                      onCommit={(vertical) =>
                        update({ box: { padding: [vertical, style.box?.padding[1] ?? 0] } })
                      }
                    />
                    <NumberControl
                      label="左右内边距"
                      value={style.box.padding[1]}
                      min={0}
                      disabled={locked}
                      onCommit={(horizontal) =>
                        update({ box: { padding: [style.box?.padding[0] ?? 0, horizontal] } })
                      }
                    />
                  </>
                )}
              </OptionalEffect>
            )}

            {(section === "style" || advancedEffect === "glow") && (
              <OptionalEffect
                label="发光"
                showHeading={section === "style"}
                enabled={style.glow !== null}
                disabled={locked}
                onToggle={(enabled) =>
                  update({ glow: enabled ? { color: "#FFD400", blur: 12 } : null })
                }
              >
                {style.glow && (
                  <>
                    <ColorControl
                      label="颜色"
                      value={style.glow.color}
                      disabled={locked}
                      onCommit={(color) => update({ glow: { color } })}
                    />
                    <NumberControl
                      label="强度"
                      value={style.glow.blur}
                      min={0.1}
                      max={100}
                      step={0.5}
                      disabled={locked}
                      onCommit={(blur) => update({ glow: { blur } })}
                    />
                  </>
                )}
              </OptionalEffect>
            )}

            {!section && advancedEffect === "gradient" && (
              <OptionalEffect
                label="渐变"
                showHeading={section === "style"}
                enabled={style.gradient !== null}
                disabled={locked}
                onToggle={(enabled) =>
                  update({ gradient: enabled ? { colors: ["#FFFFFF", "#FFD400"] } : null })
                }
              >
                {style.gradient && (
                  <>
                    {style.gradient.colors.map((color, index) => (
                      <div key={`${index}-${color}`} className="insp-row">
                        <ColorControl
                          label={`颜色 ${index + 1}`}
                          value={color}
                          disabled={locked}
                          onCommit={(next) => {
                            const colors = [...style.gradient!.colors];
                            colors[index] = next;
                            update({ gradient: { colors } });
                          }}
                        />
                        {style.gradient!.colors.length > 2 && (
                          <button
                            type="button"
                            className="mini-btn"
                            disabled={locked}
                            aria-label={`移除颜色 ${index + 1}`}
                            onClick={() => {
                              const colors = style.gradient!.colors.filter((_, i) => i !== index);
                              update({ gradient: { colors } });
                            }}
                          >
                            移除
                          </button>
                        )}
                      </div>
                    ))}
                    {style.gradient.colors.length < 4 && (
                      <button
                        type="button"
                        className="mini-btn"
                        disabled={locked}
                        onClick={() =>
                          update({ gradient: { colors: [...style.gradient!.colors, "#FFFFFF"] } })
                        }
                      >
                        添加颜色
                      </button>
                    )}
                  </>
                )}
              </OptionalEffect>
            )}
          </div>
        ))}
    </div>
  );
}

function OptionalEffect({
  label,
  showHeading = true,
  enabled,
  disabled,
  unavailable = false,
  onToggle,
  children,
}: {
  label: string;
  showHeading?: boolean;
  enabled: boolean;
  disabled: boolean;
  unavailable?: boolean;
  onToggle: (enabled: boolean) => void;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section className="field design-effect">
      <div className="design-effect-head">
        <label className="insp-row insp-toggle">
          <input
            type="checkbox"
            checked={enabled}
            disabled={disabled}
            onChange={(e) => onToggle(e.currentTarget.checked)}
          />
          <strong>{showHeading ? label : "启用"}</strong>
          {disabled && <span className="field-note">{unavailable ? "未支持" : "已锁定"}</span>}
        </label>
        {showHeading && (
          <>
            <button
              type="button"
              className="icon-btn"
              aria-label={`重置${label}`}
              disabled={disabled}
              title={`重置${label}`}
              onClick={() => onToggle(true)}
            >
              <Icon name="reopen" size={15} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={`${collapsed ? "展开" : "折叠"}${label}`}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!collapsed)}
            >
              <Icon
                name="chevronDown"
                size={13}
                style={{ transform: collapsed ? undefined : "rotate(180deg)" }}
              />
            </button>
          </>
        )}
      </div>
      {!collapsed && (enabled || disabled) && (
        <div className="insp-grid insp-effect">{children}</div>
      )}
    </section>
  );
}

function NumberControl({
  label,
  value,
  min,
  max,
  step = 1,
  slider = false,
  parameterSlider = false,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  slider?: boolean;
  parameterSlider?: boolean;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const committed = useRef(value);
  const cancelOnBlur = useRef(false);

  useEffect(() => {
    setDraft(String(value));
    committed.current = value;
  }, [value]);

  const commit = (raw = draft) => {
    const next = Number(raw);
    if (
      raw.trim() === "" ||
      !Number.isFinite(next) ||
      (min !== undefined && next < min) ||
      (max !== undefined && next > max)
    ) {
      setDraft(String(committed.current));
      return;
    }
    if (next === committed.current) return;
    committed.current = next;
    setDraft(String(next));
    onCommit(next);
  };

  return (
    <label className="insp-control">
      <span>{label}</span>
      <div className={slider ? "design-number-slider" : "design-number-only"}>
        {slider && parameterSlider && (
          <ParameterSlider
            min={min ?? 0}
            max={max ?? 100}
            step={step}
            disabled={disabled}
            label={`${label}滑块`}
            value={Number(draft)}
            onChange={(next) => setDraft(String(next))}
            onCommit={(next) => commit(String(next))}
          />
        )}
        {slider && !parameterSlider && (
          <input
            type="range"
            min={min ?? 0}
            max={max ?? 100}
            step={step}
            disabled={disabled}
            aria-label={`${label}滑块`}
            value={Number(draft) || 0}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onPointerUp={() => commit()}
            onKeyUp={() => commit()}
            onBlur={() => commit()}
          />
        )}
        <input
          className="select"
          type="number"
          style={{ width: numberInputWidth(draft) }}
          aria-label={label}
          value={draft}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onFocus={() => {
            cancelOnBlur.current = false;
          }}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={() => {
            if (cancelOnBlur.current) {
              cancelOnBlur.current = false;
              return;
            }
            commit();
          }}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return;
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              cancelOnBlur.current = true;
              setDraft(String(committed.current));
              e.currentTarget.blur();
            }
          }}
        />
      </div>
    </label>
  );
}

function ColorControl({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const committed = useRef(value);

  useEffect(() => {
    draftRef.current = value;
    committed.current = value;
    setDraft(value);
  }, [value]);

  const pickerColor = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(draft)
    ? draft.slice(0, 7)
    : "#000000";
  const alpha = /^#[0-9a-fA-F]{8}$/.test(draft) ? draft.slice(7) : "";
  const commit = () => {
    const next = draftRef.current;
    if (next.toLowerCase() === committed.current.toLowerCase()) return;
    committed.current = next;
    onCommitRef.current(next);
  };
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const input = useRef<HTMLInputElement>(null);

  // React 的 onChange 是拖动中每一下都触发的 input 事件；原生 change 在取色器关上时才触发一次，
  // 这时提交，不用等点别处失焦。切走选中元素时组件卸载，也把没提交的颜色补交上。
  useEffect(() => {
    const el = input.current;
    const onNativeChange = () => commitRef.current();
    el?.addEventListener("change", onNativeChange);
    return () => {
      el?.removeEventListener("change", onNativeChange);
      commitRef.current();
    };
  }, []);

  return (
    <label className="insp-control">
      <span>{label}</span>
      <input
        ref={input}
        type="color"
        value={pickerColor}
        disabled={disabled}
        className="insp-color"
        onChange={(e) => {
          const next = `${e.currentTarget.value}${alpha}`;
          draftRef.current = next;
          setDraft(next);
        }}
        onBlur={commit}
      />
    </label>
  );
}

/** 取当前元素上能看到的一行 / 多行文字，放在真实 TextBlock 里预览 */
function textForPreview(ref_: ItemRef): string {
  const item = ref_.item as Record<string, unknown> & {
    props?: Record<string, unknown>;
  };
  if (typeof item.text === "string" && item.text.trim()) return item.text;
  const props = item.props;
  const lines = props?.lines;
  if (Array.isArray(lines)) {
    const kept = lines.filter((x): x is string => typeof x === "string" && Boolean(x.trim()));
    if (kept.length > 0) return kept.join("\n");
  }
  for (const key of ["title", "body", "name", "text"]) {
    const value = props?.[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "标题这样显示";
}

/**
 * 当前样式的真实文字预览：用和成片相同的 TextBlock，按画布宽度缩放后裁出文字带。
 * 不画整个 9:16 画面，是为了让字体、描边、高亮在右栏里看得清。
 */
function TextPreview({
  text,
  style,
  highlights,
  durationInFrames,
  fps,
  canvasWidth,
  canvasHeight,
  label,
}: {
  text: string;
  style: TextStyle;
  highlights: { text: string; nth?: number }[];
  durationInFrames: number;
  fps: number;
  canvasWidth: number;
  canvasHeight: number;
  label: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(280);
  const max = Math.max(0, durationInFrames - 1);
  const [frame, setFrame] = useState(max);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => setFrame((f) => Math.min(f, max)), [max]);

  // 按当前画布宽度缩放，保留真实的 x / align / maxWidth；只纵向裁一条文字带
  const scale = Math.max(0.01, width / canvasWidth);
  const band = Math.min(600, canvasHeight);
  const focusY = Math.min(
    Math.max(style.layout.y, band / 2),
    Math.max(band / 2, canvasHeight - band / 2),
  );
  const offsetY = (band / 2 - focusY) * scale;

  return (
    <Field label="实际文字预览" note={label}>
      <div className="text-preview-stage" ref={wrap} style={{ height: Math.round(band * scale) }}>
        <div
          className="text-preview-canvas"
          style={{
            width: canvasWidth,
            height: canvasHeight,
            transform: `translateY(${offsetY}px) scale(${scale})`,
          }}
        >
          <TextBlock
            text={text}
            style={style}
            highlights={highlights}
            frame={frame}
            durationInFrames={durationInFrames}
            fps={fps}
          />
        </div>
      </div>
      <label className="text-preview-control">
        <span>预览帧</span>
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={frame}
          aria-label="预览帧"
          onChange={(e) => setFrame(Number(e.currentTarget.value))}
        />
        <span className="mono">{(frame / fps).toFixed(2)}s</span>
      </label>
      <p className="hint">按当前画布宽度和实际位置裁出文字带；完整画面以主预览为准</p>
    </Field>
  );
}
