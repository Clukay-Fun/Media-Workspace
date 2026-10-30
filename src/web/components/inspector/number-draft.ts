import { type KeyboardEvent, useEffect, useRef, useState } from "react";

/**
 * 数值输入框的草稿状态：回车 / 失焦时由调用方决定提交什么。
 * Esc 和清空都不提交，直接恢复原值。
 * 为什么用 ref 记 Esc：blur 是同步触发的，setState 还没生效，onBlur 读到的仍是刚输入的值。
 */
export function useNumberDraft(value: number) {
  const [draft, setDraft] = useState(String(value));
  const cancelled = useRef(false);

  useEffect(() => {
    setDraft(String(value));
    cancelled.current = false;
  }, [value]);

  const change = (raw: string) => {
    cancelled.current = false;
    setDraft(raw);
  };

  /** 返回解析后的数字；Esc、空输入、非数字返回 null（此时已经恢复原值） */
  const parse = (raw: string): number | null => {
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(String(value));
      return null;
    }
    if (raw.trim() === "") {
      setDraft(String(value));
      return null;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      setDraft(String(value));
      return null;
    }
    return n;
  };

  const keyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      cancelled.current = true;
      setDraft(String(value));
      e.currentTarget.blur();
    }
  };

  return { draft, setDraft, change, parse, keyDown };
}
