// Unit tests for the Cutout filter. Engine-free (node), per-channel. These pin the box-radius
// derivation (round(simplicity·(4−fidelity)/3) clamped [0,8]), the box smoothing (f32 sum,
// edge-clamped), and the quantisation to clamp(levels,2,8) tiers (must match filters.rs
// cutout), plus a cross-implementation golden captured from the Rust engine. A flat image
// becomes one uniform tier; with radius 0 it is pure (idempotent) posterisation.
import { describe, it, expect } from "vitest";
import { cutoutRadius, cutoutPixel, cutout2D, CUTOUT_MAX } from "./cutout";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();
const TIERS_4 = [0, 21845, 43690, CUTOUT_MAX]; // to16(i/3) for i=0..3 (levels 4 ⇒ lv=3)

describe("cutoutRadius", () => {
  it("derives round(simplicity·(4−fidelity)/3), clamped to [0,8]", () => {
    expect(cutoutRadius(3, 2)).toBe(2); // 3·2/3 = 2
    expect(cutoutRadius(5, 2)).toBe(3); // 10/3 = 3.33 → 3
    expect(cutoutRadius(7, 1)).toBe(7); // 21/3 = 7
    expect(cutoutRadius(10, 1)).toBe(8); // 30/3 = 10 → clamp 8
    expect(cutoutRadius(0, 2)).toBe(0); // no smoothing
    expect(cutoutRadius(1, 3)).toBe(0); // 1·1/3 = 0.33 → 0
  });

  it("clamps simplicity to [0,10] and fidelity to [1,3]", () => {
    expect(cutoutRadius(20, 0)).toBe(8); // es→10, ef→1 ⇒ 30/3=10 → clamp 8
    expect(cutoutRadius(10, 9)).toBe(3); // ef→3 ⇒ 10·1/3 = 3.33 → 3
    expect(cutoutRadius(-5, 2)).toBe(0); // es→0
  });
});

describe("cutoutPixel", () => {
  it("with radius 0 is pure posterisation of the centre pixel (no smoothing)", () => {
    const g = grid(3, 3, (x, y) => (x * 7000 + y * 5000) % CUTOUT_MAX);
    // r=0 ⇒ box is just the centre ⇒ quantise that value; check it lands on a level-4 tier
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        expect(TIERS_4).toContain(cutoutPixel(g, x, y, 4, 0));
      }
    }
  });

  it("smooths a flat region to the quantised flat value", () => {
    const g = grid(7, 7, () => 40000);
    // box-average of a constant is the constant; quantise(40000, levels 4) = ⅔ tier = 43690
    expect(cutoutPixel(g, 3, 3, 4, 2)).toBe(43690);
    expect(cutoutPixel(g, 0, 0, 4, 2)).toBe(43690); // corner, clamped box, same constant
  });

  it("box-smoothing changes a value vs no smoothing on a textured patch", () => {
    const g = grid(9, 9, (x, y) => (x * 6151 + y * 3079) % CUTOUT_MAX);
    // at a high-contrast pixel, a 5×5 average then quantise can differ from the r=0 quantise
    const withSmoothing = cutout2D(g, 6, 5, 2); // r=3
    const noSmoothing = cutout2D(g, 6, 0, 2); // r=0
    expect(withSmoothing).not.toEqual(noSmoothing);
  });
});

describe("cutout2D", () => {
  it("posterises a flat image to a single uniform tier", () => {
    const g = grid(8, 8, () => 40000);
    expect(cutout2D(g, 4, 3, 2)).toEqual(grid(8, 8, () => 43690));
  });

  it("emits only the quantised tiers (levels 4 ⇒ {0, ⅓, ⅔, 1}·65535)", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % CUTOUT_MAX);
    for (const [es, ef] of [
      [0, 2],
      [3, 2],
      [10, 1],
    ]) {
      for (const v of flat(cutout2D(g, 4, es, ef))) expect(TIERS_4).toContain(v);
    }
  });

  it("levels 2 collapses to pure black/white", () => {
    const g = grid(9, 9, (x, y) => (x * 5000 + y * 4000) % CUTOUT_MAX);
    for (const v of flat(cutout2D(g, 2, 2, 2))) expect([0, CUTOUT_MAX]).toContain(v);
  });

  it("radius-0 cutout (pure posterise) is idempotent", () => {
    const g = grid(9, 9, (x, y) => (x * 6151 + y * 3079) % CUTOUT_MAX);
    const once = cutout2D(g, 6, 0, 2); // es 0 → r 0
    expect(cutout2D(once, 6, 0, 2)).toEqual(once); // the tiers are quantiser fixed points
  });

  it("keeps every output an integer within [0, 65535]", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % CUTOUT_MAX);
    for (const [levels, es, ef] of [
      [4, 3, 2],
      [6, 10, 1],
      [8, 7, 3],
    ]) {
      for (const v of flat(cutout2D(g, levels, es, ef))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(CUTOUT_MAX);
      }
    }
  });

  it("clamps levels to [2, 8]", () => {
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % CUTOUT_MAX);
    expect(cutout2D(g, 1, 3, 2)).toEqual(cutout2D(g, 2, 3, 2)); // levels<2 → 2
    expect(cutout2D(g, 99, 3, 2)).toEqual(cutout2D(g, 8, 3, 2)); // levels>8 → 8
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(cutout2D([], 4, 3, 2)).toEqual([]);
    expect(cutout2D([[], []], 4, 3, 2)).toEqual([[], []]);
    // 1×1: the box clamps to the single pixel → average is itself → quantise
    expect(cutout2D([[40000]], 4, 3, 2)).toEqual([[43690]]);
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % 40000);
    expect(cutout2D(g, 6, 10, 1)).toEqual(cutout2D(g, 6, 10, 1));
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => (x * 5000 + y * 4000) % CUTOUT_MAX);
    const snapshot = g.map((r) => [...r]);
    cutout2D(g, 4, 3, 2);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = cutout2D(g, 6, 4, 2);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 13)).toBe(true);
  });
});

