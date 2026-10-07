import { describe, expect, it } from "vitest";

import { CROP_GUIDES, cropGuideLines, cropGuideSpiral, nextCropGuide, SPIRAL_ORIENTATIONS, type Rect } from "./cropGuides";

const full: Rect = { left: 0, top: 0, right: 1, bottom: 1 };

describe("cropGuideLines", () => {
  it("thirds draws two verticals + two horizontals at 1/3 and 2/3 of the rect", () => {
    const lines = cropGuideLines("thirds", full);
    expect(lines).toHaveLength(4);
    // Verticals span top→bottom at the third columns; horizontals span left→right.
    expect(lines).toContainEqual({ x1: 1 / 3, y1: 0, x2: 1 / 3, y2: 1 });
    expect(lines).toContainEqual({ x1: 2 / 3, y1: 0, x2: 2 / 3, y2: 1 });
    expect(lines).toContainEqual({ x1: 0, y1: 1 / 3, x2: 1, y2: 1 / 3 });
    expect(lines).toContainEqual({ x1: 0, y1: 2 / 3, x2: 1, y2: 2 / 3 });
  });

  it("maps fractions into a sub-rect (offset + scale), not the whole canvas", () => {
    const rect: Rect = { left: 0.2, top: 0.4, right: 0.8, bottom: 1.0 }; // 0.6 × 0.6
    const lines = cropGuideLines("thirds", rect);
    // First vertical third: x = left + (1/3)·width = 0.2 + 0.2 = 0.4, spanning the rect's rows.
    expect(lines).toContainEqual({ x1: 0.4, y1: 0.4, x2: 0.4, y2: 1.0 });
    // First horizontal third: y = top + (1/3)·height = 0.4 + 0.2 = 0.6.
    expect(lines).toContainEqual({ x1: 0.2, y1: 0.6, x2: 0.8, y2: 0.6 });
  });

  it("golden ratio splits at 1/φ and its complement (not the thirds)", () => {
    const xs = cropGuideLines("goldenRatio", full)
      .filter((l) => l.y1 === 0) // verticals
      .map((l) => l.x1)
      .sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(0.381966, 5);
    expect(xs[1]).toBeCloseTo(0.618034, 5);
  });

  it("grid draws quarter lines (three per axis)", () => {
    const lines = cropGuideLines("grid", full);
    expect(lines).toHaveLength(6);
    const xs = lines.filter((l) => l.y1 === 0).map((l) => l.x1).sort((a, b) => a - b);
    expect(xs).toEqual([0.25, 0.5, 0.75]);
  });
});

describe("cropGuideLines — angle guides", () => {
  it("diagonal on a square rect draws both corner diagonals (45° == corner-to-corner)", () => {
    const lines = cropGuideLines("diagonal", full, 1); // rp = 1
    expect(lines).toHaveLength(4);
    expect(lines).toContainEqual({ x1: 0, y1: 0, x2: 1, y2: 1 });
    expect(lines).toContainEqual({ x1: 1, y1: 0, x2: 0, y2: 1 });
  });

  it("diagonal on a 2:1 rect reaches the mid of the long side (short side sets the 45° travel)", () => {
    const lines = cropGuideLines("diagonal", full, 2); // rp = 2 → k = 0.5
    expect(lines).toContainEqual({ x1: 0, y1: 0, x2: 0.5, y2: 1 });
    expect(lines).toContainEqual({ x1: 1, y1: 0, x2: 0.5, y2: 1 });
  });

  it("triangle draws the main diagonal + a perpendicular from each other corner", () => {
    // Square: both perpendicular feet land at the centre.
    const sq = cropGuideLines("triangle", full, 1);
    expect(sq).toHaveLength(3);
    expect(sq).toContainEqual({ x1: 0, y1: 0, x2: 1, y2: 1 });
    expect(sq).toContainEqual({ x1: 1, y1: 0, x2: 0.5, y2: 0.5 });
    expect(sq).toContainEqual({ x1: 0, y1: 1, x2: 0.5, y2: 0.5 });
    // 2:1 rect: feet at t = rp²/(rp²+1) = 4/5 and 1/(rp²+1) = 1/5.
    const wide = cropGuideLines("triangle", full, 2);
    expect(wide).toContainEqual({ x1: 1, y1: 0, x2: 0.8, y2: 0.8 });
    expect(wide).toContainEqual({ x1: 0, y1: 1, x2: 0.2, y2: 0.2 });
  });

  it("maps angle-guide points into a sub-rect (offset + scale)", () => {
    const rect: Rect = { left: 0.2, top: 0.4, right: 0.8, bottom: 1.0 }; // 0.6 × 0.6, rp = 1
    const lines = cropGuideLines("diagonal", rect, 1);
    // TL corner diagonal spans the sub-rect corner to corner.
    expect(lines).toContainEqual({ x1: 0.2, y1: 0.4, x2: 0.8, y2: 1.0 });
  });
});

