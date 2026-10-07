// Unit tests for the Crosshatch filter. Engine-free (node), single luminance-channel model
// (exact for grey R=G=B input). These pin the line spacing/half-width, the triangular hatch
// profile, the crossed x+y / x−y phases (incl. the rem_euclid negative lift for x<y), and the
// multiplicative darkening out = src·(1−str·darkness·hatch) (must match filters.rs crosshatch),
// plus cross-implementation goldens captured from the Rust engine.
import { describe, it, expect } from "vitest";
import { crosshatchSpacing, crosshatchHalf, crosshatchPixel, crosshatch2D, CROSSHATCH_MAX } from "./crosshatch";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("crosshatchSpacing / crosshatchHalf", () => {
  it("spacing = 3 + 9·clamp(length,0,1) (3..12 px)", () => {
    expect(crosshatchSpacing(0)).toBe(3);
    expect(crosshatchSpacing(0.5)).toBe(7.5);
    expect(crosshatchSpacing(1)).toBe(12);
    expect(crosshatchSpacing(2)).toBe(12); // clamped
  });
  it("half = clamp(0.5 − 0.42·sharpness, 0.08, 0.5)", () => {
    expect(crosshatchHalf(0)).toBe(0.5);
    expect(crosshatchHalf(1)).toBeCloseTo(0.08, 5); // 0.5−0.42 ≈ 0.08 (just above the 0.08 floor)
    expect(crosshatchHalf(0.5)).toBeCloseTo(0.29, 4);
    expect(crosshatchHalf(2)).toBeCloseTo(0.08, 5); // sharpness clamped to 1 → same as half(1)
  });
});

describe("crosshatchPixel", () => {
  it("is a no-op when strength ≤ 0", () => {
    const g = grid(7, 7, (x, y) => (x * 9973 + y * 9931) % CROSSHATCH_MAX);
    expect(crosshatchPixel(g, 3, 3, 0.5, 0.5, 0)).toBe(g[3][3]);
    expect(crosshatchPixel(g, 3, 3, 0.5, 0.5, -1)).toBe(g[3][3]);
  });

  it("darkens a dark pixel on a hatch line and leaves an off-line pixel unchanged", () => {
    // length 0.5 ⇒ spacing 7.5. (0,0): both phases hit a line centre → strong darkening of a
    // black pixel (which stays 0). (3,0): x+y = x−y = 3 ⇒ f = 0.4 > half ⇒ no hatch → unchanged.
    const g = grid(7, 7, (x, y) => (x * 9973 + y * 9931) % CROSSHATCH_MAX);
    expect(crosshatchPixel(g, 0, 0, 0.5, 0.5, 1)).toBe(0); // v=0 darkened → 0
    expect(crosshatchPixel(g, 3, 0, 0.5, 0.5, 1)).toBe(g[0][3]); // off-line → unchanged
  });

  it("a white pixel is never darkened (darkness 0 ⇒ darken 0)", () => {
    const g = grid(7, 7, () => CROSSHATCH_MAX);
    for (const [x, y] of [
      [0, 0],
      [2, 5],
      [6, 1],
    ]) {
      expect(crosshatchPixel(g, x, y, 0.5, 0.5, 1)).toBe(CROSSHATCH_MAX);
    }
  });

  it("darkens via the x−y phase for an x<y pixel (the rem_euclid negative lift)", () => {
    // a uniform mid-grey so darkness is constant; pixel (0,6): x−y=−6 lands within a line via
    // the negative lift (rem_euclid(−6, 7.5) = 1.5 ⇒ f 0.2 < half 0.29). The EXACT value pins
    // the lift — without it, r stays −6 ⇒ f<0 ⇒ d<half always ⇒ over-darkened to 0.
    const g = grid(7, 7, () => 30000);
    expect(crosshatchPixel(g, 0, 6, 0.5, 0.5, 1)).toBe(24951); // lift on; no-lift mutant → 0
  });

  it("combines the two hatch phases with MAX, not min", () => {
    // (5,2): x+y=7 is ON a line (factor ≈ 0.77) but x−y=3 is OFF (factor 0) — so max darkens
    // the pixel while a min would leave it untouched. The exact value pins max over min.
    const g = grid(7, 7, () => 30000);
    expect(crosshatchPixel(g, 5, 2, 0.5, 0.5, 1)).toBe(17472); // max → darkened; min mutant → 30000
  });
});

