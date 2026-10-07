// Unit tests for the Pointillize filter. Engine-free (node), single grey-channel model (exact for
// grey R=G=B input with a grey background). Pointillize finds each pixel's nearest jittered-grid seed
// (the same Voronoi layout as Crystallize) and paints the sampled seed colour inside a dot of radius
// cell/2, else the background. These pin hash2, the seed search, the dot-radius test, and the cell
// coercion (must match filters.rs pointillize), plus engine goldens over a positionally-unique field
// (so each value names the sampled seed or the gap). The hash is exact; the f32 seed-POSITION rounding
// and the `best ≤ r2` dot-boundary test are load-bearing and witnessed by the discriminator goldens.
import { describe, it, expect } from "vitest";
import { hash2, pointillizeRadiusSq, pointillizeSeed, pointillize2D, POINTILLIZE_MAX } from "./pointillize";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();
const unique = (h: number, w: number) => grid(h, w, (x, y) => y * w + x);
const rows = (w: number, s: string): number[][] => {
  const v = s.trim().split(/\s+/).map(Number);
  return Array.from({ length: v.length / w }, (_, y) => v.slice(y * w, y * w + w));
};
const BG16 = 250 * 257; // 64250

describe("hash2 / pointillizeRadiusSq / pointillizeSeed", () => {
  it("hash2 is the deterministic Voronoi mix (shared layout with Crystallize)", () => {
    expect(hash2(3, 7)).toBe(2872573864);
    expect(hash2(-1, 0)).not.toBe(hash2(0, 0)); // negative-coord u32 wrap
  });
  it("dot radius² is (cell/2)²", () => {
    expect(pointillizeRadiusSq(4)).toBe(4);
    expect(pointillizeRadiusSq(5)).toBe(6.25);
    expect(pointillizeRadiusSq(2)).toBe(1);
  });
  it("the seed search returns an in-bounds sample and a finite squared distance", () => {
    for (let y = 0; y < 10; y++) for (let x = 0; x < 14; x++) {
      const [sx, sy, best] = pointillizeSeed(x, y, 4, 14, 10);
      expect(sx >= 0 && sx < 14 && sy >= 0 && sy < 10).toBe(true);
      expect(Number.isFinite(best)).toBe(true);
    }
  });
});

describe("pointillize2D", () => {
  const u = unique(16, 16);

  it("emits only sampled source values or the background colour", () => {
    const allowed = new Set([...flat(u), BG16]);
    for (const v of flat(pointillize2D(u, 5, 250))) expect(allowed.has(v)).toBe(true);
  });

  it("on a flat field, dots show the colour and the gaps show the background (both occur)", () => {
    const out = pointillize2D(grid(20, 20, () => 1000), 5, 250);
    const vals = new Set(flat(out));
    expect([...vals].every((v) => v === 1000 || v === BG16)).toBe(true);
    expect(vals.has(1000)).toBe(true); // dots
    expect(vals.has(BG16)).toBe(true); // gaps
  });

  it("paints the gaps in the chosen background colour (bg·257)", () => {
    expect(new Set(flat(pointillize2D(grid(20, 20, () => 65535), 5, 100))).has(100 * 257)).toBe(true);
  });

  it("coerces cell_size to i32 and clamps to ≥ 2 (matching the engine cell_size.max(2))", () => {
    const cs2 = pointillize2D(u, 2, 250);
    expect(pointillize2D(u, 1, 250)).toEqual(cs2); // <2 → 2
    expect(pointillize2D(u, 0, 250)).toEqual(cs2); // 0 → 2
    expect(pointillize2D(u, -3, 250)).toEqual(cs2); // negative → 2
    expect(pointillize2D(u, 5.9, 250)).toEqual(pointillize2D(u, 5, 250)); // i32 truncation 5.9 → 5
    expect(pointillize2D(u, NaN, 250)).toEqual(cs2); // NaN | 0 = 0 → 2
    expect(pointillize2D(u, 5, 250)).not.toEqual(cs2); // cell 5 ≠ cell 2: size matters
  });

  it("handles empty / 1×1 images, is deterministic and does not mutate the input", () => {
    expect(pointillize2D([], 4)).toEqual([]);
    expect(pointillize2D([[], []], 4)).toEqual([[], []]);
    const lone = pointillize2D([[42]], 4, 255)[0][0]; // a lone pixel is its own sample or the gap
    expect(lone === 42 || lone === POINTILLIZE_MAX).toBe(true);
    const snapshot = u.map((r) => [...r]);
    const out = pointillize2D(u, 5, 250);
    expect(u).toEqual(snapshot);
    expect(pointillize2D(u, 5, 250)).toEqual(out);
  });

  it("is shape-preserving on a non-square image", () => {
    const out = pointillize2D(unique(7, 11), 4, 250);
    expect(out.length).toBe(7);
    expect(out.every((r) => r.length === 11)).toBe(true);
  });
});

