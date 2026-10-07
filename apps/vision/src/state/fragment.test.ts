// Unit tests for the Fragment filter. Engine-free (node). These pin the 4-tap diagonal
// average (must match filters.rs fragment: mean of (x±4, y±4), edge-clamped) and its
// defining "earthquake" behaviour: a sharp spike is quadrupled into four quarter-strength
// ghosts offset to the diagonals, while flats and edges-of-clamp stay sane.
import { describe, it, expect } from "vitest";
import { fragment2D, OFF, FRAGMENT_OFFSETS } from "./fragment";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("constants", () => {
  it("OFF is 4 and the offsets are the four diagonal corners", () => {
    expect(OFF).toBe(4);
    expect(FRAGMENT_OFFSETS).toEqual([
      [-4, -4],
      [4, -4],
      [-4, 4],
      [4, 4],
    ]);
  });
});

describe("fragment2D", () => {
  it("leaves a constant image unchanged (mean of four equals)", () => {
    const g = grid(12, 12, () => 30000);
    expect(fragment2D(g)).toEqual(g);
  });

  it("spreads a lone spike into four quarter-strength diagonal ghosts", () => {
    // spike of 400 at (6,6) in a 13×13 field of 0. Output(y,x) samples the spike iff
    // (x±4, y±4) hits (6,6), i.e. at the four anti-diagonal positions; each gets V/4.
    const g = grid(13, 13, (x, y) => (x === 6 && y === 6 ? 400 : 0));
    const out = fragment2D(g);
    for (const [gx, gy] of [
      [2, 2],
      [10, 2],
      [2, 10],
      [10, 10],
    ]) {
      expect(out[gy][gx]).toBe(100); // round(400/4)
    }
    expect(out[6][6]).toBe(0); // the spike is gone from its own position
    expect(out[0][0]).toBe(0); // far corner untouched
  });

  it("averages four distinct diagonal taps", () => {
    // place known values at the four taps of the centre pixel (6,6): (2,2),(10,2),(2,10),(10,10)
    const g = grid(13, 13, () => 0);
    g[2][2] = 100;
    g[2][10] = 200;
    g[10][2] = 300;
    g[10][10] = 400;
    expect(fragment2D(g)[6][6]).toBe(Math.round((100 + 200 + 300 + 400) / 4)); // 250
  });

  it("edge-clamps: in a flat field every pixel (incl. borders) stays the constant", () => {
    const g = grid(6, 6, () => 12345);
    expect(fragment2D(g)).toEqual(g); // all clamped taps replicate the same value
  });

  it("clamps the diagonal taps at the borders (corner samples replicate the edge)", () => {
    // a 5×5 (< 2·OFF) image: every tap clamps deep into the image. Build a vertical split
    // and confirm output is a valid 4-tap mean of clamped taps, in range.
    const g = grid(5, 5, (x) => (x < 2 ? 10000 : 50000));
    const out = fragment2D(g);
    for (const v of flat(out)) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(10000);
      expect(v).toBeLessThanOrEqual(50000);
    }
    // top-left (0,0): all four taps clamp to corners {(0,0)=10000,(0,4? )...} → compute
    // taps: (−4,−4)→(0,0)=10000, (4,−4)→(4,0)=50000, (−4,4)→(0,4)=10000, (4,4)→(4,4)=50000
    expect(out[0][0]).toBe(Math.round((10000 + 50000 + 10000 + 50000) / 4)); // 30000
  });

  it("keeps the output within the input's min/max range", () => {
    const g = grid(10, 12, (x, y) => (x * 31 + y * 17) % 60000);
    const lo = Math.min(...flat(g));
    const hi = Math.max(...flat(g));
    for (const v of flat(fragment2D(g))) {
      expect(v).toBeGreaterThanOrEqual(lo);
      expect(v).toBeLessThanOrEqual(hi);
    }
  });

  it("handles an empty image and is deterministic", () => {
    expect(fragment2D([])).toEqual([]);
    expect(fragment2D([[], []])).toEqual([[], []]);
    const g = grid(9, 9, (x, y) => (x * 7 + y * 13) % 50000);
    expect(fragment2D(g)).toEqual(fragment2D(g));
  });

  it("does not mutate the input", () => {
    const g = grid(11, 11, (x, y) => (x + y) * 2000);
    const snapshot = g.map((row) => [...row]);
    fragment2D(g);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(4, 13, (x, y) => (x * 11 + y * 5) % 40000);
    const out = fragment2D(g);
    expect(out.length).toBe(4);
    expect(out.every((row) => row.length === 13)).toBe(true);
  });

  it("computes the right averaged value on a non-square image (pins the per-axis clamp)", () => {
    // 5 rows × 13 cols, vertical edge at x=6. For output (x=8, y=2) the four taps are
    // (4,0)=1000, (12,0)=9000, (4,4)=1000, (12,4)=9000 (rows clamp −2→0 and 6→4) → 5000.
    const g = grid(5, 13, (x) => (x < 6 ? 1000 : 9000));
    expect(fragment2D(g)[2][8]).toBe(5000);
  });
});

// ── Several fixtures swept for in-range, shape, and flat-preservation ─────────
const FIXTURES: { name: string; image: number[][] }[] = [
  { name: "checkerboard", image: grid(12, 12, (x, y) => ((x + y) % 2 ? 60000 : 0)) },
  { name: "vertical bands", image: grid(10, 12, (x) => (x % 4 < 2 ? 15000 : 45000)) },
  { name: "gradient", image: grid(12, 12, (x, y) => (x + y) * 2000) },
  { name: "central impulse", image: grid(15, 15, (x, y) => (x === 7 && y === 7 ? 65535 : 8000)) },
];

describe.each(FIXTURES)("fixture: $name", ({ image }) => {
  it("stays in range and keeps its shape", () => {
    const lo = Math.min(...flat(image));
    const hi = Math.max(...flat(image));
    const out = fragment2D(image);
    expect(out.length).toBe(image.length);
    expect(out.every((row) => row.length === image[0].length)).toBe(true);
    for (const v of flat(out)) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(lo);
      expect(v).toBeLessThanOrEqual(hi);
    }
  });
});
