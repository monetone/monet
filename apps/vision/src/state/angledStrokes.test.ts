// Unit tests for the Angled Strokes filter. Engine-free (node), single luminance-channel model
// (exact for grey R=G=B input). These pin the tone-chosen stroke direction (lum≥balance → (1,1),
// else (1,−1)), the directional box-blur, the sharpness blend-back, and the no-op/clamp paths
// (must match filters.rs angled_strokes), plus cross-implementation goldens captured from the
// Rust engine that exercise BOTH direction branches.
import { describe, it, expect } from "vitest";
import { angledStrokesPixel, angledStrokes2D, ANGLED_STROKES_MAX } from "./angledStrokes";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();
const fr = Math.fround;
// luminance of a grey value in the engine's f32 order (to construct an exact-threshold balance)
const lumOf = (v: number): number =>
  fr(fr(fr(fr(v * fr(0.299)) + fr(v * fr(0.587))) + fr(v * fr(0.114))) / 65535);

describe("angledStrokesPixel", () => {
  it("strokes a LIGHT pixel along the (1,1) diagonal", () => {
    // centre (1,1)=60000 (light, lum≥0.5) → dir 1 → blurs the main diagonal (10,60000,90).
    // A dir flip would blur the anti-diagonal (700,60000,500) and give 20400 instead.
    const g = [
      [10, 0, 700],
      [0, 60000, 0],
      [500, 0, 90],
    ];
    expect(angledStrokesPixel(g, 1, 1, 1, 0.5, 0)).toBe(20033); // (10+60000+90)/3
  });

  it("strokes a DARK pixel along the (1,−1) anti-diagonal", () => {
    // centre (1,1)=1000 (dark, lum<0.5) → dir −1 → blurs the anti-diagonal (700,1000,500).
    // A dir flip would blur the main diagonal (10,1000,90) and give 366 instead.
    const g = [
      [10, 0, 700],
      [0, 1000, 0],
      [500, 0, 90],
    ];
    expect(angledStrokesPixel(g, 1, 1, 1, 0.5, 0)).toBe(733); // (700+1000+500)/3
  });

  it("treats a pixel whose luminance EXACTLY equals balance as light (dir 1, the ≥ boundary)", () => {
    // balance = lum(32768) so lum(centre)===thr exactly. The engine's `lum ≥ thr` puts it on
    // the LIGHT side (dir 1 → main diagonal → 10956); a `>` mutant would flip it to dark
    // (dir −1 → anti-diagonal → 11322).
    const g = [
      [10, 0, 700],
      [0, 32768, 0],
      [500, 0, 90],
    ];
    expect(angledStrokesPixel(g, 1, 1, 1, lumOf(32768), 0)).toBe(10956); // ≥ → light/dir 1
  });

  it("is the identity when length ≤ 0 (no strokes)", () => {
    const g = grid(5, 5, (x, y) => (x * 53 + y * 97) % ANGLED_STROKES_MAX);
    expect(angledStrokesPixel(g, 2, 2, 0, 0.5, 0)).toBe(g[2][2]);
    expect(angledStrokesPixel(g, 2, 2, -3, 0.5, 0)).toBe(g[2][2]);
  });
});

