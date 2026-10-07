// Unit tests for the Average blur filter. Engine-free (node), single grey-channel model (exact
// for grey R=G=B input, since Average is genuinely per channel). These pin the global mean
// reduction (every output pixel = to16((Σ v/65535 / n) as f32)), the f64 accumulation (a value
// an f32-accumulation mutant would miss), and the empty/flat/1×1 paths (must match filters.rs
// average), plus cross-implementation goldens captured from the Rust engine.
import { describe, it, expect } from "vitest";
import { averageValue, average2D, AVERAGE_MAX } from "./average";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("averageValue", () => {
  it("returns 0 for an image with no pixels", () => {
    expect(averageValue([])).toBe(0);
    expect(averageValue([[], []])).toBe(0);
  });

  it("is the exact identity on a flat field (mean of a constant is the constant)", () => {
    // to16(fround(c/65535)) === c for every c (the engine's to16 is a faithful inverse of /65535).
    for (const c of [0, 1, 255, 256, 12345, 32768, 50000, 65534, AVERAGE_MAX]) {
      expect(averageValue(grid(4, 4, () => c))).toBe(c);
    }
  });

  it("returns the lone pixel exactly for a 1×1 image (every v round-trips)", () => {
    for (const v of [0, 1, 42, 1000, 32767, 60000, AVERAGE_MAX]) {
      expect(averageValue([[v]])).toBe(v);
    }
  });

  it("maps all-zero → 0 and all-max → 65535", () => {
    expect(averageValue(grid(5, 5, () => 0))).toBe(0);
    expect(averageValue(grid(5, 5, () => AVERAGE_MAX))).toBe(AVERAGE_MAX);
  });

  it("lands within the [min, max] range of its inputs", () => {
    const g = grid(13, 13, (x, y) => (x * 4099 + y * 8191) % AVERAGE_MAX);
    const f = flat(g);
    const m = averageValue(g);
    expect(m).toBeGreaterThanOrEqual(Math.min(...f));
    expect(m).toBeLessThanOrEqual(Math.max(...f));
  });

  it("accumulates in f64, not f32 (the 16×16 probe means 29318, an f32 sum would give 29319)", () => {
    // v = (x·8191 + y·53) mod 65535 over 16×16. Summing v/65535 (each <1) in f32 drifts in the
    // low bits and, amplified by ×65535 in to16, lands on 29319; the engine sums in f64 → 29318.
    const g = grid(16, 16, (x, y) => (x * 8191 + y * 53) % AVERAGE_MAX);
    expect(averageValue(g)).toBe(29318);
    expect(averageValue(g)).not.toBe(29319); // f32-accumulation mutant
  });
});

describe("average2D", () => {
  it("sets every output pixel to the single mean (a uniform field)", () => {
    const g = grid(9, 11, (x, y) => (x * 6151 + y * 3079) % AVERAGE_MAX);
    const m = averageValue(g);
    const out = average2D(g);
    for (let y = 0; y < 9; y++) for (let x = 0; x < 11; x++) expect(out[y][x]).toBe(m);
  });

  it("leaves a flat field unchanged", () => {
    const g = grid(8, 8, () => 44444);
    expect(average2D(g)).toEqual(g);
  });

  it("returns empty images unchanged", () => {
    expect(average2D([])).toEqual([]);
    expect(average2D([[], []])).toEqual([[], []]);
  });

  it("is the identity on a 1×1 image", () => {
    expect(average2D([[42]])).toEqual([[42]]);
    expect(average2D([[0]])).toEqual([[0]]);
    expect(average2D([[AVERAGE_MAX]])).toEqual([[AVERAGE_MAX]]);
  });

  it("is idempotent (averaging a uniform field returns it unchanged)", () => {
    const g = grid(7, 13, (x, y) => (x * 9973 + y * 9931) % AVERAGE_MAX);
    const once = average2D(g);
    expect(average2D(once)).toEqual(once);
  });

  it("keeps every output an integer within [0, 65535]", () => {
    for (const [h, w] of [
      [11, 13],
      [5, 1],
      [1, 7],
    ]) {
      for (const v of flat(average2D(grid(h, w, (x, y) => (x * 6151 + y * 3079) % AVERAGE_MAX)))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(AVERAGE_MAX);
      }
    }
  });

  it("does not mutate the input and is deterministic", () => {
    const g = grid(9, 9, (x, y) => (x * 5000 + y * 4000) % AVERAGE_MAX);
    const snapshot = g.map((r) => [...r]);
    const out = average2D(g);
    expect(g).toEqual(snapshot);
    expect(average2D(g)).toEqual(out);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = average2D(g);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 13)).toBe(true);
  });
});

// ── Cross-implementation goldens: exact u16 mean captured from the Rust engine's `average` on
//    grey patterns. Output is uniform, so each golden is the single mean every pixel takes. The
//    16×16 case (mean 29318) exercises the f64 accumulation; an f32-accumulation engine would
//    report 29319. Fully bit-exact (no trig/sqrt). ──
describe("engine golden (average)", () => {
  it("7×7 grey v=(x·9973+y·9931) mod 65535 → mean 31626", () => {
    const g = grid(7, 7, (x, y) => (x * 9973 + y * 9931) % AVERAGE_MAX);
    expect(averageValue(g)).toBe(31626);
    expect(average2D(g)).toEqual(grid(7, 7, () => 31626));
  });

  it("13×5 (non-square) grey v=(x·11+y·5) mod 50000 → mean 76", () => {
    const g = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    expect(averageValue(g)).toBe(76);
    expect(average2D(g)).toEqual(grid(5, 13, () => 76));
  });

  it("1×1 grey [42] → mean 42", () => {
    expect(averageValue([[42]])).toBe(42);
  });

  it("16×16 grey v=(x·8191+y·53) mod 65535 → mean 29318 (f64 accumulation)", () => {
    const g = grid(16, 16, (x, y) => (x * 8191 + y * 53) % AVERAGE_MAX);
    expect(averageValue(g)).toBe(29318);
  });
});

// ── Several fixtures swept for uniformity, in-range, idempotence ──
const FIXTURES: { name: string; h: number; w: number; a: number; b: number }[] = [
  { name: "tall", h: 17, w: 3, a: 4099, b: 8191 },
  { name: "wide", h: 3, w: 17, a: 9973, b: 53 },
  { name: "square", h: 12, w: 12, a: 6151, b: 3079 },
];

describe.each(FIXTURES)("fixture: $name", ({ h, w, a, b }) => {
  it("produces a uniform, in-range, idempotent mean", () => {
    const g = grid(h, w, (x, y) => (x * a + y * b) % AVERAGE_MAX);
    const m = averageValue(g);
    const out = average2D(g);
    expect(out.length).toBe(h);
    for (const row of out) {
      expect(row.length).toBe(w);
      for (const v of row) {
        expect(v).toBe(m);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(AVERAGE_MAX);
      }
    }
    expect(average2D(out)).toEqual(out); // idempotent
  });
});
