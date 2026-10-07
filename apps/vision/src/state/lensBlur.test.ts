// Unit tests for the Lens Blur filter (Filter ▸ Blur ▸ Lens Blur). Engine-free (node), single
// grey-channel model on an opaque image. These pin the circular-disc aperture (dx²+dy²≤r²), the
// f32 bloom exponent g = 1 + clamp(brightness,0,1)·4, and the f64 generalized power-mean
// avg = (mean of (v/65535)^g)^(1/g) with edge-clamped taps and round-half-up to u16 — all matching
// filters.rs lens_blur. The math uses `Math.pow`: Rust's f64::powf (native libm pow) and JS Math.pow
// (V8 fdlibm pow) can disagree by ≤1 ULP, shifting a quantised output by ≤1 LSB — so this is
// bit-exact-to-≤1; the engine goldens below sit at exact points.
import { describe, it, expect } from "vitest";
import { lensBlur2D, lensBlurDisc, lensBlurExponent, LENS_BLUR_MAX } from "./lensBlur";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();
// parse a verbatim engine-dumped array (commas/whitespace), avoiding hand-transcription miscounts
const nums = (s: string): number[] => s.split(/[,\s]+/).filter((t) => t.length > 0).map(Number);
// the engine's 24×24 noise fixture, used for the f64-accumulation discriminators
const noise24 = grid(24, 24, (x, y) => (x * 9973 + y * 9931 + 7919) % 65535);

// A deliberately WRONG mirror that accumulates the disc in f32 (Math.fround per add) instead of f64,
// used only to prove the engine's f64 accumulation is load-bearing (it must diverge somewhere).
const fr = Math.fround;
function lensBlurF32Accum(image: number[][], radius: number, brightness: number): number[][] {
  const { offsets } = lensBlurDisc(radius);
  const g = lensBlurExponent(brightness);
  const invG = 1 / g;
  const n = offsets.length;
  const h = image.length;
  const w = image[0].length;
  const ci = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);
  return image.map((row, y) =>
    row.map((_, x) => {
      let acc = 0;
      for (const [dx, dy] of offsets) acc = fr(acc + fr(Math.pow(image[ci(y + dy, h - 1)][ci(x + dx, w - 1)] / 65535, g)));
      const v = Math.round(Math.pow(acc / n, invG) * 65535);
      return v < 0 ? 0 : v > 65535 ? 65535 : v;
    }),
  );
}

describe("lensBlurDisc", () => {
  it("is the set of integer offsets inside the radius-r disc, clamped to [1,20]", () => {
    expect(lensBlurDisc(1).offsets.length).toBe(5); // the 5-point plus (corners excluded: 1+1>1)
    expect(lensBlurDisc(2).offsets.length).toBe(13);
    expect(lensBlurDisc(3).offsets.length).toBe(29);
    expect(lensBlurDisc(5).offsets.length).toBe(81);
    expect(lensBlurDisc(20).offsets.length).toBe(1257);
    // r1 is the plus, generated dy-outer / dx-inner
    expect(lensBlurDisc(1).offsets).toEqual([
      [0, -1],
      [-1, 0],
      [0, 0],
      [1, 0],
      [0, 1],
    ]);
  });
  it("clamps radius to [1,20] and truncates toward zero", () => {
    expect(lensBlurDisc(0).r).toBe(1);
    expect(lensBlurDisc(-7).r).toBe(1);
    expect(lensBlurDisc(25).r).toBe(20);
    expect(lensBlurDisc(2.9).r).toBe(2); // trunc, not round
    expect(lensBlurDisc(2.9).offsets.length).toBe(13);
    // wasm i32 ToInt32 coercion: NaN/±Inf radius → 0 → clamp 1 (the engine never builds an empty disc)
    expect(lensBlurDisc(NaN).r).toBe(1);
    expect(lensBlurDisc(Infinity).r).toBe(1);
    expect(lensBlurDisc(-Infinity).r).toBe(1);
    // `| 0` is true ToInt32: it wraps mod 2³² (2³²+10 → 10), unlike a plain Math.trunc
    expect(lensBlurDisc(2 ** 32 + 10).r).toBe(10);
    expect(lensBlurDisc(2 ** 31).r).toBe(1); // wraps to −2³¹ → clamp 1
  });
});

describe("lensBlurExponent", () => {
  it("g = 1 + clamp(brightness,0,1)·4 in f32 (∈ [1,5])", () => {
    expect(lensBlurExponent(0)).toBe(1);
    expect(lensBlurExponent(0.25)).toBe(2);
    expect(lensBlurExponent(0.5)).toBe(3);
    expect(lensBlurExponent(1)).toBe(5);
    expect(lensBlurExponent(-1)).toBe(1); // clamp low
    expect(lensBlurExponent(2)).toBe(5); // clamp high
  });
  it("computes g in f32, NOT f64 — a fround-free g would give 1.4 / 3.8 (engine uses `brightness: f32`)", () => {
    // these brightnesses give a g that is NOT f32-exact, pinning the f32 widening (no pow involved ⇒ exact)
    expect(lensBlurExponent(0.1)).toBe(1.399999976158142); // pure-f64 would be 1.4
    expect(lensBlurExponent(0.7)).toBe(3.799999952316284); // pure-f64 would be 3.8
    expect(lensBlurExponent(0.9)).toBe(4.599999904632568); // pure-f64 would be 4.6
  });
});

