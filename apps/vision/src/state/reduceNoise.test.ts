// Unit tests for the Reduce Noise filter (Filter ▸ Noise ▸ Reduce Noise). Engine-free (node), single
// grey-channel model. These pin the 5×5 bilateral weight (spatial Gaussian sigma_s=2 × colour
// Gaussian sigma_c=0.04+strength·0.20), the dc=3·(Δv)² grey colour distance summed in f32 order, the
// f32 weighted accumulation with edge-clamped taps, and round-half-away to u16 — all matching
// filters.rs reduce_noise. The weight uses `exp`: the engine's f32::exp (libm expf) and JS
// fround(Math.exp) can disagree by ≤1 ULP, shifting a quantised output by ≤1 LSB — so this is
// bit-exact-to-≤1; the engine goldens below sit at exact points.
import { describe, it, expect } from "vitest";
import { reduceNoise2D, reduceNoiseSigmaC, REDUCE_NOISE_MAX } from "./reduceNoise";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();
const nums = (s: string): number[] => s.split(/[,\s]+/).filter((t) => t.length > 0).map(Number);
const noise8 = grid(8, 8, (x, y) => (x * 9973 + y * 9931 + 7919) % 65535);
const noise12 = grid(12, 12, (x, y) => (x * 9973 + y * 9931 + 7919) % 65535);

const fr = Math.fround;
// A deliberately WRONG mirror that accumulates the weighted sum in f64 (no fround per add/mul) instead
// of f32 — used only to prove the engine's f32 accumulation discipline is load-bearing.
function reduceNoiseF64Accum(image: number[][], strength: number): number[][] {
  const h = image.length;
  const w = image[0].length;
  const sigmaC = reduceNoiseSigmaC(strength);
  const inv2s2 = fr(1 / fr(2 * fr(2 * 2)));
  const inv2c2 = fr(1 / fr(2 * fr(sigmaC * sigmaC)));
  const ci = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);
  return image.map((row, y) =>
    row.map((_, x) => {
      const cv = image[y][x] / 65535;
      let acc = 0;
      let wsum = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const sv = image[ci(y + dy, h - 1)][ci(x + dx, w - 1)] / 65535;
          const d = sv - cv;
          const dc = d * d * 3;
          const ds = dx * dx + dy * dy;
          const wgt = Math.exp(-ds * inv2s2 - dc * inv2c2);
          acc += sv * wgt; // f64 accumulation (the mutant)
          wsum += wgt;
        }
      }
      const v = Math.round((acc / wsum) * 65535);
      return v < 0 ? 0 : v > 65535 ? 65535 : v;
    }),
  );
}

// A mirror IDENTICAL to the engine per-tap (every weight is computed in f32, byte-for-byte like the
// production module) that ONLY changes the weighted-sum ACCUMULATION from f32 to f64. This isolates
// the f32-accumulation discipline: it differs from the engine purely because the running sums are not
// re-rounded to f32 after each add. Used to pin that the production module accumulates in f32.
function reduceNoiseF64AccumOnly(image: number[][], strength: number): number[][] {
  const h = image.length;
  const w = image[0].length;
  const sigmaC = reduceNoiseSigmaC(strength);
  const inv2s2 = fr(1 / fr(2 * fr(2 * 2)));
  const inv2c2 = fr(1 / fr(2 * fr(sigmaC * sigmaC)));
  const ci = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);
  return image.map((row, y) =>
    row.map((_, x) => {
      const cv = fr(image[y][x] / 65535);
      let acc = 0;
      let wsum = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const sv = fr(image[ci(y + dy, h - 1)][ci(x + dx, w - 1)] / 65535);
          const d = fr(sv - cv);
          const d2 = fr(d * d);
          const dc = fr(fr(d2 + d2) + d2);
          const ds = fr(dx * dx + dy * dy);
          const arg = fr(fr(-ds * inv2s2) - fr(dc * inv2c2));
          const wgt = fr(Math.exp(arg));
          acc += sv * wgt; // f64 accumulation — the ONLY deviation from the engine
          wsum += wgt;
        }
      }
      const v = fr(fr(acc / wsum) * 65535);
      const r = Math.round(v);
      return r < 0 ? 0 : r > 65535 ? 65535 : r;
    }),
  );
}

