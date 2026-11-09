// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParameterSlider } from "./parameter-slider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const host = document.createElement("div");
let root: ReturnType<typeof createRoot> | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  host.remove();
});

function renderSlider(
  initial: number,
  min: number,
  max: number,
  committed: (value: number) => void,
) {
  document.body.appendChild(host);
  root = createRoot(host);
  function Example() {
    const [value, setValue] = useState(initial);
    return (
      <ParameterSlider
        label="速度滑块"
        value={value}
        min={min}
        max={max}
        step={0.05}
        disabled={false}
        onChange={setValue}
        onCommit={committed}
      />
    );
  }
  return act(async () => root?.render(<Example />));
}

describe("属性滑杆", () => {
  it("旧值超出滑杆范围时只夹显示位置，聚焦离开不提交", async () => {
    const committed = vi.fn();
    await renderSlider(15, 0.5, 2, committed);
    const thumb = host.querySelector<HTMLInputElement>('input[aria-label="速度滑块"]');
    expect(thumb?.getAttribute("aria-valuenow")).toBe("2");
    await act(async () => {
      thumb?.focus();
      thumb?.blur();
    });
    expect(committed).not.toHaveBeenCalled();
  });

  it("键盘调整后只提交新数值", async () => {
    const committed = vi.fn();
    await renderSlider(1, 0.5, 2, committed);
    const thumb = host.querySelector<HTMLInputElement>('input[aria-label="速度滑块"]');
    await act(async () => {
      thumb?.focus();
      thumb?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(thumb?.getAttribute("aria-valuenow")).toBe("1.05");
    expect(committed).toHaveBeenCalledTimes(1);
    expect(committed).toHaveBeenCalledWith(1.05);
  });
});
