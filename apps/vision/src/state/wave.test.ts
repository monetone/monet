// Unit tests for the Wave distortion. Engine-free (node). These pin the deterministic
// generator derivation (interpolated wavelength/amplitude, golden-ratio phase), the three
// wave profiles (sine/triangle/square), the cross-axis displacement, and wrap-vs-clamp
// borders (must match mod.rs wave_buf), plus a cross-implementation golden captured from the
// Rust engine. Zero amplitude / zero scale are EXACT identities (no half-pixel bias).
import { describe, it, expect } from "vitest";
import { waveGenerators, waveDisplacement, wave2D, WAVE_MAX } from "./wave";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();
const TAU = Math.fround(2 * Math.PI);
const argminX = (row: number[]): number => {
  let bx = 0;
  let bv = Infinity;
  for (let x = 0; x < row.length; x++)
    if (row[x] < bv) {
      bv = row[x];
      bx = x;
    }
  return bx;
};

describe("waveGenerators", () => {
  it("derives a single generator at min values when numGen ≤ 1", () => {
    expect(waveGenerators(1, 16, 16, 5, 5)).toEqual([{ wl: 16, amp: 5, phase: 0 }]);
    // numGen 0 is treated as 1 (max(numGen,1)); phase of g=0 is fract(0)·τ = 0
    expect(waveGenerators(0, 12, 20, 2, 8)).toEqual([{ wl: 12, amp: 2, phase: 0 }]);
  });

  it("interpolates wavelength & amplitude across [min,max] over the generators", () => {
    const g = waveGenerators(3, 8, 16, 3, 9);
    expect(g.map((v) => v.wl)).toEqual([8, 12, 16]); // t = 0, 0.5, 1
    expect(g.map((v) => v.amp)).toEqual([3, 6, 9]);
  });

  it("scatters the phase by the golden ratio (fract(g·0.618034)·τ)", () => {
    const g = waveGenerators(3, 10, 10, 4, 4);
    const ph = (gi: number) => {
      const p = Math.fround(Math.fround(gi) * Math.fround(0.618034));
      return Math.fround(Math.fround(p - Math.trunc(p)) * TAU);
    };
    expect(g[0].phase).toBe(0);
    expect(g[1].phase).toBeCloseTo(ph(1), 5);
    expect(g[2].phase).toBeCloseTo(ph(2), 5);
    expect(g[1].phase).not.toBe(g[2].phase); // genuinely scattered
  });

  it("clamps a sub-pixel wavelength up to 1", () => {
    expect(waveGenerators(1, 0.5, 0.5, 3, 3)[0].wl).toBe(1);
    expect(waveGenerators(2, 0.25, 0.75, 1, 1)[0].wl).toBe(1); // both ends clamp
  });

  it("truncates a fractional numGen like the engine's u32 cast", () => {
    expect(waveGenerators(2.9, 8, 16, 3, 9)).toEqual(waveGenerators(2, 8, 16, 3, 9));
  });
});

describe("waveDisplacement", () => {
  const sine = waveGenerators(1, 16, 16, 5, 5);

  it("is zero everywhere at zero amplitude", () => {
    const z = waveGenerators(1, 16, 16, 0, 0);
    for (const [x, y] of [
      [0, 0],
      [3, 5],
      [6, 2],
    ]) {
      for (const wt of [0, 1, 2]) expect(waveDisplacement(x, y, z, wt)).toEqual({ dx: 0, dy: 0 });
    }
  });

  it("square wave displaces by exactly ±amp per generator", () => {
    const sq = waveGenerators(1, 12, 12, 3, 3);
    for (const [x, y] of [
      [2, 1],
      [5, 6],
      [0, 4],
    ]) {
      const { dx, dy } = waveDisplacement(x, y, sq, 2);
      expect(Math.abs(dx)).toBe(3);
      expect(Math.abs(dy)).toBe(3);
    }
  });

  it("couples cross-axis: dx depends only on the row y, dy only on the column x", () => {
    // dx(x,y) is the same for every x at a fixed y; dy(x,y) the same for every y at fixed x
    expect(waveDisplacement(0, 4, sine, 0).dx).toBe(waveDisplacement(6, 4, sine, 0).dx);
    expect(waveDisplacement(2, 0, sine, 0).dy).toBe(waveDisplacement(2, 9, sine, 0).dy);
    // and dx tracks y (a non-trivial sine), so two different rows differ
    expect(waveDisplacement(0, 1, sine, 0).dx).not.toBe(waveDisplacement(0, 5, sine, 0).dx);
  });

  it("bounds triangle/sine displacement by Σamp (|wavef| ≤ 1)", () => {
    const g = waveGenerators(2, 8, 16, 3, 5); // Σamp = 8
    for (const wt of [0, 1]) {
      for (let y = 0; y < 20; y++) {
        expect(Math.abs(waveDisplacement(0, y, g, wt).dx)).toBeLessThanOrEqual(8 + 1e-4);
      }
    }
  });
});

