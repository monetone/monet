// Unit tests for the Despeckle filter. Engine-free (node). These pin the integer edge
// metric (must match filters.rs despeckle: max |center−neighbour| over the 4-connected
// edge-clamped neighbours), the EDGE=38·257 keep-vs-blur threshold, and the conditional
// 3×3 mean — so low-contrast noise is smoothed while real edges are preserved exactly.
import { describe, it, expect } from "vitest";
import { edgeAt, despeckle2D, EDGE, EDGE_8BIT } from "./despeckle";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("EDGE constant", () => {
  it("is 38·257 in u16 (= 38 in 8-bit, ≈0.15 of full range)", () => {
    expect(EDGE).toBe(9766);
    expect(EDGE_8BIT).toBe(38);
    expect(EDGE).toBe(EDGE_8BIT * 257);
  });
});

describe("edgeAt (max diff to 4-connected neighbours)", () => {
  it("is 0 on a flat field", () => {
    const g = grid(4, 4, () => 20000);
    expect(edgeAt(g, 1, 1)).toBe(0);
    expect(edgeAt(g, 0, 0)).toBe(0); // clamped corner of a flat field
  });

  it("is the max absolute difference to up/down/left/right", () => {
    const g = grid(5, 5, () => 20000);
    g[2][2] = 22000;
    expect(edgeAt(g, 2, 2)).toBe(2000); // |22000−20000|
    // a neighbour of the spike sees it too
    expect(edgeAt(g, 1, 2)).toBe(2000);
  });

  it("ignores diagonal neighbours (4-connected only)", () => {
    const g = grid(3, 3, () => 20000);
    g[0][0] = 50000; // a diagonal of the centre
    expect(edgeAt(g, 1, 1)).toBe(0); // centre's 4-neighbours are all still 20000
  });

  it("takes the maximum across the four directions", () => {
    const g = grid(3, 3, () => 20000);
    g[1][1] = 20000;
    g[1][0] = 25000; // left  → diff 5000
    g[0][1] = 31000; // up    → diff 11000 (the max)
    expect(edgeAt(g, 1, 1)).toBe(11000);
  });

  it("edge-clamps at the border (out-of-bounds taps replicate the edge)", () => {
    const g = grid(3, 3, () => 20000);
    g[0][1] = 40000; // the up-neighbour of the top-row centre is itself (clamped)
    // for corner (0,0): right=(1,0)=20000, down=(0,1)=40000 → diff 20000
    expect(edgeAt(g, 0, 0)).toBe(20000);
  });
});

describe("despeckle2D — edges vs flats", () => {
  it("returns an empty image unchanged", () => {
    expect(despeckle2D([])).toEqual([]);
    expect(despeckle2D([[], []])).toEqual([[], []]);
  });

  it("leaves a constant image unchanged (mean of equals)", () => {
    const g = grid(5, 5, () => 30000);
    expect(despeckle2D(g)).toEqual(g);
  });

  it("handles degenerate 1×1 and single-row images (neighbours clamp to self)", () => {
    expect(edgeAt([[42000]], 0, 0)).toBe(0); // no neighbours → no edge
    expect(despeckle2D([[42000]])).toEqual([[42000]]); // 1×1 blurs to itself
    // single row: vertical taps clamp onto the one row; a strong horizontal edge is kept
    const row = [[10000, 10000, 30000, 30000, 30000]];
    expect(despeckle2D(row)).toEqual(row);
  });

  it("preserves a strong step edge exactly (both sides kept, flats unchanged)", () => {
    // |10000−30000| = 20000 ≥ EDGE → boundary pixels are kept; flats average to themselves
    const g = grid(5, 5, (x) => (x < 2 ? 10000 : 30000));
    expect(despeckle2D(g)).toEqual(g);
  });

  it("does not mutate the input", () => {
    const g = grid(4, 4, (x, y) => 20000 + ((x + y) % 2) * 1000);
    const snapshot = g.map((row) => [...row]);
    despeckle2D(g);
    expect(g).toEqual(snapshot);
  });

  it("is deterministic", () => {
    const g = grid(5, 5, (x, y) => 15000 + ((x * 7 + y * 13) % 9) * 800);
    expect(despeckle2D(g)).toEqual(despeckle2D(g));
  });
});

