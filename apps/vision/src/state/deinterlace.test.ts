// Unit tests for the De-Interlace filter. Engine-free (node), per-channel, integer-exact.
// These pin the odd/even field selection, the duplicate vs interpolate rebuild, the
// (above+below)/2 truncation, and the top/bottom edge clamp (must match filters.rs
// deinterlace), plus a cross-implementation golden captured from the Rust engine. The kept
// field is preserved exactly and a flat image is unchanged.
import { describe, it, expect } from "vitest";
import { isEliminatedRow, deinterlace2D, DEINTERLACE_MAX } from "./deinterlace";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();
// an image whose every row is a constant (so row-ops are easy to predict)
const rows = (vals: number[], w = 3): number[][] => vals.map((v) => Array(w).fill(v));

describe("isEliminatedRow", () => {
  it("selects the odd field when eliminateOdd is true", () => {
    expect([0, 1, 2, 3].map((y) => isEliminatedRow(y, true))).toEqual([false, true, false, true]);
  });
  it("selects the even field when eliminateOdd is false", () => {
    expect([0, 1, 2, 3].map((y) => isEliminatedRow(y, false))).toEqual([true, false, true, false]);
  });
});

describe("deinterlace2D", () => {
  it("preserves the kept field exactly (only eliminated rows change)", () => {
    const g = grid(6, 5, (x, y) => (x * 53 + y * 97) % DEINTERLACE_MAX);
    for (const interpolate of [false, true]) {
      const odd = deinterlace2D(g, true, interpolate);
      for (let y = 0; y < 6; y += 2) expect(odd[y]).toEqual(g[y]); // even rows kept
      const even = deinterlace2D(g, false, interpolate);
      for (let y = 1; y < 6; y += 2) expect(even[y]).toEqual(g[y]); // odd rows kept
    }
  });

  it("duplicates the line above into the eliminated rows", () => {
    const g = rows([0, 100, 200, 300]);
    // eliminate odd (rows 1,3) → row1←row0, row3←row2
    expect(deinterlace2D(g, true, false)).toEqual(rows([0, 0, 200, 200]));
  });

  it("interpolates the eliminated rows as the mean of the lines above and below", () => {
    const g = rows([0, 100, 200, 300]);
    // row1 ← (row0+row2)/2 = 100; row3 ← (row2+row4↦clamp row3)/2 = (200+300)/2 = 250
    expect(deinterlace2D(g, true, true)).toEqual(rows([0, 100, 200, 250]));
  });

  it("truncates the interpolated average toward zero", () => {
    // (5 + 20) / 2 = 12.5 → 12
    expect(deinterlace2D([[5], [10], [20]], true, true)[1][0]).toBe(12);
  });

  it("clamps at the top edge: a duplicated row 0 copies itself; an interpolated one uses its neighbour", () => {
    const g = rows([0, 100, 200, 300]);
    // eliminate even (rows 0,2). row0: above clamps to row0 → dup leaves it 0; interp (0+100)/2 = 50.
    expect(deinterlace2D(g, false, false)).toEqual(rows([0, 100, 100, 300]));
    expect(deinterlace2D(g, false, true)).toEqual(rows([50, 100, 200, 300]));
  });

  it("clamps at the bottom edge: the last eliminated row uses itself as the row below", () => {
    // 5 rows; eliminate EVEN → rows 0,2,4. Row 4 is the last row AND eliminated, so its
    // "below" (row 5) clamps back to row 4 itself.
    const g = rows([0, 100, 200, 300, 400]);
    expect(deinterlace2D(g, false, true)[4][0]).toBe(350); // interp: (row3 + row4)/2 = (300+400)/2
    expect(deinterlace2D(g, false, false)[4][0]).toBe(300); // dup: the row above (row3)
  });

  it("leaves a flat image unchanged in every mode", () => {
    const g = grid(8, 8, () => 30000);
    for (const eo of [true, false]) for (const ip of [true, false]) {
      expect(deinterlace2D(g, eo, ip)).toEqual(g);
    }
  });

  it("keeps every output an integer within [0, 65535]", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % DEINTERLACE_MAX);
    for (const eo of [true, false]) for (const ip of [true, false]) {
      for (const v of flat(deinterlace2D(g, eo, ip))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(DEINTERLACE_MAX);
      }
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(deinterlace2D([], true, true)).toEqual([]);
    expect(deinterlace2D([[], []], false, false)).toEqual([[], []]);
    // 1×1: the lone row 0 is even → eliminated; above/below clamp to itself → unchanged
    expect(deinterlace2D([[42]], false, true)).toEqual([[42]]);
    expect(deinterlace2D([[42]], false, false)).toEqual([[42]]);
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % 40000);
    expect(deinterlace2D(g, true, true)).toEqual(deinterlace2D(g, true, true));
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => (x * 5000 + y * 4000) % DEINTERLACE_MAX);
    const snapshot = g.map((r) => [...r]);
    for (const eo of [true, false]) for (const ip of [true, false]) deinterlace2D(g, eo, ip);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = deinterlace2D(g, true, true);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 13)).toBe(true);
  });
});