// ── Cross-implementation goldens from the Rust engine's `pointillize` over a positionally-unique
//    field (v = y·w + x) with background 250 (·257 = 64250) / 200 (51400). Each value names the
//    sampled seed (a dot) or the background (a gap), so they pin the seed selection AND the dot test.
//    Bit-exact (integer hash + selection + copy/fill). ──
describe("engine golden (pointillize)", () => {
  it("matches the engine bit-exactly — 14×10, cell 4, bg 250", () => {
    expect(pointillize2D(unique(10, 14), 4, 250)).toEqual(
      rows(14, "0 0 2 18 18 18 7 7 23 23 9 64250 64250 64250 0 0 2 18 18 18 7 7 23 23 23 64250 64250 64250 0 64250 64250 18 18 18 64250 23 23 23 23 64250 64250 69 64250 64250 64250 64250 61 61 61 64250 64250 64250 64250 64250 69 69 64250 64250 73 73 61 61 61 64250 79 79 79 83 83 69 64250 64250 73 73 61 61 61 79 79 79 79 83 83 83 64250 64250 73 73 73 61 61 64250 79 79 79 64250 83 83 112 64250 64250 73 73 64250 64250 120 120 120 64250 64250 64250 64250 112 64250 129 129 130 130 64250 120 120 120 120 64250 64250 64250 64250 64250 129 129 130 130 130 120 120 120 120 64250 64250 64250"),
    );
  });
  it("matches the engine bit-exactly — 16×16, cell 5, bg 250", () => {
    expect(pointillize2D(unique(16, 16), 5, 250)).toEqual(
      rows(16, "0 0 3 3 21 21 21 8 8 8 27 27 27 11 64250 64250 0 0 3 21 21 21 21 21 8 8 27 27 27 27 64250 64250 0 0 64250 21 21 21 21 21 64250 27 27 27 27 27 64250 64250 64250 64250 64250 64250 64250 21 64250 64250 64250 64250 27 27 27 64250 64250 95 64250 64250 64250 64250 64250 102 102 102 64250 64250 64250 64250 64250 64250 64250 95 64250 64250 116 116 116 102 102 102 102 64250 123 123 123 123 111 111 64250 64250 116 116 116 102 102 102 102 123 123 123 123 123 111 111 64250 64250 116 116 116 116 102 102 102 123 123 123 123 123 111 111 144 64250 116 116 116 116 102 64250 64250 64250 123 123 123 123 64250 64250 144 64250 64250 64250 180 181 181 64250 64250 170 170 170 170 64250 64250 64250 144 64250 64250 180 180 181 181 181 170 170 170 170 170 64250 64250 64250 144 64250 180 180 180 181 181 181 170 170 170 170 170 64250 64250 64250 64250 64250 180 180 180 181 181 181 64250 170 170 170 170 64250 64250 64250 240 64250 64250 180 180 181 181 181 64250 64250 64250 64250 64250 64250 64250 64250 240 240 64250 64250 64250 64250 64250 64250 64250 64250 64250 64250 64250 64250 64250 64250 240 240 64250 64250 64250 64250 64250 64250 64250 64250 64250 64250 64250 64250 64250 64250"),
    );
  });
  it("matches the engine bit-exactly — 6×6, cell 2 (minimum), bg 250", () => {
    expect(pointillize2D(unique(6, 6), 2, 250)).toEqual(
      rows(6, "0 1 2 3 4 5 0 64250 2 64250 4 4 64250 20 14 14 22 22 64250 20 20 14 22 22 24 32 32 64250 28 28 64250 32 32 64250 28 64250"),
    );
  });
  it("matches the engine bit-exactly — 13×9, cell 3, bg 200 (odd dims)", () => {
    expect(pointillize2D(unique(9, 13), 3, 200)).toEqual(
      rows(13, "0 2 2 3 5 5 19 19 51400 51400 51400 12 12 0 0 3 3 3 5 19 19 51400 51400 51400 51400 25 51400 51400 51400 43 43 51400 19 19 51400 49 49 49 51400 51400 51400 54 43 43 43 59 59 51400 49 49 49 51400 51400 54 54 54 43 51400 59 59 59 49 49 51400 51400 78 51400 54 54 51400 51400 84 59 51400 51400 51400 51400 51400 78 51400 94 94 94 84 84 84 51400 51400 51400 51400 51400 51400 51400 94 94 94 84 84 84 51400 51400 51400 51400 51400 104 51400 94 94 51400 51400 51400 51400 51400 51400 51400 115 115"),
    );
  });
});

