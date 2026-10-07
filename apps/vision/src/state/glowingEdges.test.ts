// Unit tests for the Glowing Edges filter. Engine-free (node), per-channel. These pin the
// central-difference gradient magnitude at span d=max(width,1), the linear `brightness`
// scaling, the edge-clamped sampling, and the clamp+TRUNCATE to u16 (must match filters.rs
// glowing_edges), plus a cross-implementation golden captured from the Rust engine. A flat
// image becomes solid black (no gradient).
import { describe, it, expect } from "vitest";
import { glowingEdgesPixel, glowingEdges2D, GLOWING_EDGES_MAX } from "./glowingEdges";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("glowingEdgesPixel", () => {
  it("is 0 everywhere in a flat region (no gradient)", () => {
    const g = grid(5, 5, () => 41000);
    for (const [x, y] of [
      [2, 2],
      [0, 0],
      [4, 4],
    ]) {
      expect(glowingEdgesPixel(g, x, y, 1, 1)).toBe(0);
    }
  });

  it("lights a vertical step as |Δ| across the 2d-wide band (gy = 0)", () => {
    // rows identical → gy = 0; a step between cols 2 and 3 of height 10000.
    const g = grid(3, 7, (x) => (x < 3 ? 0 : 10000));
    expect(glowingEdgesPixel(g, 2, 1, 1, 1)).toBe(10000); // src[3]−src[1]
    expect(glowingEdgesPixel(g, 3, 1, 1, 1)).toBe(10000); // src[4]−src[2]
    expect(glowingEdgesPixel(g, 1, 1, 1, 1)).toBe(0); // both samples low
    expect(glowingEdgesPixel(g, 5, 1, 1, 1)).toBe(0); // both samples high
    expect(glowingEdgesPixel(g, 0, 1, 1, 1)).toBe(0); // clamped, both low
  });

  it("lights a horizontal step via gy (gx = 0)", () => {
    const g = grid(7, 3, (_x, y) => (y < 3 ? 0 : 10000));
    expect(glowingEdgesPixel(g, 1, 2, 1, 1)).toBe(10000); // src[row3]−src[row1]
    expect(glowingEdgesPixel(g, 1, 3, 1, 1)).toBe(10000);
    expect(glowingEdgesPixel(g, 1, 0, 1, 1)).toBe(0);
  });

  it("scales the edge magnitude linearly with brightness (before the clamp)", () => {
    const g = grid(3, 7, (x) => (x < 3 ? 0 : 100)); // small step → no clamp
    expect(glowingEdgesPixel(g, 2, 1, 1, 1)).toBe(100);
    expect(glowingEdgesPixel(g, 2, 1, 1, 2)).toBe(200);
    expect(glowingEdgesPixel(g, 2, 1, 1, 0.5)).toBe(50);
    expect(glowingEdgesPixel(g, 2, 1, 1, 0)).toBe(0); // brightness 0 → black
  });

  it("combines gx and gy as sqrt(gx²+gy²) at a corner", () => {
    // dark top-left quadrant, bright elsewhere → at the inner corner both gradients fire
    const g = grid(7, 7, (x, y) => (x < 3 && y < 3 ? 0 : 6000));
    // pixel (2,2): gx = src[(3,2)=6000] − src[(1,2)=0] = 6000; gy = src[(2,3)=6000] − src[(2,1)=0] = 6000
    // mag = sqrt(6000²·2) = 6000·√2 = 8485.28… → trunc 8485
    expect(glowingEdgesPixel(g, 2, 2, 1, 1)).toBe(8485);
  });

  it("clamps a negative-brightness (inverted) magnitude to 0", () => {
    // mag = sqrt(gx²)·(−1) = −10000 < 0 → the engine's clamp(0, 65535) floors it to 0.
    const g = grid(3, 7, (x) => (x < 3 ? 0 : 10000));
    expect(glowingEdgesPixel(g, 2, 1, 1, -1)).toBe(0);
  });

  it("clamps a huge scaled gradient to 65535 and truncates", () => {
    const g = grid(3, 7, (x) => (x < 3 ? 0 : 60000));
    expect(glowingEdgesPixel(g, 2, 1, 1, 2)).toBe(GLOWING_EDGES_MAX); // 60000·2 ≫ 65535
  });

  it("uses a wider span for a larger width", () => {
    // step between cols 3 and 4; with width 2 the lit band straddles it differently than width 1
    const g = grid(3, 9, (x) => (x < 4 ? 0 : 20000));
    // width 2 at x=3: gx = src[5]−src[1] = 20000; at x=2: gx = src[4]−src[0] = 20000
    expect(glowingEdgesPixel(g, 2, 1, 2, 1)).toBe(20000);
    expect(glowingEdgesPixel(g, 2, 1, 1, 1)).toBe(0); // width 1 at x=2: src[3]−src[1] = 0
  });
});

