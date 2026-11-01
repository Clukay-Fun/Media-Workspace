import { describe, expect, it } from "vitest";
import { isImeComposing } from "./common";

describe("isImeComposing 输入法状态判定", () => {
  it("当 nativeEvent.isComposing 为 true 时返回 true", () => {
    const event = {
      nativeEvent: { isComposing: true },
      keyCode: 13,
    } as unknown as React.KeyboardEvent<HTMLInputElement>;
    expect(isImeComposing(event)).toBe(true);
  });

  it("当 keyCode 为 229 时返回 true（输入法组字中的回车等键）", () => {
    const event = {
      nativeEvent: { isComposing: false },
      keyCode: 229,
    } as unknown as React.KeyboardEvent<HTMLInputElement>;
    expect(isImeComposing(event)).toBe(true);
  });

  it("当原生键盘事件处于组字状态时返回 true", () => {
    const event = {
      isComposing: true,
      keyCode: 13,
    } as unknown as KeyboardEvent;
    expect(isImeComposing(event)).toBe(true);
  });

  it("当正常按下回车时返回 false", () => {
    const event = {
      nativeEvent: { isComposing: false },
      keyCode: 13,
    } as unknown as React.KeyboardEvent<HTMLInputElement>;
    expect(isImeComposing(event)).toBe(false);
  });
});