describe("lensBlur2D engine goldens", () => {
  it("F1 — 9×9 impulse, radius 2, brightness 0 is a plain circular-disc average", () => {
    const f1 = grid(9, 9, (x, y) => (x === 4 && y === 4 ? 65535 : 0));
    // brightness 0 ⇒ g=1 ⇒ linear mean: 65535/13 = 5041 over the 13-point disc
    expect(flat(lensBlur2D(f1, 2, 0))).toEqual(
      nums(`0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 5041, 0, 0, 0, 0,
        0, 0, 0, 5041, 5041, 5041, 0, 0, 0,
        0, 0, 5041, 5041, 5041, 5041, 5041, 0, 0,
        0, 0, 0, 5041, 5041, 5041, 0, 0, 0,
        0, 0, 0, 0, 5041, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0`),
    );
  });
  it("F2 — same impulse, brightness 1 (g=5) blooms the highlight far brighter (5041 → 39236)", () => {
    const f1 = grid(9, 9, (x, y) => (x === 4 && y === 4 ? 65535 : 0));
    expect(flat(lensBlur2D(f1, 2, 1))).toEqual(
      nums(`0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 39236, 0, 0, 0, 0,
        0, 0, 0, 39236, 39236, 39236, 0, 0, 0,
        0, 0, 39236, 39236, 39236, 39236, 39236, 0, 0,
        0, 0, 0, 39236, 39236, 39236, 0, 0, 0,
        0, 0, 0, 0, 39236, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0`),
    );
  });
  it("F3 — 8×8 vertical step (60000|4000), radius 3, brightness 0.5 (g=3)", () => {
    const f3 = grid(8, 8, (x) => (x < 4 ? 60000 : 4000));
    expect(flat(lensBlur2D(f3, 3, 0.5))).toEqual([
      60000, 59302, 55540, 51184, 43440, 35500, 19583, 4000, 60000, 59302, 55540, 51184, 43440, 35500, 19583, 4000,
      60000, 59302, 55540, 51184, 43440, 35500, 19583, 4000, 60000, 59302, 55540, 51184, 43440, 35500, 19583, 4000,
      60000, 59302, 55540, 51184, 43440, 35500, 19583, 4000, 60000, 59302, 55540, 51184, 43440, 35500, 19583, 4000,
      60000, 59302, 55540, 51184, 43440, 35500, 19583, 4000, 60000, 59302, 55540, 51184, 43440, 35500, 19583, 4000,
    ]);
  });
  it("F5 — 10×10 ramp (x·7000), radius 3, brightness 1 (bloom on a ramp)", () => {
    const f5 = grid(10, 10, (x) => Math.min(x * 7000, 65535));
    const row = [11878, 16939, 22381, 28129, 34126, 40322, 46678, 52548, 56630, 59791];
    expect(flat(lensBlur2D(f5, 3, 1))).toEqual(Array.from({ length: 10 }, () => row).flat());
  });
  it("F7 — single highlight on a dim field: brightness 1 blooms the neighbourhood (6846 → 38916)", () => {
    const f7 = grid(7, 7, (x, y) => (x === 3 && y === 3 ? 65000 : 2000));
    expect(flat(lensBlur2D(f7, 2, 0))).toEqual([
      2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 6846, 2000, 2000, 2000, 2000, 2000, 6846, 6846, 6846,
      2000, 2000, 2000, 6846, 6846, 6846, 6846, 6846, 2000, 2000, 2000, 6846, 6846, 6846, 2000, 2000, 2000, 2000, 2000,
      6846, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000,
    ]);
    expect(flat(lensBlur2D(f7, 2, 1))).toEqual([
      2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 38916, 2000, 2000, 2000, 2000, 2000, 38916, 38916,
      38916, 2000, 2000, 2000, 38916, 38916, 38916, 38916, 38916, 2000, 2000, 2000, 38916, 38916, 38916, 2000, 2000,
      2000, 2000, 2000, 38916, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000,
    ]);
  });
});

