import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { basename, extname, resolve, sep } from "node:path";

// 本地媒体文件服务：渲染器（无头 Chrome）和网页预览都通过 HTTP 读取媒体。
// 必须支持 Range（视频拖动、解码器按需读取）和 CORS（@remotion/media 用 fetch 读取）。

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff2": "font/woff2",
};

export type MediaServer = {
  baseUrl: string;
  /** 把根目录下的文件路径转换成 URL */
  urlFor: (absPath: string) => string;
  /** 登记任意位置的单个文件（例如用户的原始图片、字体），返回它的 URL。只有登记过的文件能被访问 */
  register: (absPath: string) => string;
  close: () => Promise<void>;
};

export async function startMediaServer(root: string | null, port = 0): Promise<MediaServer> {
  const rootDir = root ? resolve(root) : null;
  const registered = new Map<string, string>();
  const server: Server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Range");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    let file = registered.get(pathname);
    if (!file) {
      // 不允许访问根目录以外的文件
      const candidate = rootDir ? resolve(rootDir, `.${pathname}`) : null;
      if (
        !rootDir ||
        !candidate ||
        (candidate !== rootDir && !candidate.startsWith(rootDir + sep))
      ) {
        res.writeHead(403).end();
        return;
      }
      file = candidate;
    }
    let size: number;
    try {
      const st = statSync(file);
      if (!st.isFile()) throw new Error("not a file");
      size = st.size;
    } catch {
      res.writeHead(404).end();
      return;
    }
    const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (range) {
      const first = range[1] ? Number(range[1]) : null;
      const last = range[2] ? Number(range[2]) : null;
      const start = first ?? Math.max(0, size - (last ?? 0));
      const end = first !== null && last !== null ? Math.min(last, size - 1) : size - 1;
      if (
        size === 0 ||
        (first === null && (!last || !Number.isSafeInteger(last))) ||
        (first !== null && !Number.isSafeInteger(first)) ||
        (last !== null && !Number.isSafeInteger(last)) ||
        start > end ||
        start >= size
      ) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
        return;
      }
      res.writeHead(206, {
        "Content-Type": type,
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
      });
      if (req.method === "HEAD") return void res.end();
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
    if (req.method === "HEAD") return void res.end();
    createReadStream(file).pipe(res);
  });

  await new Promise<void>((ok) => server.listen(port, "127.0.0.1", ok));
  const { port: actual } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${actual}`;
  return {
    baseUrl,
    register: (absPath) => {
      const abs = resolve(absPath);
      const key = `/f/${createHash("sha1").update(abs).digest("hex").slice(0, 12)}/${basename(abs)}`;
      registered.set(key, abs);
      return `${baseUrl}${key.split("/").map(encodeURIComponent).join("/")}`;
    },
    urlFor: (absPath) => {
      if (!rootDir) throw new Error("媒体服务没有设置根目录");
      const rel = resolve(absPath)
        .slice(rootDir.length)
        .split(sep)
        .map(encodeURIComponent)
        .join("/");
      return `${baseUrl}${rel}`;
    },
    close: () => new Promise((ok) => server.close(() => ok())),
  };
}
