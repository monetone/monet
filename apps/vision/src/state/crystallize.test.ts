// Unit tests for the Crystallize filter. Engine-free (node), single grey-channel model (exact for
// grey R=G=B input). Crystallize is a deterministic Voronoi: each output pixel is a COPY of the
// source pixel at its nearest jittered grid seed, so the output is always an input value (faceted
// flat cells), never an average. These pin hash2, the cell-size coercion, the nearest-seed choice,
// and the sample/clamp (must match filters.rs crystallize), plus cross-implementation goldens from
// the Rust engine over a positionally-unique field (so the sample LOCATION is validated, not just
// the value). The integer hash + selection are bit-exact; the f32 SEED-POSITION frounds are load-
// bearing — the `engine f32-vs-f64 discriminators` block pins ordinary pixels where computing the
// seed positions in f64 would pick a different nearest seed than the real engine does.
import { describe, it, expect } from "vitest";
import { hash2, crystallizeSample, crystallize2D, CRYSTALLIZE_MAX } from "./crystallize";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();
// positionally-unique field: value v = y·w + x uniquely identifies the sampled pixel.
const unique = (h: number, w: number) => grid(h, w, (x, y) => y * w + x);
const rows = (w: number, s: string): number[][] => {
  const v = s.trim().split(/\s+/).map(Number);
  return Array.from({ length: v.length / w }, (_, y) => v.slice(y * w, y * w + w));
};

describe("hash2", () => {
  it("is a deterministic u32 mix that depends on both coordinates (and their order)", () => {
    expect(hash2(3, 7)).toBe(hash2(3, 7));
    const v = hash2(3, 7);
    expect(Number.isInteger(v) && v >= 0 && v <= 0xffffffff).toBe(true);
    expect(hash2(3, 7)).not.toBe(hash2(7, 3)); // not symmetric
    expect(hash2(-1, 0)).not.toBe(hash2(0, 0)); // negative coord (u32 wrap) is handled
    // concrete pins (a wrong constant/shift breaks these; values are engine-faithful — the goldens
    // and the f32 discriminators both validate hash2 end-to-end against the real engine).
    expect(hash2(3, 7)).toBe(2872573864);
    expect(hash2(-1, 0)).toBe(1404390209); // exercises the u32 wrap of a negative coordinate
  });
});

describe("crystallizeSample", () => {
  it("always returns an in-bounds source location", () => {
    for (let y = 0; y < 10; y++) for (let x = 0; x < 14; x++) {
      const [sx, sy] = crystallizeSample(x, y, 4, 14, 10);
      expect(sx).toBeGreaterThanOrEqual(0);
      expect(sx).toBeLessThan(14);
      expect(sy).toBeGreaterThanOrEqual(0);
      expect(sy).toBeLessThan(10);
    }
  });
});

describe("crystallize2D", () => {
  const uniq = unique(16, 16);

  it("only ever emits input values (a Voronoi sample, never an average)", () => {
    const present = new Set(flat(uniq));
    for (const v of flat(crystallize2D(uniq, 5))) expect(present.has(v)).toBe(true);
  });

  it("clumps the image into fewer flat cells (faceting reduces the distinct-value count)", () => {
    const distinctIn = new Set(flat(uniq)).size; // 256
    const distinctOut = new Set(flat(crystallize2D(uniq, 5))).size;
    expect(distinctOut).toBeLessThan(distinctIn);
  });

  it("leaves a flat field unchanged (every sample has the same value)", () => {
    const flatField = grid(8, 8, () => 1000);
    expect(crystallize2D(flatField, 4)).toEqual(flatField);
  });

  it("coerces cell_size to i32 and clamps to ≥ 2 (matching the engine `cell_size.max(2)`)", () => {
    const cs2 = crystallize2D(uniq, 2);
    expect(crystallize2D(uniq, 1)).toEqual(cs2); // <2 → 2
    expect(crystallize2D(uniq, 0)).toEqual(cs2); // 0 → 2
    expect(crystallize2D(uniq, -5)).toEqual(cs2); // negative → 2
    expect(crystallize2D(uniq, 5.9)).toEqual(crystallize2D(uniq, 5)); // i32 truncation: 5.9 → 5
    expect(crystallize2D(uniq, NaN)).toEqual(cs2); // NaN | 0 = 0 → 2
    expect(crystallize2D(uniq, 3e9)).toEqual(cs2); // huge value wraps via ToInt32 (3e9|0 < 0) → max(.,2) = 2
    expect(crystallize2D(uniq, 5)).not.toEqual(cs2); // cell 5 ≠ cell 2: the size genuinely matters
  });

  it("handles empty / 1×1 images, is deterministic and does not mutate the input", () => {
    expect(crystallize2D([], 4)).toEqual([]);
    expect(crystallize2D([[], []], 4)).toEqual([[], []]);
    expect(crystallize2D([[42]], 4)).toEqual([[42]]); // lone pixel samples itself
    const snapshot = uniq.map((r) => [...r]);
    const out = crystallize2D(uniq, 5);
    expect(uniq).toEqual(snapshot);
    expect(crystallize2D(uniq, 5)).toEqual(out);
  });

  it("is shape-preserving on a non-square image", () => {
    const ns = unique(3, 7);
    const out = crystallize2D(ns, 3);
    expect(out.length).toBe(3);
    expect(out.every((r) => r.length === 7)).toBe(true);
    for (const v of flat(out)) expect(v).toBeLessThanOrEqual(CRYSTALLIZE_MAX);
  });
});