// A mirror IDENTICAL to the engine EXCEPT the grey colour distance dc is computed in f64 (d2·3 without
// the f32 re-rounding of the three-term sum). Isolates the f32-ness of the dc step — the engine sums
// three f32 .powi(2) terms, so dc must be re-rounded to f32, not left as an f64 product.
function reduceNoiseF64Dc(image: number[][], strength: number): number[][] {
  const h = image.length;
  const w = image[0].length;
  const sigmaC = reduceNoiseSigmaC(strength);
  const inv2s2 = fr(1 / fr(2 * fr(2 * 2)));
  const inv2c2 = fr(1 / fr(2 * fr(sigmaC * sigmaC)));
  const ci = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);
  return image.map((row, y) =>
    row.map((_, x) => {
      const cv = fr(image[y][x] / 65535);
      let acc = 0;
      let wsum = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const sv = fr(image[ci(y + dy, h - 1)][ci(x + dx, w - 1)] / 65535);
          const d = fr(sv - cv);
          const d2 = fr(d * d);
          const dc = d2 * 3; // f64 dc — the ONLY deviation from the engine
          const ds = fr(dx * dx + dy * dy);
          const arg = fr(fr(-ds * inv2s2) - fr(dc * inv2c2));
          const wgt = fr(Math.exp(arg));
          acc = fr(acc + fr(sv * wgt));
          wsum = fr(wsum + wgt);
        }
      }
      return Math.round(fr(fr(acc / wsum) * 65535));
    }),
  );
}

describe("reduceNoiseSigmaC", () => {
  it("sigma_c = 0.04 + clamp(strength,0,1)·0.20 in f32", () => {
    expect(reduceNoiseSigmaC(0)).toBe(0.03999999910593033); // f32(0.04)
    expect(reduceNoiseSigmaC(0.5)).toBe(0.14000000059604645);
    expect(reduceNoiseSigmaC(1)).toBe(0.24000000953674316);
    expect(reduceNoiseSigmaC(-1)).toBe(0.03999999910593033); // clamp low
    expect(reduceNoiseSigmaC(2)).toBe(0.24000000953674316); // clamp high
  });
});

describe("reduceNoise2D engine goldens", () => {
  it("F1 — 8×8 noise, strength 0.5", () => {
    expect(flat(reduceNoise2D(noise8, 0.5))).toEqual(
      nums(`9005, 17992, 28183, 38156, 48119, 56635, 4147, 12199,
        17953, 28035, 37906, 47872, 56483, 3545, 12168, 21300,
        28109, 37868, 47719, 56413, 3425, 12119, 21970, 31729,
        38040, 47792, 56371, 3383, 12077, 22042, 31901, 41660,
        47961, 56357, 3341, 12035, 22000, 31973, 41832, 51585,
        56442, 3386, 11993, 21958, 31931, 41904, 51755, 60377,
        3927, 11940, 21806, 31779, 41752, 51717, 60365, 7663,
        11903, 21062, 31529, 41502, 51470, 60322, 7633, 15100`),
    );
  });
  it("F2 — 8×8 vertical step (10000|55000), strength 1: the edge is preserved (no cross-edge bleed)", () => {
    const f2 = grid(8, 8, (x) => (x < 4 ? 10000 : 55000));
    // every pixel keeps its own side's value — the 45000 jump dwarfs sigma_c, so cross-edge weight ≈ 0
    expect(flat(reduceNoise2D(f2, 1))).toEqual(flat(f2));
  });
  it("F3 — 7×7 impulse, strength 0 (narrow colour sigma): the spike and its zeros are untouched", () => {
    const f3 = grid(7, 7, (x, y) => (x === 3 && y === 3 ? 65535 : 0));
    expect(reduceNoise2D(f3, 0)).toEqual(f3);
  });
  it("F5 — 9×5 ramp (x·7000), strength 0.3 (rows identical, edges replicate)", () => {
    const f5 = grid(5, 9, (x) => Math.min(x * 7000, 65535));
    const row = [425, 6470, 14000, 21000, 28000, 35000, 42000, 49530, 55575];
    expect(flat(reduceNoise2D(f5, 0.3))).toEqual(Array.from({ length: 5 }, () => row).flat());
  });
});

