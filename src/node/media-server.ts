import { createReadStream, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, resolve, sep } from "node:path";

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
  close: () => Promise<void>;
};

export async function startMediaServer(root: string, port = 0): Promise<MediaServer> {
  const rootDir = resolve(root);
  const server: Server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Range");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    const file = resolve(rootDir, `.${pathname}`);
    // 不允许访问根目录以外的文件
    if (file !== rootDir && !file.startsWith(rootDir + sep)) {
      res.writeHead(403).end();
      return;
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
      const start = range[1] ? Number(range[1]) : size - Number(range[2]);
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end || start >= size) {
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
    urlFor: (absPath) => {
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