// ── Cross-implementation goldens captured from the Rust engine's crystallize on a positionally-
//    unique grey field (v = y·w + x), so each output value names the exact source pixel its nearest
//    seed sampled — validating the f32 Voronoi seed CHOICE and the round/clamp, not just the copied
//    value. Integer hash + selection ⇒ bit-exact (strict equality). ──
describe("engine golden (crystallize)", () => {
  it("matches the engine bit-exactly — 14×10, cell 4", () => {
    expect(crystallize2D(unique(10, 14), 4)).toEqual(
      rows(14, "0 0 2 18 18 18 7 7 23 23 9 9 9 13 0 0 2 18 18 18 7 7 23 23 23 23 69 69 0 0 18 18 18 18 18 23 23 23 23 23 69 69 0 73 73 73 61 61 61 23 23 23 23 83 69 69 73 73 73 73 61 61 61 61 79 79 79 83 83 69 112 73 73 73 61 61 61 79 79 79 79 83 83 83 112 73 73 73 73 61 61 79 79 79 79 79 83 83 112 112 73 73 73 130 120 120 120 120 79 79 83 83 112 112 129 129 130 130 130 120 120 120 120 120 83 83 112 129 129 129 130 130 130 120 120 120 120 120 120 139"),
    );
  });

  it("matches the engine bit-exactly — 14×10, cell 3", () => {
    expect(crystallize2D(unique(10, 14), 3)).toEqual(
      rows(14, "0 2 2 3 5 5 20 20 7 7 12 12 12 27 0 0 3 3 3 5 20 20 20 52 52 52 27 27 0 0 3 46 46 20 20 20 20 52 52 52 27 27 58 58 58 46 46 46 63 63 63 52 52 52 52 27 84 58 58 58 46 46 63 63 63 52 52 52 52 83 84 58 58 58 46 90 90 63 63 52 52 52 83 83 84 101 101 101 101 90 90 90 90 52 52 123 123 83 84 101 101 101 101 90 90 90 90 123 123 123 123 139 126 126 101 101 101 90 90 90 90 123 123 123 123 139 126 126 101 101 131 131 132 132 132 123 123 123 123 139"),
    );
  });

  it("matches the engine bit-exactly — 16×16, cell 5", () => {
    expect(crystallize2D(unique(16, 16), 5)).toEqual(
      rows(16, "0 0 3 3 21 21 21 8 8 8 27 27 27 11 11 11 0 0 3 21 21 21 21 21 8 8 27 27 27 27 27 95 0 0 0 21 21 21 21 21 8 27 27 27 27 27 27 95 0 0 0 21 21 21 21 102 102 27 27 27 27 27 95 95 0 116 116 116 102 102 102 102 102 27 27 123 123 123 111 95 116 116 116 116 116 102 102 102 102 123 123 123 123 123 111 111 116 116 116 116 116 102 102 102 102 123 123 123 123 123 111 111 144 116 116 116 116 116 102 102 102 123 123 123 123 123 111 111 144 116 116 116 116 116 102 102 102 123 123 123 123 123 111 111 144 144 116 116 180 181 181 181 170 170 170 170 170 123 123 111 144 144 180 180 180 181 181 181 170 170 170 170 170 170 170 111 144 144 180 180 180 181 181 181 170 170 170 170 170 170 170 170 144 180 180 180 180 181 181 181 170 170 170 170 170 170 170 239 240 240 180 180 180 181 181 181 181 170 170 170 170 170 170 239 240 240 240 180 180 181 181 181 181 170 170 170 170 170 239 239 240 240 240 180 180 181 181 248 248 248 251 251 251 251 251 239"),
    );
  });

  it("matches the engine bit-exactly — 6×6, cell 2 (minimum cell)", () => {
    expect(crystallize2D(unique(6, 6), 2)).toEqual(
      rows(6, "0 1 2 3 4 5 0 2 2 2 4 4 20 20 14 14 22 22 24 20 20 14 22 22 24 32 32 32 28 28 30 32 32 32 28 28"),
    );
  });
});

// ── f32-vs-f64 seed-choice discriminators. The structural goldens above truncate identically under
//    f32 and f64, so they are blind to the seed-position frounds. These ordinary pixels are NOT: the
//    nearest seed differs between f32 and f64 seed positions, and the f32 answer is the engine's.
//    Each (sx,sy) was read back from the real engine by encoding R=x, G=y and reading the sampled
//    pixel's (R,G). Dropping the jx/jy or `(g+j)·csf` frounds (computing seeds in f64) breaks these. ──
describe("engine f32-vs-f64 discriminators (crystallize)", () => {
  it.each([
    { x: 156, y: 185, cs: 3, sample: [155, 186], f64: [156, 187] },
    { x: 15, y: 284, cs: 8, sample: [15, 279], f64: [20, 286] },
    { x: 192, y: 287, cs: 40, sample: [185, 299], f64: [198, 269] },
  ])("pixel ($x,$y) cell $cs samples the engine's f32 seed $sample, not the f64 $f64", ({ x, y, cs, sample }) => {
    expect(crystallizeSample(x, y, cs, 300, 300)).toEqual(sample);
  });
});