describe("reduceNoise2D f32 discriminators", () => {
  it("F4 — 12×12 noise, strength 0.7: engine-verified pixels pin the f32 bilateral", () => {
    const o4 = reduceNoise2D(noise12, 0.7);
    expect(o4[5][5]).toBe(41902);
    expect(o4[0][0]).toBe(9993);
    expect(o4[11][11]).toBe(28185);
    expect(o4[3][7]).toBe(41986);
    expect(o4[9][2]).toBe(51602);
  });
  it("the f32 discipline is load-bearing — a fully-f64 mirror diverges at a known pixel", () => {
    // 16×16 noise, strength 0.2: the engine (f32) gives [11][11] = 63871; a mirror that drops f32 in the
    // per-tap math AND the accumulation tips it to 63870. This catches the COMBINED f64 deviation; the
    // accumulation step alone and the dc step alone are isolated by the dedicated tests above (ROW10 /
    // [10][6] and [0][1]). Both mirrors run under the same V8 Math.exp, so the comparison is deterministic.
    const disc = grid(16, 16, (x, y) => (x * 40503 + y * 1009 + 1234) % 65535);
    const f32 = reduceNoise2D(disc, 0.2);
    const f64 = reduceNoiseF64Accum(disc, 0.2);
    expect(f32[11][11]).toBe(63871);
    expect(f64[11][11]).toBe(63870);
    let diffs = 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (f32[y][x] !== f64[y][x]) diffs++;
    expect(diffs).toBe(1); // [11][11] is the sole divergence
  });
  it("DISC ROW11 — engine-captured full row of the 16×16 strength-0.2 discriminator field", () => {
    const disc = grid(16, 16, (x, y) => (x * 40503 + y * 1009 + 1234) % 65535);
    expect(reduceNoise2D(disc, 0.2)[11]).toEqual([
      12333, 52836, 27804, 2772, 43275, 18243, 58746, 33714, 8682, 49185, 24153, 63871, 39624, 14592, 55095, 30063,
    ]);
  });
  it("pins the f32 ACCUMULATION specifically — re-rounding the running sums to f32 is load-bearing", () => {
    // This is the sharp test: the per-tap weights are computed in f32 IDENTICALLY in both mirrors; the
    // ONLY difference is whether the weighted sums are re-rounded to f32 after each add. The engine
    // accumulates in f32 (acc:[f32;3], wsum:f32). On this 12×12 noise field at strength 0.5 the engine
    // gives [10][6] = 57461; accumulating those same f32 weights in f64 tips it to 57462. So a mirror
    // that keeps every per-tap op in f32 but accumulates in f64 STILL diverges — the f32 accumulation,
    // not just the f32 per-tap math, is required for bit-for-bit parity.
    const disc = grid(12, 12, (x, y) => (x * 40503 + y * 1009 + 1234) % 65535);
    const f32 = reduceNoise2D(disc, 0.5); // production: f32 accumulation
    const f64 = reduceNoiseF64AccumOnly(disc, 0.5); // f32 per-tap, f64 accumulation
    expect(f32[10][6]).toBe(57461); // engine-captured (the engine accumulates in f32)
    expect(f64[10][6]).toBe(57462); // f64 accumulation diverges by 1 LSB
    let diffs = 0;
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) if (f32[y][x] !== f64[y][x]) diffs++;
    expect(diffs).toBe(1); // [10][6] is the sole divergence — pins the f32 accumulation precisely
  });
  it("ACCUM ROW10 — engine-captured full row of the 12×12 strength-0.5 f32-accumulation field", () => {
    const disc = grid(12, 12, (x, y) => (x * 40503 + y * 1009 + 1234) % 65535);
    expect(reduceNoise2D(disc, 0.5)[10]).toEqual([
      11252, 51739, 26682, 2129, 42153, 17129, 57461, 32592, 7698, 48063, 22869, 63454,
    ]);
  });
  it("pins the f32 dc computation — re-rounding the colour distance to f32 is load-bearing", () => {
    // The engine sums three f32 (Δ)² terms; computing dc in f64 (d²·3 without re-rounding) diverges. On
    // the 12×12 noise field at strength 0.7 the engine gives [0][1] = 18159 (engine-captured); an f64 dc
    // tips it to 18160. Both mirrors share V8 Math.exp, so the comparison is deterministic in JS.
    const f32 = reduceNoise2D(noise12, 0.7); // production: f32 dc
    const f64dc = reduceNoiseF64Dc(noise12, 0.7); // f64 dc
    expect(f32[0][1]).toBe(18159); // engine-captured exact point
    expect(f64dc[0][1]).toBe(18160); // f64 dc diverges by 1 LSB
    let diffs = 0;
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) if (f32[y][x] !== f64dc[y][x]) diffs++;
    expect(diffs).toBe(1); // [0][1] is the sole divergence — pins the f32 dc step precisely
  });
});

