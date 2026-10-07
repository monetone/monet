// Unit tests for the Path Blur stroke geometry — the user-drawn Bezier paths
// behind Blur Gallery ▸ Path Blur. The per-pixel direction field they feed is
// covered by packages/engine mod.rs path_blur_tests.
import { describe, it, expect } from "vitest";
import {
  defaultBlurPath, flattenBlurPaths, hitTestBlurPaths, samplePath, type BlurPathStroke,
} from "./blurPathStrokes";

const stroke = (points: { x: number; y: number }[], speedStart = 1, speedEnd = 1): BlurPathStroke =>
  ({ points, speedStart, speedEnd });

describe("path blur strokes", () => {
  it("defaultBlurPath lays a horizontal path across the document", () => {
    const p = defaultBlurPath(400, 200);
    expect(p.points).toEqual([{ x: 100, y: 100 }, { x: 300, y: 100 }]);
    expect(p.speedStart).toBe(1);
    expect(p.speedEnd).toBe(1);
  });

  it("samplePath leaves a two-anchor path a straight segment", () => {
    const pts = samplePath(stroke([{ x: 0, y: 0 }, { x: 10, y: 0 }]));
    expect(pts).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  });

  it("samplePath bends three anchors into a curve that still reaches its ends", () => {
    const pts = samplePath(stroke([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }]));
    expect(pts.length).toBeGreaterThan(3);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 20, y: 0 });
    // The apex bulges past the straight chord through the middle anchor.
    expect(Math.max(...pts.map((q) => q.y))).toBeGreaterThan(9.9);
    // …and the curve never leaves the anchors' span.
    expect(Math.min(...pts.map((q) => q.x))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...pts.map((q) => q.x))).toBeLessThanOrEqual(20);
  });

  it("flattenBlurPaths packs a self-describing record per path", () => {
    const flat = flattenBlurPaths([
      stroke([{ x: 1, y: 2 }, { x: 3, y: 4 }], 0.5, 1.5),
      stroke([{ x: 5, y: 6 }, { x: 7, y: 8 }]),
    ]);
    expect(Array.from(flat)).toEqual([2, 0.5, 1.5, 1, 2, 3, 4, 2, 1, 1, 5, 6, 7, 8]);
    // Each record is header + 2 floats per point, so the array walks cleanly.
    let i = 0;
    let records = 0;
    while (i < flat.length) { i += 3 + flat[i] * 2; records++; }
    expect(i).toBe(flat.length);
    expect(records).toBe(2);
  });

  it("flattenBlurPaths drops directionless paths and clamps negative speeds", () => {
    expect(flattenBlurPaths([stroke([{ x: 1, y: 1 }])]).length).toBe(0);
    expect(flattenBlurPaths([])).toEqual(new Float32Array(0));
    const flat = flattenBlurPaths([stroke([{ x: 0, y: 0 }, { x: 1, y: 1 }], -2, 3)]);
    expect(flat[1]).toBe(0);
    expect(flat[2]).toBe(3);
  });

  it("flattenBlurPaths emits the flattened curve, not the raw anchors", () => {
    const curved = stroke([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }]);
    const flat = flattenBlurPaths([curved]);
    expect(flat[0]).toBe(samplePath(curved).length);
    expect(flat[0]).toBeGreaterThan(curved.points.length);
  });

  it("hitTestBlurPaths grabs the nearest anchor of the topmost path", () => {
    const paths = [
      stroke([{ x: 10, y: 10 }, { x: 50, y: 10 }]),
      stroke([{ x: 12, y: 10 }, { x: 80, y: 10 }]),
    ];
    expect(hitTestBlurPaths(paths, 11, 10, 4)).toEqual({ path: 1, point: 0 });
    expect(hitTestBlurPaths(paths, 50, 10, 4)).toEqual({ path: 0, point: 1 });
    expect(hitTestBlurPaths(paths, 200, 200, 4)).toBeNull();
  });
});
