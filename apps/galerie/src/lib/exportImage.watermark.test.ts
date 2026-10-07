// Watermark Editor extras (lib/exportImage): content gating, font shorthand,
// rotation/graphic sizing math, and the named saved-watermark store shared by
// Export / Print / Web / Slideshow. Pure — no canvas, no DOM.

import { describe, expect, it } from "vitest";

import type { PresetStorage } from "./exportPresets";
import {
  deleteWatermark,
  graphicBox,
  hasWatermarkContent,
  listWatermarks,
  rotatedBox,
  saveWatermark,
  watermarkFont,
  type WatermarkSpecEx,
} from "./exportImage";

const spec = (over: Partial<WatermarkSpecEx> = {}): WatermarkSpecEx => ({
  text: "© Test",
  anchor: "bottom-right",
  opacity: 0.7,
  sizePct: 4,
  insetPct: 2,
  ...over,
});

function fakeStorage(initial: Record<string, string> = {}): PresetStorage {
  const map: Record<string, string> = { ...initial };
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => {
      map[k] = v;
    },
  };
}

describe("hasWatermarkContent", () => {
  it("text mode needs non-blank text", () => {
    expect(hasWatermarkContent(spec())).toBe(true);
    expect(hasWatermarkContent(spec({ text: "   " }))).toBe(false);
    expect(hasWatermarkContent(spec({ mode: "text", text: "" }))).toBe(false);
  });

  it("graphic mode needs a graphic, and ignores the text field", () => {
    expect(hasWatermarkContent(spec({ mode: "graphic" }))).toBe(false);
    expect(hasWatermarkContent(spec({ mode: "graphic", text: "", graphicDataUrl: "data:image/png;base64,AA==" }))).toBe(true);
  });
});

describe("watermarkFont", () => {
  it("defaults to plain sans-serif", () => {
    expect(watermarkFont(spec(), 24)).toBe("24px sans-serif");
  });

  it("composes italic/bold/family in CSS shorthand order", () => {
    expect(watermarkFont(spec({ bold: true, italic: true, font: "serif" }), 30)).toBe("italic bold 30px serif");
  });
});

describe("rotatedBox", () => {
  it("swaps the box on odd quarter turns, keeps it on even", () => {
    expect(rotatedBox(200, 50, 0)).toEqual({ w: 200, h: 50 });
    expect(rotatedBox(200, 50, 1)).toEqual({ w: 50, h: 200 });
    expect(rotatedBox(200, 50, 2)).toEqual({ w: 200, h: 50 });
    expect(rotatedBox(200, 50, 3)).toEqual({ w: 50, h: 200 });
  });
});

describe("graphicBox", () => {
  it("scales the graphic to sizePct of the canvas width, keeping aspect", () => {
    expect(graphicBox(1000, 800, 200, 100, 10)).toEqual({ width: 100, height: 50 });
  });

  it("clamps so the graphic always fits the canvas", () => {
    // Unclamped 500×2000 on a 1000×100 canvas → height-bound at ¼ scale.
    expect(graphicBox(1000, 100, 100, 400, 50)).toEqual({ width: 25, height: 100 });
  });

  it("degrades to 1×1 for undecodable (non-positive) source dims", () => {
    expect(graphicBox(1000, 800, 0, 0, 10)).toEqual({ width: 1, height: 1 });
  });
});

describe("saved watermarks", () => {
  it("saves, lists alphabetically, and round-trips the full spec", () => {
    const s = fakeStorage();
    saveWatermark("Zed", spec(), s);
    const g = spec({ mode: "graphic", graphicDataUrl: "data:image/png;base64,AA==", rotateQuarter: 1, color: "#ff0000" });
    const list = saveWatermark("Alpha", g, s);
    expect(list.map((w) => w.name)).toEqual(["Alpha", "Zed"]);
    expect(listWatermarks(s).find((w) => w.name === "Alpha")?.spec).toEqual(g);
  });

  it("upserts by trimmed name and ignores blank names", () => {
    const s = fakeStorage();
    saveWatermark(" A ", spec(), s);
    const list = saveWatermark("A", spec({ text: "v2" }), s);
    expect(list).toHaveLength(1);
    expect(list[0].spec.text).toBe("v2");
    expect(saveWatermark("   ", spec(), s)).toHaveLength(1);
  });

  it("deletes by name", () => {
    const s = fakeStorage();
    saveWatermark("A", spec(), s);
    saveWatermark("B", spec(), s);
    expect(deleteWatermark("A", s).map((w) => w.name)).toEqual(["B"]);
  });

  it("treats corrupt or missing storage as empty", () => {
    expect(listWatermarks(fakeStorage({ "galerie.watermarks": "{not json" }))).toEqual([]);
    expect(listWatermarks(null)).toEqual([]);
    expect(saveWatermark("A", spec(), null)).toEqual([]);
  });
});
