import { describe, expect, it } from "vitest";

import { chunk } from "./embedXmp";
import { exportFilename, fitLongEdge, fitResize, tagPpiJpeg, tagPpiPng, uniqueName } from "./exportImage";

describe("uniqueName", () => {
  it("passes a fresh name through and records it", () => {
    const seen = new Set<string>();
    expect(uniqueName("a.jpg", seen)).toBe("a.jpg");
    expect(seen.has("a.jpg")).toBe(true);
  });

  it("disambiguates collisions with -2, -3 …", () => {
    const seen = new Set<string>();
    expect(uniqueName("DSC_0001.jpg", seen)).toBe("DSC_0001.jpg");
    expect(uniqueName("DSC_0001.jpg", seen)).toBe("DSC_0001-2.jpg");
    expect(uniqueName("DSC_0001.jpg", seen)).toBe("DSC_0001-3.jpg");
  });

  it("handles an extensionless name", () => {
    const seen = new Set<string>(["RAW"]);
    expect(uniqueName("RAW", seen)).toBe("RAW-2");
  });
});

describe("fitLongEdge", () => {
  it("returns full size for null/zero long edge", () => {
    expect(fitLongEdge(6000, 4000, null)).toEqual({ width: 6000, height: 4000 });
    expect(fitLongEdge(6000, 4000, 0)).toEqual({ width: 6000, height: 4000 });
  });

  it("never upscales", () => {
    expect(fitLongEdge(800, 600, 4096)).toEqual({ width: 800, height: 600 });
  });

  it("fits within the long edge, preserving aspect (landscape + portrait)", () => {
    expect(fitLongEdge(6000, 4000, 3000)).toEqual({ width: 3000, height: 2000 });
    expect(fitLongEdge(4000, 6000, 3000)).toEqual({ width: 2000, height: 3000 });
  });

  it("rounds to whole pixels, never below 1", () => {
    const d = fitLongEdge(6000, 3999, 100);
    expect(d.width).toBe(100);
    expect(d.height).toBe(67); // 3999/6000*100 = 66.65 → 67
  });
});

describe("fitResize", () => {
  it("widthHeight fits within the box as entered (orientation matters)", () => {
    expect(fitResize(6000, 4000, { mode: "widthHeight", value: 1200, value2: 1200 }))
      .toEqual({ width: 1200, height: 800 });
    // A portrait image against a wide box is height-bound.
    expect(fitResize(4000, 6000, { mode: "widthHeight", value: 3000, value2: 1500 }))
      .toEqual({ width: 1000, height: 1500 });
  });

  it("dimensions is orientation-free: long edge → larger entry", () => {
    const landscape = fitResize(6000, 4000, { mode: "dimensions", value: 1200, value2: 1800 });
    const portrait = fitResize(4000, 6000, { mode: "dimensions", value: 1200, value2: 1800 });
    expect(landscape).toEqual({ width: 1800, height: 1200 });
    expect(portrait).toEqual({ width: 1200, height: 1800 });
  });

  it("longEdge / shortEdge take free values, not just the old presets", () => {
    expect(fitResize(6000, 4000, { mode: "longEdge", value: 1600 })).toEqual({ width: 1600, height: 1067 });
    expect(fitResize(6000, 4000, { mode: "shortEdge", value: 1000 })).toEqual({ width: 1500, height: 1000 });
  });

  it("megapixels fits a pixel budget", () => {
    const d = fitResize(6000, 4000, { mode: "megapixels", value: 6 });
    expect(d.width * d.height).toBeGreaterThan(5.9e6);
    expect(d.width * d.height).toBeLessThan(6.1e6);
    expect(d.width / d.height).toBeCloseTo(1.5, 2);
  });

  it("percentage scales, including above 100", () => {
    expect(fitResize(800, 600, { mode: "percentage", value: 50 })).toEqual({ width: 400, height: 300 });
    expect(fitResize(800, 600, { mode: "percentage", value: 200 })).toEqual({ width: 1600, height: 1200 });
  });

  it("upscales when Don't Enlarge is off, and refuses when on", () => {
    expect(fitResize(800, 600, { mode: "longEdge", value: 1600 })).toEqual({ width: 1600, height: 1200 });
    expect(fitResize(800, 600, { mode: "longEdge", value: 1600, dontEnlarge: true }))
      .toEqual({ width: 800, height: 600 });
  });

  it("converts in/cm entries through the export ppi", () => {
    // 4 in at 300 ppi = 1200 px on the long edge.
    expect(fitResize(6000, 4000, { mode: "longEdge", value: 4, unit: "in" }, 300))
      .toEqual({ width: 1200, height: 800 });
    // 2.54 cm = 1 in.
    expect(fitResize(6000, 4000, { mode: "longEdge", value: 2.54, unit: "cm" }, 300))
      .toEqual({ width: 300, height: 200 });
  });

  it("treats a non-finite or non-positive entry as full size (free-entry guard)", () => {
    expect(fitResize(6000, 4000, { mode: "longEdge", value: 0 })).toEqual({ width: 6000, height: 4000 });
    expect(fitResize(6000, 4000, { mode: "percentage", value: NaN })).toEqual({ width: 6000, height: 4000 });
  });

  it("a missing/invalid second entry falls back to the first (square box)", () => {
    expect(fitResize(6000, 4000, { mode: "widthHeight", value: 1200 })).toEqual({ width: 1200, height: 800 });
  });
});

