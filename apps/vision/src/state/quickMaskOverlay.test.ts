// Unit tests for the Quick Mask overlay colour math. Engine-free (node); the live
// overlay rendering + round-trip are covered by e2e/quick-mask.spec.ts.
import { describe, it, expect } from "vitest";
import { quickMaskPixel, QM_COLOR, QM_DEFAULT_OPACITY } from "./quickMaskOverlay";

describe("quickMaskPixel", () => {
  it("is fully transparent over a selected pixel (255)", () => {
    expect(quickMaskPixel(255)).toEqual({ r: 255, g: 0, b: 0, a: 0 });
  });

  it("is red at ~half alpha over a fully-masked pixel (0) at the default opacity", () => {
    const px = quickMaskPixel(0);
    expect(px.r).toBe(255);
    expect(px.g).toBe(0);
    expect(px.b).toBe(0);
    // 0.5 * 1 * 255 = 127.5 → 128.
    expect(px.a).toBe(128);
  });

  it("ramps alpha linearly with how masked the pixel is", () => {
    // A half-masked pixel (128) → roughly half of the fully-masked alpha.
    expect(quickMaskPixel(128).a).toBe(Math.round(QM_DEFAULT_OPACITY * (1 - 128 / 255) * 255));
    expect(quickMaskPixel(64).a).toBeGreaterThan(quickMaskPixel(192).a);
  });

  it("honours a custom opacity", () => {
    expect(quickMaskPixel(0, 1).a).toBe(255);
    expect(quickMaskPixel(0, 0).a).toBe(0);
  });

  it("clamps out-of-range buffer values", () => {
    expect(quickMaskPixel(-5).a).toBe(quickMaskPixel(0).a);
    expect(quickMaskPixel(999).a).toBe(quickMaskPixel(255).a);
  });

  it("always paints the Quick Mask colour (red)", () => {
    for (const v of [0, 50, 128, 200, 255]) {
      const px = quickMaskPixel(v);
      expect([px.r, px.g, px.b]).toEqual([QM_COLOR.r, QM_COLOR.g, QM_COLOR.b]);
    }
  });
});
