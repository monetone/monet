// Unit tests for the Sharpen Edges filter. Engine-free (node), single luminance-channel model
// (exact for grey R=G=B input). These pin the luminance-gradient edge gate (min(|∇lum|/15000,
// 1)), the flat-region passthrough (edge 0 → unchanged), the per-channel 4-neighbour laplacian
// 4c−L−R−U−D, and the clamp+truncate (must match filters.rs sharpen_edges), plus a cross-
// implementation golden captured from the Rust engine.
import { describe, it, expect } from "vitest";
import { sharpenEdgesPixel, sharpenEdges2D, SHARPEN_EDGES_MAX } from "./sharpenEdges";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("sharpenEdgesPixel", () => {
  it("leaves a pixel unchanged inside a flat region (edge gate = 0)", () => {
    const g = grid(5, 5, () => 24000);
    for (const [x, y] of [
      [2, 2],
      [0, 0],
      [4, 4],
    ]) {
      expect(sharpenEdgesPixel(g, x, y)).toBe(24000);
    }
  });

  it("sharpens a pixel on a strong edge (applies edge·laplacian)", () => {
    // a vertical step: cols <3 dark, cols ≥3 bright. the boundary pixels have a strong
    // gradient (edge > 0) and a non-zero laplacian, so they change.
    const g = grid(3, 7, (x) => (x < 3 ? 0 : 40000));
    // pixel (3,1): c=40000; lap = 4·40000 − L(2,1=0) − R(4,1=40000) − U(3,0=40000) − D(3,2=40000)
    //            = 160000 − 0 − 40000 − 40000 − 40000 = 40000 (positive → brightens, clamps high)
    expect(sharpenEdgesPixel(g, 3, 1)).toBeGreaterThan(40000);
    // pixel (2,1): c=0; lap = 0 − 0 − 40000 − 0 − 0 = −40000 (negative → darkens, clamps to 0)
    expect(sharpenEdgesPixel(g, 2, 1)).toBe(0);
  });

  it("does not fire at a lone spike — the gate is a centred difference of the NEIGHBOURS", () => {
    // a single bright pixel among a dark field: at the spike, left==right==up==down (all 0),
    // so the luminance gradient there is 0 → edge gate 0 → the spike is left unchanged. (The
    // gradient lives one pixel AWAY, where left≠right — the gate never inspects the centre.)
    const g = grid(7, 7, (x, y) => (x === 3 && y === 3 ? 60000 : 0));
    expect(sharpenEdgesPixel(g, 3, 3)).toBe(60000); // gradient 0 at the spike → unchanged
    expect(sharpenEdgesPixel(g, 0, 0)).toBe(0); // far corner, flat → unchanged
  });

  it("scales by a FRACTIONAL edge and TRUNCATES (not a plain unconditional sharpen)", () => {
    // a strictly-partial edge: gy=0, gx from the 15500/20000 neighbours → edge ≈ 0.30 (in (0,1)),
    // lap = 4·6700 − 15500 − 20000 − 6700 − 6700 = −22100, so val ≈ 69.9995 → trunc 69.
    // This pins THREE things the saturated golden cannot: real = 69; a round-instead-of-trunc
    // mutant = 70; an "always edge=1" (plain Sharpen) mutant = 0.
    const g = [
      [0, 6700, 0],
      [15500, 6700, 20000],
      [0, 6700, 0],
    ];
    expect(sharpenEdgesPixel(g, 1, 1)).toBe(69);
  });
});