describe("tagPpiJpeg", () => {
  // SOI + minimal 16-byte JFIF APP0 (units=0, 1:1 density) + EOI.
  const jfif = () =>
    new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
      0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
      0xff, 0xd9,
    ]);

  it("patches an existing JFIF header to dots-per-inch density", () => {
    const out = tagPpiJpeg(jfif(), 300);
    expect(out.length).toBe(jfif().length);
    expect(out[13]).toBe(1); // units: dpi
    expect((out[14] << 8) | out[15]).toBe(300);
    expect((out[16] << 8) | out[17]).toBe(300);
  });

  it("inserts a JFIF APP0 after SOI when none exists", () => {
    const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x02, 0xff, 0xd9]);
    const out = tagPpiJpeg(bare, 240);
    expect([...out.subarray(0, 4)]).toEqual([0xff, 0xd8, 0xff, 0xe0]);
    expect(out[13]).toBe(1);
    expect((out[14] << 8) | out[15]).toBe(240);
    // The original stream follows intact.
    expect([...out.subarray(out.length - bare.length + 2)]).toEqual([...bare.subarray(2)]);
  });

  it("rejects a non-JPEG", () => {
    expect(() => tagPpiJpeg(new Uint8Array([0x89, 0x50]), 300)).toThrow(/not a JPEG/);
  });
});

describe("tagPpiPng", () => {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const png = (...chunks: Uint8Array[]) => {
    const parts = [new Uint8Array(SIG), ...chunks];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  const readPhys = (bytes: Uint8Array, at: number) => ({
    type: String.fromCharCode(...bytes.subarray(at + 4, at + 8)),
    ppm: ((bytes[at + 8] << 24) | (bytes[at + 9] << 16) | (bytes[at + 10] << 8) | bytes[at + 11]) >>> 0,
    unit: bytes[at + 16],
  });

  it("inserts pHYs before the first IDAT, in pixels per metre", () => {
    const ihdr = chunk("IHDR", new Uint8Array(13));
    const idat = chunk("IDAT", new Uint8Array([1, 2, 3]));
    const iend = chunk("IEND", new Uint8Array(0));
    const out = tagPpiPng(png(ihdr, idat, iend), 300);
    const at = SIG.length + ihdr.length; // right after IHDR, before IDAT
    const phys = readPhys(out, at);
    expect(phys.type).toBe("pHYs");
    expect(phys.ppm).toBe(Math.round(300 / 0.0254)); // 11811
    expect(phys.unit).toBe(1); // metre
    expect(out.length).toBe(png(ihdr, idat, iend).length + 21);
  });

  it("replaces an existing pHYs instead of stacking a second one", () => {
    const ihdr = chunk("IHDR", new Uint8Array(13));
    const oldPhys = chunk("pHYs", new Uint8Array(9));
    const idat = chunk("IDAT", new Uint8Array([1]));
    const iend = chunk("IEND", new Uint8Array(0));
    const src = png(ihdr, oldPhys, idat, iend);
    const out = tagPpiPng(src, 72);
    expect(out.length).toBe(src.length); // swapped, not stacked
    expect(readPhys(out, SIG.length + ihdr.length).ppm).toBe(Math.round(72 / 0.0254));
  });

  it("rejects a PNG with no IDAT", () => {
    const ihdr = chunk("IHDR", new Uint8Array(13));
    expect(() => tagPpiPng(png(ihdr, chunk("IEND", new Uint8Array(0))), 300)).toThrow(/no IDAT/);
  });
});

describe("exportFilename", () => {
  it("swaps the extension for the format", () => {
    expect(exportFilename("/a/b/IMG_1234.CR3", null, "jpeg")).toBe("IMG_1234.jpg");
    expect(exportFilename("/a/b/IMG_1234.CR3", null, "png")).toBe("IMG_1234.png");
  });

  it("appends the virtual-copy name (spaces stripped)", () => {
    expect(exportFilename("C:\\pics\\shot.tif", "Copy 2", "jpeg")).toBe("shot-Copy2.jpg");
  });

  it("handles a bare filename with no directory", () => {
    expect(exportFilename("photo.jpeg", null, "jpeg")).toBe("photo.jpg");
  });
});
