// Unit tests for the Patchwork filter. Engine-free (node), single grey-channel model (exact for
// grey R=G=B input). These pin the per-cell average (f64 accumulation), the bevel relief shade
// (top-left raised, bottom-right recessed, scaled by tile brightness), the relief-0 pure-mosaic
// case, and the truncating output (must match filters.rs patchwork), plus cross-implementation
// goldens captured from the Rust engine.
import { describe, it, expect } from "vitest";
import { patchworkShade, patchwork2D, PATCHWORK_MAX } from "./patchwork";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("patchworkShade", () => {
  it("is positive at the top-left, zero at the tile centre, negative at the bottom-right", () => {
    expect(patchworkShade(0, 0, 30000, 1)).toBeGreaterThan(0); // top-left raised
    expect(patchworkShade(0.5, 0.5, 30000, 1)).toBe(0); // centre flat ((0.5-0.5)+(0.5-0.5)=0)
    expect(patchworkShade(1, 1, 30000, 1)).toBeLessThan(0); // bottom-right recessed
  });
  it("scales with relief and with tile brightness (a darker tile beveled less)", () => {
    expect(patchworkShade(0, 0, 30000, 0)).toBe(0); // relief 0 → no bevel
    expect(patchworkShade(0, 0, 10000, 1)).toBeLessThan(patchworkShade(0, 0, 50000, 1)); // brighter → stronger
  });
});

describe("patchwork2D", () => {
  const g = grid(8, 8, (x, y) => (x * 9973 + y * 9931) % PATCHWORK_MAX);

  it("relief 0 is a pure block-average mosaic: each tile is a single flat value", () => {
    const out = patchwork2D(g, 3, 0);
    // tile (0,0) covers x,y ∈ [0,2]; all nine pixels must equal the same cell average.
    const a = out[0][0];
    for (let y = 0; y <= 2; y++) for (let x = 0; x <= 2; x++) expect(out[y][x]).toBe(a);
  });

  it("embosses the bevel: within a tile, top-left > centre(=avg) > bottom-right", () => {
    const out = patchwork2D(g, 3, 0.5);
    expect(out[0][0]).toBeGreaterThan(out[1][1]); // top-left lighter than centre
    expect(out[1][1]).toBeGreaterThan(out[2][2]); // centre lighter than bottom-right
  });

  it("a flat field is unchanged at relief 0 but shows the bevel at relief > 0", () => {
    const f = grid(6, 6, () => 30000);
    expect(patchwork2D(f, 3, 0)).toEqual(f); // pure mosaic of a constant = the constant
    const beveled = patchwork2D(f, 3, 1);
    expect(beveled).not.toEqual(f); // relief raises/lowers by tile position
    expect(beveled[0][0]).toBeGreaterThan(30000); // top-left of a tile raised
  });

  it("clamps tile size to ≥ 2", () => {
    expect(patchwork2D(g, 1, 0.5)).toEqual(patchwork2D(g, 2, 0.5));
    expect(patchwork2D(g, 0, 0.5)).toEqual(patchwork2D(g, 2, 0.5));
  });

  it("clamps relief to [0,1] (above 1 ≡ 1, below 0 ≡ 0 / pure mosaic)", () => {
    expect(patchwork2D(g, 3, 1.5)).toEqual(patchwork2D(g, 3, 1));
    expect(patchwork2D(g, 3, -0.3)).toEqual(patchwork2D(g, 3, 0));
  });

  it("keeps every output an integer within [0, 65535]", () => {
    for (const [sz, rl] of [
      [3, 0.5],
      [4, 1],
      [5, 0.2],
    ]) {
      for (const v of flat(patchwork2D(g, sz, rl))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(PATCHWORK_MAX);
      }
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(patchwork2D([], 3, 0.5)).toEqual([]);
    expect(patchwork2D([[], []], 3, 0.5)).toEqual([[], []]);
    expect(patchwork2D([[40000]], 3, 0)).toEqual([[40000]]); // 1×1, relief 0: cell avg = the pixel
    expect(patchwork2D(g, 3, 0.5)).toEqual(patchwork2D(g, 3, 0.5));
  });

  it("does not mutate the input", () => {
    const snapshot = g.map((r) => [...r]);
    patchwork2D(g, 3, 0.8);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const ng = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = patchwork2D(ng, 3, 0.5);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 13)).toBe(true);
  });
});