// ── f32-vs-f64 discriminators (all captured from the real engine via an R=x,G=y read-back, since the
//    sampled indices overflow u16). The structural goldens above truncate identically under f32 and
//    f64; these pixels do not. TWO f32 decisions are observably load-bearing in Pointillize:
//
//    1. The `best ≤ r2` dot boundary — a fround-free mirror computes a slightly different `best` and
//       lands on the other side of r2. Both directions are pinned (f32-inside/f64-gap AND f32-gap/
//       f64-inside), so a wholesale f64 mirror flips a dot to a gap or vice versa.
//    2. The seed-POSITION rounding — even when the nearest seed is unambiguous, its continuous x can
//       sit at ~k.5 and round to a different integer in f32 vs f64, sampling a different in-dot pixel.
//       (Seed-CHOICE flips, where two seeds are near-equidistant, stay hidden inside dots; the
//       observable seed-frounds here are the round, not the choice.) ──
describe("engine f32-vs-f64 discriminators (pointillize)", () => {
  it("dot boundary, forward — f32 is inside the dot (samples the seed) where f64 is a gap", () => {
    // 200×150 cell 5 (15,137): best=6.24999857 ≤ r2=6.25 in f32 ⇒ samples 27213; f64 best>r2 ⇒ bg 64250.
    expect(pointillize2D(unique(150, 200), 5, 250)[137][15]).toBe(27213);
  });
  it("dot boundary, reverse — f32 is a gap where f64 would be inside (and wrongly sample a seed)", () => {
    // 400×400 cell 9 (295,294): f32 best=20.25010 > r2=20.25 ⇒ bg 64250; a pure-f64 mirror best≤r2 ⇒ 118699.
    expect(pointillize2D(unique(400, 400), 9, 250)[294][295]).toBe(64250);
  });
  it("seed-position rounding — an unambiguous seed's x rounds differently in f32, sampling a different in-dot pixel", () => {
    // 512×384 cell 3 (505,346): both samples are inside the dot (best=1.86442≤r2=2.25); the nearest
    // seed's px≈505.5 rounds to 506 in f32 (engine) vs 505 in f64 ⇒ 178170 here, 178169 in pure f64.
    expect(pointillize2D(unique(384, 512), 3, 250)[346][505]).toBe(178170);
  });
});
