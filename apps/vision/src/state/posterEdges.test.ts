// Unit tests for the Poster Edges filter. Engine-free (node), single luminance-channel model
// (exact for grey R=G=B input). These pin the posterisation (round(v/65535·lv)/lv to lv+1
// tiers), the neighbourhood max-luminance edge term, the darkening dark=1−clamp(maxd·intensity),
// and their product (must match filters.rs poster_edges), plus a cross-implementation golden
// captured from the Rust engine. A flat region is purely posterised; a hard edge inks black.
import { describe, it, expect } from "vitest";
import { posterizeChannel, posterEdgesPixel, posterEdges2D, POSTER_EDGES_MAX } from "./posterEdges";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("posterizeChannel", () => {
  it("collapses to pure black/white at levels 2 (lv = 1)", () => {
    expect(posterizeChannel(0, 2)).toBe(0);
    expect(posterizeChannel(POSTER_EDGES_MAX, 2)).toBe(POSTER_EDGES_MAX);
    expect(posterizeChannel(40000, 2)).toBe(POSTER_EDGES_MAX); // 0.61 → round 1
    expect(posterizeChannel(20000, 2)).toBe(0); // 0.31 → round 0
  });

  it("quantises to 4 evenly-spaced tiers (0, ⅓, ⅔, 1 of 65535)", () => {
    expect(posterizeChannel(0, 4)).toBe(0);
    expect(posterizeChannel(POSTER_EDGES_MAX, 4)).toBe(POSTER_EDGES_MAX);
    expect(posterizeChannel(21845, 4)).toBe(21845); // ⅓ tier, a quantiser fixed point
    expect(posterizeChannel(50000, 4)).toBe(43690); // 0.763·3 → round 2 → ⅔ → 43690
    expect(posterizeChannel(10000, 4)).toBe(0); // 0.153·3 → round 0
    expect(posterizeChannel(12000, 4)).toBe(21845); // 0.183·3 → round 1 → ⅓
  });

  it("treats levels < 2 as 2", () => {
    expect(posterizeChannel(40000, 1)).toBe(posterizeChannel(40000, 2));
    expect(posterizeChannel(40000, 0)).toBe(posterizeChannel(40000, 2));
  });
});

describe("posterEdgesPixel", () => {
  it("is pure posterisation inside a flat region (maxd = 0 ⇒ dark = 1)", () => {
    const g = grid(5, 5, () => 40000);
    for (const [x, y] of [
      [2, 2],
      [0, 0],
    ]) {
      expect(posterEdgesPixel(g, x, y, 4, 1, 2)).toBe(posterizeChannel(40000, 4));
      expect(posterEdgesPixel(g, x, y, 6, 2, 1)).toBe(posterizeChannel(40000, 6));
    }
  });

  it("darkens a pixel sitting on a strong edge (dark < 1)", () => {
    const g = grid(3, 7, (x) => (x < 3 ? 0 : 60000));
    // pixel (3,1) is bright (60000) but borders the dark half → edge term darkens it below
    // its plain posterised value
    const plain = posterizeChannel(60000, 4);
    expect(posterEdgesPixel(g, 3, 1, 4, 1, 2)).toBeLessThan(plain);
  });

  it("inks a hard edge fully black at high intensity (darkening, not posterising-zero)", () => {
    const g = grid(3, 7, (x) => (x < 3 ? 0 : POSTER_EDGES_MAX));
    // the bright edge pixel posterises to MAX (q=1); the full-scale step gives maxd ≈ 1, so
    // intensity 3 saturates dark→0 → output 0. The black is therefore purely from darkening
    // (it would be MAX without it), so this is NOT a posterising-zero tautology.
    expect(posterEdgesPixel(g, 3, 1, 2, 1, 3)).toBe(0);
  });

  it("a negative intensity clamps to no darkening (pure posterisation)", () => {
    // md = maxd·(−5) < 0 → the lower clamp pins it to 0 → dark = 1 → the edge pixel is just
    // posterised. Without the lower clamp, dark > 1 would over-brighten (→ 65535 here).
    const g = grid(3, 7, (x) => (x < 3 ? 10000 : 55000));
    expect(posterEdgesPixel(g, 3, 1, 6, 1, -5)).toBe(posterizeChannel(55000, 6));
  });

  it("a higher intensity darkens an edge at least as much", () => {
    const g = grid(3, 7, (x) => (x < 3 ? 10000 : 38000));
    const lo = posterEdgesPixel(g, 3, 1, 6, 1, 1);
    const hi = posterEdgesPixel(g, 3, 1, 6, 1, 3);
    expect(hi).toBeLessThanOrEqual(lo);
  });
});

