// Unit tests for Perspective Crop's pure geometry. Engine-free (node); the engine
// rectify + dialog are covered by e2e/perspective-crop.spec.ts.
import { describe, it, expect } from "vitest";
import { cropQuadPixels, isIdentityCrop, suggestedCropSize, FULL_CROP_QUAD, type CropCorner } from "./perspectiveCrop";

describe("cropQuadPixels", () => {
  it("maps the full-canvas quad to the canvas rect (TL,TR,BR,BL)", () => {
    expect(cropQuadPixels(FULL_CROP_QUAD, 200, 100)).toEqual([0, 0, 200, 0, 200, 100, 0, 100]);
  });

  it("scales fractional corners by canvas size", () => {
    const q: CropCorner[] = [{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.1 }, { x: 0.8, y: 0.9 }, { x: 0.2, y: 0.8 }];
    expect(cropQuadPixels(q, 100, 100)).toEqual([10, 20, 90, 10, 80, 90, 20, 80]);
  });

  it("falls back to the full-rect corners for a missing corner (never NaN)", () => {
    expect(cropQuadPixels([{ x: 0.25, y: 0.25 }], 100, 100)).toEqual([25, 25, 100, 0, 100, 100, 0, 100]);
  });
});

describe("suggestedCropSize", () => {
  it("is the full canvas for the identity quad", () => {
    expect(suggestedCropSize(FULL_CROP_QUAD, 240, 160)).toEqual({ w: 240, h: 160 });
  });

  it("averages opposite edge lengths of a skewed quad", () => {
    // top edge 100px, bottom 60px → w = 80; slanted sides √(20²+100²) ≈ 102 → h = 102
    const q: CropCorner[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.8, y: 1 }, { x: 0.2, y: 1 }];
    expect(suggestedCropSize(q, 100, 100)).toEqual({ w: 80, h: 102 });
  });

  it("never returns a zero dimension", () => {
    const degenerate: CropCorner[] = [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }];
    const s = suggestedCropSize(degenerate, 100, 100);
    expect(s.w).toBeGreaterThanOrEqual(1);
    expect(s.h).toBeGreaterThanOrEqual(1);
  });
});

describe("isIdentityCrop", () => {
  it("accepts only a full quad at the unchanged rounded size", () => {
    expect(isIdentityCrop(FULL_CROP_QUAD, 240, 160, 240, 160)).toBe(true);
    expect(isIdentityCrop(FULL_CROP_QUAD, 240, 160, 239, 160)).toBe(false);
    expect(isIdentityCrop([{ x: 0.01, y: 0 }, ...FULL_CROP_QUAD.slice(1)], 240, 160, 240, 160)).toBe(false);
  });
});