describe("reduceNoise2D semantics & edge cases", () => {
  it("a flat field is unchanged (every tap equal ⇒ weighted mean = the constant)", () => {
    const flatField = grid(6, 6, () => 30000);
    expect(reduceNoise2D(flatField, 0)).toEqual(flatField);
    expect(reduceNoise2D(flatField, 1)).toEqual(flatField);
  });
  it("clamps strength to [0,1] through the 2D entry point (not just reduceNoiseSigmaC)", () => {
    const img = grid(8, 8, (x, y) => (x * 9973 + y * 9931 + 7919) % 65535);
    expect(reduceNoise2D(img, 2)).toEqual(reduceNoise2D(img, 1)); // >1 clamps to 1
    expect(reduceNoise2D(img, -1)).toEqual(reduceNoise2D(img, 0)); // <0 clamps to 0
  });
  it("preserves edges far better than a plain box blur would", () => {
    const step = grid(5, 6, (x) => (x < 3 ? 8000 : 60000));
    const out = reduceNoise2D(step, 1);
    // the column adjacent to the edge stays essentially on its own side (a box blur would average ~34000)
    expect(out[2][2]).toBe(8000);
    expect(out[2][3]).toBe(60000);
  });
  it("NaN strength yields all zeros (NaN sigma ⇒ NaN weights ⇒ NaN as u16 = 0), matching the engine", () => {
    const f6 = grid(5, 5, (x, y) => (x * 31 + y * 17) * 2000);
    expect(flat(reduceNoise2D(f6, NaN))).toEqual(Array(25).fill(0));
  });
  it("does not mutate the input and is deterministic", () => {
    const img = grid(8, 8, (x, y) => ((x + y) % 5) * 12000);
    const copy = img.map((r) => [...r]);
    const a = reduceNoise2D(img, 0.5);
    const b = reduceNoise2D(img, 0.5);
    expect(img).toEqual(copy);
    expect(a).toEqual(b);
  });
  it("preserves shape, including non-square and 1×1", () => {
    expect(reduceNoise2D(grid(3, 7, (x, y) => (x + y) * 1000), 0.5).map((r) => r.length)).toEqual([7, 7, 7]);
    expect(reduceNoise2D([[12345]], 0.5)).toEqual([[12345]]); // every tap clamps to the one pixel ⇒ unchanged
  });
  it("empty input returns an empty copy", () => {
    expect(reduceNoise2D([], 0.5)).toEqual([]);
    expect(reduceNoise2D([[]], 0.5)).toEqual([[]]);
  });
  it("exposes the engine's 16-bit ceiling", () => {
    expect(REDUCE_NOISE_MAX).toBe(65535);
  });
});