describe("posterEdges2D", () => {
  it("posterises a flat image to a single uniform tier (not black)", () => {
    const g = grid(8, 8, () => 40000);
    expect(posterEdges2D(g, 4, 1, 2)).toEqual(grid(8, 8, () => posterizeChannel(40000, 4)));
  });

  it("inks the boundary of a hard step black while keeping the flat interiors", () => {
    // BOTH sides posterise to NON-zero tiers (levels 6), so a black edge pixel is attributable
    // to darkening — not to posterising a zero source. Strong intensity saturates dark→0.
    const g = grid(4, 7, (x) => (x < 3 ? 25000 : 55000));
    const darkTier = posterizeChannel(25000, 6);
    const brightTier = posterizeChannel(55000, 6);
    expect(darkTier).toBeGreaterThan(0); // sanity: the dark-side black below IS from darkening
    const out = posterEdges2D(g, 6, 1, 3);
    for (let y = 0; y < 4; y++) {
      expect(out[y][3]).toBe(0); // bright edge pixel darkened to black (would be brightTier)
      expect(out[y][2]).toBe(0); // dark edge pixel darkened to black (would be darkTier > 0)
      expect(out[y][6]).toBe(brightTier); // deep bright interior → its tier (no edge)
      expect(out[y][0]).toBe(darkTier); // deep dark interior → its tier (no edge)
    }
  });

  it("keeps every output an integer within [0, 65535]", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % POSTER_EDGES_MAX);
    for (const [levels, thickness, intensity] of [
      [4, 1, 2],
      [6, 2, 1],
      [8, 3, 0.5],
    ]) {
      for (const v of flat(posterEdges2D(g, levels, thickness, intensity))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(POSTER_EDGES_MAX);
      }
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(posterEdges2D([], 4, 1, 2)).toEqual([]);
    expect(posterEdges2D([[], []], 4, 1, 2)).toEqual([[], []]);
    // lone pixel: neighbourhood clamps to itself → maxd 0 → dark 1 → pure posterise
    expect(posterEdges2D([[40000]], 4, 1, 2)).toEqual([[posterizeChannel(40000, 4)]]);
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % 40000);
    expect(posterEdges2D(g, 6, 2, 1)).toEqual(posterEdges2D(g, 6, 2, 1));
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => (x * 5000 + y * 4000) % POSTER_EDGES_MAX);
    const snapshot = g.map((r) => [...r]);
    posterEdges2D(g, 4, 1, 2);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = posterEdges2D(g, 4, 2, 1);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 13)).toBe(true);
  });
});

// ── Cross-implementation golden: exact u16 output captured from the Rust engine's
//    poster_edges on a 7×7 grey pattern v = (x·9973 + y·9931) mod 65535. The single-channel
//    luminance model is bit-exact to the engine for grey input. ──
describe("engine golden (poster_edges, 7×7 grey)", () => {
  const input = grid(7, 7, (x, y) => (x * 9973 + y * 9931) % POSTER_EDGES_MAX);

  it("matches the engine bit-exactly — levels 4, thickness 1, intensity 2", () => {
    const GOLDEN = [
      [0, 0, 8576, 8576, 17151, 0, 0],
      [0, 8576, 8576, 17151, 0, 0, 0],
      [8576, 8576, 17151, 0, 0, 0, 0],
      [8576, 17151, 0, 0, 0, 0, 8576],
      [17151, 0, 0, 0, 0, 8576, 17151],
      [0, 0, 0, 0, 8576, 17151, 17151],
      [0, 0, 0, 8576, 17151, 17151, 17151],
    ];
    expect(posterEdges2D(input, 4, 1, 2)).toEqual(GOLDEN);
  });

  it("matches the engine bit-exactly — levels 6, thickness 2, intensity 1", () => {
    const GOLDEN = [
      [0, 5145, 10291, 14263, 17901, 15890, 9889],
      [5145, 10291, 14263, 17901, 15890, 9889, 0],
      [10291, 14263, 15436, 15890, 9889, 0, 3972],
      [14263, 17901, 15890, 9889, 0, 3972, 11934],
      [17901, 15890, 9889, 0, 3972, 11934, 21395],
      [15923, 9931, 0, 3972, 11934, 21395, 15436],
      [9973, 0, 3972, 11934, 21395, 15436, 20582],
    ];
    expect(posterEdges2D(input, 6, 2, 1)).toEqual(GOLDEN);
  });
});

// ── Several levels/thickness/intensity fixtures swept for in-range, shape, flat→posterised ──
const FIXTURES: { name: string; levels: number; thickness: number; intensity: number }[] = [
  { name: "coarse strong", levels: 3, thickness: 1, intensity: 3 },
  { name: "fine gentle", levels: 8, thickness: 2, intensity: 0.5 },
  { name: "mid", levels: 5, thickness: 3, intensity: 1.5 },
];

describe.each(FIXTURES)("fixture: $name", ({ levels, thickness, intensity }) => {
  it("stays in range, keeps shape, and posterises a flat field uniformly", () => {
    const g = grid(13, 13, (x, y) => (x * 4099 + y * 8191) % POSTER_EDGES_MAX);
    const out = posterEdges2D(g, levels, thickness, intensity);
    expect(out.length).toBe(13);
    expect(out.every((r) => r.length === 13)).toBe(true);
    for (const v of flat(out)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(POSTER_EDGES_MAX);
    }
    const tier = posterizeChannel(36000, levels);
    expect(posterEdges2D(grid(13, 13, () => 36000), levels, thickness, intensity)).toEqual(
      grid(13, 13, () => tier),
    );
  });
});
