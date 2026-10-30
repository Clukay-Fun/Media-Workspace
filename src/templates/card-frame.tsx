import type React from "react";
import { AbsoluteFill } from "remotion";
import { ease } from "../core/animate";
import type { Box } from "../core/lint";

// 卡片外框：底板 + 统一的进出场。卡片里的内容按画布坐标排（和 TextBlock 一样），
// 放在 children 里跟着底板一起动。

// 进场和半屏时主画面上移同一段 400ms
const ENTER_MS = 400;
const EXIT_MS = 200;

export type CardFrameProps = {
  box: Box;
  frame: number;
  durationInFrames: number;
  fps: number;
  /** 底板颜色；null = 不画底板（全屏卡常用自己的背景） */
  background?: string | null;
  radius?: number;
  children?: React.ReactNode;
};

export const CardFrame: React.FC<CardFrameProps> = ({
  box,
  frame,
  durationInFrames,
  fps,
  background = "#000000B3",
  radius = 32,
  children,
}) => {
  const ms = (frame * 1000) / fps;
  const left = ((durationInFrames - frame) * 1000) / fps;
  const enter = ease("ease-out", Math.min(1, ms / ENTER_MS));
  const exit = ease("ease-in-out", Math.min(1, left / EXIT_MS));
  const h = box.y1 - box.y0;
  // 从下面一点浮上来，轻微放大；退场只淡出，不抢下一张卡的注意力
  const style: React.CSSProperties = {
    opacity: Math.min(enter, exit),
    transform: `translateY(${(1 - enter) * Math.min(48, h * 0.15)}px) scale(${0.96 + 0.04 * enter})`,
    transformOrigin: `${(box.x0 + box.x1) / 2}px ${(box.y0 + box.y1) / 2}px`,
  };
  return (
    <AbsoluteFill style={style}>
      {background ? (
        <div
          style={{
            position: "absolute",
            left: box.x0,
            top: box.y0,
            width: box.x1 - box.x0,
            height: h,
            background,
            borderRadius: radius,
          }}
        />
      ) : null}
      {children}
    </AbsoluteFill>
  );
};