describe("wave2D", () => {
  it("is the exact identity at zero amplitude (every wave type, wrap and clamp)", () => {
    const g = grid(9, 11, (x, y) => (x * 37 + y * 19) % WAVE_MAX);
    for (const wt of [0, 1, 2]) {
      for (const wrap of [false, true]) {
        expect(wave2D(g, 2, 8, 16, 0, 0, 1, 1, wt, wrap)).toEqual(g);
      }
    }
  });

  it("is the exact identity at zero scale on both axes", () => {
    const g = grid(9, 9, (x, y) => (x * 53 + y * 97) % WAVE_MAX);
    expect(wave2D(g, 3, 8, 16, 5, 9, 0, 0, 0, false)).toEqual(g);
  });

  it("a horizontal-only warp leaves a row-constant image unchanged", () => {
    // scale_v = 0 → sy = y; if every column in a row is equal, shifting x samples the same
    // value, so the output is identical (exercises the cross-axis sx path with no artifacts).
    const g = grid(12, 12, (_x, y) => y * 4000);
    expect(wave2D(g, 1, 10, 10, 6, 6, 1, 0, 0, false)).toEqual(g);
  });

  it("leaves a constant image unchanged at any params (wrap and clamp)", () => {
    const g = grid(10, 10, () => 31000);
    for (const wrap of [false, true]) {
      for (const wt of [0, 1, 2]) {
        expect(wave2D(g, 2, 6, 14, 7, 7, 1, 1, wt, wrap)).toEqual(g);
      }
    }
  });

  it("bends a straight vertical line (the engine's sine signature)", () => {
    // 40×40 white with a black column at x=20; sine wave, horizontal only — the line should
    // sweep across many columns as y varies (engine asserts range ≥ 6).
    const g = grid(40, 40, () => WAVE_MAX);
    for (let y = 0; y < 40; y++) g[y][20] = 0;
    const out = wave2D(g, 1, 16, 16, 5, 5, 1, 0, 0, false);
    const xs = out.map((row) => argminX(row));
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(6);
  });

  it("a square wave snaps the line between ~2 columns; sine sweeps continuously", () => {
    const g = grid(40, 40, () => WAVE_MAX);
    for (let y = 0; y < 40; y++) g[y][20] = 0;
    const distinct = (wt: number) => {
      const out = wave2D(g, 1, 16, 16, 5, 5, 1, 0, wt, false);
      return new Set(out.map((row) => argminX(row))).size;
    };
    expect(distinct(2)).toBeLessThanOrEqual(3); // square: ~2 snap positions
    expect(distinct(0)).toBeGreaterThanOrEqual(6); // sine: continuous sweep
  });

  it("wrap and clamp resolve an off-edge source to concretely different columns", () => {
    // A horizontal colour ramp (value = column·1000, row-independent) reveals which column a
    // pixel sampled FROM. Square wave, 1 gen, amp 3, scale 1: at row 0 the phase is 0 so
    // sin=0 → +1 → dx=+3 → sx = x−3 (an integer). For x=0, sx=−3:
    //   clamp → column 0  (edge-replicate)            → 0
    //   wrap  → rem_euclid(−3, 8) = column 5          → 5000
    // This pins the branch DIRECTION (a wrap↔clamp swap flips these two values), not just
    // that the two modes differ.
    const ramp = grid(4, 8, (x) => x * 1000);
    const clamp = wave2D(ramp, 1, 16, 16, 3, 3, 1, 1, 2, false);
    const wrap = wave2D(ramp, 1, 16, 16, 3, 3, 1, 1, 2, true);
    expect(clamp[0][0]).toBe(0); // sx=−3 → edge column 0
    expect(wrap[0][0]).toBe(5000); // sx=−3 → rem_euclid(−3,8)=5
  });

  it("keeps every output an integer within [0, 65535]", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % WAVE_MAX);
    for (const wt of [0, 1, 2]) {
      for (const wrap of [false, true]) {
        for (const v of flat(wave2D(g, 3, 6, 18, 4, 8, 1, 1, wt, wrap))) {
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(WAVE_MAX);
        }
      }
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(wave2D([], 2, 8, 16, 5, 5, 1, 1, 0, false)).toEqual([]);
    expect(wave2D([[], []], 2, 8, 16, 5, 5, 1, 1, 0, true)).toEqual([[], []]);
    expect(wave2D([[42]], 3, 8, 16, 9, 9, 1, 1, 1, false)).toEqual([[42]]); // lone pixel
    expect(wave2D([[42]], 3, 8, 16, 9, 9, 1, 1, 0, true)).toEqual([[42]]);
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % 40000);
    expect(wave2D(g, 2, 8, 16, 4, 6, 1, 1, 0, false)).toEqual(wave2D(g, 2, 8, 16, 4, 6, 1, 1, 0, false));
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => (x + y) * 3000);
    const snapshot = g.map((row) => [...row]);
    for (const wt of [0, 1, 2]) wave2D(g, 2, 8, 16, 5, 5, 1, 1, wt, false);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = wave2D(g, 2, 8, 16, 5, 5, 1, 1, 0, true);
    expect(out.length).toBe(5);
    expect(out.every((row) => row.length === 13)).toBe(true);
  });
});

