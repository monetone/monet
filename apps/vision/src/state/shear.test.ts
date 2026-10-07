// Unit tests for the Shear distortion. Engine-free (node). These pin the per-row linear
// offset (must match mod.rs shear_buf: off = top + (bottom−top)·y/max(h−1,1)), the wrap
// (rem_euclid) vs clamp source mapping, and the horizontal-only resample: top=bottom=0 is
// the exact identity, an integer offset is an exact cyclic shift (wrap) or edge-repeat
// (clamp), the row index is unchanged, and a constant image is invariant.
import { describe, it, expect } from "vitest";
import { shearOffset, shearSourceX, shear2D, SHEAR_MAX } from "./shear";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();
const sorted = (a: number[]) => [...a].sort((p, q) => p - q);

describe("shearOffset", () => {
  it("interpolates linearly from top (row 0) to bottom (row h−1)", () => {
    expect(shearOffset(0, 5, 4, -4)).toBe(4); // t=0 → top
    expect(shearOffset(4, 5, 4, -4)).toBe(-4); // t=1 → bottom
    expect(shearOffset(2, 5, 4, -4)).toBeCloseTo(0, 6); // midpoint → average
    expect(shearOffset(1, 5, 0, 8)).toBeCloseTo(2, 6); // 0 + 8·(1/4)
  });

  it("a single-row image uses the top offset (denom floored at 1)", () => {
    expect(shearOffset(0, 1, 7, 99)).toBe(7);
  });
});

describe("shearSourceX", () => {
  it("wrap mode is the Euclidean remainder into [0, w)", () => {
    expect(shearSourceX(0, 1, 4, true)).toBe(3); // sx=−1 → 3
    expect(shearSourceX(1, 1, 4, true)).toBe(0); // sx=0
    expect(shearSourceX(0, -1, 4, true)).toBe(1); // sx=1
    expect(shearSourceX(0, 4, 4, true)).toBe(0); // sx=−4 → 0 (normalised, not −0)
    expect(shearSourceX(3, -2, 4, true)).toBe(1); // sx=5 → 1
  });

  it("clamp mode repeats the edge column", () => {
    expect(shearSourceX(0, 2, 4, false)).toBe(0); // sx=−2 → clamp 0
    expect(shearSourceX(1, 2, 4, false)).toBe(0); // sx=−1 → clamp 0
    expect(shearSourceX(3, 2, 4, false)).toBe(1); // sx=1 (in range)
    expect(shearSourceX(3, -2, 4, false)).toBe(3); // sx=5 → clamp w−1
  });

  it("a fractional offset gives a fractional source x", () => {
    expect(shearSourceX(2, 0.5, 4, false)).toBeCloseTo(1.5, 6);
  });
});