describe("crosshatch2D", () => {
  it("strength 0 is a no-op (the engine's early return)", () => {
    const g = grid(8, 8, (x, y) => (x * 6151 + y * 3079) % CROSSHATCH_MAX);
    expect(crosshatch2D(g, 0.5, 0.5, 0)).toEqual(g);
  });

  it("only ever darkens (out ≤ in everywhere)", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % CROSSHATCH_MAX);
    const out = crosshatch2D(g, 0.5, 0.5, 1);
    for (let y = 0; y < 11; y++) for (let x = 0; x < 13; x++) expect(out[y][x]).toBeLessThanOrEqual(g[y][x]);
  });

  it("leaves a white field unchanged (nothing to darken)", () => {
    const g = grid(9, 9, () => CROSSHATCH_MAX);
    expect(crosshatch2D(g, 0.5, 0.5, 1)).toEqual(g);
  });

  it("keeps every output an integer within [0, 65535]", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % CROSSHATCH_MAX);
    for (const [len, sharp, str] of [
      [0.2, 0.8, 0.6],
      [0.5, 0.5, 1],
      [1, 0.1, 0.9],
    ]) {
      for (const v of flat(crosshatch2D(g, len, sharp, str))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(CROSSHATCH_MAX);
      }
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(crosshatch2D([], 0.5, 0.5, 1)).toEqual([]);
    expect(crosshatch2D([[], []], 0.5, 0.5, 1)).toEqual([[], []]);
    expect(crosshatch2D([[0]], 0.5, 0.5, 1)).toEqual([[0]]); // black lone pixel: darkens to 0
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % 40000);
    expect(crosshatch2D(g, 0.2, 0.8, 0.6)).toEqual(crosshatch2D(g, 0.2, 0.8, 0.6));
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => (x * 5000 + y * 4000) % CROSSHATCH_MAX);
    const snapshot = g.map((r) => [...r]);
    crosshatch2D(g, 0.5, 0.5, 1);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = crosshatch2D(g, 0.5, 0.5, 1);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 13)).toBe(true);
  });
});

// ── Cross-implementation goldens: exact u16 output captured from the Rust engine's crosshatch
//    on a 7×7 grey pattern v = (x·9973 + y·9931) mod 65535. Both cases darken a MIX of pixels
//    (40 and 20 of 49 changed), incl. x<y pixels exercising the rem_euclid negative lift. Fully
//    bit-exact (no trig/sqrt). ──
describe("engine golden (crosshatch, 7×7 grey)", () => {
  const input = grid(7, 7, (x, y) => (x * 9973 + y * 9931) % CROSSHATCH_MAX);

  it("matches the engine bit-exactly — length 0.5, sharpness 0.5, strength 1", () => {
    expect(crosshatch2D(input, 0.5, 0.5, 1)).toEqual([
      [0, 5405, 18829, 29919, 39892, 49865, 58223],
      [5378, 6045, 21094, 38593, 49823, 58170, 1183],
      [18748, 21054, 24180, 43316, 58118, 1170, 5614],
      [29793, 38507, 43262, 54406, 1156, 5590, 19367],
      [39724, 49697, 58012, 1142, 3025, 15828, 32710],
      [49655, 57960, 1128, 5543, 15792, 17623, 36139],
      [57907, 1115, 5519, 19251, 32626, 36089, 44312],
    ]);
  });

  it("matches the engine bit-exactly — length 0.2, sharpness 0.8, strength 0.6", () => {
    expect(crosshatch2D(input, 0.2, 0.8, 0.6)).toEqual([
      [0, 9973, 19946, 29919, 39892, 44528, 59838],
      [9931, 11588, 29877, 39850, 44476, 59796, 2461],
      [19862, 29835, 30431, 44425, 59754, 4192, 14165],
      [29793, 39766, 44373, 56528, 4150, 14123, 21922],
      [39724, 44321, 59670, 4108, 7447, 21881, 29198],
      [44269, 59628, 4066, 14039, 21841, 24168, 43958],
      [59586, 2333, 13997, 21800, 29114, 43916, 48143],
    ]);
  });
});

// ── Several length/sharpness/strength fixtures swept for in-range, shape, darken-only ──
const FIXTURES: { name: string; len: number; sharp: number; str: number }[] = [
  { name: "fine dense", len: 0.1, sharp: 0.2, str: 1 },
  { name: "wide soft", len: 0.9, sharp: 0.9, str: 0.5 },
  { name: "mid", len: 0.5, sharp: 0.5, str: 0.8 },
];

describe.each(FIXTURES)("fixture: $name", ({ len, sharp, str }) => {
  it("stays in range, keeps shape, and only darkens", () => {
    const g = grid(13, 13, (x, y) => (x * 4099 + y * 8191) % CROSSHATCH_MAX);
    const out = crosshatch2D(g, len, sharp, str);
    expect(out.length).toBe(13);
    expect(out.every((r) => r.length === 13)).toBe(true);
    for (let y = 0; y < 13; y++) {
      for (let x = 0; x < 13; x++) {
        expect(out[y][x]).toBeLessThanOrEqual(g[y][x]);
        expect(out[y][x]).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
