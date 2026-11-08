import { describe, expect, it } from "vitest";
import {
  type FontCatalog,
  fontWarningsForStyles,
  parseFontconfigList,
  publicFontCatalog,
  resolveStyleFaces,
} from "./fonts";

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
          key: "system:Songti SC",
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

  it("falls back to an available system family and reports the affected element", () => {
    const catalog: FontCatalog = {
      platform: "darwin",
      scannedAt: "2026-11-08T00:00:00.000Z",
      warnings: [],
      items: [
        {
          key: "system:Backup Sans",
          id: "system:Backup Sans",
          family: "Backup Sans",
          style: "Regular",
          weight: 400,
          source: "system",
          available: true,
          exportable: true,
          path: "/System/Library/Fonts/Backup.ttc",
        },
      ],
    };
    const style = {
      font: {
        family: "Missing Sans",
        fallback: ["Backup Sans"],
        weight: 400,
        size: 32,
        letterSpacing: 0,
        lineHeight: 1.25,
      },
    };
    expect(resolveStyleFaces(style, catalog).warnings).toMatchObject([
      {
        code: "FONT_FALLBACK",
        requested: "Missing Sans",
        actual: "Backup Sans",
        source: "system",
      },
    ]);
    expect(
      fontWarningsForStyles([{ styleId: "title", style, elements: ["overlay-1"] }], catalog),
    ).toMatchObject([{ code: "FONT_FALLBACK", elements: ["overlay-1"] }]);
  });

  it("reports a non-blocking missing warning when no candidate is available", () => {
    const catalog: FontCatalog = {
      platform: "linux",
      scannedAt: "2026-11-08T00:00:00.000Z",
      warnings: [],
      items: [],
    };
    const style = {
      font: {
        family: "Missing Sans",
        fallback: ["Also Missing"],
        weight: 700,
        size: 32,
        letterSpacing: 0,
        lineHeight: 1.25,
      },
    };
    expect(resolveStyleFaces(style, catalog).warnings).toMatchObject([
      {
        code: "FONT_MISSING",
        requested: "Missing Sans",
        actual: null,
        source: "missing",
      },
    ]);
  });
});