describe("angledStrokes2D", () => {
  it("is a no-op when length ≤ 0", () => {
    const g = grid(8, 8, (x, y) => (x * 6151 + y * 3079) % ANGLED_STROKES_MAX);
    expect(angledStrokes2D(g, 0, 0.5, 0)).toEqual(g);
    expect(angledStrokes2D(g, -2, 0.5, 0)).toEqual(g);
  });

  it("leaves a flat field unchanged (a directional blur of a constant is the constant)", () => {
    const g = grid(8, 8, () => 30000);
    expect(angledStrokes2D(g, 3, 0.5, 0)).toEqual(g);
  });

  it("sharpness 1 keeps (nearly) the original; sharpness 0 fully blurs (they differ)", () => {
    const g = grid(9, 9, (x, y) => (x * 6151 + y * 3079) % ANGLED_STROKES_MAX);
    const kept = angledStrokes2D(g, 2, 0.5, 1);
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) expect(Math.abs(kept[y][x] - g[y][x])).toBeLessThanOrEqual(1);
    expect(angledStrokes2D(g, 2, 0.5, 0)).not.toEqual(kept); // full blur ≠ near-identity
  });

  it("keeps every output an integer within [0, 65535]", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % ANGLED_STROKES_MAX);
    for (const [len, bal, sh] of [
      [2, 0.5, 0.3],
      [3, 0.4, 0.7],
      [5, 0.6, 0],
    ]) {
      for (const v of flat(angledStrokes2D(g, len, bal, sh))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(ANGLED_STROKES_MAX);
      }
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(angledStrokes2D([], 2, 0.5, 0)).toEqual([]);
    expect(angledStrokes2D([[], []], 2, 0.5, 0)).toEqual([[], []]);
    expect(angledStrokes2D([[42]], 2, 0.5, 0)).toEqual([[42]]); // lone pixel: blur of itself
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % 40000);
    expect(angledStrokes2D(g, 3, 0.4, 0.7)).toEqual(angledStrokes2D(g, 3, 0.4, 0.7));
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => (x * 5000 + y * 4000) % ANGLED_STROKES_MAX);
    const snapshot = g.map((r) => [...r]);
    angledStrokes2D(g, 2, 0.5, 0.3);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = angledStrokes2D(g, 2, 0.5, 0.3);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 13)).toBe(true);
  });
});

// ── Cross-implementation goldens: exact u16 output captured from the Rust engine's
//    angled_strokes on a 7×7 grey pattern v = (x·9973 + y·9931) mod 65535. Mixed tone (24 of 49
//    light) so BOTH direction branches run; a dir-swap mutant differs in 38 pixels. Fully
//    bit-exact (no trig/sqrt). ──
describe("engine golden (angled_strokes, 7×7 grey)", () => {
  const input = grid(7, 7, (x, y) => (x * 9973 + y * 9931) % ANGLED_STROKES_MAX);

  it("matches the engine bit-exactly — length 2, balance 0.5, sharpness 0.3", () => {
    expect(angledStrokes2D(input, 2, 0.5, 0.3)).toEqual([
      [8359, 15540, 24117, 34090, 34888, 34290, 41470],
      [15510, 22690, 31267, 32065, 32863, 41440, 19785],
      [24050, 31231, 30633, 31431, 41404, 11970, 19151],
      [33981, 31987, 31389, 41362, 4150, 12726, 19907],
      [34737, 32743, 41320, 4108, 14081, 22657, 39013],
      [34103, 41284, 11850, 12648, 22621, 40373, 38379],
      [41253, 19599, 19000, 19798, 38946, 38348, 45529],
    ]);
  });

  it("matches the engine bit-exactly — length 3, balance 0.4, sharpness 0.7", () => {
    expect(angledStrokes2D(input, 3, 0.4, 0.7)).toEqual([
      [5118, 13808, 22927, 26855, 36400, 42710, 51401],
      [13772, 22463, 25963, 35509, 42246, 51364, 11372],
      [22852, 25925, 35043, 41780, 51326, 8952, 17643],
      [26740, 35430, 41740, 51286, 6531, 15649, 24340],
      [36245, 42127, 51245, 6491, 13227, 22346, 36654],
      [42516, 51207, 8833, 15570, 22307, 37043, 42925],
      [51170, 11178, 17488, 24224, 36579, 42888, 51579],
    ]);
  });
});

// ── Several length/balance/sharpness fixtures swept for in-range, shape, flat-invariance ──
const FIXTURES: { name: string; len: number; bal: number; sh: number }[] = [
  { name: "short soft", len: 1, bal: 0.5, sh: 0.8 },
  { name: "long hard", len: 6, bal: 0.5, sh: 0 },
  { name: "low balance", len: 3, bal: 0.2, sh: 0.4 },
];

describe.each(FIXTURES)("fixture: $name", ({ len, bal, sh }) => {
  it("stays in range, keeps shape, and leaves a flat field untouched", () => {
    const g = grid(13, 13, (x, y) => (x * 4099 + y * 8191) % ANGLED_STROKES_MAX);
    const out = angledStrokes2D(g, len, bal, sh);
    expect(out.length).toBe(13);
    expect(out.every((r) => r.length === 13)).toBe(true);
    for (const v of flat(out)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(ANGLED_STROKES_MAX);
    }
    expect(angledStrokes2D(grid(13, 13, () => 44444), len, bal, sh)).toEqual(grid(13, 13, () => 44444));
  });
});