// ── Cross-implementation golden: exact u16 output captured from the Rust engine's wave_buf
//    (7×7, input (x·9973 + y·9931) mod 65535) across all three wave types. Square is
//    bit-exact (displacement is exactly ±amp → integer source coords); sine/triangle match
//    to ≤1 LSB (f32 sin/asin residual through the bilinear blend). ──
describe("engine golden (wave_buf, 7×7)", () => {
  const input = grid(7, 7, (x, y) => (x * 9973 + y * 9931) % WAVE_MAX);
  const maxDiff = (a: number[][], b: number[][]): number => {
    let m = 0;
    for (let y = 0; y < a.length; y++)
      for (let x = 0; x < a[0].length; x++) m = Math.max(m, Math.abs(a[y][x] - b[y][x]));
    return m;
  };

  it("matches the engine on sine (2 generators, clamp) to ≤1 LSB", () => {
    const GOLDEN = [
      [27089, 26128, 8104, 19899, 30917, 36361, 26269],
      [26046, 25154, 8376, 23945, 40848, 46292, 36200],
      [7962, 8316, 13987, 29740, 50731, 53889, 46131],
      [19755, 23868, 29723, 45477, 53889, 53889, 53889],
      [30820, 40793, 50718, 53889, 53889, 53889, 53889],
      [36287, 46260, 53889, 53889, 53889, 53889, 53889],
      [26152, 36125, 46098, 53889, 53889, 53889, 53889],
    ];
    expect(maxDiff(wave2D(input, 2, 8, 16, 3, 5, 1, 1, 0, false), GOLDEN)).toBeLessThanOrEqual(1);
  });

  it("matches the engine on triangle (wrap) to ≤1 LSB", () => {
    const GOLDEN = [
      [0, 4024, 8038, 18011, 33943, 49865, 15355],
      [37571, 48717, 37361, 8013, 25921, 43839, 40786],
      [57759, 49302, 40845, 37596, 19896, 37813, 55731],
      [15262, 14669, 14076, 8206, 29827, 47744, 23720],
      [28043, 26082, 27824, 37797, 50472, 8097, 26015],
      [49655, 51683, 53711, 37470, 16067, 33985, 51903],
      [10008, 12036, 14064, 24037, 41955, 53889, 26249],
    ];
    expect(maxDiff(wave2D(input, 1, 10, 10, 4, 4, 1, 0.5, 1, true), GOLDEN)).toBeLessThanOrEqual(1);
  });

  it("matches the engine bit-exactly on square (clamp — integer source coords)", () => {
    const GOLDEN = [
      [0, 0, 0, 0, 9973, 19946, 59712],
      [0, 0, 0, 0, 9973, 19946, 4108],
      [0, 0, 0, 0, 9973, 19946, 14039],
      [0, 0, 0, 0, 9973, 19946, 23970],
      [9931, 9931, 9931, 9931, 19904, 29877, 23970],
      [19862, 19862, 19862, 19862, 29835, 39808, 23970],
      [59712, 4150, 14123, 24096, 24096, 24096, 53889],
    ];
    expect(wave2D(input, 1, 12, 12, 3, 3, 1, 1, 2, false)).toEqual(GOLDEN);
  });
});

// ── Several generator/type/wrap fixtures swept for in-range, shape, constant-invariance ──
const FIXTURES: { name: string; ng: number; wt: number; wrap: boolean }[] = [
  { name: "single sine clamp", ng: 1, wt: 0, wrap: false },
  { name: "multi triangle wrap", ng: 4, wt: 1, wrap: true },
  { name: "square clamp", ng: 2, wt: 2, wrap: false },
  { name: "many-gen sine wrap", ng: 6, wt: 0, wrap: true },
];

describe.each(FIXTURES)("fixture: $name", ({ ng, wt, wrap }) => {
  it("stays in range, keeps shape, and leaves a flat field untouched", () => {
    const g = grid(13, 13, (x, y) => (x * 4099 + y * 8191) % WAVE_MAX);
    const out = wave2D(g, ng, 6, 20, 4, 9, 1, 1, wt, wrap);
    expect(out.length).toBe(13);
    expect(out.every((row) => row.length === 13)).toBe(true);
    for (const v of flat(out)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(WAVE_MAX);
    }
    const flatField = grid(13, 13, () => 22222);
    expect(wave2D(flatField, ng, 6, 20, 4, 9, 1, 1, wt, wrap)).toEqual(flatField);
  });
});