describe("nextCropGuide", () => {
  it("advances one step and wraps back to the start after a full cycle", () => {
    expect(nextCropGuide("thirds")).toBe("grid");
    expect(nextCropGuide("grid")).toBe("diagonal");
    expect(nextCropGuide("goldenRatio")).toBe("goldenSpiral");
    expect(nextCropGuide("goldenSpiral")).toBe("thirds");
    let g = CROP_GUIDES[0];
    for (let i = 0; i < CROP_GUIDES.length; i++) g = nextCropGuide(g);
    expect(g).toBe(CROP_GUIDES[0]);
  });
});

describe("cropGuideSpiral", () => {
  const PHI_INV = 0.6180339887498949;

  it("draws no fractional lines (the spiral is a polyline, not lines)", () => {
    expect(cropGuideLines("goldenSpiral", full)).toHaveLength(0);
  });

  it("starts at the rect corner and the first arc lands on the golden division", () => {
    const pts = cropGuideSpiral(full, 0, 7, 16);
    expect(pts[0].x).toBeCloseTo(0, 12);
    expect(pts[0].y).toBeCloseTo(0, 12);
    // Arc 1 ends at the canonical square's far corner → (1/φ, 1) normalized.
    expect(pts[16].x).toBeCloseTo(PHI_INV, 12);
    expect(pts[16].y).toBeCloseTo(1, 12);
  });

  it("is one continuous polyline: no duplicate joints, small steps, all inside the rect", () => {
    const pts = cropGuideSpiral(full);
    // 7 arcs × 16 samples + the single starting point.
    expect(pts).toHaveLength(7 * 16 + 1);
    for (let i = 1; i < pts.length; i++) {
      const gap = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThan(0.11); // ≤ first-arc chord (radius 1/φ span, 16 samples)
    }
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-12);
      expect(p.x).toBeLessThanOrEqual(1 + 1e-12);
      expect(p.y).toBeGreaterThanOrEqual(-1e-12);
      expect(p.y).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it("maps into a sub-rect (offset + scale)", () => {
    const rect: Rect = { left: 0.2, top: 0.4, right: 0.8, bottom: 1.0 };
    const pts = cropGuideSpiral(rect);
    expect(pts[0].x).toBeCloseTo(0.2, 12);
    expect(pts[0].y).toBeCloseTo(0.4, 12);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0.2 - 1e-12);
      expect(p.x).toBeLessThanOrEqual(0.8 + 1e-12);
      expect(p.y).toBeGreaterThanOrEqual(0.4 - 1e-12);
      expect(p.y).toBeLessThanOrEqual(1.0 + 1e-12);
    }
  });

  it("orientation 4 mirrors x and orientation 1 rotates 90° in unit space", () => {
    const base = cropGuideSpiral(full, 0);
    const mirrored = cropGuideSpiral(full, 4);
    const rotated = cropGuideSpiral(full, 1);
    for (let i = 0; i < base.length; i += 7) {
      expect(mirrored[i].x).toBeCloseTo(1 - base[i].x, 12);
      expect(mirrored[i].y).toBeCloseTo(base[i].y, 12);
      expect(rotated[i].x).toBeCloseTo(1 - base[i].y, 12);
      expect(rotated[i].y).toBeCloseTo(base[i].x, 12);
    }
  });

  it("cycles through 8 distinct orientations", () => {
    expect(SPIRAL_ORIENTATIONS).toBe(8);
    const signatures = new Set<string>();
    for (let o = 0; o < SPIRAL_ORIENTATIONS; o++) {
      const p = cropGuideSpiral(full, o)[40];
      signatures.add(`${p.x.toFixed(9)},${p.y.toFixed(9)}`);
    }
    expect(signatures.size).toBe(8);
  });
});
