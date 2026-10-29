import type React from "react";

// 线性图标，16px 网格、1.5 描边，颜色跟随文字

const paths = {
  play: "M5 3.5v9l7.5-4.5z",
  pause: "M5 3.5v9M11 3.5v9",
  undo: "M5.5 4 2.5 7l3 3M2.5 7h7a4 4 0 0 1 0 8H8",
  redo: "M10.5 4l3 3-3 3M13.5 7h-7a4 4 0 0 0 0 8H8",
  export: "M8 10V2.5M5 5.5l3-3 3 3M3 9.5v3a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3",
  lock: "M4.5 7.5h7a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zM5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2",
  unlock:
    "M4.5 7.5h7a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zM5.5 7.5V5.5a2.5 2.5 0 0 1 4.8-1",
  eye: "M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  eyeOff:
    "M2.5 2.5l11 11M6.6 4A6.6 6.6 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.8 2.3M4.3 5.2A11 11 0 0 0 1.5 8S4 12.5 8 12.5a6 6 0 0 0 2.5-.5",
  volume: "M2.5 6v4h2.5l3.5 3V3L5 6zM11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4",
  mute: "M2.5 6v4h2.5l3.5 3V3L5 6zM11 6l3 4M14 6l-3 4",
  comment: "M2.5 3.5h11v7.5H7L4 13.5V11H2.5z",
  warn: "M8 2.5l6 10.5H2zM8 6.5v3M8 11.2v.3",
  spark: "M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.8 1.8M10.2 10.2 12 12M12 4l-1.8 1.8M5.8 10.2 4 12",
  film: "M2.5 3h11v10h-11zM5 3v10M11 3v10M2.5 6H5M2.5 10H5M11 6h2.5M11 10h2.5",
  image: "M2.5 3h11v10h-11zM2.5 11l3.5-3.5 3 3 2-2 2.5 2.5M10.5 6a1 1 0 1 0 0-.01",
  text: "M3 4V3h10v1M8 3v10M6 13h4",
  title: "M2.5 4.5h11v4h-11zM4.5 11h7",
  check: "M3 8.5l3 3 7-7",
  close: "M4 4l8 8M12 4l-8 8",
  safe: "M2.5 4.5V2.5h2M11.5 2.5h2v2M13.5 11.5v2h-2M4.5 13.5h-2v-2M5.5 6h5v4h-5z",
  prev: "M10 3.5 5.5 8l4.5 4.5",
  next: "M6 3.5 10.5 8 6 12.5",
  target: "M8 2v2.5M8 11.5V14M2 8h2.5M11.5 8H14M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  back: "M8.5 3.5 4 8l4.5 4.5M13 3.5 8.5 8l4.5 4.5",
  forward: "M7.5 3.5 12 8l-4.5 4.5M3 3.5 7.5 8 3 12.5",
  split: "M8 1.5v13M5 4.5 2.5 8 5 11.5M11 4.5 13.5 8 11 11.5",
  search: "M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM10.6 10.6 14 14",
  list: "M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01",
  magnet: "M3.5 2.5v6a4.5 4.5 0 0 0 9 0v-6h-3v6a1.5 1.5 0 0 1-3 0v-6zM3.5 5.5h3M9.5 5.5h3",
  reopen: "M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.5H5",
} as const;

export type IconName = keyof typeof paths;

export function Icon({
  name,
  size = 16,
  ...rest
}: { name: IconName; size?: number } & React.SVGProps<SVGSVGElement>) {
  const filled = name === "play";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  );
}
