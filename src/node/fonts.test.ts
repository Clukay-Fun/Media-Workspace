import { describe, expect, it } from "vitest";
import { type FontCatalog, parseFontconfigList, publicFontCatalog } from "./fonts";

describe("runtime font catalog", () => {
  it("parses fontconfig family aliases and maps weights to CSS weights", () => {
    const items = parseFontconfigList(
      "/System/Library/Fonts/Songti.ttc\tSongti SC,宋体\tRegular\t80\n" +
        "/tmp/missing.ttf\tMissing\tBold\t200\n",
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "system:Songti SC",
      family: "Songti SC",
      style: "Regular",
      weight: 400,
      source: "system",
    });
    expect(items[1]?.weight).toBe(800);
    expect(items[1]?.available).toBe(false);
  });

  it("does not expose machine paths in the public catalog", () => {
    const catalog: FontCatalog = {
      platform: "darwin",
      scannedAt: "2026-11-08T00:00:00.000Z",
      warnings: [],
      items: [
        {
          id: "system:Songti SC",
          family: "Songti SC",
          style: "Regular",
          weight: 400,
          source: "system",
          available: true,
          exportable: true,
          path: "/System/Library/Fonts/Songti.ttc",
        },
      ],
    };
    expect(publicFontCatalog(catalog).fonts[0]).not.toHaveProperty("path");
  });
});