describe("shear2D", () => {
  it("top = bottom = 0 is the exact identity", () => {
    const g = grid(8, 8, (x, y) => (x * 31 + y * 17) % SHEAR_MAX);
    expect(shear2D(g, 0, 0, true)).toEqual(g);
    expect(shear2D(g, 0, 0, false)).toEqual(g);
  });

  it("wrap: an integer offset is an exact cyclic shift of each row", () => {
    // 2 rows; row 0 off=top=1 (cyclic right by 1), row 1 off=bottom=0 (unchanged)
    const g = [
      [10, 20, 30, 40],
      [50, 60, 70, 80],
    ];
    expect(shear2D(g, 1, 0, true)).toEqual([
      [40, 10, 20, 30],
      [50, 60, 70, 80],
    ]);
  });

  it("clamp: an integer offset repeats the edge column", () => {
    const g = [
      [10, 20, 30, 40],
      [50, 60, 70, 80],
    ];
    expect(shear2D(g, 2, 0, false)).toEqual([
      [10, 10, 10, 20],
      [50, 60, 70, 80],
    ]);
  });

  it("a fractional offset blends horizontally (clamp mode)", () => {
    // off=0.5 → sx = clamp(x−0.5): x0→0, x1→0.5, x2→1.5, x3→2.5 → midpoint blends
    expect(shear2D([[0, 100, 200, 300]], 0.5, 0.5, false)).toEqual([[0, 50, 150, 250]]);
  });

  it("a fractional wrap offset edge-clamps at the seam (no blend across the wrap)", () => {
    // off=0.5, x0 → sx=3.5: taps col 3 and col 4→clamp 3, so out[0][0]=src[3]=40, NOT a
    // blend toward src[0]=10. The interior columns blend normally.
    expect(shear2D([[10, 20, 30, 40]], 0.5, 0.5, true)).toEqual([[40, 15, 25, 35]]);
  });

  it("applies the linear top→bottom shear per row", () => {
    // 3 identical rows, top=0 bottom=2: row0 off=0, row1 off=1, row2 off=2 (wrap)
    const g = grid(3, 4, () => 0).map(() => [10, 20, 30, 40]);
    expect(shear2D(g, 0, 2, true)).toEqual([
      [10, 20, 30, 40], // off 0
      [40, 10, 20, 30], // off 1
      [30, 40, 10, 20], // off 2
    ]);
  });

  it("leaves the row index unchanged: each output row permutes its own source row (wrap)", () => {
    const g = grid(6, 6, (x, y) => (x * 7 + y * 50) % 60000);
    const out = shear2D(g, 2, 2, true); // uniform integer offset → every row a cyclic shift
    for (let y = 0; y < 6; y++) expect(sorted(out[y])).toEqual(sorted(g[y]));
  });

  it("leaves a constant image unchanged in both modes (sx always in bounds)", () => {
    const g = grid(9, 9, () => 33000);
    expect(shear2D(g, 12, -7, true)).toEqual(g);
    expect(shear2D(g, 12, -7, false)).toEqual(g);
  });

  it("keeps every output within [0, 65535]", () => {
    const g = grid(10, 12, (x, y) => (x * 6151 + y * 3079) % SHEAR_MAX);
    for (const wrap of [true, false]) {
      for (const v of flat(shear2D(g, 5.5, -3.5, wrap))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(SHEAR_MAX);
      }
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(shear2D([], 3, 1, true)).toEqual([]);
    expect(shear2D([[], []], 3, 1, false)).toEqual([[], []]);
    expect(shear2D([[42]], 5, -5, true)).toEqual([[42]]); // lone pixel wraps/clamps to itself
    expect(shear2D([[42]], 5, -5, false)).toEqual([[42]]);
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % 40000);
    expect(shear2D(g, 4, 2, true)).toEqual(shear2D(g, 4, 2, true));
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => (x + y) * 3000);
    const snapshot = g.map((row) => [...row]);
    shear2D(g, 4, -4, true);
    shear2D(g, 4, -4, false);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 11, (x, y) => (x * 11 + y * 5) % 50000);
    const out = shear2D(g, 3, 6, false);
    expect(out.length).toBe(5);
    expect(out.every((row) => row.length === 11)).toBe(true);
  });
});

// ── Several top/bottom/mode fixtures swept for in-range, shape, constant invariance ──
const FIXTURES: { name: string; top: number; bottom: number; wrap: boolean }[] = [
  { name: "wrap diagonal", top: -6, bottom: 6, wrap: true },
  { name: "clamp diagonal", top: -6, bottom: 6, wrap: false },
  { name: "uniform wrap", top: 4, bottom: 4, wrap: true },
  { name: "fractional clamp", top: 2.5, bottom: -3.5, wrap: false },
];

describe.each(FIXTURES)("fixture: $name", ({ top, bottom, wrap }) => {
  it("stays in range, keeps shape, and leaves the constant region invariant", () => {
    const g = grid(13, 13, (x, y) => (x * 4099 + y * 8191) % SHEAR_MAX);
    const out = shear2D(g, top, bottom, wrap);
    expect(out.length).toBe(13);
    expect(out.every((row) => row.length === 13)).toBe(true);
    for (const v of flat(out)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(SHEAR_MAX);
    }
    expect(shear2D(grid(13, 13, () => 41000), top, bottom, wrap).every((r) => r.every((v) => v === 41000))).toBe(true);
  });
});
