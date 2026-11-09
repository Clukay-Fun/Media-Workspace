import type { Layout } from "../../core/layout";
import { useStore } from "../store";

// 账号版式保留人脸位置、倍速和字幕字数；旧版参考线数据只为兼容读取。
const pct = (v: number) => Math.round(v * 1000) / 10;

/** 编辑账号版式：浮在预览区右上角的卡片。 */
export function LayoutEditorCard() {
  const layout = useStore((s) => s.layout);
  const { setLayoutEditing, saveLayout } = useStore.getState();
  const base: Layout = layout ?? {
    version: 1,
    guides: [],
    face: null,
    titleStyle: null,
    captionStyle: null,
    captionMaxChars: null,
    speed: 1,
    savedAt: "",
  };
  const setFace = (k: "cx" | "top" | "bottom", v: number) => {
    const face = base.face ?? { cx: 0.5, top: 0.36, bottom: 0.5 };
    void saveLayout({ ...base, face: { ...face, [k]: v } });
  };

  return (
    <section className="layout-card" aria-label="账号版式">
      <header className="layout-card-head">
        <strong>账号版式</strong>
        <button type="button" className="layout-done" onClick={() => setLayoutEditing(false)}>
          完成
        </button>
      </header>
      <div className="layout-fields">
        <p className="layout-hint">
          所有工程共用，AI 出片按它摆人物、定倍速和字幕字数。人脸位置用占画面的百分比填写。
        </p>
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
        <strong>字幕字数</strong>
        <p className="layout-hint">
          AI 识音出字幕时一条最多几个字，比一行长时折成两行；空着 = 按字幕样式每条一行
        </p>
        <div className="layout-row">
          <span className="layout-axis">每条</span>
          <span className="pct-input">
            <input
              key={base.captionMaxChars ?? "auto"}
              aria-label="一条字幕最多几个字"
              type="number"
              min={4}
              max={40}
              step={1}
              placeholder="自动"
              defaultValue={base.captionMaxChars ?? ""}
              onBlur={(e) => {
                const raw = e.currentTarget.value.trim();
                const v = raw === "" ? null : Math.round(Number(raw));
                if (v !== null && !(v >= 4 && v <= 40)) return;
                if (v !== base.captionMaxChars) void saveLayout({ ...base, captionMaxChars: v });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
            字
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
    </section>
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
