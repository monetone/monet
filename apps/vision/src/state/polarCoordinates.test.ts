// Unit tests for the Polar Coordinates distortion. Engine-free (node). These pin the
// rectangular↔polar remap (must match mod.rs polar_buf) via its geometric invariants:
// Polar→Rect places the source at radius (y+0.5)/h·maxR from the centre (depends only on
// the row); Rect→Polar keeps every source in bounds (constant-invariant) while Polar→Rect
// pushes the disc's corners off the image → black.
import { describe, it, expect } from "vitest";
import { polarMaxRadius, polarSource, polar2D, POLAR_MAX } from "./polarCoordinates";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();
const hyp = Math.hypot;

describe("polarMaxRadius", () => {
  it("is the half-diagonal, floored at 1", () => {
    expect(polarMaxRadius(10, 10)).toBeCloseTo(Math.sqrt(50), 5);
    expect(polarMaxRadius(8, 6)).toBeCloseTo(5, 5); // √(16+9)
    expect(polarMaxRadius(1, 1)).toBe(1); // √0.5 → floored to 1
  });
});

describe("polarSource — Polar→Rectangular (toPolar = false)", () => {
  const W = 12;
  const H = 12;
  const cx = W / 2;
  const cy = H / 2;
  const maxR = polarMaxRadius(W, H);

  it("places the source at radius (y+0.5)/h·maxR from the centre (depends only on the row)", () => {
    for (const [x, y] of [
      [0, 1],
      [5, 1],
      [3, 6],
      [8, 10],
    ]) {
      const s = polarSource(x, y, W, H, false);
      const srcR = hyp(s.fx + 0.5 - cx, s.fy + 0.5 - cy);
      expect(srcR).toBeCloseTo(((y + 0.5) / H) * maxR, 2);
    }
  });

  it("the source radius is the same across a row and grows with the row index", () => {
    const radAt = (x: number, y: number) => {
      const s = polarSource(x, y, W, H, false);
      return hyp(s.fx + 0.5 - cx, s.fy + 0.5 - cy);
    };
    expect(radAt(0, 4)).toBeCloseTo(radAt(9, 4), 3); // same row → same radius
    expect(radAt(3, 1)).toBeLessThan(radAt(3, 6)); // deeper row → larger radius
    expect(radAt(3, 6)).toBeLessThan(radAt(3, 11));
  });

  it("the top row samples near the centre (tiny radius)", () => {
    const s = polarSource(5, 0, W, H, false);
    expect(hyp(s.fx + 0.5 - cx, s.fy + 0.5 - cy)).toBeLessThan(maxR * 0.1);
  });
});

describe("polarSource — Rectangular→Polar (toPolar = true)", () => {
  const W = 12;
  const H = 12;
  const cx = W / 2;
  const cy = H / 2;
  const maxR = polarMaxRadius(W, H);

  it("encodes the pixel's distance from centre as the source row", () => {
    const near = polarSource(6, 6, W, H, true); // r ≈ 0.707
    expect(near.fy + 0.5).toBeCloseTo((hyp(6.5 - cx, 6.5 - cy) / maxR) * H, 1);
    const corner = polarSource(0, 0, W, H, true); // r ≈ maxR
    expect(corner.fy + 0.5).toBeGreaterThan(near.fy + 0.5);
    expect(corner.fy + 0.5).toBeGreaterThan(H * 0.9); // corner → bottom of the source
  });

  it("handles the dead-centre pixel (atan2(0,0)) with a finite, in-bounds source", () => {
    // odd dims → pixel (5,5) of 11×11 sits exactly at the centre (dx=dy=0, r=0). The
    // degenerate angle resolves via atan2(0,−0)=π → source column 5.5, and r=0 → top row.
    const s = polarSource(5, 5, 11, 11, true);
    expect(Number.isFinite(s.fx)).toBe(true);
    expect(Number.isFinite(s.fy)).toBe(true);
    expect(s.fx + 0.5).toBeCloseTo(5.5, 5); // sxc = π/2π · 11
    expect(s.fy + 0.5).toBeCloseTo(0, 5); // syc = 0/maxR · 11 → top row
  });

  it("encodes the angle as the source column (in [0, w))", () => {
    for (const [x, y] of [
      [3, 2],
      [9, 8],
      [0, 5],
    ]) {
      const s = polarSource(x, y, W, H, true);
      expect(s.fx + 0.5).toBeGreaterThanOrEqual(0);
      expect(s.fx + 0.5).toBeLessThan(W);
    }
  });
});

describe("polar2D", () => {
  it("Rectangular→Polar leaves a constant image unchanged (every source stays in bounds)", () => {
    const g = grid(11, 11, () => 33000);
    expect(polar2D(g, true)).toEqual(g);
  });

  it("Polar→Rectangular pushes the disc's corners off the image → some black pixels", () => {
    const g = grid(11, 11, () => 50000);
    const out = polar2D(g, false);
    expect(out.some((row) => row.some((v) => v === 0))).toBe(true); // edges go black
    expect(out[5][5]).toBe(50000); // the central output stays in bounds → constant
  });

  it("remaps a non-trivial image (not the identity, both directions)", () => {
    const g = grid(13, 13, (x, y) => (x + y) * 2000);
    expect(polar2D(g, true)).not.toEqual(g);
    expect(polar2D(g, false)).not.toEqual(g);
  });

  it("keeps every output within [0, 65535]", () => {
    const g = grid(10, 12, (x, y) => (x * 6151 + y * 3079) % POLAR_MAX);
    for (const toPolar of [true, false]) {
      for (const v of flat(polar2D(g, toPolar))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(POLAR_MAX);
      }
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(polar2D([], true)).toEqual([]);
    expect(polar2D([[], []], false)).toEqual([[], []]);
    expect(polar2D([[42]], true)).toEqual([[42]]); // lone pixel resamples to itself
    expect(polar2D([[42]], false)).toEqual([[42]]);
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % 40000);
    expect(polar2D(g, true)).toEqual(polar2D(g, true));
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => (x + y) * 3000);
    const snapshot = g.map((row) => [...row]);
    polar2D(g, true);
    polar2D(g, false);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image (both directions)", () => {
    const g = grid(5, 11, (x, y) => (x * 11 + y * 5) % 50000);
    for (const toPolar of [true, false]) {
      const out = polar2D(g, toPolar);
      expect(out.length).toBe(5);
      expect(out.every((row) => row.length === 11)).toBe(true);
    }
  });
});

// ── Both directions swept over several images for in-range + shape ───────────
const IMAGES: { name: string; image: number[][] }[] = [
  { name: "radial gradient", image: grid(13, 13, (x, y) => Math.round(hyp(x - 6, y - 6) * 4000)) },
  { name: "vertical bands", image: grid(12, 12, (x) => (x % 3 === 0 ? 60000 : 5000)) },
  { name: "checkerboard", image: grid(12, 12, (x, y) => ((x + y) % 2 ? 65535 : 0)) },
];

describe.each(IMAGES)("fixture: $name", ({ image }) => {
  it("stays in range and keeps shape for both directions", () => {
    for (const toPolar of [true, false]) {
      const out = polar2D(image, toPolar);
      expect(out.length).toBe(image.length);
      expect(out.every((row) => row.length === image[0].length)).toBe(true);
      for (const v of flat(out)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(POLAR_MAX);
      }
    }
  });
});
