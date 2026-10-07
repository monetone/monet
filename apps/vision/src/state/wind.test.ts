// Unit tests for the Wind stylize filter. Engine-free (node), per-channel. These pin the
// directional fade-max streak, its reach per method (Wind 10 / Blast 24 / Stagger 10+shift),
// the fade profile 1−k/(len+1), the direction, and the edge-SKIP (must match filters.rs
// wind), plus a cross-implementation golden captured from the Rust engine. Wind never darkens
// (out ≥ in) and a flat field is unchanged.
import { describe, it, expect } from "vitest";
import { windPixel, wind2D, WIND_MAX, WIND_WIND, WIND_BLAST, WIND_STAGGER } from "./wind";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();
const row1 = (vals: number[]): number[][] => [vals]; // a 1×N image for streak tests

describe("windPixel", () => {
  it("keeps the pixel itself when no upwind sample is in range", () => {
    // from_left ⇒ dir=1 ⇒ upwind is to the LEFT; at x=0 every sx<0 is skipped → self
    const img = row1([5000, 1, 2, 3]);
    expect(windPixel(img, 0, 0, WIND_WIND, true)).toBe(5000);
  });

  it("streaks a lone bright pixel downwind with a decaying fade (Wind, reach 10)", () => {
    // bright 10000 at x=2 in a row of zeros; from_left ⇒ pixels to the RIGHT pick it up at
    // faded = 10000·(1 − k/11), k = x−2, for k = 1..10.
    const img = row1([0, 0, 10000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(windPixel(img, 2, 0, WIND_WIND, true)).toBe(10000); // the source itself
    expect(windPixel(img, 3, 0, WIND_WIND, true)).toBe(9091); // k=1 → ·10/11
    expect(windPixel(img, 4, 0, WIND_WIND, true)).toBe(8182); // k=2 → ·9/11
    expect(windPixel(img, 12, 0, WIND_WIND, true)).toBe(909); // k=10 → ·1/11 (last in reach)
    expect(windPixel(img, 13, 0, WIND_WIND, true)).toBe(0); // k=11 > 10 → beyond reach
    expect(windPixel(img, 1, 0, WIND_WIND, true)).toBe(0); // upwind of the source → untouched
  });

  it("Blast reaches further than Wind (24 vs 10)", () => {
    const img = row1(Array.from({ length: 30 }, (_, i) => (i === 2 ? 10000 : 0)));
    expect(windPixel(img, 13, 0, WIND_WIND, true)).toBe(0); // beyond Wind's reach 10
    expect(windPixel(img, 13, 0, WIND_BLAST, true)).toBe(5600); // k=11 → ·(1−11/25)=0.56
    expect(windPixel(img, 26, 0, WIND_BLAST, true)).toBe(400); // k=24 → ·1/25 (last Blast step)
    expect(windPixel(img, 27, 0, WIND_BLAST, true)).toBe(0); // k=25 > 24 → beyond Blast
  });

  it("reverses the streak direction with fromLeft=false", () => {
    const img = row1([0, 0, 10000, 0, 0]);
    // dir=−1 ⇒ upwind is to the RIGHT, so the streak falls to the LEFT of the source
    expect(windPixel(img, 1, 0, WIND_WIND, false)).toBe(9091); // k=1
    expect(windPixel(img, 0, 0, WIND_WIND, false)).toBe(8182); // k=2
    expect(windPixel(img, 3, 0, WIND_WIND, false)).toBe(0); // right side now upwind → untouched
  });

  it("never returns less than the pixel's own value", () => {
    const img = row1([1000, 9000, 200, 50000, 30000, 7000, 12000]);
    for (let x = 0; x < 7; x++) {
      for (const fl of [true, false]) {
        expect(windPixel(img, x, 0, WIND_WIND, fl)).toBeGreaterThanOrEqual(img[0][x]);
      }
    }
  });
});

describe("wind2D", () => {
  it("leaves a flat image unchanged (every faded neighbour is below the flat value)", () => {
    const g = grid(6, 9, () => 28000);
    for (const m of [WIND_WIND, WIND_BLAST, WIND_STAGGER]) {
      for (const fl of [true, false]) expect(wind2D(g, m, fl)).toEqual(g);
    }
  });

  it("never darkens any pixel (out ≥ in everywhere)", () => {
    const g = grid(10, 12, (x, y) => (x * 6151 + y * 3079) % WIND_MAX);
    for (const m of [WIND_WIND, WIND_BLAST, WIND_STAGGER]) {
      const out = wind2D(g, m, true);
      for (let y = 0; y < 10; y++) for (let x = 0; x < 12; x++) expect(out[y][x]).toBeGreaterThanOrEqual(g[y][x]);
    }
  });

  it("Stagger matches plain Wind on even rows but differs on odd rows", () => {
    const g = grid(4, 16, (x, y) => ((x * 7 + y * 13) % 5 === 0 ? 50000 : 1000));
    const w0 = wind2D(g, WIND_WIND, true);
    const w2 = wind2D(g, WIND_STAGGER, true);
    expect(w2[0]).toEqual(w0[0]); // even row: stagger 0 → identical
    expect(w2[2]).toEqual(w0[2]); // even row
    expect(w2[1]).not.toEqual(w0[1]); // odd row: shifted by 2
  });

  it("keeps every output an integer within [0, 65535]", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % WIND_MAX);
    for (const m of [WIND_WIND, WIND_BLAST, WIND_STAGGER]) {
      for (const fl of [true, false]) {
        for (const v of flat(wind2D(g, m, fl))) {
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(WIND_MAX);
        }
      }
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(wind2D([], WIND_WIND, true)).toEqual([]);
    expect(wind2D([[], []], WIND_BLAST, false)).toEqual([[], []]);
    expect(wind2D([[42]], WIND_WIND, true)).toEqual([[42]]); // lone pixel: no upwind → itself
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % 40000);
    expect(wind2D(g, WIND_STAGGER, true)).toEqual(wind2D(g, WIND_STAGGER, true));
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => (x * 5000 + y * 4000) % WIND_MAX);
    const snapshot = g.map((r) => [...r]);
    for (const m of [WIND_WIND, WIND_BLAST, WIND_STAGGER]) wind2D(g, m, true);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = wind2D(g, WIND_WIND, false);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 13)).toBe(true);
  });
});

