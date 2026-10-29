import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startMediaServer } from "./media-server";

describe("媒体服务 Range", () => {
  it("超出文件长度的后缀范围从文件开头读取，非法范围返回 416", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mw-range-"));
    const file = join(dir, "small.mp3");
    await writeFile(file, "12345");
    const server = await startMediaServer(null);
    try {
      const url = server.register(file);
      const suffix = await fetch(url, { headers: { range: "bytes=-999" } });
      expect(suffix.status).toBe(206);
      expect(suffix.headers.get("content-range")).toBe("bytes 0-4/5");
      expect(await suffix.text()).toBe("12345");

      const invalid = await fetch(url, { headers: { range: "bytes=-0" } });
      expect(invalid.status).toBe(416);
      expect((await fetch(url)).status).toBe(200);
    } finally {
      await server.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
