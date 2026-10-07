// Unit tests for the Plastic Wrap filter. Engine-free (node), single grey-channel model (exact for
// grey R=G=B input). These pin the smoothing radius / gradient distance, the box-blurred luminance
// field, the gradient-magnitude specular sheen toward white (two sqrts), and the hs≤0 no-op (must
// match filters.rs plastic_wrap), plus cross-implementation goldens captured from the Rust engine.
// sqrt is IEEE-correctly-rounded so these are bit-exact (no tolerance).
import { describe, it, expect } from "vitest";
import { plasticWrapParams, plasticWrap2D, PLASTIC_WRAP_MAX } from "./plasticWrap";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();
// the radial bump used for the engine goldens: a smooth paraboloid clamped to u16.
const bump = grid(9, 9, (x, y) => {
  const dx = x - 4;
  const dy = y - 4;
  return Math.min(Math.max(20000 + (dx * dx + dy * dy) * 1200, 0), PLASTIC_WRAP_MAX);
});

describe("plasticWrapParams", () => {
  it("r = round(smoothness·6) ∈ [0,6]; d = 1 + round(detail·3) ∈ [1,4]", () => {
    expect(plasticWrapParams(0, 0)).toEqual({ r: 0, d: 1 });
    expect(plasticWrapParams(1, 1)).toEqual({ r: 6, d: 4 });
    expect(plasticWrapParams(0.5, 0.5)).toEqual({ r: 3, d: 3 }); // round(1.5)=2 (half away) ⇒ d=3
    expect(plasticWrapParams(0.3, 0.3)).toEqual({ r: 2, d: 2 }); // round(1.8)=2, 1+round(0.9)=2
  });
});

describe("plasticWrap2D", () => {
  it("is the identity when highlight_strength ≤ 0 (engine early return)", () => {
    expect(plasticWrap2D(bump, 0, 0.5, 0.5)).toEqual(bump.map((r) => [...r]));
    expect(plasticWrap2D(bump, -0.5, 0.5, 0.5)).toEqual(bump.map((r) => [...r]));
  });

  it("leaves a flat field unchanged (zero curvature ⇒ no sheen)", () => {
    const g = grid(8, 8, () => 30000);
    expect(plasticWrap2D(g, 1, 1, 0)).toEqual(g);
    expect(plasticWrap2D(g, 0.5, 0.5, 1)).toEqual(g);
  });

  it("brightens curved regions toward white while the flat peak stays put", () => {
    const out = plasticWrap2D(bump, 0.5, 0.3, 0);
    expect(out[4][4]).toBe(20000); // the paraboloid apex: gradient 0 ⇒ unchanged
    expect(out[0][0]).toBeGreaterThan(bump[0][0]); // a curved corner gains a white sheen
  });

  it("only ever brightens (out ≥ in everywhere)", () => {
    const out = plasticWrap2D(bump, 1, 1, 0.5);
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) expect(out[y][x]).toBeGreaterThanOrEqual(bump[y][x]);
  });

  it("keeps every output an integer within [0, 65535]", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % PLASTIC_WRAP_MAX);
    for (const [hs, dt, sm] of [
      [0.5, 0.3, 0],
      [1, 1, 0.5],
      [0.3, 0, 1],
    ]) {
      for (const v of flat(plasticWrap2D(g, hs, dt, sm))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(PLASTIC_WRAP_MAX);
      }
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(plasticWrap2D([], 0.5, 0.5, 0)).toEqual([]);
    expect(plasticWrap2D([[], []], 0.5, 0.5, 0)).toEqual([[], []]);
    expect(plasticWrap2D([[42]], 0.5, 0.5, 0)).toEqual([[42]]); // 1×1: all neighbours clamp ⇒ no gradient
    expect(plasticWrap2D(bump, 1, 1, 0.5)).toEqual(plasticWrap2D(bump, 1, 1, 0.5));
  });

  it("does not mutate the input", () => {
    const snapshot = bump.map((r) => [...r]);
    plasticWrap2D(bump, 1, 1, 0.5);
    expect(bump).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 13, (x, y) => 20000 + ((x * 11 + y * 5) % 30000));
    const out = plasticWrap2D(g, 0.5, 0.5, 0.5);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 13)).toBe(true);
  });
});

