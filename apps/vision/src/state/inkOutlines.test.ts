// Unit tests for the Ink Outlines filter. Engine-free (node), single grey-channel model (exact for
// grey R=G=B input). These pin the Sobel luminance gradient, the gain, the edge = clamp(mag/30000·
// gain) strength, the dual output (edges → dark ink v·(1−edge·dark); flats → toward white), and the
// truncating output (must match filters.rs ink_outlines), plus cross-implementation goldens from
// the Rust engine. sqrt is IEEE-correctly-rounded so these are bit-exact (no tolerance).
import { describe, it, expect } from "vitest";
import { inkOutlinesGain, inkOutlinesPixel, inkOutlines2D, INK_OUTLINES_MAX } from "./inkOutlines";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();
// the bilinear saddle used for the engine goldens (non-linear ⇒ pins the Sobel perpendicular taps).
const saddle = grid(9, 9, (x, y) => 20000 + x * y * 180);

describe("inkOutlinesGain", () => {
  it("gain = 0.5 + 2·clamp(stroke_length,0,1) (0.5..2.5)", () => {
    expect(inkOutlinesGain(0)).toBe(0.5);
    expect(inkOutlinesGain(0.5)).toBe(1.5);
    expect(inkOutlinesGain(1)).toBe(2.5);
    expect(inkOutlinesGain(2)).toBe(2.5); // clamped
  });
});

describe("inkOutlinesPixel", () => {
  it("is the identity when dark=0 and light=0 (nothing inked, nothing bleached)", () => {
    const g = grid(7, 7, (x, y) => 20000 + x * 200 + y * 150);
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) expect(inkOutlinesPixel(g, x, y, 0.5, 0, 0)).toBe(g[y][x]);
  });

  it("bleaches a flat region toward white by `light` (flats are NOT identity)", () => {
    const fld = grid(5, 5, () => 30000);
    expect(inkOutlinesPixel(fld, 2, 2, 0.5, 0.5, 0)).toBe(30000); // light 0 ⇒ identity (no wash)
    expect(inkOutlinesPixel(fld, 2, 2, 0.5, 0.5, 0.5)).toBe(47767); // 30000 + (65535−30000)·0.5 = 47767.5 → trunc
    expect(inkOutlinesPixel(fld, 2, 2, 0.5, 0.5, 1)).toBe(INK_OUTLINES_MAX); // full wash → white
  });

  it("inks a strong edge dark (edge saturates ⇒ out = v·(1−dark), no wash)", () => {
    const step = grid(7, 7, (x) => (x < 3 ? 1000 : 60000));
    // boundary column (huge gradient ⇒ edge=1): a bright pixel becomes v·(1−dark), darker than v.
    expect(inkOutlinesPixel(step, 3, 3, 1, 0.7, 0.3)).toBeLessThan(60000);
    expect(inkOutlinesPixel(step, 3, 3, 1, 0.7, 0.3)).toBe(Math.trunc(60000 * (1 - 0.7))); // 18000
  });
});

describe("inkOutlines2D", () => {
  it("keeps every output an integer within [0, 65535]", () => {
    const g = grid(11, 13, (x, y) => 10000 + ((x * 4099 + y * 8191) % 45000));
    for (const [sl, di, li] of [
      [0.4, 0.7, 0.3],
      [0.85, 0.5, 0.65],
      [0.1, 1, 0],
    ]) {
      for (const v of flat(inkOutlines2D(g, sl, di, li))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(INK_OUTLINES_MAX);
      }
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(inkOutlines2D([], 0.4, 0.7, 0.3)).toEqual([]);
    expect(inkOutlines2D([[], []], 0.4, 0.7, 0.3)).toEqual([[], []]);
    expect(inkOutlines2D([[40000]], 0.4, 0.7, 0)).toEqual([[40000]]); // lone pixel: no gradient, light 0 → identity
    expect(inkOutlines2D(saddle, 0.4, 0.7, 0.3)).toEqual(inkOutlines2D(saddle, 0.4, 0.7, 0.3));
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => 20000 + x * 300 + y * 200);
    const snapshot = g.map((r) => [...r]);
    inkOutlines2D(g, 0.5, 0.5, 0.5);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 13, (x, y) => 20000 + x * 200 + y * 150);
    const out = inkOutlines2D(g, 0.5, 0.5, 0.3);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 13)).toBe(true);
  });
});

