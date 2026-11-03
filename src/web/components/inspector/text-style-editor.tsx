import { useEffect, useRef, useState } from "react";
import { TextBlock } from "../../../composition/TextBlock";
import { builtinStyles } from "../../../core/aspect";
import { FONT_FAMILIES } from "../../../core/fonts";
import type { Caption, Project } from "../../../core/schema";
import { effectiveStyleId, type StyleScope } from "../../../core/style-scope";
import type { Anim, TextStyle } from "../../../core/text-style";
import { ApiFailure } from "../../data/client";
import type { ItemRef } from "../../lib/project";
import { itemFrames } from "../../lib/timeline";
import { useStore } from "../../store";
import { editStyle, Field, isImeComposing } from "./common";

type TextStyleEditorProps = {
  project: Project;
  id: string;
  ref_: ItemRef;
  fallback: string;
  showHighlight?: boolean;
  elementLabel: string;
};

const ANIMATIONS: { value: Anim["preset"] | "none"; label: string }[] = [
  { value: "none", label: "无" },
  { value: "fade", label: "淡入" },
  { value: "fade-up", label: "上浮淡入" },
  { value: "pop", label: "弹出" },
  { value: "typewriter", label: "打字机" },
  { value: "color-sweep", label: "颜色扫过" },
];

const ANIM_UNITS = [
  { value: "char", label: "逐字" },
  { value: "word", label: "逐词" },
  { value: "line", label: "整行" },
] as const;