// ── Cross-implementation goldens: exact u16 output captured from the Rust engine's patchwork on
//    an 8×8 grey pattern v = (x·9973 + y·9931) mod 65535. Cases: bevel on (size 3, relief 0.5),
//    pure mosaic (relief 0), a larger tile (size 4, relief 0.8), and a flat field whose bevel is
//    visible. Fully bit-exact (f64 cell average; no trig/sqrt). ──
describe("engine golden (patchwork)", () => {
  const g = grid(8, 8, (x, y) => (x * 9973 + y * 9931) % PATCHWORK_MAX);
  const rows = (n: number, vals: number[]): number[][] => Array.from({ length: n }, (_, y) => vals.slice(y * (vals.length / n), y * (vals.length / n) + vals.length / n));

  it("matches the engine bit-exactly — size 3, relief 0.5 (cell average + bevel)", () => {
    expect(patchwork2D(g, 3, 0.5)).toEqual(
      rows(8, [
        29856, 24880, 19904, 63812, 53176, 42541, 30214, 25178, 24880, 19904, 14928, 53176, 42541, 31906, 25178, 20143,
        19904, 14928, 9952, 42541, 31906, 21270, 20143, 15107, 63623, 53019, 42415, 32044, 26703, 21362, 58520, 48766,
        53019, 42415, 31811, 26703, 21362, 16022, 48766, 39013, 42415, 31811, 21207, 21362, 16022, 10681, 39013, 29260,
        29868, 24890, 19912, 58362, 48635, 38908, 65535, 59321, 24890, 19912, 14934, 48635, 38908, 29181, 59321, 47457,
      ]),
    );
  });

  it("matches the engine bit-exactly — size 3, relief 0 (pure block-average mosaic)", () => {
    expect(patchwork2D(g, 3, 0)).toEqual(
      rows(8, [
        19904, 19904, 19904, 42541, 42541, 42541, 20143, 20143, 19904, 19904, 19904, 42541, 42541, 42541, 20143, 20143,
        19904, 19904, 19904, 42541, 42541, 42541, 20143, 20143, 42415, 42415, 42415, 21362, 21362, 21362, 39013, 39013,
        42415, 42415, 42415, 21362, 21362, 21362, 39013, 39013, 42415, 42415, 42415, 21362, 21362, 21362, 39013, 39013,
        19912, 19912, 19912, 38908, 38908, 38908, 47457, 47457, 19912, 19912, 19912, 38908, 38908, 38908, 47457, 47457,
      ]),
    );
  });

  it("matches the engine bit-exactly — size 4, relief 0.8", () => {
    expect(patchwork2D(g, 4, 0.8)).toEqual(
      rows(8, [
        53740, 45779, 37817, 29856, 51819, 44142, 36465, 28788, 45779, 37817, 29856, 21894, 44142, 36465, 28788, 21111,
        37817, 29856, 21894, 13932, 36465, 28788, 21111, 13434, 29856, 21894, 13932, 5971, 28788, 21111, 13434, 5757,
        51517, 43884, 36252, 28620, 65535, 61089, 50465, 39841, 43884, 36252, 28620, 20988, 61089, 50465, 39841, 29216,
        36252, 28620, 20988, 13356, 50465, 39841, 29216, 18592, 28620, 20988, 13356, 5724, 39841, 29216, 18592, 7968,
      ]),
    );
  });

  it("matches the engine bit-exactly — flat field 30000, size 3, relief 1 (bevel only)", () => {
    expect(patchwork2D(grid(5, 5, () => 30000), 3, 1)).toEqual([
      [60000, 45000, 30000, 60000, 45000],
      [45000, 30000, 15000, 45000, 30000],
      [30000, 15000, 0, 30000, 15000],
      [60000, 45000, 30000, 60000, 45000],
      [45000, 30000, 15000, 45000, 30000],
    ]);
  });

  it("pins the f64 cell accumulator — 17×17 all-white, size 17, relief 0.7 (cell sum > 2²⁴)", () => {
    // The single 17×17 cell sums to 18,939,615 > 2²⁴, so an f32 accumulator rounds the mean up by
    // ~0.11 and the recessed (bottom-right) pixels come out 1 LSB high (28262 instead of 28261).
    // Tile sizes up to 32 are user-reachable, so the f64 accumulator is load-bearing for parity.
    const white = grid(17, 17, () => PATCHWORK_MAX);
    const out = patchwork2D(white, 17, 0.7);
    for (const [x, y] of [[16, 13], [15, 14], [14, 15], [13, 16]] as const) {
      expect(out[y][x]).toBe(28261); // an f32-accumulator mirror yields 28262 here
    }
    expect(out[16][16]).toBe(19660); // most-recessed corner
    expect(out[8][8]).toBe(PATCHWORK_MAX); // tile centre: shade 0 ⇒ the cell average (65535)
  });
});