// ── Cross-implementation golden: exact u16 output captured from the Rust engine's cutout.
//    Per-channel. The dim 7×7 pattern below keeps r=8 box sums under 2²⁴ (max ≈ 11.5M); a
//    separate BRIGHT case exercises the >2²⁴ f32 high-sum path. (The coarse quantiser makes
//    f32-vs-f64 accumulation unobservable at the output, so the f32 sum is faithful-by-
//    construction rather than golden-discriminated — see cutout.ts.) ──
describe("engine golden (cutout, 7×7)", () => {
  const input = grid(7, 7, (x, y) => (x * 9973 + y * 9931) % CUTOUT_MAX);

  it("matches the engine bit-exactly — levels 4, simplicity 3, fidelity 2 (r=2)", () => {
    expect(cutout2D(input, 4, 3, 2)).toEqual([
      [21845, 21845, 21845, 43690, 43690, 43690, 43690],
      [21845, 21845, 21845, 43690, 43690, 43690, 43690],
      [21845, 21845, 21845, 43690, 43690, 21845, 21845],
      [43690, 43690, 43690, 43690, 21845, 21845, 21845],
      [43690, 43690, 43690, 21845, 21845, 21845, 21845],
      [43690, 43690, 21845, 21845, 21845, 21845, 43690],
      [43690, 43690, 21845, 21845, 21845, 43690, 43690],
    ]);
  });

  it("matches the engine bit-exactly — levels 6, simplicity 10, fidelity 1 (r=8 box)", () => {
    expect(cutout2D(input, 6, 10, 1)).toEqual([
      [26214, 26214, 26214, 26214, 39321, 39321, 39321],
      [26214, 26214, 26214, 39321, 39321, 39321, 39321],
      [26214, 26214, 39321, 39321, 39321, 39321, 39321],
      [26214, 39321, 39321, 39321, 39321, 39321, 39321],
      [39321, 39321, 39321, 39321, 39321, 39321, 39321],
      [39321, 39321, 39321, 39321, 39321, 39321, 39321],
      [39321, 39321, 39321, 39321, 39321, 39321, 39321],
    ]);
  });

  it("matches the engine on a BRIGHT image whose r=8 box sum exceeds 2²⁴", () => {
    // v ∈ [59000, 64999] ⇒ every 17×17 (r=8) box sums ≥ 289·59000 ≈ 17.05M > 2²⁴ (16.77M),
    // so the f32 running sum genuinely loses precision here. Heavy smoothing of a bright field
    // saturates every pixel to the top tier (65535) — captured from the Rust engine.
    const bright = grid(7, 7, (x, y) => 59000 + ((x * 9973 + y * 9931) % 6000));
    expect(cutout2D(bright, 6, 10, 1)).toEqual(grid(7, 7, () => 65535));
  });
});

// ── Several levels/simplicity/fidelity fixtures swept for in-range, shape, flat→tier ──
const FIXTURES: { name: string; levels: number; es: number; ef: number }[] = [
  { name: "coarse simple", levels: 3, es: 8, ef: 1 },
  { name: "fine sharp", levels: 8, es: 2, ef: 3 },
  { name: "mid", levels: 5, es: 5, ef: 2 },
];

describe.each(FIXTURES)("fixture: $name", ({ levels, es, ef }) => {
  it("stays in range, keeps shape, and posterises a flat field uniformly", () => {
    const g = grid(13, 13, (x, y) => (x * 4099 + y * 8191) % CUTOUT_MAX);
    const out = cutout2D(g, levels, es, ef);
    expect(out.length).toBe(13);
    expect(out.every((r) => r.length === 13)).toBe(true);
    for (const v of flat(out)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(CUTOUT_MAX);
    }
    const flatOut = cutout2D(grid(13, 13, () => 33333), levels, es, ef);
    expect(new Set(flat(flatOut)).size).toBe(1); // a flat field → a single uniform tier
  });
});
