// Unit tests for Smart Blur. Engine-free (node), single luminance-channel model (exact for
// grey R=G=B input). These pin the threshold-gated edge-preserving blur, the edge detection
// (max neighbour luminance diff > threshold), and the three modes (must match filters.rs
// smart_blur), plus a cross-implementation golden captured from the Rust engine on a grey
// gradient. A flat region blurs to itself; a hard step is detected as an edge and preserved.
import { describe, it, expect } from "vitest";
import {
  smartBlurPixel,
  smartBlur2D,
  SMART_BLUR_MAX,
  SMART_NORMAL,
  SMART_EDGE_ONLY,
  SMART_OVERLAY,
} from "./smartBlur";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("smartBlurPixel", () => {
  it("never flags an edge inside a flat region and returns the flat value", () => {
    const g = grid(7, 7, () => 24000);
    for (const [x, y] of [
      [3, 3],
      [0, 0],
      [6, 6],
    ]) {
      const { isEdge, value } = smartBlurPixel(g, x, y, 2, 40);
      expect(isEdge).toBe(false);
      expect(value).toBe(24000); // mean of identical neighbours, round-trips through to16
    }
  });

  it("flags an edge across a hard step beyond the threshold", () => {
    // left half 0, right half 65535; threshold 40/255 ≈ 0.157 ≪ the step of 1.0
    const g = grid(5, 6, (x) => (x < 3 ? 0 : SMART_BLUR_MAX));
    expect(smartBlurPixel(g, 2, 2, 1, 40).isEdge).toBe(true); // straddles the step
    expect(smartBlurPixel(g, 3, 2, 1, 40).isEdge).toBe(true);
    expect(smartBlurPixel(g, 0, 2, 1, 40).isEdge).toBe(false); // deep in the flat left half
    expect(smartBlurPixel(g, 5, 2, 1, 40).isEdge).toBe(false); // deep in the flat right half
  });

  it("at a step edge, the gate excludes the far side (edge preserved, not averaged)", () => {
    const g = grid(5, 6, (x) => (x < 3 ? 0 : SMART_BLUR_MAX));
    // pixel (2,2) is the last low pixel; with a sub-step threshold only same-side (low)
    // neighbours pass the gate, so its blurred value stays 0 (the high side is rejected).
    expect(smartBlurPixel(g, 2, 2, 1, 40).value).toBe(0);
    expect(smartBlurPixel(g, 3, 2, 1, 40).value).toBe(SMART_BLUR_MAX); // first high pixel stays high
  });

  it("includes a neighbour whose luminance diff is exactly the threshold (inclusive gate d ≤ thr)", () => {
    // center 0; the lone neighbour N=40000 sits EXACTLY on the gate when
    // threshold = fround(lum(40000)·255) ⇒ d === thr. The inclusive gate counts it, so the
    // 3×3 mean is round(40000/9) = 4444; a strict `d < thr` gate would drop it and yield 0.
    const N = 40000;
    const threshold = 155.6420135498047; // = Math.fround(lum(N) * 255), placing N on the gate
    const img = [
      [0, 0, 0],
      [0, 0, N],
      [0, 0, 0],
    ];
    const { value, isEdge } = smartBlurPixel(img, 1, 1, 1, threshold);
    expect(value).toBe(4444); // boundary neighbour INCLUDED (excluded would give 0)
    expect(isEdge).toBe(false); // maxDiff === thr, and the edge test is strict ( > thr )
  });

  it("a huge threshold includes every neighbour → a plain box mean", () => {
    const g = grid(5, 5, (x, y) => (x * 7 + y * 11) * 100);
    // threshold 255 → thr clamps to 1.0 ≥ any luminance diff → all (2r+1)² neighbours in
    const { value, isEdge } = smartBlurPixel(g, 2, 2, 1, 255);
    expect(isEdge).toBe(false);
    let sum = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += g[2 + dy][2 + dx];
    expect(value).toBe(Math.round(sum / 9)); // unweighted box mean of the 3×3
  });
});

