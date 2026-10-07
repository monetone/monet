import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyWebExportPixels, matteLevel } from "./webExportPrefs";

// VIS-SFW-01: Save for Web's Matte and Convert to sRGB used to be persisted and
// then ignored. These pin the pixel work itself; the wiring check below pins
// that saveForWeb still reaches it (same idiom as colorExportWiring.test.ts).

/** An n=2 lattice that inverts: trilinear over two points is linear, so a
 *  sampled channel comes back as 255 − in. Stands in for a real
 *  `display_lut` bake without pulling the wasm engine into a node test. */
const INVERT_LUT = (() => {
  const lut = new Uint8Array(2 * 2 * 2 * 3);
  for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) {
    const i = ((b * 2 + g) * 2 + r) * 3;
    lut[i] = r ? 0 : 255; lut[i + 1] = g ? 0 : 255; lut[i + 2] = b ? 0 : 255;
  }
  return lut;
})();

const px = (...v: number[]) => new Uint8ClampedArray(v);

describe("matteLevel", () => {
  it("maps the dialog choice to a grey, null for transparent", () => {
    expect(matteLevel("white")).toBe(255);
    expect(matteLevel("black")).toBe(0);
    expect(matteLevel("transparent")).toBeNull();
  });
});

describe("applyWebExportPixels", () => {
  it("leaves the pixels untouched when neither control asks for work", () => {
    const data = px(10, 20, 30, 128);
    applyWebExportPixels(data, null, 0, null);
    expect([...data]).toEqual([10, 20, 30, 128]);
  });

  it("composites half-transparent pixels against a white matte and makes them opaque", () => {
    const data = px(0, 0, 0, 128, 200, 100, 50, 255);
    applyWebExportPixels(data, null, 0, 255);
    // 0·(128/255) + 255·(1 − 128/255) = 127; the opaque pixel is unchanged.
    expect([...data]).toEqual([127, 127, 127, 255, 200, 100, 50, 255]);
  });

  it("drops fully transparent pixels onto the black matte", () => {
    const data = px(240, 240, 240, 0);
    applyWebExportPixels(data, null, 0, 0);
    expect([...data]).toEqual([0, 0, 0, 255]);
  });

  it("converts through the document → sRGB LUT and keeps alpha", () => {
    const data = px(0, 64, 255, 128);
    applyWebExportPixels(data, INVERT_LUT, 2, null);
    expect([...data]).toEqual([255, 191, 0, 128]);
  });

  it("mattes AFTER converting, so the matte colour is not run through the LUT", () => {
    const data = px(255, 255, 255, 0);
    applyWebExportPixels(data, INVERT_LUT, 2, 255);
    // Converted (→ 0,0,0) but fully transparent, so the white matte wins outright.
    expect([...data]).toEqual([255, 255, 255, 255]);
  });
});

describe("VIS-SFW-01 — Save for Web applies Matte and Convert to sRGB", () => {
  const source = readFileSync(fileURLToPath(new URL("./app.ts", import.meta.url)), "utf8");
  const section = (start: string, end: string) => {
    const from = source.indexOf(start);
    expect(from, `missing anchor: ${start}`).toBeGreaterThanOrEqual(0);
    const to = source.indexOf(end, from + start.length);
    expect(to, `missing anchor: ${end}`).toBeGreaterThan(from);
    return source.slice(from, to);
  };

  it("resolves both prefs into pixel work and runs the composite through it", () => {
    const work = section("function webExportPixelWork(", "/** The composite on a canvas");
    expect(work).toContain("matteLevel(prefs.matte)");
    expect(work).toContain("prefs.convertToSRgb");
    expect(work).toContain("display_lut(DISPLAY_LUT_SIZE, exportIccBytes())");
    expect(section("async function webExportCanvas(", "/** Encode a region")).toContain("applyWebExportPixels(");
  });

  it("routes Save for Web through the pixel path whenever work is pending", () => {
    const body = section("export async function saveForWeb(", "async function pngToJpegPage(");
    expect(body).toContain("webExportPixelWork(prefs)");
    expect(body).toContain("webExportCanvas(work)");
  });
});
