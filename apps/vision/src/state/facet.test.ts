// Unit tests for the Facet pixelate filter. Engine-free (node), integer-exact, single
// luminance-channel model (exact for grey R=G=B input). These pin the 3×3 coarse bucketing
// (key = v>>11), the dominant-bucket integer mean, the tie-break (last bucket wins, matching
// Rust max_by_key), and edge clamping (must match filters.rs facet), plus a cross-
// implementation golden captured from the Rust engine. A flat region is unchanged.
import { describe, it, expect } from "vitest";
import { facetPixel, facet2D, FACET_MAX } from "./facet";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("facetPixel", () => {
  it("returns the value itself for a flat 3×3 (one bucket of 9)", () => {
    const g = grid(3, 3, () => 24000);
    expect(facetPixel(g, 1, 1)).toEqual({ key: 24000 >> 11, count: 9, value: 24000 });
  });

  it("averages the values that share a coarse band (key = v>>11)", () => {
    // 1000 and 1500 are both in band 0 (>>11 = 0); 60000 is in band 29. The band-0 bucket
    // dominates (8 vs 1) → mean of the eight band-0 values.
    const g = [
      [1000, 1500, 1000],
      [1500, 60000, 1000],
      [1500, 1000, 1500],
    ];
    const { key, count, value } = facetPixel(g, 1, 1);
    expect(key).toBe(0);
    expect(count).toBe(8);
    const band0 = [1000, 1500, 1000, 1500, 1000, 1500, 1000, 1500]; // the 8 non-centre cells
    expect(value).toBe(Math.floor(band0.reduce((a, b) => a + b, 0) / 8));
  });

  it("breaks a tie toward the LAST bucket in row-major order (Rust max_by_key)", () => {
    // four 1000s (band 0, inserted first) vs four 5000s (band 2, inserted second) + one 60000.
    // A first-wins impl would pick band 0 (=1000); the engine's last-wins picks band 2 (=5000).
    const g = [
      [1000, 1000, 5000],
      [1000, 60000, 5000],
      [1000, 5000, 5000],
    ];
    const { key, count, value } = facetPixel(g, 1, 1);
    expect(count).toBe(4);
    expect(key).toBe(2); // 5000 >> 11 = 2, the later-inserted tied bucket
    expect(value).toBe(5000);
  });

  it("edge-clamps the neighbourhood at a corner", () => {
    // corner pixel (0,0): the −1 offsets replicate the edge, so the 3×3 over [0..1]² is
    // sampled with multiplicity. All four distinct cells here share band 0 → mean of the
    // 9 clamped samples.
    const g = [
      [2000, 100],
      [300, 1900],
    ];
    const { value } = facetPixel(g, 0, 0);
    // clamp multiplicities: (0,0)×4, (1,0)×2, (0,1)×2, (1,1)×1 — all band 0
    expect(value).toBe(Math.floor((2000 * 4 + 100 * 2 + 300 * 2 + 1900) / 9));
  });
});

describe("facet2D", () => {
  it("leaves a flat image unchanged", () => {
    const g = grid(8, 8, () => 30000);
    expect(facet2D(g)).toEqual(g);
  });

  it("dissolves a lone outlier back into the surrounding flat field", () => {
    // one 60000 pixel in a field of 10000: every 3×3 touching it is 8:1 in favour of the
    // flat band, so the whole image collapses to flat.
    const g = grid(9, 9, () => 10000);
    g[4][4] = 60000;
    expect(facet2D(g)).toEqual(grid(9, 9, () => 10000));
  });

  it("leaves the interior of two large same-band regions unchanged", () => {
    // left half band 1 (value 3000), right half band 10 (value 21000); pixels whose whole 3×3
    // stays within one region are unchanged (only the seam column shifts).
    const g = grid(7, 8, (x) => (x < 4 ? 3000 : 21000));
    const out = facet2D(g);
    for (let y = 0; y < 7; y++) {
      expect(out[y][0]).toBe(3000); // deep left
      expect(out[y][1]).toBe(3000);
      expect(out[y][6]).toBe(21000); // deep right
      expect(out[y][7]).toBe(21000);
    }
  });

  it("keeps every output an integer within [0, 65535]", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % FACET_MAX);
    for (const v of flat(facet2D(g))) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(FACET_MAX);
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(facet2D([])).toEqual([]);
    expect(facet2D([[], []])).toEqual([[], []]);
    expect(facet2D([[42]])).toEqual([[42]]); // lone pixel: 3×3 clamps to itself → unchanged
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % 40000);
    expect(facet2D(g)).toEqual(facet2D(g));
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => (x * 5000 + y * 4000) % FACET_MAX);
    const snapshot = g.map((row) => [...row]);
    facet2D(g);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = facet2D(g);
    expect(out.length).toBe(5);
    expect(out.every((row) => row.length === 13)).toBe(true);
  });
});

// ── Cross-implementation golden: exact u16 output captured from the Rust engine's facet on a
//    7×7 GREY image v = (x·9973 + y·9931) mod 65535 (R=G=B). Integer-exact, so bit-for-bit. ──
describe("engine golden (facet, 7×7 grey)", () => {
  const input = grid(7, 7, (x, y) => (x * 9973 + y * 9931) % FACET_MAX);
  const GOLDEN = [
    [9952, 19932, 29905, 39878, 49851, 59824, 59829],
    [19876, 19904, 29877, 39850, 49823, 59796, 4220],
    [29807, 29835, 39808, 49781, 59754, 4192, 14151],
    [39738, 39766, 49739, 59712, 4150, 14123, 24082],
    [49669, 49697, 59670, 14060, 14081, 24054, 34013],
    [59600, 59628, 14018, 14039, 24012, 33985, 43944],
    [59594, 4038, 14011, 23984, 33957, 43930, 53889],
  ];

  it("matches the engine bit-exactly", () => {
    expect(facet2D(input)).toEqual(GOLDEN);
  });
});

// ── Several image fixtures swept for in-range, shape, flat-invariance, idempotence-ish ──
const FIXTURES: { name: string; fn: (x: number, y: number) => number }[] = [
  { name: "diagonal ramp", fn: (x, y) => ((x + y) * 4000) % FACET_MAX },
  { name: "high-frequency", fn: (x, y) => (x * 6151 + y * 3079) % FACET_MAX },
  { name: "two bands", fn: (x, y) => ((x ^ y) & 1 ? 5000 : 40000) },
];

describe.each(FIXTURES)("fixture: $name", ({ fn }) => {
  it("stays in range, keeps shape, and leaves a flat field untouched", () => {
    const g = grid(13, 13, fn);
    const out = facet2D(g);
    expect(out.length).toBe(13);
    expect(out.every((row) => row.length === 13)).toBe(true);
    for (const v of flat(out)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(FACET_MAX);
    }
    const flatField = grid(13, 13, () => 33333);
    expect(facet2D(flatField)).toEqual(flatField);
  });
});
