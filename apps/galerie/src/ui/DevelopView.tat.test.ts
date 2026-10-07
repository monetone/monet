// Tone Curve Targeted Adjustment Tool (GAL-DEV-22): dragging on the image must
// hit the parametric region the sampled pixel actually lives in — at the
// recipe's OWN split points, not the fixed quarter defaults — and a vertical
// drag must sweep the ±100 slider domain. The Color-Mixer TAT twin is covered
// by lib/tat.test.ts.

import { describe, expect, it } from "vitest";

import { toneRegionForPixel, toneTatValue } from "./DevelopView";

describe("toneRegionForPixel", () => {
  it("maps a pixel to its region by Rec.709 luma, not a channel average", () => {
    expect(toneRegionForPixel(0, 0, 0)).toBe("shadows");
    expect(toneRegionForPixel(255, 255, 255)).toBe("highlights");
    expect(toneRegionForPixel(128, 128, 128)).toBe("lights"); // 0.502 → just past the mid split
    // Pure green is luma 0.715 (lights) but averages to 0.333 (darks) — the
    // weighting is what's under test here.
    expect(toneRegionForPixel(0, 255, 0)).toBe("lights");
    expect(toneRegionForPixel(0, 0, 255)).toBe("shadows"); // luma 0.072
  });

  it("follows the recipe's split points instead of the quarter defaults", () => {
    const mid = [128, 128, 128] as const;
    expect(toneRegionForPixel(...mid, [0.25, 0.5, 0.75])).toBe("lights");
    expect(toneRegionForPixel(...mid, [0.1, 0.2, 0.3])).toBe("highlights");
    expect(toneRegionForPixel(...mid, [0.4, 0.7, 0.8])).toBe("darks");
    expect(toneRegionForPixel(...mid, [0.55, 0.9, 0.95])).toBe("shadows");
  });

  it("survives hostile splits (out of order / non-finite) without folding regions", () => {
    // normalizeRecipe sanitizes on load, but a live drag can hand anything through.
    expect(toneRegionForPixel(255, 255, 255, [0.9, Number.NaN, 0.2])).toBe("highlights");
    expect(toneRegionForPixel(0, 0, 0, [0.9, Number.NaN, 0.2])).toBe("shadows");
  });
});

describe("toneTatValue", () => {
  it("drags up to brighten, down to darken, ~200px per full sweep", () => {
    expect(toneTatValue(0, 200)).toBe(100);
    expect(toneTatValue(0, -200)).toBe(-100);
    expect(toneTatValue(20, 50)).toBe(45);
  });

  it("clamps to the ±100 slider domain", () => {
    expect(toneTatValue(50, 1000)).toBe(100);
    expect(toneTatValue(-50, -1000)).toBe(-100);
  });
});