describe("sharpenEdges2D", () => {
  it("leaves a flat image completely unchanged", () => {
    const g = grid(8, 8, () => 30000);
    expect(sharpenEdges2D(g)).toEqual(g);
  });

  it("keeps every output an integer within [0, 65535]", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % SHARPEN_EDGES_MAX);
    for (const v of flat(sharpenEdges2D(g))) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(SHARPEN_EDGES_MAX);
    }
  });

  it("changes a textured image but not a flat one", () => {
    const textured = grid(9, 9, (x, y) => (x * 6151 + y * 3079) % SHARPEN_EDGES_MAX);
    expect(sharpenEdges2D(textured)).not.toEqual(textured);
    const flatField = grid(9, 9, () => 12345);
    expect(sharpenEdges2D(flatField)).toEqual(flatField);
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(sharpenEdges2D([])).toEqual([]);
    expect(sharpenEdges2D([[], []])).toEqual([[], []]);
    expect(sharpenEdges2D([[42]])).toEqual([[42]]); // lone pixel: all neighbours clamp to itself → flat
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % 40000);
    expect(sharpenEdges2D(g)).toEqual(sharpenEdges2D(g));
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => (x * 5000 + y * 4000) % SHARPEN_EDGES_MAX);
    const snapshot = g.map((r) => [...r]);
    sharpenEdges2D(g);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = sharpenEdges2D(g);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 13)).toBe(true);
  });
});

// ── Cross-implementation golden: exact u16 output captured from the Rust engine's
//    sharpen_edges on a 7×7 grey pattern v = (x·9973 + y·9931) mod 65535. The single-channel
//    luminance model is bit-exact to the engine for grey input. ──
describe("engine golden (sharpen_edges, 7×7 grey)", () => {
  const input = grid(7, 7, (x, y) => (x * 9973 + y * 9931) % SHARPEN_EDGES_MAX);

  it("matches the engine bit-exactly (high-contrast: mostly saturated edge=1)", () => {
    expect(sharpenEdges2D(input)).toEqual([
      [0, 42, 10015, 19988, 29961, 39934, 65535],
      [0, 19904, 29877, 39850, 49823, 65535, 0],
      [9889, 29835, 39808, 49781, 65535, 0, 24138],
      [19820, 39766, 49739, 65535, 0, 14123, 34069],
      [29751, 49697, 65535, 0, 14081, 24054, 44000],
      [39682, 65535, 0, 14039, 24012, 33985, 53931],
      [65535, 0, 23928, 33901, 43874, 53847, 65535],
    ]);
  });

  it("matches the engine bit-exactly on a LOW-gradient field (fractional 0<edge<1 everywhere)", () => {
    // a smooth curved field v = 200x² + 150y² + 80xy keeps |∇lum| well under 15000, so every
    // pixel uses a FRACTIONAL edge gate (the filter's whole premise) and a non-zero laplacian —
    // unlike the high-contrast golden above, which is almost entirely saturated/clamped.
    const lowGrad = grid(7, 7, (x, y) => 200 * x * x + 150 * y * y + 80 * x * y);
    expect(sharpenEdges2D(lowGrad)).toEqual([
      [0, 165, 722, 1671, 3012, 4744, 7439],
      [124, 372, 1017, 2060, 3502, 5345, 8194],
      [544, 877, 1605, 2730, 4254, 6177, 9199],
      [1258, 1680, 2491, 3698, 5303, 7308, 10515],
      [2265, 2782, 3675, 4964, 6651, 8736, 12141],
      [3566, 4184, 5158, 6529, 8297, 10464, 14076],
      [5515, 6298, 7454, 9022, 11001, 13390, 16577],
    ]);
  });
});

// ── Several image fixtures swept for in-range, shape, flat-passthrough ──
const FIXTURES: { name: string; fn: (x: number, y: number) => number }[] = [
  { name: "diagonal ramp", fn: (x, y) => ((x + y) * 4000) % SHARPEN_EDGES_MAX },
  { name: "high-frequency", fn: (x, y) => (x * 6151 + y * 3079) % SHARPEN_EDGES_MAX },
  { name: "blocky", fn: (x, y) => ((x >> 1) + (y >> 1)) * 8000 },
];

describe.each(FIXTURES)("fixture: $name", ({ fn }) => {
  it("stays in range, keeps shape, and leaves a flat field untouched", () => {
    const g = grid(13, 13, fn);
    const out = sharpenEdges2D(g);
    expect(out.length).toBe(13);
    expect(out.every((r) => r.length === 13)).toBe(true);
    for (const v of flat(out)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(SHARPEN_EDGES_MAX);
    }
    expect(sharpenEdges2D(grid(13, 13, () => 55555))).toEqual(grid(13, 13, () => 55555));
  });
});