describe("smartBlur2D", () => {
  it("leaves a flat image unchanged in every mode", () => {
    const g = grid(8, 8, () => 30000);
    // Normal & Overlay reproduce the flat value; Edge-Only paints all black (no edges)
    expect(smartBlur2D(g, 2, 40, SMART_NORMAL)).toEqual(g);
    expect(smartBlur2D(g, 2, 40, SMART_OVERLAY)).toEqual(g);
    expect(smartBlur2D(g, 2, 40, SMART_EDGE_ONLY)).toEqual(grid(8, 8, () => 0));
  });

  it("Edge-Only emits a binary 0/65535 map", () => {
    const g = grid(9, 9, (x, y) => (x * 6151 + y * 3079) % SMART_BLUR_MAX);
    for (const v of flat(smartBlur2D(g, 2, 30, SMART_EDGE_ONLY))) {
      expect(v === 0 || v === SMART_BLUR_MAX).toBe(true);
    }
  });

  it("Overlay equals Edge-Only's white pixels with the Normal blur underneath", () => {
    const g = grid(9, 9, (x, y) => ((x * 5000 + y * 4000) % SMART_BLUR_MAX) as number);
    const normal = smartBlur2D(g, 2, 50, SMART_NORMAL);
    const edge = smartBlur2D(g, 2, 50, SMART_EDGE_ONLY);
    const overlay = smartBlur2D(g, 2, 50, SMART_OVERLAY);
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        expect(overlay[y][x]).toBe(edge[y][x] === SMART_BLUR_MAX ? SMART_BLUR_MAX : normal[y][x]);
      }
    }
  });

  it("smooths a gentle gradient (Normal changes it but keeps it in range)", () => {
    const g = grid(10, 10, (x, y) => (x + y) * 3000);
    const out = smartBlur2D(g, 2, 60, SMART_NORMAL);
    expect(out).not.toEqual(g);
    for (const v of flat(out)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(SMART_BLUR_MAX);
    }
  });

  it("threshold 0 only ever averages exactly-equal neighbours (flat blocks unchanged)", () => {
    // a checker of two flat blocks: with thr 0, no cross-block neighbour passes the gate,
    // and within a block all neighbours are equal → every pixel keeps its value.
    const g = grid(8, 8, (x, y) => (x < 4 === y < 4 ? 10000 : 50000));
    expect(smartBlur2D(g, 3, 0, SMART_NORMAL)).toEqual(g);
  });

  it("does not flag edges on a flat field at threshold 0 (the edge test is strict, maxDiff > thr)", () => {
    // flat ⇒ maxDiff = 0, thr = 0. Strict `0 > 0` = false ⇒ NO edges; a `>=` gate would
    // paint every pixel white. Overlay then leaves the (already flat) blur untouched.
    const g = grid(6, 6, () => 20000);
    expect(smartBlur2D(g, 2, 0, SMART_EDGE_ONLY)).toEqual(grid(6, 6, () => 0));
    expect(smartBlur2D(g, 2, 0, SMART_OVERLAY)).toEqual(g);
  });

  it("keeps every output an integer within [0, 65535] for all modes", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % SMART_BLUR_MAX);
    for (const mode of [SMART_NORMAL, SMART_EDGE_ONLY, SMART_OVERLAY]) {
      for (const v of flat(smartBlur2D(g, 2, 45, mode))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(SMART_BLUR_MAX);
      }
    }
  });

  it("radius < 1 is treated as radius 1", () => {
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % SMART_BLUR_MAX);
    expect(smartBlur2D(g, 0, 50, SMART_NORMAL)).toEqual(smartBlur2D(g, 1, 50, SMART_NORMAL));
    expect(smartBlur2D(g, -5, 50, SMART_NORMAL)).toEqual(smartBlur2D(g, 1, 50, SMART_NORMAL));
  });

  it("handles 1×1 images and is deterministic", () => {
    expect(smartBlur2D([[42]], 2, 50, SMART_NORMAL)).toEqual([[42]]); // lone pixel = its own mean
    expect(smartBlur2D([[42]], 2, 50, SMART_EDGE_ONLY)).toEqual([[0]]); // no edge
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % 40000);
    expect(smartBlur2D(g, 2, 50, SMART_OVERLAY)).toEqual(smartBlur2D(g, 2, 50, SMART_OVERLAY));
  });

  it("handles empty images", () => {
    expect(smartBlur2D([], 2, 50, SMART_NORMAL)).toEqual([]);
    expect(smartBlur2D([[], []], 2, 50, SMART_EDGE_ONLY)).toEqual([[], []]);
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => (x + y) * 3000);
    const snapshot = g.map((row) => [...row]);
    for (const mode of [SMART_NORMAL, SMART_EDGE_ONLY, SMART_OVERLAY]) smartBlur2D(g, 2, 40, mode);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = smartBlur2D(g, 2, 50, SMART_NORMAL);
    expect(out.length).toBe(5);
    expect(out.every((row) => row.length === 13)).toBe(true);
  });
});

