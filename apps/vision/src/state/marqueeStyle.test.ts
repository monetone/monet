// Unit tests for the Marquee Style geometry. Engine-free (node); the canvas wiring
// (preview + select_rect/select_ellipse) is covered by e2e/marquee-style.spec.ts.
import { describe, it, expect } from "vitest";
import { fixedRatioRect, fixedSizeRect, normalizeFixedSize } from "./marqueeStyle";

describe("fixedRatioRect", () => {
  it("keeps a 1:1 ratio (square), sized to the larger drag axis", () => {
    // wide-ish drag → width drives the square
    expect(fixedRatioRect(0, 0, 100, 10, 1, 1)).toEqual({ x0: 0, y0: 0, w: 100, h: 100 });
    // tall-ish drag → height drives the square
    expect(fixedRatioRect(0, 0, 100, 200, 1, 1)).toEqual({ x0: 0, y0: 0, w: 200, h: 200 });
  });

  it("keeps a 2:1 ratio (twice as wide as tall)", () => {
    expect(fixedRatioRect(0, 0, 200, 50, 2, 1)).toEqual({ x0: 0, y0: 0, w: 200, h: 100 });
  });

  it("anchors at the start for drags toward the top-left", () => {
    // dx=-100, dy=-20 at 1:1 → 100×100 square whose top-left lands on (0,0)
    expect(fixedRatioRect(100, 100, 0, 80, 1, 1)).toEqual({ x0: 0, y0: 0, w: 100, h: 100 });
  });

  it("treats ratio terms <= 0 as 1", () => {
    expect(fixedRatioRect(0, 0, 100, 10, 0, 0)).toEqual({ x0: 0, y0: 0, w: 100, h: 100 });
    expect(fixedRatioRect(0, 0, 100, 10, -3, -1)).toEqual({ x0: 0, y0: 0, w: 100, h: 100 });
  });
});

describe("fixedSizeRect", () => {
  it("places an exact w×h box at the click when it fits", () => {
    expect(fixedSizeRect(10, 20, 200, 100, 1280, 800)).toEqual({ x0: 10, y0: 20, w: 200, h: 100 });
  });

  it("keeps the requested anchor when the box crosses the canvas edge", () => {
    expect(fixedSizeRect(1200, 760, 200, 100, 1280, 800)).toEqual({ x0: 1200, y0: 760, w: 200, h: 100 });
  });

  it("keeps a requested size larger than the canvas for downstream clipping", () => {
    expect(fixedSizeRect(10, 20, 2000, 100, 1280, 800)).toEqual({ x0: 10, y0: 20, w: 2000, h: 100 });
  });

  it("normalizes dimensions to the finite field range before the wasm boundary", () => {
    expect(normalizeFixedSize(2 ** 31)).toBe(10_000);
    expect(normalizeFixedSize(Number.NaN)).toBe(1);
    expect(normalizeFixedSize(Number.POSITIVE_INFINITY)).toBe(1);
    expect(fixedSizeRect(10, 20, Number.NEGATIVE_INFINITY, 2 ** 31, 1280, 800))
      .toEqual({ x0: 10, y0: 20, w: 1, h: 10_000 });
  });

  it("clamps only the anchor to the document pixel domain", () => {
    expect(fixedSizeRect(-5, -5, 100, 100, 1280, 800)).toEqual({ x0: 0, y0: 0, w: 100, h: 100 });
    expect(fixedSizeRect(2000, 900, 100, 100, 1280, 800)).toEqual({ x0: 1279, y0: 799, w: 100, h: 100 });
  });
});
