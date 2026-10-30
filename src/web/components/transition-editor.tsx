import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Transition } from "../../core/schema";
import type { TransitionPair } from "../lib/transitions";
import { defaultTransition } from "../lib/transitions";
import { useStore } from "../store";
import { Icon, type IconName } from "./icons";

type Props = {
  pair: TransitionPair;
  locked: boolean;
  variant: "timeline" | "inspector";
  left?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onOpen?: () => void;
};

type Position = { left: number; top: number };
type Direction = NonNullable<Transition["direction"]>;

const TYPE_LABEL: Record<Transition["type"], string> = {
  fade: "叠化",
  slide: "滑入",
  push: "推开",
};

const DIRECTIONS: { value: Direction; label: string; icon: IconName }[] = [
  { value: "left", label: "向左", icon: "prev" },
  { value: "right", label: "向右", icon: "next" },
  { value: "up", label: "向上", icon: "arrowUp" },
  { value: "down", label: "向下", icon: "arrowDown" },
];

/** 主轨剪辑点和属性面板共用的转场入口与浮层。所有改动仍通过 item.update 提交。 */
export function TransitionEditor({
  pair,
  locked,
  variant,
  left = 0,
  open: controlledOpen,
  onOpenChange,
  onOpen,
}: Props) {
  const current = pair.incoming.transitionIn ?? null;
  const fallback = defaultTransition(pair.maxDurationMs);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : false;
  const [localOpen, setLocalOpen] = useState(false);
  const open = isControlled ? isOpen : localOpen;
  const [typeDraft, setTypeDraft] = useState<Transition["type"]>(current?.type ?? "fade");
  const [durationDraft, setDurationDraft] = useState(
    String(current?.durationMs ?? fallback.durationMs),
  );
  const [directionDraft, setDirectionDraft] = useState<Direction>(current?.direction ?? "left");
  const [showMore, setShowMore] = useState(current !== null && current.type !== "fade");
  const [saving, setSaving] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const durationRef = useRef<HTMLInputElement>(null);

  const close = useCallback(
    (restoreFocus = false) => {
      if (!isControlled) setLocalOpen(false);
      onOpenChange?.(false);
      if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
    },
    [isControlled, onOpenChange],
  );

  const toggle = () => {
    if (locked) return;
    const next = !open;
    if (!isControlled) setLocalOpen(next);
    onOpenChange?.(next);
    if (next) onOpen?.();
  };

  useEffect(() => {
    if (!open) return;
    setTypeDraft(current?.type ?? "fade");
    setDurationDraft(String(current?.durationMs ?? fallback.durationMs));
    setDirectionDraft(current?.direction ?? "left");
    setShowMore(current !== null && current.type !== "fade");
  }, [
    open,
    pair.incoming.id,
    current?.type,
    current?.durationMs,
    current?.direction,
    fallback.durationMs,
  ]);

  useEffect(() => {
    if (!open) return;
    durationRef.current?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (anchorRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      close();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close(true);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", keyboard);
    };
  }, [open, close]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const update = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const popover = popoverRef.current?.getBoundingClientRect();
      if (!anchor || !popover) return;

      const margin = 12;
      const gap = 8;
      const maxLeft = Math.max(margin, window.innerWidth - popover.width - margin);
      const left = Math.max(
        margin,
        Math.min(anchor.left + anchor.width / 2 - popover.width / 2, maxLeft),
      );
      const below = anchor.bottom + gap;
      const above = anchor.top - gap - popover.height;
      const maxTop = Math.max(margin, window.innerHeight - popover.height - margin);
      const preferredTop = below + popover.height <= window.innerHeight - margin ? below : above;
      const top = Math.max(margin, Math.min(preferredTop, maxTop));
      setPosition((previous) =>
        previous && Math.abs(previous.left - left) < 0.5 && Math.abs(previous.top - top) < 0.5
          ? previous
          : { left, top },
      );
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const observer = popoverRef.current ? new ResizeObserver(update) : null;
    if (observer && popoverRef.current) observer.observe(popoverRef.current);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      observer?.disconnect();
    };
  }, [open, showMore, typeDraft]);

  const requestedDuration = Number(durationDraft);
  const validDuration =
    durationDraft.trim() !== "" && Number.isFinite(requestedDuration) && requestedDuration >= 1;
  const maxDuration = Math.max(pair.maxDurationMs, current?.durationMs ?? 0);
  const nextDuration = validDuration
    ? Math.max(1, Math.min(maxDuration, Math.round(requestedDuration)))
    : null;
  const nextTransition: Transition | null =
    nextDuration === null
      ? null
      : {
          type: typeDraft,
          durationMs: nextDuration,
          ...(typeDraft === "fade" ? {} : { direction: directionDraft }),
        };
  const unchanged =
    current !== null &&
    nextTransition !== null &&
    current.type === nextTransition.type &&
    current.durationMs === nextTransition.durationMs &&
    (current.type === "fade" || (current.direction ?? "left") === directionDraft);
  const formatTransition = (transition: Transition) =>
    `${TYPE_LABEL[transition.type]} · ${transition.durationMs}ms`;

  const apply = () => {
    if (locked || saving || !nextTransition || unchanged) return;
    setSaving(true);
    const label = current
      ? `转场已改为「${formatTransition(nextTransition)}」`
      : `已添加「${formatTransition(nextTransition)}」转场`;
    void useStore
      .getState()
      .submit(
        [{ op: "item.update", id: pair.incoming.id, set: { transitionIn: nextTransition } }],
        label,
      )
      .then((ok) => {
        setSaving(false);
        if (ok) close(true);
      });
  };

  const remove = () => {
    if (locked || saving || !current) return;
    setSaving(true);
    void useStore
      .getState()
      .submit(
        [{ op: "item.update", id: pair.incoming.id, set: { transitionIn: null } }],
        "已移除转场",
      )
      .then((ok) => {
        setSaving(false);
        if (ok) close(true);
      });
  };

  const triggerLabel = current ? formatTransition(current) : "添加转场";
  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className={[
        "transition-trigger",
        `transition-trigger--${variant}`,
        current ? "has-transition" : "no-transition",
        open ? "is-open" : "",
      ].join(" ")}
      aria-label={
        current
          ? `编辑转场：${triggerLabel}`
          : `在 ${pair.outgoing.id} 和 ${pair.incoming.id} 之间添加转场`
      }
      aria-haspopup="dialog"
      aria-expanded={open}
      title={triggerLabel}
      disabled={locked}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={toggle}
    >
      {variant === "timeline" ? (
        <Icon name={current ? "transition" : "add"} size={14} />
      ) : (
        <>
          <span className="transition-trigger-label">
            <Icon name={current ? "transition" : "add"} size={14} />
            {triggerLabel}
          </span>
          <Icon name="settings" size={13} />
        </>
      )}
    </button>
  );

  const popover = open ? (
    <div
      ref={popoverRef}
      className="transition-popover"
      data-positioned={position ? "true" : undefined}
      style={position ? { left: position.left, top: position.top } : undefined}
      role="dialog"
      aria-label="设置转场"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header className="transition-popover-head">
        <div>
          <strong>转场</strong>
          <span>主视频剪辑点</span>
        </div>
        <button
          type="button"
          className="icon-btn ghost"
          aria-label="关闭转场设置"
          onClick={() => close(true)}
        >
          <Icon name="close" size={13} />
        </button>
      </header>

      <div className="transition-primary-row">
        <div className="transition-type-group" role="radiogroup" aria-label="转场类型">
          <button
            type="button"
            role="radio"
            aria-checked={typeDraft === "fade"}
            className={typeDraft === "fade" ? "transition-choice on" : "transition-choice"}
            disabled={locked || saving}
            onClick={() => {
              setTypeDraft("fade");
              setShowMore(false);
            }}
          >
            <Icon name="transition" size={14} />
            叠化
          </button>
        </div>
        <label className="transition-duration">
          <span>时长</span>
          <span className="transition-duration-input">
            <input
              ref={durationRef}
              type="number"
              min={1}
              max={maxDuration}
              step={10}
              value={durationDraft}
              disabled={locked || saving}
              aria-label="转场时长（毫秒）"
              onChange={(event) => setDurationDraft(event.currentTarget.value)}
              onBlur={() => {
                if (!validDuration || requestedDuration <= 0)
                  setDurationDraft(String(current?.durationMs ?? fallback.durationMs));
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  apply();
                }
              }}
            />
            <span>ms</span>
          </span>
        </label>
      </div>

      <button
        type="button"
        className="transition-more"
        aria-expanded={showMore}
        onClick={() => setShowMore((value) => !value)}
      >
        <span>更多转场</span>
        <Icon name={showMore ? "prev" : "next"} size={12} />
      </button>

      {showMore && (
        <div className="transition-more-options">
          <div className="transition-type-group" role="radiogroup" aria-label="更多转场类型">
            {(["slide", "push"] as const).map((type) => (
              <button
                type="button"
                role="radio"
                aria-checked={typeDraft === type}
                className={typeDraft === type ? "transition-choice on" : "transition-choice"}
                key={type}
                disabled={locked || saving}
                onClick={() => setTypeDraft(type)}
              >
                <Icon name="transition" size={14} />
                {TYPE_LABEL[type]}
              </button>
            ))}
          </div>
          {(typeDraft === "slide" || typeDraft === "push") && (
            <div className="transition-direction-row">
              <span>方向</span>
              <div className="transition-directions" role="radiogroup" aria-label="转场方向">
                {DIRECTIONS.map((direction) => (
                  <button
                    type="button"
                    role="radio"
                    aria-label={direction.label}
                    aria-checked={directionDraft === direction.value}
                    className={
                      directionDraft === direction.value
                        ? "transition-direction on"
                        : "transition-direction"
                    }
                    key={direction.value}
                    disabled={locked || saving}
                    onClick={() => setDirectionDraft(direction.value)}
                  >
                    <Icon name={direction.icon} size={13} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <footer className="transition-popover-actions">
        {current ? (
          <button
            type="button"
            className="transition-remove"
            disabled={locked || saving}
            onClick={remove}
          >
            移除转场
          </button>
        ) : (
          <span className="transition-empty-note">默认叠化 · {fallback.durationMs}ms</span>
        )}
        <button
          type="button"
          className="mini-btn primary transition-apply"
          disabled={locked || saving || !nextTransition || unchanged}
          onClick={apply}
        >
          {saving ? "保存中…" : current ? "应用" : typeDraft === "fade" ? "添加叠化" : "添加转场"}
        </button>
      </footer>
    </div>
  ) : null;

  return (
    <div
      ref={anchorRef}
      className={`transition-control transition-control--${variant}`}
      style={variant === "timeline" ? { left } : undefined}
    >
      {trigger}
      {popover && typeof document !== "undefined" ? createPortal(popover, document.body) : null}
    </div>
  );
}