/** 1029 样片的首批预设：只列这条样片用到的两套，其他动画先不往这里放 */
const PRESETS: { id: string; label: string; note: string; caption: boolean; title: boolean }[] = [
  {
    id: "caption-word-yellow",
    label: "1029 字幕",
    note: "白字黑边，当前词柠檬黄，逐词短淡入",
    caption: true,
    title: false,
  },
  {
    id: "title-bar-yellow",
    label: "1029 标题",
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
}: TextStyleEditorProps) {
  const activeStyleId = effectiveStyleId(project, id, fallback);
  const builtins = builtinStyles(project.canvas);
  const style =
    project.styles[activeStyleId] ??
    builtins[activeStyleId] ??
    builtins[fallback] ??
    builtins["caption-word-yellow"]!;
  const locked = ref_.track.locked;
  const [scope, setScope] = useState<StyleScope>("item");
  const family = FONT_FAMILIES[style.font.family] ?? FONT_FAMILIES["alibaba-puhuiti-3"]!;
  const weights = [...new Set([...Object.keys(family.faces).map(Number), style.font.weight])].sort(
    (a, b) => a - b,
  );
  const animIn = style.animation.in;
  const [fontQuery, setFontQuery] = useState("");
  const tl = useStore((s) => s.preview?.timeline);
  const fps = tl?.fps ?? 30;
  const range = tl ? itemFrames(tl, id) : null;
  const duration = Math.max(1, Math.min(range ? range.to - range.from : 60, 300));
  const isCaption = ref_.track.kind === "caption";
  const template = "template" in ref_.item ? String(ref_.item.template) : "";
  const isTitle = template === "title-bar";
  const previewText = textForPreview(ref_);
  const previewHighlights =
    "highlights" in ref_.item ? ((ref_.item as Caption).highlights ?? []) : [];
  const presets = PRESETS.filter((p) => (isCaption ? p.caption : p.title));
  const fonts = Object.entries(FONT_FAMILIES).filter(([fid, font]) => {
    const q = fontQuery.trim().toLowerCase();
    return (
      !q ||
      font.css.toLowerCase().includes(q) ||
      font.group.toLowerCase().includes(q) ||
      fid.toLowerCase().includes(q)
    );
  });

  useEffect(() => setScope("item"), [id, activeStyleId]);

  const chooseFont = (fid: string) => {
    const next = FONT_FAMILIES[fid];
    if (!next) return;
    const available = Object.keys(next.faces)
      .map(Number)
      .sort((a, b) => a - b);
    const weight = available.includes(style.font.weight)
      ? style.font.weight
      : available.reduce(
          (best, w) =>
            Math.abs(w - style.font.weight) < Math.abs(best - style.font.weight) ? w : best,
          available[0] ?? style.font.weight,
        );
    update({ font: { family: fid, weight } });
  };

  const applyPreset = (presetId: string) => {
    const preset = builtins[presetId];
    if (!preset) return;
    editStyle(
      id,
      preset as unknown as Record<string, unknown>,
      scope,
      fallback,
      `已套用「${presetId}」`,
    );
  };

  const update = (patch: Record<string, unknown>) => editStyle(id, patch, scope, fallback);

  const saveAsTemplate = async () => {
    const st = useStore.getState();
    const requested = window.prompt("模板名称", activeStyleId)?.trim();
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

  return (
    <div className="text-style-editor">
      <Field label="修改范围">
        <select
          className="select"
          value={scope}
          disabled={locked}
          aria-label="样式修改范围"
          onChange={(e) => setScope(e.target.value as StyleScope)}
        >
          <option value="item">仅当前{elementLabel}</option>
          <option value="shared">应用到所有用这个样式的</option>
        </select>
        <p className="hint">
          {scope === "item"
            ? `后续调整只影响当前${elementLabel}`
            : "后续调整会同步到使用当前样式的所有元素"}
        </p>
      </Field>

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
        <Field label="常用预设" note="1029 样片">
          <div className="preset-row">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                className="preset-chip"
                disabled={locked}
                onClick={() => applyPreset(p.id)}
              >
                <b>{p.label}</b>
                <span>{p.note}</span>
              </button>
            ))}
          </div>
        </Field>
      )}

      <Field label="模板">
        <button type="button" className="mini-btn" disabled={locked} onClick={saveAsTemplate}>
          存为模板
        </button>
      </Field>

      <Field label="字体" note={`${fonts.length} 个`}>
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
          {fonts.map(([fid, font]) => (
            <button
              key={fid}
              type="button"
              className={style.font.family === fid ? "font-option on" : "font-option"}
              disabled={locked}
              aria-pressed={style.font.family === fid}
              onClick={() => chooseFont(fid)}
            >
              <span>{font.css}</span>
              <small>{font.group}</small>
            </button>
          ))}
        </div>
      </Field>

      <div className="insp-grid">
        <NumberControl
          label="字号"
          value={style.font.size}
          min={1}
          max={400}
          disabled={locked}
          onCommit={(size) => update({ font: { size } })}
        />
        <label className="insp-control">
          <span>字重</span>
          <select
            className="select"
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
      </div>

      <div className="insp-grid">
        <ColorControl
          label="填充色"
          value={style.fill}
          disabled={locked}
          onCommit={(fill) => update({ fill })}
        />
        {showHighlight && (
          <ColorControl
            label="高亮色"
            value={style.highlight?.fill ?? "#FFD400"}
            disabled={locked}
            onCommit={(fill) => update({ highlight: { fill } })}
          />
        )}
      </div>

      <Field label="位置">
        <div className="insp-grid">
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

      <Field label="入场动画">
        <select
          className="select"
          value={animIn?.preset ?? "none"}
          disabled={locked}
          onChange={(e) => setAnimation(e.currentTarget.value)}
        >
          {ANIMATIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </Field>

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

      <details className="style-more">
        <summary>更多</summary>
        <div className="style-more-body">
          <OptionalEffect
            label="描边"
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

          <OptionalEffect
            label="阴影"
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

          <OptionalEffect
            label="背景框"
            enabled={style.box !== null}
            disabled={locked}
            onToggle={(enabled) =>
              update({ box: enabled ? { color: "#000000AA", radius: 12, padding: [8, 16] } : null })
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

          <OptionalEffect
            label="发光"
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

          <OptionalEffect
            label="渐变"
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
        </div>
      </details>
    </div>
  );
}

function OptionalEffect({
  label,
  enabled,
  disabled,
  onToggle,
  children,
}: {
  label: string;
  enabled: boolean;
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <section className="field">
      <h3>{label}</h3>
      <label className="insp-row insp-toggle">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(e) => onToggle(e.currentTarget.checked)}
        />
        启用
      </label>
      {enabled && <div className="insp-grid insp-effect">{children}</div>}
    </section>
  );
}

function NumberControl({
  label,
  value,
  min,
  max,
  step = 1,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
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

  const commit = () => {
    const next = Number(draft);
    if (
      draft.trim() === "" ||
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
      <input
        className="select"
        type="number"
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
