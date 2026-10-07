// Unit tests for the New Document preset list + lookups. Engine-free (node); the
// dialog wiring is covered by e2e/new-document.spec.ts.
import { describe, it, expect } from "vitest";
import {
  DOC_PRESETS,
  CUSTOM_PRESET,
  DOCUMENT_SIZE_UNITS,
  DEFAULT_DOCUMENT_RESOLUTION_PPI,
  MAX_DOCUMENT_DIMENSION_PX,
  MAX_DOCUMENT_PIXELS,
  MAX_DOCUMENT_RESOLUTION_PPI,
  convertDocumentLength,
  documentSizeFromPixels,
  documentSizePrecision,
  documentSizeToPixels,
  normalizeDocumentResolutionPpi,
  normalizeDocumentSizeUnit,
  presetByName,
  presetDisplaySize,
  presetForSettings,
} from "./docPresets";

describe("DOC_PRESETS", () => {
  it("is a non-empty list with positive integer dims and unique names", () => {
    expect(DOC_PRESETS.length).toBeGreaterThan(0);
    const names = new Set<string>();
    for (const p of DOC_PRESETS) {
      expect(Number.isInteger(p.w) && p.w > 0).toBe(true);
      expect(Number.isInteger(p.h) && p.h > 0).toBe(true);
      expect(p.resolutionPpi).toBeGreaterThan(0);
      expect(p.colorMode).toBeGreaterThanOrEqual(0);
      expect(p.colorMode).toBeLessThanOrEqual(4);
      expect(p.colorProfile).toBeGreaterThanOrEqual(0);
      expect(p.colorProfile).toBeLessThanOrEqual(3);
      expect(DOCUMENT_SIZE_UNITS.some((unit) => unit.value === p.unit)).toBe(true);
      expect(names.has(p.name)).toBe(false);
      names.add(p.name);
    }
    expect(names.has(CUSTOM_PRESET)).toBe(false); // "Custom" is the sentinel, not a preset
  });
});

describe("presetByName", () => {
  it("returns the matching preset, or undefined", () => {
    const first = DOC_PRESETS[0];
    expect(presetByName(first.name)).toEqual(first);
    expect(presetByName("Nope")).toBeUndefined();
    expect(presetByName(CUSTOM_PRESET)).toBeUndefined();
  });
});

describe("presetForSettings", () => {
  it("matches the complete document tuple, else undefined (→ Custom)", () => {
    const p = DOC_PRESETS.find((x) => x.name.startsWith("Web 1920"))!;
    expect(presetForSettings(p.w, p.h, p.resolutionPpi, p.colorMode, p.colorProfile, p.unit)).toEqual(p);
    expect(presetForSettings(p.w, p.h + 1, p.resolutionPpi, p.colorMode, p.colorProfile, p.unit)).toBeUndefined();
    expect(presetForSettings(p.w, p.h, 300, p.colorMode, p.colorProfile, p.unit)).toBeUndefined();
    expect(presetForSettings(p.w, p.h, p.resolutionPpi, 2, p.colorProfile, p.unit)).toBeUndefined();
    expect(presetForSettings(p.w, p.h, p.resolutionPpi, p.colorMode, 2, p.unit)).toBeUndefined();
    expect(presetForSettings(p.w, p.h, p.resolutionPpi, p.colorMode, p.colorProfile, "in")).toBeUndefined();
  });
});

