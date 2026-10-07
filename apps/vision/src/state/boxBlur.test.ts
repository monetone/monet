// Unit tests for the Box Blur filter. Engine-free (node). These pin the uniform
// moving-average (must match filters.rs box_blur: mean of the (2r+1)² edge-clamped
// window ÷ the fixed area, radius<1 is a no-op) and its defining properties: flats
// are preserved, an impulse spreads to a flat box, the border is edge-replicated, the
// result stays in range, and the 2-D blur is separable (h-pass ∘ v-pass ≡ direct).
import { describe, it, expect } from "vitest";
import { boxBlur1D, boxBlur2D, boxBlurSeparable } from "./boxBlur";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("boxBlur1D", () => {
  it("radius < 1 returns an unchanged copy", () => {
    const sig = [1, 2, 3, 4];
    const out = boxBlur1D(sig, 0);
    expect(out).toEqual(sig);
    expect(out).not.toBe(sig); // fresh copy
  });

  it("a NaN radius is a no-op (defensive)", () => {
    expect(boxBlur1D([1, 2, 3], NaN)).toEqual([1, 2, 3]);
  });

  it("leaves a constant signal unchanged", () => {
    for (const v of boxBlur1D([7, 7, 7, 7, 7], 2)) expect(v).toBeCloseTo(7, 12);
  });

  it("computes exact window means with edge clamping", () => {
    // [0,3,6] r=1 → i0:[0,0,3]/3=1, i1:[0,3,6]/3=3, i2:[3,6,6]/3=5
    expect(boxBlur1D([0, 3, 6], 1)).toEqual([1, 3, 5]);
  });

  it("replicates the border (edge values repeat into out-of-bounds taps)", () => {
    // [10,0,0] r=1 → i0:[10,10,0]/3, i1:[10,0,0]/3, i2:[0,0,0]/3
    const out = boxBlur1D([10, 0, 0], 1);
    expect(out[0]).toBeCloseTo(20 / 3, 12);
    expect(out[1]).toBeCloseTo(10 / 3, 12);
    expect(out[2]).toBe(0);
  });

  it("spreads a unit impulse into a flat box of height 1/(2r+1)", () => {
    const out = boxBlur1D([0, 0, 0, 1, 0, 0, 0], 1);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBeCloseTo(1 / 3, 12);
    expect(out[3]).toBeCloseTo(1 / 3, 12);
    expect(out[4]).toBeCloseTo(1 / 3, 12);
    expect(out[5]).toBe(0);
    expect(out[6]).toBe(0);
  });

  it("keeps the output within the input's min/max range", () => {
    const sig = [3, 9, 1, 7, 2, 8, 4];
    const lo = Math.min(...sig);
    const hi = Math.max(...sig);
    for (const v of boxBlur1D(sig, 2)) {
      expect(v).toBeGreaterThanOrEqual(lo);
      expect(v).toBeLessThanOrEqual(hi);
    }
  });

  it("handles an empty signal and is deterministic", () => {
    expect(boxBlur1D([], 1)).toEqual([]);
    const sig = [5, 2, 9, 1, 6];
    expect(boxBlur1D(sig, 2)).toEqual(boxBlur1D(sig, 2));
  });

  it("does not mutate the input", () => {
    const sig = [1, 4, 1, 5, 9];
    const snapshot = [...sig];
    boxBlur1D(sig, 2);
    expect(sig).toEqual(snapshot);
  });
});