// ── Cross-implementation goldens: exact u16 output captured from the Rust engine's plastic_wrap on
//    a 9×9 radial bump v = clamp(20000 + ((x−4)²+(y−4)²)·1200). The curved ring gives a continuous
//    sheen (smoothness 0/0.5/1 exercise the box-blur radii). sqrt is correctly-rounded so these are
//    bit-exact. ──
describe("engine golden (plastic_wrap, 9×9 radial bump)", () => {
  const rows = (vals: number[]): number[][] => Array.from({ length: 9 }, (_, y) => vals.slice(y * 9, y * 9 + 9));

  it("matches the engine bit-exactly — strength 0.5, detail 0.3, smoothness 0 (no blur)", () => {
    expect(plasticWrap2D(bump, 0.5, 0.3, 0)).toEqual(
      rows([
        64024, 63029, 62430, 58666, 56657, 58666, 62430, 63029, 64024, 63029, 62696, 62427, 58460, 56544, 58460, 62427,
        62696, 63029, 62430, 62427, 62311, 57999, 55981, 57999, 62311, 62427, 62430, 58666, 58460, 57999, 50165, 45197,
        50165, 57999, 58460, 58666, 56657, 56544, 55981, 45197, 20000, 45197, 55981, 56544, 56657, 58666, 58460, 57999,
        50165, 45197, 50165, 57999, 58460, 58666, 62430, 62427, 62311, 57999, 55981, 57999, 62311, 62427, 62430, 63029,
        62696, 62427, 58460, 56544, 58460, 62427, 62696, 63029, 64024, 63029, 62430, 58666, 56657, 58666, 62430, 63029,
        64024,
      ]),
    );
  });

  it("matches the engine bit-exactly — strength 1, detail 1, smoothness 0.5 (blur radius 3)", () => {
    expect(plasticWrap2D(bump, 1, 1, 0.5)).toEqual(
      rows([
        64140, 62071, 59804, 57825, 57017, 57825, 59804, 62071, 64140, 62071, 59459, 56454, 53734, 52594, 53734, 56454,
        59459, 62071, 59804, 56454, 52366, 48343, 46501, 48343, 52366, 56454, 59804, 57825, 53734, 48343, 42032, 38168,
        42032, 48343, 53734, 57825, 57017, 52594, 46501, 38168, 20000, 38168, 46501, 52594, 57017, 57825, 53734, 48343,
        42032, 38168, 42032, 48343, 53734, 57825, 59804, 56454, 52366, 48343, 46501, 48343, 52366, 56454, 59804, 62071,
        59459, 56454, 53734, 52594, 53734, 56454, 59459, 62071, 64140, 62071, 59804, 57825, 57017, 57825, 59804, 62071,
        64140,
      ]),
    );
  });

  it("pins the per-op f32 rounding — a non-symmetric grid where an f64 mirror diverges", () => {
    // The symmetric bump above truncates to the same u16 in f32 and f64, so it cannot defend the
    // bit-exactness claim. This asymmetric grid does: pixel (2,3) is 55435 in the engine's f32, but
    // a no-fround (f64) mirror computes 55434. Captured from the engine. (strength 1, detail 1, smoothness 0.5)
    const asym = [
      [3978, 1471, 35211, 54392],
      [55399, 44624, 24953, 38381],
      [45639, 46620, 47095, 64899],
      [29475, 6417, 12556, 29319],
      [8323, 50381, 38910, 52733],
    ];
    expect(plasticWrap2D(asym, 1, 1, 0.5)).toEqual([
      [56563, 55811, 60762, 63724],
      [63951, 62136, 58702, 60818],
      [62214, 62255, 62225, 65417],
      [59132, 54637, 55435, 58420],
      [54762, 62574, 60158, 62872],
    ]);
  });

  it("matches the engine bit-exactly — strength 0.3, detail 0, smoothness 1 (blur radius 6)", () => {
    expect(plasticWrap2D(bump, 0.3, 0, 1)).toEqual(
      rows([
        59396, 52170, 46530, 43353, 42294, 43353, 46530, 52170, 59396, 52170, 44944, 39117, 35939, 34880, 35939, 39117,
        44944, 52170, 46530, 39117, 29600, 26000, 24800, 26000, 29600, 39117, 46530, 43353, 35939, 26000, 22400, 21200,
        22400, 26000, 35939, 43353, 42294, 34880, 24800, 21200, 20000, 21200, 24800, 34880, 42294, 43353, 35939, 26000,
        22400, 21200, 22400, 26000, 35939, 43353, 46530, 39117, 29600, 26000, 24800, 26000, 29600, 39117, 46530, 52170,
        44944, 39117, 35939, 34880, 35939, 39117, 44944, 52170, 59396, 52170, 46530, 43353, 42294, 43353, 46530, 52170,
        59396,
      ]),
    );
  });
});
