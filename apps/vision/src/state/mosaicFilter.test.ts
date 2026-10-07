// Unit tests for the Mosaic / Pixelate filter. Engine-free (node). These pin the
// block-average behaviour (must match filters.rs mosaic: tile into size×size cells,
// flood-fill each cell with its rounded mean, clip edge cells, size<2 is a no-op)
// and its defining properties: each cell ends uniform, a constant image is unchanged,
// and the output stays in range introducing no out-of-gamut values.
import { describe, it, expect } from "vitest";
import { blockMean, mosaic2D } from "./mosaicFilter";

// Build an h×w grid from a (x,y)→value function.
const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("blockMean", () => {
  it("is the rounded mean of the samples", () => {
    expect(blockMean([10, 20, 30, 40])).toBe(25); // 100/4
    expect(blockMean([100, 100, 100, 100])).toBe(100);
    expect(blockMean([7])).toBe(7);
  });

  it("rounds half up (matches the engine's to16 quantization)", () => {
    expect(blockMean([0, 255])).toBe(128); // 127.5 → 128
    expect(blockMean([1, 2])).toBe(2); // 1.5 → 2
  });

  it("an empty cell is 0 (defensive — never reached by mosaic2D)", () => {
    expect(blockMean([])).toBe(0);
  });

  it("does not mutate the input", () => {
    const v = [3, 1, 2];
    blockMean(v);
    expect(v).toEqual([3, 1, 2]);
  });
});

describe("mosaic2D", () => {
  it("size < 2 (and negatives) returns an unchanged copy", () => {
    const g = grid(3, 3, (x, y) => x + y * 3);
    for (const s of [0, 1, -1, -5]) {
      const out = mosaic2D(g, s);
      expect(out).toEqual(g);
      expect(out).not.toBe(g); // fresh copy
    }
  });

  it("a NaN size is treated as a no-op (defensive)", () => {
    const g = grid(3, 3, (x, y) => x + y);
    expect(mosaic2D(g, NaN)).toEqual(g);
  });

  it("truncates a fractional size (2.9 behaves like 2)", () => {
    const g = grid(4, 4, (x, y) => x * 10 + y);
    expect(mosaic2D(g, 2.9)).toEqual(mosaic2D(g, 2));
  });

  it("leaves a constant image unchanged (every block mean equals the constant)", () => {
    const g = grid(4, 4, () => 128);
    expect(mosaic2D(g, 2)).toEqual(g);
  });

  it("flood-fills a single 2×2 block with its mean", () => {
    // one block exactly covers the image → whole image becomes the mean
    const g = [
      [10, 20],
      [30, 40],
    ];
    expect(mosaic2D(g, 2)).toEqual([
      [25, 25],
      [25, 25],
    ]); // round(100/4)
  });

  it("tiles a 4×4 image into four independent 2×2 blocks", () => {
    // four blocks, each a distinct constant → each stays its own value
    const g = [
      [10, 10, 20, 20],
      [10, 10, 20, 20],
      [30, 30, 40, 40],
      [30, 30, 40, 40],
    ];
    expect(mosaic2D(g, 2)).toEqual(g); // each block already uniform
  });

  it("averages within each block independently", () => {
    const g = [
      [0, 100, 10, 30],
      [100, 0, 50, 90],
      [200, 200, 1, 1],
      [200, 200, 1, 255],
    ];
    // block(0,0)=mean(0,100,100,0)=50; block(0,2)=mean(10,30,50,90)=45;
    // block(2,0)=mean(200,200,200,200)=200; block(2,2)=mean(1,1,1,255)=round(258/4=64.5)=65
    expect(mosaic2D(g, 2)).toEqual([
      [50, 50, 45, 45],
      [50, 50, 45, 45],
      [200, 200, 65, 65],
      [200, 200, 65, 65],
    ]);
  });

  it("clips edge blocks to the image (a 3×3 image with size 2 → fewer samples at the edges)", () => {
    const g = [
      [10, 20, 60],
      [30, 40, 80],
      [90, 70, 200],
    ];
    // block(0,0): mean(10,20,30,40)=25 (2×2) → fills rows 0-1, cols 0-1
    // block(0,2): mean(60,80)=70 (1 col × 2 rows) → fills rows 0-1, col 2
    // block(2,0): mean(90,70)=80 (2 cols × 1 row) → fills row 2, cols 0-1
    // block(2,2): mean(200)=200 (1×1 corner) → fills row 2, col 2
    expect(mosaic2D(g, 2)).toEqual([
      [25, 25, 70],
      [25, 25, 70],
      [80, 80, 200],
    ]);
  });

  it("a size larger than the image collapses it to a single mean", () => {
    const g = grid(3, 3, (x, y) => (x + y) * 10);
    const mean = blockMean(flat(g));
    const out = mosaic2D(g, 10);
    expect(out.every((row) => row.every((v) => v === mean))).toBe(true);
  });

  it("every block ends uniform (the defining property)", () => {
    const g = grid(8, 8, (x, y) => (x * 23 + y * 13) % 256);
    const s = 3;
    const out = mosaic2D(g, s);
    for (let by = 0; by < 8; by += s) {
      for (let bx = 0; bx < 8; bx += s) {
        const v = out[by][bx];
        for (let y = by; y < Math.min(by + s, 8); y++)
          for (let x = bx; x < Math.min(bx + s, 8); x++) expect(out[y][x]).toBe(v);
      }
    }
  });

  it("keeps the output within the input's min/max range (a mean never escapes the extremes)", () => {
    const g = grid(7, 9, (x, y) => (x * 31 + y * 17) % 256);
    const lo = Math.min(...flat(g));
    const hi = Math.max(...flat(g));
    for (const v of flat(mosaic2D(g, 3))) {
      expect(v).toBeGreaterThanOrEqual(lo);
      expect(v).toBeLessThanOrEqual(hi);
    }
  });

  it("preserves the overall shape (same dimensions, integer values)", () => {
    const g = grid(5, 7, (x, y) => (x * 11 + y * 7) % 200);
    const out = mosaic2D(g, 3);
    expect(out.length).toBe(5);
    expect(out.every((row) => row.length === 7)).toBe(true);
    expect(flat(out).every((v) => Number.isInteger(v))).toBe(true);
  });

  it("handles an empty image safely", () => {
    expect(mosaic2D([], 2)).toEqual([]);
    expect(mosaic2D([[], []], 2)).toEqual([[], []]); // zero-width rows
  });

  it("does not mutate the input image", () => {
    const g = grid(4, 4, (x, y) => x + y);
    const snapshot = g.map((row) => [...row]);
    mosaic2D(g, 2);
    expect(g).toEqual(snapshot);
  });

  it("is deterministic", () => {
    const g = grid(6, 6, (x, y) => (x * 13 + y * 7) % 200);
    expect(mosaic2D(g, 3)).toEqual(mosaic2D(g, 3));
  });
});

