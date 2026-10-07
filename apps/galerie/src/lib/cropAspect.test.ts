import { describe, expect, it } from "vitest";

import { aspectCropRect, constrainRectToAspect, CROP_ASPECTS, fitUnitRect } from "./cropAspect";

const aspectOf = (r: { left: number; top: number; right: number; bottom: number }): number =>
  (r.right - r.left) / (r.bottom - r.top);
const inBounds = (r: { left: number; top: number; right: number; bottom: number }): boolean =>
  r.left >= -1e-9 && r.top >= -1e-9 && r.right <= 1 + 1e-9 && r.bottom <= 1 + 1e-9 && r.left < r.right && r.top < r.bottom;

describe("fitUnitRect", () => {
  it("na = 1 fills the unit square", () => {
    expect(fitUnitRect(1)).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
  });

  it("wide aspect is width-bound and vertically centered", () => {
    // na = 2 → height 0.5, centered → 0.25 margins top/bottom.
    expect(fitUnitRect(2)).toEqual({ left: 0, top: 0.25, right: 1, bottom: 0.75 });
  });

  it("tall aspect is height-bound and horizontally centered", () => {
    // na = 0.5 → width 0.5, centered → 0.25 margins left/right.
    expect(fitUnitRect(0.5)).toEqual({ left: 0.25, top: 0, right: 0.75, bottom: 1 });
  });

  it("falls back to the full frame for a degenerate aspect", () => {
    expect(fitUnitRect(0)).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
    expect(fitUnitRect(Number.NaN)).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
  });
});

describe("aspectCropRect", () => {
  it("a 1:1 crop of a 2:1 image is a centered full-height half-width rect (a pixel square)", () => {
    // na = ratio/imageAspect = 1/2 = 0.5 → tall, height-bound.
    expect(aspectCropRect(1, 2)).toEqual({ left: 0.25, top: 0, right: 0.75, bottom: 1 });
  });

  it("a 16:9 crop of a square image is width-bound", () => {
    const r = aspectCropRect(16 / 9, 1); // na = 16/9
    expect(r.left).toBe(0);
    expect(r.right).toBe(1);
    expect(r.bottom - r.top).toBeCloseTo(9 / 16, 6);
    expect(r.top).toBeCloseTo((1 - 9 / 16) / 2, 6); // centered
  });

  it("an Original-aspect crop (ratio == image aspect) is the whole frame", () => {
    expect(aspectCropRect(1.5, 1.5)).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
  });

  it("every preset produces an in-bounds, correctly-proportioned rect", () => {
    const imageAspect = 1.5;
    for (const p of CROP_ASPECTS) {
      const r = aspectCropRect(p.ratio, imageAspect);
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(1);
      expect(r.bottom).toBeLessThanOrEqual(1);
      // Recovered pixel ratio = (normW/normH)·imageAspect ≈ the preset ratio.
      const normW = r.right - r.left;
      const normH = r.bottom - r.top;
      expect((normW / normH) * imageAspect).toBeCloseTo(p.ratio, 6);
    }
  });
});

describe("constrainRectToAspect", () => {
  it("keeps the target aspect and anchors the fixed corner (drag br from a fixed tl)", () => {
    const r = constrainRectToAspect(0.1, 0.1, 0.7, 0.5, 1.5); // fixed tl, na = 1.5
    expect(aspectOf(r)).toBeCloseTo(1.5, 6);
    expect(r.left).toBeCloseTo(0.1, 9); // tl stays put
    expect(r.top).toBeCloseTo(0.1, 9);
    expect(inBounds(r)).toBe(true);
  });

  it("reaches the pointer along the dominant axis", () => {
    // Wide drag (dx >> dy·na): width leads, height derived → w = 0.6, h = 0.4.
    const r = constrainRectToAspect(0.1, 0.1, 0.7, 0.15, 1.5);
    expect(r.right - r.left).toBeCloseTo(0.6, 6);
    expect(r.bottom - r.top).toBeCloseTo(0.4, 6);
  });

  it("anchors correctly when dragging up-left (signs flip)", () => {
    // Fixed br at (0.9, 0.9), drag tl toward the origin.
    const r = constrainRectToAspect(0.9, 0.9, 0.2, 0.3, 1);
    expect(r.right).toBeCloseTo(0.9, 9);
    expect(r.bottom).toBeCloseTo(0.9, 9);
    expect(aspectOf(r)).toBeCloseTo(1, 6);
    expect(inBounds(r)).toBe(true);
  });

  it("shrinks aspect-preserving to stay in bounds when the drag runs past an edge", () => {
    const r = constrainRectToAspect(0.1, 0.1, 5, 5, 1); // way out of bounds
    expect(inBounds(r)).toBe(true);
    expect(aspectOf(r)).toBeCloseTo(1, 6);
    // Bound by the nearer edge from the fixed corner (0.9 available each way).
    expect(r.right - r.left).toBeCloseTo(0.9, 6);
  });

  it("floors a near-zero drag to a minimum-size rect (never collapses)", () => {
    const r = constrainRectToAspect(0.5, 0.5, 0.5001, 0.5001, 2);
    expect(r.right - r.left).toBeGreaterThan(0.02);
    expect(r.bottom - r.top).toBeGreaterThan(0.02);
    expect(aspectOf(r)).toBeCloseTo(2, 6);
  });
});
