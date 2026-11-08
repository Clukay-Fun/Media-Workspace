import type React from "react";
import { useState } from "react";
import type { Comment } from "../../core/review";
import { frameOfMs, msOfFrame, timecode } from "../lib/timeline";
import { useStore } from "../store";
import { Icon } from "./icons";

export type PlayerComment = Pick<Comment, "id" | "text" | "status" | "atMs" | "target">;

/** 进度条比例换成时间线帧。右端是最后一帧，不会 seek 到 duration 之外。 */
export function frameAtRatio(ratio: number, durationInFrames: number): number {
  const total = Math.max(1, Math.floor(durationInFrames));
  const last = total - 1;
  if (!Number.isFinite(ratio)) return 0;
  const clamped = Math.min(1, Math.max(0, ratio));
  return Math.min(last, Math.max(0, Math.round(clamped * last)));
}

/** 批注在进度条上的位置，和 seek 用同一套帧换算。 */
export function markerLeftPercent(atMs: number, fps: number, durationInFrames: number): number {
  const last = Math.max(1, Math.max(1, Math.floor(durationInFrames)) - 1);
  const frame = frameOfMs(atMs, fps);
  return Math.min(100, Math.max(0, (frame / last) * 100));
}

function ratioFromClientX(el: HTMLElement, clientX: number): number {
  const rect = el.getBoundingClientRect();
  if (!(rect.width > 0)) return 0;
  return (clientX - rect.left) / rect.width;
}

function isTimedOpen(comment: PlayerComment): comment is PlayerComment & { atMs: number } {
  return comment.status === "open" && comment.atMs !== undefined;
}