// ── Several image fixtures swept for in-range + uniform-block invariants ──────
const FIXTURES: { name: string; image: number[][]; sizes: number[] }[] = [
  { name: "checkerboard", image: grid(6, 6, (x, y) => ((x + y) % 2 ? 255 : 0)), sizes: [2, 3] },
  { name: "vertical edge", image: grid(5, 8, (x) => (x < 4 ? 30 : 210)), sizes: [2, 4] },
  { name: "horizontal gradient", image: grid(6, 6, (x) => x * 40), sizes: [2, 3] },
  { name: "single impulse", image: grid(7, 7, (x, y) => (x === 3 && y === 3 ? 255 : 60)), sizes: [2, 3, 5] },
];

describe.each(FIXTURES)("fixture: $name", ({ image, sizes }) => {
  it("stays in range, keeps its shape, and every block is uniform across sizes", () => {
    const lo = Math.min(...flat(image));
    const hi = Math.max(...flat(image));
    const h = image.length;
    const w = image[0].length;
    for (const s of sizes) {
      const out = mosaic2D(image, s);
      expect(out.length).toBe(h);
      expect(out.every((row) => row.length === w)).toBe(true);
      for (const v of flat(out)) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(lo);
        expect(v).toBeLessThanOrEqual(hi);
      }
      // every size×size cell is a single colour
      for (let by = 0; by < h; by += s)
        for (let bx = 0; bx < w; bx += s) {
          const v = out[by][bx];
          for (let y = by; y < Math.min(by + s, h); y++)
            for (let x = bx; x < Math.min(bx + s, w); x++) expect(out[y][x]).toBe(v);
        }
    }
  });
});