describe("boxBlur2D", () => {
  it("radius < 1 returns an unchanged copy", () => {
    const g = grid(3, 3, (x, y) => x + y * 3);
    const out = boxBlur2D(g, 0);
    expect(out).toEqual(g);
    expect(out).not.toBe(g);
  });

  it("a NaN radius is a no-op", () => {
    const g = grid(3, 3, (x, y) => x + y);
    expect(boxBlur2D(g, NaN)).toEqual(g);
  });

  it("leaves a constant image unchanged", () => {
    const g = grid(4, 4, () => 128);
    for (const v of flat(boxBlur2D(g, 2))) expect(v).toBeCloseTo(128, 12);
  });

  it("spreads a single central spike to 1 everywhere in a 3×3 (every window holds it)", () => {
    // the lone 9 at the centre is inside every 3×3 clamped window → mean 9/9 = 1
    const g = [
      [0, 0, 0],
      [0, 9, 0],
      [0, 0, 0],
    ];
    expect(boxBlur2D(g, 1)).toEqual([
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ]);
  });

  it("a single-row image blurs exactly like the 1-D case (vertical clamps onto the one row)", () => {
    expect(boxBlur2D([[0, 3, 6]], 1)).toEqual([[1, 3, 5]]);
  });

  it("keeps the output within the input's min/max range", () => {
    const g = grid(6, 7, (x, y) => (x * 31 + y * 17) % 256);
    const lo = Math.min(...flat(g));
    const hi = Math.max(...flat(g));
    for (const v of flat(boxBlur2D(g, 2))) {
      expect(v).toBeGreaterThanOrEqual(lo);
      expect(v).toBeLessThanOrEqual(hi);
    }
  });

  it("preserves a linear gradient in the interior (a ramp is a fixed point away from edges)", () => {
    // value = 10x + 5y is linear in both axes, so the symmetric window mean equals the
    // centre value wherever the window is fully in-bounds. (Edge-clamp is NOT globally
    // mean-conserving — borders over-weight the replicated edge — so we assert only the
    // interior, where the box blur genuinely leaves a gradient untouched.)
    const g = grid(5, 5, (x, y) => x * 10 + y * 5);
    const out = boxBlur2D(g, 1);
    for (let y = 1; y < 4; y++)
      for (let x = 1; x < 4; x++) expect(out[y][x]).toBeCloseTo(g[y][x], 12);
  });

  it("handles an empty image and is deterministic", () => {
    expect(boxBlur2D([], 1)).toEqual([]);
    expect(boxBlur2D([[], []], 1)).toEqual([[], []]);
    const g = grid(4, 4, (x, y) => (x * 7 + y * 13) % 50);
    expect(boxBlur2D(g, 1)).toEqual(boxBlur2D(g, 1));
  });

  it("does not mutate the input", () => {
    const g = grid(3, 3, (x, y) => x + y);
    const snapshot = g.map((row) => [...row]);
    boxBlur2D(g, 1);
    expect(g).toEqual(snapshot);
  });
});

describe("boxBlurSeparable ≡ boxBlur2D (the uniform kernel is separable)", () => {
  const IMAGES: { name: string; image: number[][] }[] = [
    { name: "checkerboard", image: grid(6, 6, (x, y) => ((x + y) % 2 ? 255 : 0)) },
    { name: "vertical edge", image: grid(5, 8, (x) => (x < 4 ? 30 : 210)) },
    { name: "gradient", image: grid(6, 6, (x, y) => x * 20 + y * 10) },
    { name: "impulse", image: grid(7, 7, (x, y) => (x === 3 && y === 3 ? 255 : 10)) },
    { name: "non-square", image: grid(3, 9, (x, y) => (x * 5 + y * 11) % 100) },
  ];

  describe.each(IMAGES)("fixture: $name", ({ image }) => {
    it("the separable two-pass blur matches the direct 2-D blur for several radii", () => {
      for (const r of [1, 2, 3]) {
        const direct = boxBlur2D(image, r);
        const separable = boxBlurSeparable(image, r);
        expect(separable.length).toBe(direct.length);
        for (let y = 0; y < direct.length; y++) {
          for (let x = 0; x < direct[0].length; x++) {
            expect(separable[y][x]).toBeCloseTo(direct[y][x], 10);
          }
        }
      }
    });
  });

  it("radius < 1 returns an unchanged copy", () => {
    const g = grid(3, 3, (x, y) => x + y);
    const out = boxBlurSeparable(g, 0);
    expect(out).toEqual(g);
    expect(out).not.toBe(g);
  });
});

// ── Several fixtures swept for in-range + shape across radii ──────────────────
const FIXTURES: { name: string; image: number[][] }[] = [
  { name: "checkerboard", image: grid(6, 6, (x, y) => ((x + y) % 2 ? 255 : 0)) },
  { name: "horizontal bands", image: grid(8, 6, (_, y) => (y % 2 ? 200 : 50)) },
  { name: "ramp", image: grid(5, 5, (x) => x * 60) },
  { name: "single impulse", image: grid(7, 7, (x, y) => (x === 3 && y === 3 ? 255 : 0)) },
];

describe.each(FIXTURES)("fixture: $name", ({ image }) => {
  it("stays in range and keeps its shape for r = 1 and r = 2", () => {
    const lo = Math.min(...flat(image));
    const hi = Math.max(...flat(image));
    const h = image.length;
    const w = image[0].length;
    for (const r of [1, 2]) {
      const out = boxBlur2D(image, r);
      expect(out.length).toBe(h);
      expect(out.every((row) => row.length === w)).toBe(true);
      for (const v of flat(out)) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(lo);
        expect(v).toBeLessThanOrEqual(hi);
      }
    }
  });
});
