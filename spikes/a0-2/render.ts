import { resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { startMediaServer } from "../../src/node/media-server";

const dir = resolve("fixtures/out/1029");
const server = await startMediaServer(resolve(dir, "cache"));
try {
  const serveUrl = await bundle({ entryPoint: resolve("spikes/a0-2/index.tsx") });
  const inputProps = {
    rawSrc: server.urlFor(resolve(dir, "cache/raw.mez.mp4")),
    outroSrc: server.urlFor(resolve(dir, "cache/outro.mez.mp4")),
    trimBeforeFrames: Math.round((2607 / 1000) * 30),
    speed: 1.1,
    contentFrames: Math.round(26.955 * 30),
    outroFrames: 53,
  };
  const composition = await selectComposition({ serveUrl, id: "spike", inputProps });
  const t0 = performance.now();
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: "h264",
    crf: 18,
    outputLocation: resolve(dir, "spike-a0-2.mp4"),
    onProgress: ({ progress }) => process.stderr.write(`\r${(progress * 100).toFixed(0)}%`),
  });
  console.log(
    `\nrendered ${composition.durationInFrames} frames in ${((performance.now() - t0) / 1000).toFixed(1)}s`,
  );
} finally {
  await server.close();
}