// ── Cross-implementation golden: exact u16 output captured from the Rust engine's wind on a
//    7×7 grey pattern v = (x·9973 + y·9931) mod 65535, across the three method/direction combos.
//    Per-channel & integer round, so bit-for-bit. ──
describe("engine golden (wind, 7×7)", () => {
  const input = grid(7, 7, (x, y) => (x * 9973 + y * 9931) % WIND_MAX);

  it("matches the engine bit-exactly — Wind, fromLeft", () => {
    const GOLDEN = [
      [0, 9973, 19946, 29919, 39892, 49865, 59838],
      [9931, 19904, 29877, 39850, 49823, 59796, 54360],
      [19862, 29835, 39808, 49781, 59754, 54322, 48890],
      [29793, 39766, 49739, 59712, 54284, 48855, 43427],
      [39724, 49697, 59670, 54245, 48821, 43396, 37972],
      [49655, 59628, 54207, 48787, 43366, 37945, 43958],
      [59586, 54169, 48752, 43335, 37918, 43916, 53889],
    ];
    expect(wind2D(input, WIND_WIND, true)).toEqual(GOLDEN);
  });

  it("matches the engine bit-exactly — Blast, fromRight", () => {
    const GOLDEN = [
      [45477, 47870, 50264, 52657, 55051, 57444, 59838],
      [47837, 50229, 52620, 55012, 57404, 59796, 4234],
      [50193, 52584, 54974, 57364, 59754, 13598, 14165],
      [52547, 54935, 57324, 59712, 22168, 23132, 24096],
      [54896, 57283, 59670, 29944, 31305, 32666, 34027],
      [57243, 59628, 36925, 38683, 40441, 42200, 43958],
      [59586, 43111, 45267, 47422, 49578, 51733, 53889],
    ];
    expect(wind2D(input, WIND_BLAST, false)).toEqual(GOLDEN);
  });

  it("matches the engine bit-exactly — Stagger, fromLeft", () => {
    const GOLDEN = [
      [0, 9973, 19946, 29919, 39892, 49865, 59838],
      [9931, 19904, 29877, 39850, 49823, 59796, 36227],
      [19862, 29835, 39808, 49781, 59754, 54322, 48890],
      [29793, 39766, 49739, 59712, 36151, 45217, 54284],
      [39724, 49697, 59670, 54245, 48821, 43396, 37972],
      [49655, 59628, 4066, 45141, 54207, 48787, 43958],
      [59586, 54169, 48752, 43335, 37918, 43916, 53889],
    ];
    expect(wind2D(input, WIND_STAGGER, true)).toEqual(GOLDEN);
  });
});

// ── Several method/direction fixtures swept for in-range, shape, flat-invariance, out≥in ──
const FIXTURES: { name: string; method: number; fromLeft: boolean }[] = [
  { name: "wind L→R", method: WIND_WIND, fromLeft: true },
  { name: "blast R→L", method: WIND_BLAST, fromLeft: false },
  { name: "stagger L→R", method: WIND_STAGGER, fromLeft: true },
];

describe.each(FIXTURES)("fixture: $name", ({ method, fromLeft }) => {
  it("stays in range, keeps shape, leaves a flat field untouched, and never darkens", () => {
    const g = grid(13, 13, (x, y) => (x * 4099 + y * 8191) % WIND_MAX);
    const out = wind2D(g, method, fromLeft);
    expect(out.length).toBe(13);
    expect(out.every((r) => r.length === 13)).toBe(true);
    for (let y = 0; y < 13; y++) {
      for (let x = 0; x < 13; x++) {
        expect(out[y][x]).toBeGreaterThanOrEqual(g[y][x]);
        expect(out[y][x]).toBeLessThanOrEqual(WIND_MAX);
      }
    }
    const flatField = grid(13, 13, () => 44444);
    expect(wind2D(flatField, method, fromLeft)).toEqual(flatField);
  });
});
