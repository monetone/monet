import { describe, it, expect } from "vitest";
import { catmullRomResample } from "./pathSmooth";

describe("catmullRomResample", () => {
  it("returns the input unchanged when there are fewer than 3 points", () => {
    expect(catmullRomResample([0, 0, 10, 10])).toEqual([0, 0, 10, 10]);
  });

  it("keeps a straight horizontal run straight (no overshoot)", () => {
    const out = catmullRomResample([0, 0, 10, 0, 20, 0, 30, 0], 5);
    for (let i = 1; i < out.length; i += 2) expect(Math.abs(out[i])).toBeLessThan(1e-6);
    // x stays monotonically increasing across the resampled path
    for (let i = 2; i < out.length; i += 2) expect(out[i]).toBeGreaterThanOrEqual(out[i - 2] - 1e-6);
  });

  it("passes through the original anchor points and densifies the path", () => {
    const pts = [0, 0, 10, 8, 20, 0];
    const out = catmullRomResample(pts, 6);
    // first and last anchors are preserved exactly
    expect(out.slice(0, 2)).toEqual([0, 0]);
    expect(out.slice(-2)).toEqual([20, 0]);
    // (n-1) segments × perSeg + 1 final point
    expect(out.length / 2).toBe((3 - 1) * 6 + 1);
  });
});

// The Curvature Pen fits a smooth interpolating curve through the user's CLICKED
// anchor points (re-using catmullRomResample). The defining property of that tool
// is that the fitted curve passes through EVERY clicked anchor (not just the ends)
// while bending smoothly between them — unlike a plain straight-segment polyline.
describe("Curvature Pen curve fit (Catmull-Rom through clicked points)", () => {
  const perSeg = 8;
  const clicks = [10, 10, 50, 40, 90, 10, 130, 50]; // 4 clicked anchors
  const n = clicks.length / 2;

  it("passes through every clicked anchor, not just the endpoints", () => {
    const out = catmullRomResample(clicks, perSeg);
    for (let i = 0; i < n; i++) {
      // anchor i lands at the start of its segment (index i*perSeg); the last
      // anchor is the explicit final point.
      const idx = i < n - 1 ? i * perSeg * 2 : out.length - 2;
      expect(out[idx]).toBeCloseTo(clicks[i * 2], 6);
      expect(out[idx + 1]).toBeCloseTo(clicks[i * 2 + 1], 6);
    }
  });

  it("densifies the path between anchors so the curve can bend", () => {
    const out = catmullRomResample(clicks, perSeg);
    expect(out.length / 2).toBe((n - 1) * perSeg + 1);
  });

  it("bends smoothly between clicked points instead of cutting straight across", () => {
    // Three clicks with the middle one off the chord between the outer two: the
    // fitted curve must actually deviate from that straight chord at its midpoint.
    const pts = [0, 0, 50, 40, 100, 0];
    const out = catmullRomResample(pts, 10);
    // The fitted curve must bow off the straight A→C chord (the x-axis, y=0 here)
    // toward the (50,40) click — a plain polyline would stay on the chord.
    let maxY = 0;
    for (let i = 1; i < out.length; i += 2) maxY = Math.max(maxY, out[i]);
    expect(maxY).toBeGreaterThan(20);
  });
});