function Glyph({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlayerChromeV7({
  frame,
  fps,
  total,
  width,
  height,
  playing,
  loop,
  comments,
  onLoopChange,
  onFullscreen,
}: {
  frame: number;
  fps: number;
  total: number;
  width: number;
  height: number;
  playing: boolean;
  loop: boolean;
  comments: PlayerComment[];
  onLoopChange: (loop: boolean) => void;
  onFullscreen: () => void;
}) {
  const [composer, setComposer] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ frame: number; x: number; y: number } | null>(null);
  const markers = comments.filter(isTimedOpen);
  const opened = markers.find((comment) => comment.id === openId);
  const last = Math.max(1, total - 1);
  const played = Math.min(100, Math.max(0, (Math.min(frame, last) / last) * 100));

  const seekAt = (el: HTMLElement, clientX: number) => {
    useStore.getState().seek(frameAtRatio(ratioFromClientX(el, clientX), total));
  };

  const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    seekAt(e.currentTarget, e.clientX);
  };

  const onTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    seekAt(e.currentTarget, e.clientX);
  };

  const onTrackContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const next = frameAtRatio(ratioFromClientX(e.currentTarget, e.clientX), total);
    useStore.getState().seek(next);
    setMenu({ frame: next, x: e.clientX, y: e.clientY });
  };

  const splitHere = () => {
    if (!menu) return;
    const st = useStore.getState();
    st.seek(menu.frame);
    void st.splitAtPlayhead();
    setMenu(null);
  };

  const submitComment = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    const saved = await useStore.getState().addComment({ text, atMs: msOfFrame(frame, fps) });
    setBusy(false);
    if (!saved) return;
    setDraft("");
    setComposer(false);
  };

  return (
    <footer className="mw-player-chrome" aria-label="播放器控制">
      <div className="mw-player-track-wrap">
        <div
          className="mw-player-track"
          role="slider"
          tabIndex={0}
          aria-label="播放进度"
          aria-valuemin={0}
          aria-valuemax={last}
          aria-valuenow={Math.min(frame, last)}
          aria-valuetext={timecode(frame, fps)}
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
          onContextMenu={onTrackContextMenu}
        >
          <div className="mw-player-track-base">
            <div className="mw-player-track-played" style={{ width: `${played}%` }} />
          </div>
          <div className="mw-player-thumb" style={{ left: `${played}%` }} />
        </div>
        <div className="mw-player-markers">
          {markers.map((comment) => (
            <button
              key={comment.id}
              type="button"
              className={comment.id === openId ? "mw-player-marker is-on" : "mw-player-marker"}
              style={{ left: `${markerLeftPercent(comment.atMs, fps, total)}%` }}
              title={comment.text}
              aria-label={`批注 ${comment.id} ${timecode(frameOfMs(comment.atMs, fps), fps)}`}
              onClick={() => {
                const st = useStore.getState();
                st.seek(frameOfMs(comment.atMs, fps));
                if (comment.target) st.select(comment.target, { reveal: false });
                st.setSideTab("comments");
                setComposer(false);
                setOpenId(comment.id);
              }}
            />
          ))}
        </div>
      </div>
      <div className="mw-player-controls">
        <div className="mw-player-controls-side">
          <button
            type="button"
            className="mw-player-icon play"
            aria-label={playing ? "暂停" : "播放"}
            title={playing ? "暂停（空格）" : "播放（空格）"}
            onClick={() => useStore.getState().setPlaying(!playing)}
          >
            <Icon name={playing ? "pause" : "play"} size={16} />
          </button>
          <button
            type="button"
            className={loop ? "mw-player-icon is-on" : "mw-player-icon"}
            aria-label="循环播放"
            aria-pressed={loop}
            title="循环播放"
            onClick={() => onLoopChange(!loop)}
          >
            <Glyph d="M3 10V7a4 4 0 0 1 4-4h13m0 0-4-3m4 3-4 3M21 14v3a4 4 0 0 1-4 4H4m0 0 4-3m-4 3 4 3" />
          </button>
        </div>
        <div className="mw-player-time mono">
          {timecode(frame, fps)}
          <span> / {timecode(Math.max(0, total - 1), fps)}</span>
        </div>
        <div className="mw-player-controls-side end">
          <button
            type="button"
            className="mw-player-icon pin"
            aria-label="添加批注"
            title="在当前时间添加批注"
            onClick={() => {
              useStore.getState().setPlaying(false);
              setOpenId(null);
              setMenu(null);
              setComposer(true);
            }}
          >
            <Glyph d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
          </button>
          <span className="mw-player-resolution mono" aria-label={`画布 ${width}×${height}`}>
            {width}×{height}
          </span>
          <button
            type="button"
            className="mw-player-icon"
            aria-label="全屏"
            title="全屏"
            onClick={onFullscreen}
          >
            <Glyph d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />
          </button>
        </div>
      </div>
      {composer && (
        <form
          className="mw-player-note"
          aria-label="添加批注"
          onSubmit={(e) => void submitComment(e)}
        >
          <div className="mw-player-note-head">
            <span>添加批注 · {timecode(frame, fps)}</span>
            <button type="button" aria-label="关闭" onClick={() => setComposer(false)}>
              <Icon name="close" size={12} />
            </button>
          </div>
          <textarea
            aria-label="批注内容"
            value={draft}
            placeholder="输入批注内容…"
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              e.stopPropagation();
              setComposer(false);
            }}
          />
          <button type="submit" disabled={!draft.trim() || busy}>
            添加批注
          </button>
        </form>
      )}
      {opened && (
        <div className="mw-player-note detail" role="dialog" aria-label="批注">
          <div className="mw-player-note-head">
            <span className="mono">{timecode(frameOfMs(opened.atMs, fps), fps)}</span>
            <button type="button" aria-label="关闭批注" onClick={() => setOpenId(null)}>
              <Icon name="close" size={12} />
            </button>
          </div>
          <p>{opened.text}</p>
        </div>
      )}
      {menu && (
        <>
          <button
            type="button"
            className="mw-player-menu-backdrop"
            aria-label="关闭菜单"
            onClick={() => setMenu(null)}
          />
          <div className="mw-player-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
            <button type="button" role="menuitem" onClick={splitHere}>
              在此分割
            </button>
          </div>
        </>
      )}
    </footer>
  );
}