describe("despeckle2D — the EDGE threshold gates noise removal", () => {
  const field = (spike: number): number[][] => {
    const g = grid(5, 5, () => 20000);
    g[2][2] = spike;
    return g;
  };

  it("smooths a sub-threshold spike (diff < EDGE) toward its neighbours", () => {
    const spike = 20000 + (EDGE_8BIT - 2) * 257; // diff 9252 < 9766
    const out = despeckle2D(field(spike));
    expect(out[2][2]).toBeLessThan(spike); // pulled down…
    expect(out[2][2]).toBeGreaterThan(20000); // …but above the field
    expect(out[2][2]).toBe(Math.round((8 * 20000 + spike) / 9)); // exact 3×3 mean
  });

  it("KEEPS a supra-threshold spike (diff ≥ EDGE) — it looks like an edge", () => {
    const spike = 20000 + (EDGE_8BIT + 2) * 257; // diff 10280 ≥ 9766
    const out = despeckle2D(field(spike));
    expect(out[2][2]).toBe(spike); // the spike is preserved exactly (not smoothed)
    // its 4-connected neighbours also exceed the threshold vs the spike → kept at the field
    for (const [nx, ny] of [
      [2, 1],
      [2, 3],
      [1, 2],
      [3, 2],
    ]) {
      expect(out[ny][nx]).toBe(20000);
    }
  });

  it("pins the exact boundary: diff == EDGE is kept, diff == EDGE−1 is blurred", () => {
    const keep = field(20000 + EDGE); // diff exactly 9766 ≥ EDGE → keep
    expect(despeckle2D(keep)[2][2]).toBe(20000 + EDGE);

    const blur = field(20000 + EDGE - 1); // diff 9765 < EDGE → blur
    const out = despeckle2D(blur);
    expect(out[2][2]).toBe(Math.round((8 * 20000 + (20000 + EDGE - 1)) / 9));
    expect(out[2][2]).toBeLessThan(20000 + EDGE - 1);
  });
});

describe("despeckle2D — exact blur value & range", () => {
  it("computes the rounded 3×3 mean for a sub-threshold spike", () => {
    const g = grid(5, 5, () => 20000);
    g[2][2] = 22000; // diff 2000 < EDGE → blur
    const out = despeckle2D(g);
    expect(out[2][2]).toBe(20222); // round(182000/9)
    expect(out[0][0]).toBe(20000); // far corner untouched
  });

  it("keeps every output within the input's min/max range", () => {
    const g = grid(6, 7, (x, y) => 10000 + ((x * 31 + y * 17) % 20) * 1500);
    const lo = Math.min(...flat(g));
    const hi = Math.max(...flat(g));
    for (const v of flat(despeckle2D(g))) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(lo);
      expect(v).toBeLessThanOrEqual(hi);
    }
  });

  it("a checkerboard (every pixel an edge) is preserved exactly", () => {
    // every 4-neighbour differs by ≫ EDGE → all pixels kept → identity
    const g = grid(6, 6, (x, y) => ((x + y) % 2 ? 60000 : 5000));
    expect(despeckle2D(g)).toEqual(g);
  });
});

// ── Several fixtures swept for in-range, shape, and edge-vs-noise behaviour ───
const FIXTURES: { name: string; image: number[][] }[] = [
  { name: "flat with speckle", image: grid(7, 7, (x, y) => (x === 3 && y === 3 ? 24000 : 20000)) },
  { name: "strong vertical edge", image: grid(5, 8, (x) => (x < 4 ? 8000 : 40000)) },
  { name: "checkerboard (all edges)", image: grid(6, 6, (x, y) => ((x + y) % 2 ? 60000 : 5000)) },
  { name: "gentle gradient", image: grid(6, 6, (x) => x * 2000) },
];

describe.each(FIXTURES)("fixture: $name", ({ image }) => {
  it("stays in range, keeps shape, and never introduces an out-of-gamut value", () => {
    const lo = Math.min(...flat(image));
    const hi = Math.max(...flat(image));
    const out = despeckle2D(image);
    expect(out.length).toBe(image.length);
    expect(out.every((row) => row.length === image[0].length)).toBe(true);
    for (const v of flat(out)) {
      expect(v).toBeGreaterThanOrEqual(lo);
      expect(v).toBeLessThanOrEqual(hi);
    }
  });
});