describe("lensBlur2D f64 / pow discriminators", () => {
  it("F4 — 24×24 noise, radius 4, brightness 1: engine-verified scattered pixels pin the f64 power-mean", () => {
    const o4 = lensBlur2D(noise24, 4, 1);
    expect(o4[1][17]).toBe(40949);
    expect(o4[20][7]).toBe(46566);
    expect(o4[12][12]).toBe(43011);
    expect(o4[5][9]).toBe(46600);
    expect(o4[0][0]).toBe(36774);
  });
  it("F4 — three full engine-captured rows pin 72 absolute outputs (broad coverage of the power-mean)", () => {
    // engine-anchored (captured from the real Rust engine), away from the ≤1-LSB knife-edge in row 19
    const o4 = lensBlur2D(noise24, 4, 1);
    expect(o4[0]).toEqual([
      36774, 40675, 41835, 42633, 42619, 42635, 42772, 44799, 46140, 45936, 46178, 46172, 46212, 46395, 46395, 44538,
      42664, 41449, 41457, 41578, 43341, 43843, 43193, 44301,
    ]);
    expect(o4[5]).toEqual([
      42501, 43435, 45433, 46948, 46032, 44898, 44400, 44313, 46355, 46600, 45449, 45687, 42421, 39620, 41507, 43681,
      45400, 44837, 43739, 43248, 43083, 44470, 45219, 46433,
    ]);
    expect(o4[12]).toEqual([
      45830, 46836, 46977, 45697, 45443, 42185, 39381, 41259, 43430, 45149, 44590, 43500, 43011, 42889, 44886, 47106,
      48821, 48196, 46998, 46491, 46396, 47845, 48629, 48803,
    ]);
  });
  it("the f64 accumulation is load-bearing — an f32-accumulating mirror diverges at exactly one pixel", () => {
    // Both mirrors run under the SAME V8 Math.pow, so this comparison is deterministic in JS and immune to
    // the engine-vs-V8 pow discrepancy. [19][12] is the single knife-edge (pre-round 46249.4999): f64 floors
    // to 46249, the lossy f32 disc-sum tips it to 46250. This pins the f64 discipline without engine-anchoring
    // the fragile pixel (its native-engine value is 46249, but the deployed WASM libm pow could differ by ≤1).
    const f64 = lensBlur2D(noise24, 4, 1);
    const f32 = lensBlurF32Accum(noise24, 4, 1);
    expect(f64[19][12]).toBe(46249);
    expect(f32[19][12]).toBe(46250);
    let diffs = 0;
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) if (f64[y][x] !== f32[y][x]) diffs++;
    expect(diffs).toBe(1); // [19][12] is the sole divergence across the 576-pixel field
  });
});

describe("lensBlur2D semantics & edge cases", () => {
  it("brightness 0 reduces to the arithmetic disc mean (g=1 ⇒ no gamma)", () => {
    const img = grid(6, 6, (x, y) => ((x * 7 + y * 13) % 9) * 7000);
    const { offsets } = lensBlurDisc(2);
    const ci = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);
    const linear = img.map((row, y) =>
      row.map((_, x) => {
        let acc = 0;
        for (const [dx, dy] of offsets) acc += img[ci(y + dy, 5)][ci(x + dx, 5)];
        return Math.round(acc / offsets.length);
      }),
    );
    expect(lensBlur2D(img, 2, 0)).toEqual(linear);
  });
  it("a flat field is unchanged (mean of a constant, any brightness)", () => {
    const flatField = grid(7, 7, () => 30000);
    expect(lensBlur2D(flatField, 4, 1)).toEqual(flatField);
    expect(lensBlur2D(flatField, 4, 0)).toEqual(flatField);
  });
  it("edge taps replicate the border (no darkening at corners on a flat field)", () => {
    const f = grid(5, 5, () => 50000);
    expect(lensBlur2D(f, 3, 1)[0][0]).toBe(50000);
    expect(lensBlur2D(f, 3, 1)[4][4]).toBe(50000);
  });
  it("NaN brightness yields all zeros (NaN as u16 = 0), matching the engine", () => {
    const f6 = grid(5, 5, (x, y) => (x === 2 && y === 2 ? 50000 : 0));
    expect(flat(lensBlur2D(f6, 1, NaN))).toEqual(Array(25).fill(0));
  });
  it("does not mutate the input and is deterministic", () => {
    const img = grid(8, 8, (x, y) => ((x + y) % 5) * 12000);
    const copy = img.map((r) => [...r]);
    const a = lensBlur2D(img, 3, 0.5);
    const b = lensBlur2D(img, 3, 0.5);
    expect(img).toEqual(copy);
    expect(a).toEqual(b);
  });
  it("preserves shape, including non-square and 1×1", () => {
    expect(lensBlur2D(grid(3, 7, (x, y) => (x + y) * 1000), 2, 1).map((r) => r.length)).toEqual([7, 7, 7]);
    expect(lensBlur2D([[12345]], 5, 1)).toEqual([[12345]]); // every disc tap clamps to the one pixel
  });
  it("empty input returns an empty copy", () => {
    expect(lensBlur2D([], 3, 1)).toEqual([]);
    expect(lensBlur2D([[]], 3, 1)).toEqual([[]]);
  });
  it("exposes the engine's 16-bit ceiling", () => {
    expect(LENS_BLUR_MAX).toBe(65535);
  });
});
