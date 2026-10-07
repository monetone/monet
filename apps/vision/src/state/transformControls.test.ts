// Unit tests for the transform-controls geometry. Engine-free (node); the overlay
// + Move options bar are covered by e2e/move-options.spec.ts.
import { describe, it, expect } from "vitest";
import { pathTransformMatrix, transformHandles, transformPoints } from "./transformControls";

describe("transformHandles", () => {
  it("returns the 8 handles of a box at the origin, ordered TL,T,TR,R,BR,B,BL,L", () => {
    expect(transformHandles(0, 0, 100, 80)).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 40 },
      { x: 100, y: 80 },
      { x: 50, y: 80 },
      { x: 0, y: 80 },
      { x: 0, y: 40 },
    ]);
  });

  it("offsets all handles for a box not at the origin", () => {
    const h = transformHandles(10, 20, 40, 40);
    expect(h[0]).toEqual({ x: 10, y: 20 }); // top-left
    expect(h[4]).toEqual({ x: 50, y: 60 }); // bottom-right
    expect(h[3]).toEqual({ x: 50, y: 40 }); // right edge midpoint
  });

  it("collapses all 8 handles to the point for a zero-size box", () => {
    expect(transformHandles(5, 5, 0, 0)).toEqual(new Array(8).fill({ x: 5, y: 5 }));
  });
});

describe("pathTransformMatrix guards (#163)", () => {
  // A 20x10 rect about its own centre — the dialog's raw values land here.
  const rect = [0, 0, 20, 0, 20, 10, 0, 10];
  const xf = (t: Parameters<typeof pathTransformMatrix>[0]) => transformPoints(rect, pathTransformMatrix(t, 10, 5));
  const span = (flat: number[]) => {
    const xs = flat.filter((_, i) => i % 2 === 0), ys = flat.filter((_, i) => i % 2 === 1);
    return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };

  it("clamps ±90° skew instead of throwing the path ~1e17 px off-canvas", () => {
    const s = span(xf({ skewH: 90 }));
    expect(s.w).toBeLessThan(1e4); // tan(89°) · 10 ≈ 573 of shear, not 1.6e17
    expect(s.h).toBeCloseTo(10, 6);
    expect(span(xf({ skewV: -90 })).h).toBeLessThan(1e4);
  });

  it("keeps a zero or non-finite scale from collapsing the path to a line", () => {
    expect(span(xf({ sx: 0 })).w).toBeGreaterThan(0);
    expect(span(xf({ sy: 0 })).h).toBeGreaterThan(0);
    expect(xf({ sx: NaN, sy: NaN })).toEqual(rect); // NaN reads as "unchanged"
  });

  it("ignores non-finite rotation and translation", () => {
    expect(xf({ deg: NaN })).toEqual(rect);
    expect(xf({ tx: NaN, ty: Infinity })).toEqual(rect);
  });

  it("leaves valid transforms untouched", () => {
    expect(xf({ sx: 2, sy: 2 })).toEqual([-10, -5, 30, -5, 30, 15, -10, 15]);
    expect(xf({ tx: 5, ty: -3 })).toEqual([5, -3, 25, -3, 25, 7, 5, 7]);
  });
});
