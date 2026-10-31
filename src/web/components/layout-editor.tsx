import { useRef, useState } from "react";
import type { Layout, LayoutGuide } from "../../core/layout";
import { useStore } from "../store";

// 账号版式（docs/decisions/0027）：画面上的参考线和人脸位置，所有工程共用。
// 编辑时参考线可以拖动，松手保存；面板里改名字、精确数值、增删参考线和人脸位置。

const pct = (v: number) => Math.round(v * 1000) / 10;

/** 画面上的账号参考线；编辑时可以拖，并显示人脸该落在哪 */
export function AccountGuides({ width, height }: { width: number; height: number }) {
  const layout = useStore((s) => s.layout);
  const show = useStore((s) => s.accountGuides);
  const editing = useStore((s) => s.layoutEditing);
  const [moving, setMoving] = useState<{ id: string; pos: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  if (!layout || !show) return null;

  const posOf = (g: LayoutGuide) => (moving?.id === g.id ? moving.pos : g.pos);
  const fromPointer = (g: LayoutGuide, e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return g.pos;
    const v = g.axis === "h" ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    return Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
  };
  const face = layout.face;

  return (
    <div ref={box} className={editing ? "account-guides editing" : "account-guides"}>
      {layout.guides.map((g) => (
        <div
          key={g.id}
          className={`account-guide ${g.axis}`}
          style={g.axis === "h" ? { top: `${posOf(g) * 100}%` } : { left: `${posOf(g) * 100}%` }}
          title={editing ? `${g.label || g.id}：拖动调整` : g.label}
          onPointerDown={(e) => {
            if (!editing) return;
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            setMoving({ id: g.id, pos: g.pos });
          }}
          onPointerMove={(e) => {
            if (moving?.id !== g.id) return;
            e.stopPropagation();
            setMoving({ id: g.id, pos: fromPointer(g, e) });
          }}
          onPointerUp={(e) => {
            if (moving?.id !== g.id) return;
            e.stopPropagation();
            const pos = fromPointer(g, e);
            setMoving(null);
            if (pos !== g.pos)
              void saveGuides(layout, (gs) => gs.map((x) => (x.id === g.id ? { ...x, pos } : x)));
          }}
        >
          {g.label ? <span>{g.label}</span> : null}
        </div>
      ))}
      {editing && face ? (
        <div
          className="face-target"
          style={{
            top: `${face.top * 100}%`,
            height: `${(face.bottom - face.top) * 100}%`,
            // 人脸框大致是 3:4，宽度只用来示意
            width: `${(((face.bottom - face.top) * height * 0.78) / width) * 100}%`,
            left: `${face.cx * 100}%`,
          }}
        >
          <span>人脸</span>
        </div>
      ) : null}
    </div>
  );
}

function saveGuides(layout: Layout, f: (gs: LayoutGuide[]) => LayoutGuide[]) {
  return useStore.getState().saveLayout({ ...layout, guides: f(layout.guides) });
}

/** 预览设置里的账号版式面板 */
export function LayoutPanel() {
  const layout = useStore((s) => s.layout);
  const show = useStore((s) => s.accountGuides);
  const editing = useStore((s) => s.layoutEditing);
  const { toggleAccountGuides, setLayoutEditing, saveLayout } = useStore.getState();
  const base: Layout = layout ?? {
    version: 1,
    guides: [],
    face: null,
    titleStyle: null,
    captionStyle: null,
    speed: 1,
    savedAt: "",
  };
  const add = (axis: "h" | "v") => {
    let n = base.guides.length + 1;
    while (base.guides.some((g) => g.id === `g${n}`)) n++;
    void saveLayout({
      ...base,
      guides: [...base.guides, { id: `g${n}`, axis, pos: 0.5, label: "" }],
    });
  };
  const setFace = (k: "cx" | "top" | "bottom", v: number) => {
    const face = base.face ?? { cx: 0.5, top: 0.36, bottom: 0.5 };
    void saveLayout({ ...base, face: { ...face, [k]: v } });
  };

  return (
    <div className="layout-panel">
      <label className="preview-setting">
        <input
          type="checkbox"
          aria-label="账号参考线"
          checked={show}
          onChange={toggleAccountGuides}
        />
        <span>账号参考线</span>
      </label>
      <label className="preview-setting">
        <input
          type="checkbox"
          aria-label="编辑账号版式"
          checked={editing}
          onChange={() => setLayoutEditing(!editing)}
        />
        <span>编辑账号版式</span>
      </label>
      {editing ? (
        <div className="layout-fields">
          <p className="layout-hint">
            所有工程共用；拖画面上的线，或改下面的数值（占画面的百分比）
          </p>
          {base.guides.map((g) => (
            <div key={g.id} className="layout-row">
              <span className="layout-axis">{g.axis === "h" ? "横" : "竖"}</span>
              <input
                aria-label={`${g.id} 名字`}
                defaultValue={g.label}
                placeholder="名字"
                maxLength={20}
                onBlur={(e) => {
                  const label = e.currentTarget.value.trim();
                  if (label !== g.label)
                    void saveGuides(base, (gs) =>
                      gs.map((x) => (x.id === g.id ? { ...x, label } : x)),
                    );
                }}
              />
              <PctInput
                label={`${g.id} 位置`}
                value={g.pos}
                onChange={(pos) =>
                  void saveGuides(base, (gs) => gs.map((x) => (x.id === g.id ? { ...x, pos } : x)))
                }
              />
              <button
                type="button"
                className="icon-btn"
                aria-label={`删除 ${g.label || g.id}`}
                onClick={() => void saveGuides(base, (gs) => gs.filter((x) => x.id !== g.id))}
              >
                ×
              </button>
            </div>
          ))}
          <div className="layout-actions">
            <button type="button" onClick={() => add("h")}>
              加横线
            </button>
            <button type="button" onClick={() => add("v")}>
              加竖线
            </button>
          </div>
          <strong>口播倍速</strong>
          <p className="layout-hint">AI 出片时主轨默认用这个倍速（整体加速，不剪句中停顿）</p>
          <div className="layout-row">
            <span className="layout-axis">倍速</span>
            <span className="pct-input">
              <input
                key={base.speed}
                aria-label="口播倍速"
                type="number"
                min={0.5}
                max={2}
                step={0.05}
                defaultValue={base.speed}
                onBlur={(e) => {
                  const v = Number(e.currentTarget.value);
                  if (Number.isFinite(v) && v >= 0.5 && v <= 2 && v !== base.speed)
                    void saveLayout({ ...base, speed: v });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
              ×
            </span>
          </div>
          <strong>人脸位置</strong>
          <p className="layout-hint">mw frame 按它摆人物：人脸框（不含头发）的中心、上沿、下沿</p>
          {(["cx", "top", "bottom"] as const).map((k) => (
            <div key={k} className="layout-row">
              <span className="layout-axis">
                {k === "cx" ? "中心" : k === "top" ? "上沿" : "下沿"}
              </span>
              <PctInput
                label={`人脸${k}`}
                value={base.face?.[k] ?? { cx: 0.5, top: 0.36, bottom: 0.5 }[k]}
                onChange={(v) => setFace(k, v)}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 百分比输入：显示 0–100，存 0–1；失焦或回车时提交 */
function PctInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <span className="pct-input">
      <input
        key={value}
        aria-label={label}
        type="number"
        min={0}
        max={100}
        step={0.1}
        defaultValue={pct(value)}
        onBlur={(e) => {
          const v = Number(e.currentTarget.value) / 100;
          if (Number.isFinite(v) && v >= 0 && v <= 1 && Math.abs(v - value) > 1e-4) onChange(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      %
    </span>
  );
}