describe("glowingEdges2D", () => {
  it("turns a flat image solid black", () => {
    const g = grid(8, 8, () => 30000);
    expect(glowingEdges2D(g, 1, 1)).toEqual(grid(8, 8, () => 0));
  });

  it("brightness 0 produces an all-black image", () => {
    const g = grid(6, 6, (x, y) => (x * 6151 + y * 3079) % GLOWING_EDGES_MAX);
    expect(glowingEdges2D(g, 1, 0)).toEqual(grid(6, 6, () => 0));
  });

  it("keeps every output an integer within [0, 65535]", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % GLOWING_EDGES_MAX);
    for (const [width, brightness] of [
      [1, 1],
      [2, 1.5],
      [3, 3],
    ]) {
      for (const v of flat(glowingEdges2D(g, width, brightness))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(GLOWING_EDGES_MAX);
      }
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(glowingEdges2D([], 1, 1)).toEqual([]);
    expect(glowingEdges2D([[], []], 2, 1)).toEqual([[], []]);
    expect(glowingEdges2D([[42]], 1, 1)).toEqual([[0]]); // lone pixel: gradient clamps to itself → 0
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % 40000);
    expect(glowingEdges2D(g, 2, 1.5)).toEqual(glowingEdges2D(g, 2, 1.5));
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => (x * 5000 + y * 4000) % GLOWING_EDGES_MAX);
    const snapshot = g.map((r) => [...r]);
    glowingEdges2D(g, 2, 1);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = glowingEdges2D(g, 1, 1);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 13)).toBe(true);
  });

  it("width < 1 is treated as width 1", () => {
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % GLOWING_EDGES_MAX);
    expect(glowingEdges2D(g, 0, 1)).toEqual(glowingEdges2D(g, 1, 1));
    expect(glowingEdges2D(g, -3, 1)).toEqual(glowingEdges2D(g, 1, 1));
  });
});

// ── Cross-implementation golden: exact u16 output captured from the Rust engine's
//    glowing_edges on a 7×7 grey pattern v = (x·9973 + y·9931) mod 65535. Per-channel and
//    f32-faithful (incl. the >2²⁴ precision loss in gx²), so bit-for-bit. ──
describe("engine golden (glowing_edges, 7×7)", () => {
  const input = grid(7, 7, (x, y) => (x * 9973 + y * 9931) % GLOWING_EDGES_MAX);

  it("matches the engine bit-exactly — width 1, brightness 1", () => {
    const GOLDEN = [
      [14074, 22281, 22281, 22281, 22281, 22281, 56491],
      [22225, 28148, 28148, 28148, 28148, 64532, 65535],
      [22225, 28148, 28148, 28148, 64532, 64532, 22225],
      [22225, 28148, 28148, 64532, 64532, 28148, 22225],
      [22225, 28148, 64532, 64532, 28148, 28148, 22225],
      [22225, 64532, 64532, 28148, 28148, 28148, 22225],
      [56442, 65535, 22281, 22281, 22281, 22281, 14074],
    ];
    expect(glowingEdges2D(input, 1, 1)).toEqual(GOLDEN);
  });

  it("matches the engine bit-exactly — width 2, brightness 1.5", () => {
    const GOLDEN = [
      [42222, 53867, 65535, 65535, 65535, 65535, 65535],
      [53780, 63334, 65535, 65535, 65535, 65535, 65535],
      [65535, 65535, 65535, 54575, 54575, 65535, 65535],
      [65535, 65535, 54575, 54575, 54575, 65535, 65535],
      [65535, 65535, 54575, 54575, 54575, 65535, 65535],
      [65535, 65535, 65535, 65535, 65535, 63334, 53780],
      [65535, 65535, 65535, 65535, 65535, 53867, 42222],
    ];
    expect(glowingEdges2D(input, 2, 1.5)).toEqual(GOLDEN);
  });
});

// ── Several width/brightness fixtures swept for in-range, shape, flat→black ──
const FIXTURES: { name: string; width: number; brightness: number }[] = [
  { name: "thin bright", width: 1, brightness: 2 },
  { name: "wide dim", width: 3, brightness: 0.5 },
  { name: "wide bright", width: 2, brightness: 3 },
];

describe.each(FIXTURES)("fixture: $name", ({ width, brightness }) => {
  it("stays in range, keeps shape, and renders a flat field black", () => {
    const g = grid(13, 13, (x, y) => (x * 4099 + y * 8191) % GLOWING_EDGES_MAX);
    const out = glowingEdges2D(g, width, brightness);
    expect(out.length).toBe(13);
    expect(out.every((r) => r.length === 13)).toBe(true);
    for (const v of flat(out)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(GLOWING_EDGES_MAX);
    }
    expect(glowingEdges2D(grid(13, 13, () => 55555), width, brightness)).toEqual(grid(13, 13, () => 0));
  });
});
