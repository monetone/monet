// Unit tests for the Crop tool's pure aspect-ratio helpers. Engine-free (node);
// the live crop is covered by e2e/crop-aspect.spec.ts.
import { describe, it, expect } from "vitest";
import { aspectRatioFor, fitRectToAspect, CROP_ASPECTS } from "./cropAspect";

describe("aspectRatioFor", () => {
  it("maps known preset keys to their ratio", () => {
    expect(aspectRatioFor("free")).toBe(0);
    expect(aspectRatioFor("1:1")).toBe(1);
    expect(aspectRatioFor("16:9")).toBeCloseTo(16 / 9, 6);
    expect(aspectRatioFor("4:5")).toBeCloseTo(0.8, 6);
  });
  it("returns 0 for unknown keys", () => {
    expect(aspectRatioFor("nope")).toBe(0);
    expect(aspectRatioFor("")).toBe(0);
  });
  it("starts with Free (ratio 0)", () => {
    expect(CROP_ASPECTS[0]).toMatchObject({ key: "free", ratio: 0 });
  });
});

describe("fitRectToAspect", () => {
  it("is height-limited for a wider-than-ratio drag", () => {
    // 200×40 drag, 1:1 → fits a 40×40 square
    expect(fitRectToAspect(0, 0, 200, 40, 1)).toEqual({ x0: 0, y0: 0, w: 40, h: 40 });
  });
  it("is width-limited for a taller-than-ratio drag", () => {
    // 40×200 drag, 1:1 → fits a 40×40 square
    expect(fitRectToAspect(0, 0, 40, 200, 1)).toEqual({ x0: 0, y0: 0, w: 40, h: 40 });
  });
  it("produces the requested ratio (16:9)", () => {
    // 200×60 drag → height-limited: h=60, w=60*16/9≈107
    const r = fitRectToAspect(0, 0, 200, 60, 16 / 9);
    expect(r).toEqual({ x0: 0, y0: 0, w: 107, h: 60 });
    expect(r.w / r.h).toBeCloseTo(16 / 9, 1);
  });
  it("keeps the mousedown corner fixed when dragging up/left (#132)", () => {
    // drag from (100,80) up-left to (20,30): box 80×50, 1:1 → 50×50 grown from
    // the anchor, i.e. x∈[50,100], y∈[30,80]. The old code re-seated it at the
    // box top-left (20,30), leaving the grabbed corner 30px outside the rect.
    expect(fitRectToAspect(100, 80, 20, 30, 1)).toEqual({ x0: 50, y0: 30, w: 50, h: 50 });
    // up-right and down-left drags pin the anchor on one axis each
    expect(fitRectToAspect(100, 80, 180, 30, 1)).toEqual({ x0: 100, y0: 30, w: 50, h: 50 });
    expect(fitRectToAspect(100, 80, 20, 130, 1)).toEqual({ x0: 50, y0: 80, w: 50, h: 50 });
  });
  it("yields a zero-size rect for a zero-height drag", () => {
    expect(fitRectToAspect(5, 5, 100, 5, 1)).toEqual({ x0: 5, y0: 5, w: 0, h: 0 });
  });
});