// ── Cross-implementation goldens captured from the Rust engine's ink_outlines on a 9×9 bilinear
//    saddle v = 20000 + x·y·180 (non-linear ⇒ exercises the Sobel perpendicular taps; continuous
//    edge in the corner, saturating in the high-curvature ring). These pin the algebra/structure;
//    per-op f32 frounds are covered separately by the cover probes below. sqrt is correctly-rounded
//    so these are bit-exact. ──
describe("engine golden (ink_outlines, 9×9 saddle)", () => {
  const rows = (vals: number[]): number[][] => Array.from({ length: 9 }, (_, y) => vals.slice(y * 9, y * 9 + 9));

  it("matches the engine bit-exactly — stroke 0.4, dark 0.7, light 0.3", () => {
    expect(inkOutlines2D(saddle, 0.4, 0.7, 0.3)).toEqual(
      rows([
        33401, 32837, 32134, 31396, 30643, 29879, 29105, 28322, 27738, 32837, 31680, 30546, 29220, 27805, 26327, 24796,
        23216, 22109, 32134, 30546, 29864, 28867, 27694, 26405, 25026, 23573, 22827, 31396, 29220, 28867, 28183, 27271,
        26196, 24995, 23688, 23484, 30643, 27805, 27694, 27271, 26603, 25742, 24724, 23573, 24079, 29879, 26327, 26405,
        26196, 25742, 25079, 24239, 23243, 24609, 29105, 24796, 25026, 24995, 24724, 24239, 23563, 22713, 25074, 28322,
        23216, 23573, 23688, 23573, 23243, 22713, 21997, 25472, 27738, 22109, 22827, 23484, 24079, 24609, 25074, 25472,
        32179,
      ]),
    );
  });

  it("matches the engine bit-exactly — stroke 0.85, dark 0.5, light 0.65", () => {
    expect(inkOutlines2D(saddle, 0.85, 0.5, 0.65)).toEqual(
      rows([
        48977, 47621, 45918, 44115, 42258, 40358, 38419, 36441, 34957, 47621, 44584, 41579, 38075, 34311, 30351, 26218,
        21918, 18832, 45918, 41579, 39465, 36576, 33240, 29600, 25721, 21629, 19359, 44115, 38075, 36576, 34270, 31412,
        28155, 24585, 20748, 19738, 42258, 34311, 33240, 31412, 28998, 26127, 22885, 19322, 19970, 40358, 30351, 29600,
        28155, 26127, 23614, 20690, 17401, 20060, 38419, 26218, 25721, 24585, 22885, 20690, 18056, 15026, 20009, 36441,
        21918, 21629, 20748, 19322, 17401, 15026, 14410, 19820, 34957, 18832, 19359, 19738, 19970, 20060, 20009, 19820,
        34212,
      ]),
    );
  });

  it("matches the engine bit-exactly — flat 30000 bleaches uniformly (stroke 0.5, dark 0.5, light 0.5)", () => {
    expect(inkOutlines2D(grid(5, 5, () => 30000), 0.5, 0.5, 0.5)).toEqual(grid(5, 5, () => 47767));
  });

  it("pins the aggregate f32-vs-f64 truncation — a fractional-param pixel a wholesale f64 mirror misses", () => {
    // The saddle goldens truncate the same in f32 and f64. This 12×12 asymmetric ramp at (stroke
    // 0.52, dark 0.48, light 0.29) does not: pixel (9,10) is 33353 in the engine's f32 but 33352 in
    // an all-f64 mirror. (Per-op fround discipline is pinned at finer granularity below.)
    const g = grid(12, 12, (x, y) => 20000 + x * 137 + y * 91);
    expect(inkOutlines2D(g, 0.52, 0.48, 0.29)[10][9]).toBe(33353);
  });

  // Per-op fround cover: a greedy set of (pattern, pixel, params) probes that each make distinct
  // LIVE Math.fround sites load-bearing — dropping any individual fround flips at least one of
  // these. (A single aggregate probe only catches wholesale f64.) Captured from the real engine.
  const field = (pat: number, x: number, y: number): number =>
    pat === 0 ? 20000 + x * 50 + y * 100
    : pat === 1 ? 20000 + x * 137 + y * 91
    : pat === 3 ? 20000 + x * y * 180
    : 25000 + x * 211 + y * y * 40;
  it.each([
    { pat: 1, x: 3, y: 7, sl: 0.4, di: 0.7, li: 0.3, out: 33198 },
    { pat: 3, x: 4, y: 3, sl: 0.52, di: 0.48, li: 0.29, out: 26877 },
    { pat: 0, x: 0, y: 2, sl: 0.85, di: 0.5, li: 0.65, out: 47647 },
    { pat: 3, x: 2, y: 1, sl: 0.52, di: 0.48, li: 0.29, out: 30070 },
    { pat: 4, x: 2, y: 5, sl: 0.52, di: 0.48, li: 0.29, out: 33858 },
    { pat: 4, x: 1, y: 5, sl: 0.37, di: 0.91, li: 0.18, out: 29209 },
  ])("fround-cover probe pat=$pat ($x,$y) — matches the engine", ({ pat, x, y, sl, di, li, out }) => {
    const g = grid(8, 8, (gx, gy) => field(pat, gx, gy));
    expect(inkOutlines2D(g, sl, di, li)[y][x]).toBe(out);
  });
});
