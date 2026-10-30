// 下载测试和 CI 用的开源字体 Noto Sans SC（SIL OFL）。测试不能依赖普惠体（AGENTS.md）。
// 用法：pnpm fonts:fetch-test

import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { FONT_FAMILIES } from "../src/core/fonts";

const BASE = "https://github.com/notofonts/noto-cjk/raw/main/Sans/SubsetOTF/SC";
const fam = FONT_FAMILIES["noto-sans-sc"];
if (!fam) throw new Error("字体目录里没有 noto-sans-sc");
const dir = join(import.meta.dirname, "..", "assets", "fonts", fam.dir);
await mkdir(dir, { recursive: true });

for (const file of Object.values(fam.faces)) {
  const out = join(dir, file);
  if (existsSync(out)) {
    console.error(`已存在：${file}`);
    continue;
  }
  console.error(`下载：${file}`);
  const res = await fetch(`${BASE}/${file}`);
  if (!res.ok || !res.body) throw new Error(`下载失败：${file}（HTTP ${res.status}）`);
  await pipeline(
    Readable.fromWeb(res.body as NodeReadableStream<Uint8Array>),
    createWriteStream(`${out}.part`),
  );
  await rename(`${out}.part`, out);
}
console.error("完成");