describe("document size units", () => {
  it("converts signed scalar lengths without clamping Relative deltas", () => {
    expect(convertDocumentLength(1, "in", "px", 100)).toBe(100);
    expect(convertDocumentLength(-0.5, "in", "px", 100)).toBe(-50);
    expect(convertDocumentLength(100, "px", "in", 100)).toBe(1);
    expect(convertDocumentLength(Number.NaN, "px", "in", 100)).toBe(0);
  });

  it("converts physical units to canonical integer pixels", () => {
    expect(documentSizeToPixels(2, 1, "in", 100)).toEqual({ w: 200, h: 100 });
    expect(documentSizeToPixels(2.54, 2.54, "cm", 300)).toEqual({ w: 300, h: 300 });
    expect(documentSizeToPixels(25.4, 25.4, "mm", 300)).toEqual({ w: 300, h: 300 });
    expect(documentSizeToPixels(72, 72, "pt", 300)).toEqual({ w: 300, h: 300 });
    expect(documentSizeToPixels(6, 6, "pc", 300)).toEqual({ w: 300, h: 300 });
  });

  it("keeps pixels independent of resolution and bounds untrusted sizes", () => {
    expect(documentSizeToPixels(320, 240, "px", 10_000)).toEqual({ w: 320, h: 240 });
    expect(documentSizeToPixels(0.005, 0.001, "in", 300)).toEqual({ w: 2, h: 1 });
    expect(documentSizeToPixels(Number.NaN, -5, "px", 72)).toEqual({ w: 1, h: 1 });
    expect(documentSizeToPixels(Infinity, Infinity, "px", 72)).toEqual({ w: 1, h: 1 });
    expect(documentSizeToPixels(Number.NaN, Infinity, "in", 300)).toEqual({ w: 1, h: 1 });
    expect(documentSizeToPixels(MAX_DOCUMENT_DIMENSION_PX + 1, 1, "px", 72).w).toBe(MAX_DOCUMENT_DIMENSION_PX);
  });

  it("fits oversized dimensions to the engine pixel budget without changing aspect", () => {
    const size = documentSizeToPixels(10_000, 10_000, "px", 72);
    expect(size).toEqual({ w: 8_944, h: 8_944 });
    expect(size.w * size.h).toBeLessThanOrEqual(MAX_DOCUMENT_PIXELS);
    expect(documentSizeToPixels(100, 1, "in", 1_000)).toEqual({ w: 32_767, h: 328 });
  });

  it("converts canonical pixels back to the selected unit", () => {
    expect(documentSizeFromPixels(200, 100, "in", 100)).toEqual({ w: 2, h: 1 });
  });

  it("uses enough display precision to preserve canonical pixels", () => {
    const precision = documentSizePrecision("in", 300);
    const inches = documentSizeFromPixels(2, 1, "in", 300);
    expect(precision).toBe(3);
    expect(documentSizeToPixels(Number(inches.w.toFixed(precision)), Number(inches.h.toFixed(precision)), "in", 300)).toEqual({ w: 2, h: 1 });
  });

  it("preserves the physical sizes of print presets", () => {
    const a4 = DOC_PRESETS.find((p) => p.name.startsWith("A4"))!;
    const letter = DOC_PRESETS.find((p) => p.name.startsWith("US Letter"))!;
    expect({ unit: a4.unit, ...presetDisplaySize(a4) }).toEqual({ unit: "mm", w: 210, h: 297 });
    expect({ unit: letter.unit, ...presetDisplaySize(letter) }).toEqual({ unit: "in", w: 8.5, h: 11 });
    expect(documentSizeToPixels(210, 297, "mm", 300)).toEqual({ w: a4.w, h: a4.h });
    expect(documentSizeToPixels(8.5, 11, "in", 300)).toEqual({ w: letter.w, h: letter.h });
  });

  it("normalizes unknown units to pixels", () => {
    expect(normalizeDocumentSizeUnit("mm")).toBe("mm");
    expect(normalizeDocumentSizeUnit("yards")).toBe("px");
  });
});

describe("normalizeDocumentResolutionPpi", () => {
  it("keeps finite positive values and bounds untrusted metadata", () => {
    expect(normalizeDocumentResolutionPpi(300)).toBe(300);
    expect(normalizeDocumentResolutionPpi(0)).toBe(1);
    expect(normalizeDocumentResolutionPpi(Number.POSITIVE_INFINITY)).toBe(DEFAULT_DOCUMENT_RESOLUTION_PPI);
    expect(normalizeDocumentResolutionPpi(MAX_DOCUMENT_RESOLUTION_PPI + 1)).toBe(MAX_DOCUMENT_RESOLUTION_PPI);
  });
});
