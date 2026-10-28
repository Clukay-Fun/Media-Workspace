// 验证 spike 输出：
// 1. 音频：和剪映导出的成片做响度包络相关，找出最佳偏移（理想为 0ms）
// 2. 画面：输出第 N 帧应该等于标准化原片的第 78 + round(N * 1.1) 帧
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const dir = resolve("fixtures/out/1029");
const out = resolve(dir, "spike-a0-2.mp4");
const ref = resolve(process.env.HOME ?? "", "Desktop/1029/剪辑后.mp4");
const mez = resolve(dir, "cache/raw.mez.mp4");

const R = 16000;
const H = 80;
const env = (f: string) => {
  const b = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", f, "-vn", "-ac", "1", "-ar", String(R), "-f", "f32le", "-"],
    { maxBuffer: 1 << 30 },
  );
  const x = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  return Float64Array.from({ length: Math.floor(x.length / H) }, (_, k) => {
    let s = 0;
    for (let i = k * H; i < (k + 1) * H; i++) s += (x[i] ?? 0) ** 2;
    return Math.log10(Math.sqrt(s / H) + 1e-4);
  });
};
const a = env(out);
const b = env(ref);
const corr = (shift: number) => {
  const n = Math.round(26900 / 5);
  let ma = 0,
    mb = 0;
  for (let k = 60; k < n; k++) {
    ma += a[k] ?? 0;
    mb += b[k + shift] ?? 0;
  }
  ma /= n - 60;
  mb /= n - 60;
  let d = 0,
    x = 0,
    y = 0;
  for (let k = 60; k < n; k++) {
    const p = (a[k] ?? 0) - ma,
      q = (b[k + shift] ?? 0) - mb;
    d += p * q;
    x += p * p;
    y += q * q;
  }
  return d / Math.sqrt(x * y);
};
let best = { shift: 0, c: -2 };
for (let s = -60; s <= 60; s++) {
  const c = corr(s);
  if (c > best.c) best = { shift: s, c };
}
console.log(
  `音频：最佳偏移 ${best.shift * 5}ms，相关系数 ${best.c.toFixed(3)}（偏移 0 时 ${corr(0).toFixed(3)}）`,
);

const psnrOf = (n1: number, n2: number) => {
  try {
    const out2 = execFileSync(
      "sh",
      [
        "-c",
        `ffmpeg -v info -i "${out}" -i "${mez}" -lavfi "[0:v]select=eq(n\\,${n1}),setpts=PTS-STARTPTS[a];[1:v]select=eq(n\\,${n2}),setpts=PTS-STARTPTS[b];[a][b]psnr" -frames:v 1 -f null - 2>&1`,
      ],
      { encoding: "utf8" },
    );
    return Number(/average:([\d.]+|inf)/.exec(out2)?.[1] ?? "nan");
  } catch {
    return Number.NaN;
  }
};
for (const n of [0, 100, 400, 700, 805]) {
  const expected = 78 + Math.round(n * 1.1);
  const scores = [-2, -1, 0, 1, 2].map((d) => ({ d, p: psnrOf(n, expected + d) }));
  const top = scores.reduce((x, y) => (y.p > x.p ? y : x));
  console.log(
    `画面：输出第 ${n} 帧 → 原片预期第 ${expected} 帧，最匹配偏差 ${top.d} 帧（PSNR ${scores.map((s) => `${s.d}:${s.p.toFixed(1)}`).join(" ")}）`,
  );
}