// ── Cross-implementation golden: exact u16 output captured from the Rust engine's smart_blur
//    on a 7×7 GREY gradient v = (x·3000 + y·2500) mod 65535 (R=G=B, opaque), across the three
//    modes. The single-channel luminance model is bit-exact to the engine for grey input. ──
describe("engine golden (smart_blur, 7×7 grey gradient)", () => {
  const input = grid(7, 7, (x, y) => (x * 3000 + y * 2500) % SMART_BLUR_MAX);

  it("matches the engine bit-exactly — Normal (r=2, thr=40)", () => {
    const GOLDEN = [
      [2979, 4729, 7104, 10104, 13104, 15900, 17700],
      [4438, 6188, 8563, 11563, 14563, 17400, 19200],
      [6417, 8167, 11000, 14000, 17000, 19833, 21583],
      [8917, 10667, 13500, 16500, 19500, 22333, 24083],
      [11417, 13167, 16000, 19000, 22000, 24833, 26583],
      [13800, 15600, 18437, 21438, 24438, 26813, 28563],
      [15300, 17100, 19896, 22896, 25896, 28271, 30021],
    ];
    expect(smartBlur2D(input, 2, 40, SMART_NORMAL)).toEqual(GOLDEN);
  });

  it("matches the engine bit-exactly — Edge Only (r=2, thr=40)", () => {
    const GOLDEN = [
      [65535, 65535, 65535, 65535, 65535, 0, 0],
      [65535, 65535, 65535, 65535, 65535, 0, 0],
      [65535, 65535, 65535, 65535, 65535, 65535, 65535],
      [65535, 65535, 65535, 65535, 65535, 65535, 65535],
      [65535, 65535, 65535, 65535, 65535, 65535, 65535],
      [0, 0, 65535, 65535, 65535, 65535, 65535],
      [0, 0, 65535, 65535, 65535, 65535, 65535],
    ];
    expect(smartBlur2D(input, 2, 40, SMART_EDGE_ONLY)).toEqual(GOLDEN);
  });

  it("matches the engine bit-exactly — Overlay (r=1, thr=80)", () => {
    const GOLDEN = [
      [1833, 3833, 6833, 9833, 12833, 15833, 17833],
      [3500, 5500, 8500, 11500, 14500, 17500, 19500],
      [6000, 8000, 11000, 14000, 17000, 20000, 22000],
      [8500, 10500, 13500, 16500, 19500, 22500, 24500],
      [11000, 13000, 16000, 19000, 22000, 25000, 27000],
      [13500, 15500, 18500, 21500, 24500, 27500, 29500],
      [15167, 17167, 20167, 23167, 26167, 29167, 31167],
    ];
    expect(smartBlur2D(input, 1, 80, SMART_OVERLAY)).toEqual(GOLDEN);
  });
});

// ── Several radius/threshold/mode fixtures swept for in-range, shape, flat-invariance ──
const FIXTURES: { name: string; radius: number; threshold: number; mode: number }[] = [
  { name: "small normal", radius: 1, threshold: 30, mode: SMART_NORMAL },
  { name: "wide normal", radius: 3, threshold: 90, mode: SMART_NORMAL },
  { name: "edge only", radius: 2, threshold: 50, mode: SMART_EDGE_ONLY },
  { name: "overlay", radius: 2, threshold: 70, mode: SMART_OVERLAY },
];

describe.each(FIXTURES)("fixture: $name", ({ radius, threshold, mode }) => {
  it("stays in range, keeps shape, and leaves a flat field untouched (mode-appropriately)", () => {
    const g = grid(13, 13, (x, y) => (x * 4099 + y * 8191) % SMART_BLUR_MAX);
    const out = smartBlur2D(g, radius, threshold, mode);
    expect(out.length).toBe(13);
    expect(out.every((row) => row.length === 13)).toBe(true);
    for (const v of flat(out)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(SMART_BLUR_MAX);
    }
    const flatField = grid(13, 13, () => 41000);
    const expected = mode === SMART_EDGE_ONLY ? grid(13, 13, () => 0) : flatField;
    expect(smartBlur2D(flatField, radius, threshold, mode)).toEqual(expected);
  });
});