// ── Cross-implementation golden: exact u16 output captured from the Rust engine's
//    deinterlace on a 6×6 grey pattern v = (x·9973 + y·9931) mod 65535, across all four
//    field/rebuild combos. Per-channel & integer, so bit-for-bit. ──
describe("engine golden (deinterlace, 6×6)", () => {
  const input = grid(6, 6, (x, y) => (x * 9973 + y * 9931) % DEINTERLACE_MAX);

  it("matches the engine bit-exactly — eliminate odd, duplicate", () => {
    expect(deinterlace2D(input, true, false)).toEqual([
      [0, 9973, 19946, 29919, 39892, 49865],
      [0, 9973, 19946, 29919, 39892, 49865],
      [19862, 29835, 39808, 49781, 59754, 4192],
      [19862, 29835, 39808, 49781, 59754, 4192],
      [39724, 49697, 59670, 4108, 14081, 24054],
      [39724, 49697, 59670, 4108, 14081, 24054],
    ]);
  });

  it("matches the engine bit-exactly — eliminate odd, interpolate", () => {
    expect(deinterlace2D(input, true, true)).toEqual([
      [0, 9973, 19946, 29919, 39892, 49865],
      [9931, 19904, 29877, 39850, 49823, 27028],
      [19862, 29835, 39808, 49781, 59754, 4192],
      [29793, 39766, 49739, 26944, 36917, 14123],
      [39724, 49697, 59670, 4108, 14081, 24054],
      [44689, 54662, 31868, 9073, 19046, 29019],
    ]);
  });

  it("matches the engine bit-exactly — eliminate even, duplicate", () => {
    expect(deinterlace2D(input, false, false)).toEqual([
      [0, 9973, 19946, 29919, 39892, 49865],
      [9931, 19904, 29877, 39850, 49823, 59796],
      [9931, 19904, 29877, 39850, 49823, 59796],
      [29793, 39766, 49739, 59712, 4150, 14123],
      [29793, 39766, 49739, 59712, 4150, 14123],
      [49655, 59628, 4066, 14039, 24012, 33985],
    ]);
  });

  it("matches the engine bit-exactly — eliminate even, interpolate", () => {
    expect(deinterlace2D(input, false, true)).toEqual([
      [4965, 14938, 24911, 34884, 44857, 54830],
      [9931, 19904, 29877, 39850, 49823, 59796],
      [19862, 29835, 39808, 49781, 26986, 36959],
      [29793, 39766, 49739, 59712, 4150, 14123],
      [39724, 49697, 26902, 36875, 14081, 24054],
      [49655, 59628, 4066, 14039, 24012, 33985],
    ]);
  });
});

// ── Several field/rebuild/image fixtures swept for in-range, shape, kept-field, flat ──
const FIXTURES: { name: string; eliminateOdd: boolean; interpolate: boolean }[] = [
  { name: "odd duplicate", eliminateOdd: true, interpolate: false },
  { name: "odd interpolate", eliminateOdd: true, interpolate: true },
  { name: "even duplicate", eliminateOdd: false, interpolate: false },
  { name: "even interpolate", eliminateOdd: false, interpolate: true },
];

describe.each(FIXTURES)("fixture: $name", ({ eliminateOdd, interpolate }) => {
  it("stays in range, keeps shape & the kept field, and leaves a flat field untouched", () => {
    const g = grid(13, 12, (x, y) => (x * 4099 + y * 8191) % DEINTERLACE_MAX);
    const out = deinterlace2D(g, eliminateOdd, interpolate);
    expect(out.length).toBe(13);
    expect(out.every((r) => r.length === 12)).toBe(true);
    for (let y = 0; y < 13; y++) {
      if (!isEliminatedRow(y, eliminateOdd)) expect(out[y]).toEqual(g[y]);
      for (const v of out[y]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(DEINTERLACE_MAX);
      }
    }
    expect(deinterlace2D(grid(13, 12, () => 41000), eliminateOdd, interpolate)).toEqual(
      grid(13, 12, () => 41000),
    );
  });
});
