// Unit tests for the Stained Glass filter. Engine-free (node), single grey-channel model (exact for
// grey R=G=B input with a grey lead). Stained Glass is Crystallize's Voronoi (each pixel takes the
// colour at its nearest jittered-grid seed) plus LEAD seams (pixels within `border` of a different
// cell are drawn in the fg colour) and an optional central GLOW. These pin hash2, the cell/seed
// assignment, the lead test, the glow, and the cell/border clamps (must match filters.rs
// stained_glass), plus engine goldens over a positionally-unique field. The hash + cell/lead logic
// are bit-exact; the seed choice (as in Crystallize) and the `src·glow` value are f32-sensitive (the
// latter witnessed by the glow discriminator goldens).
import { describe, it, expect } from "vitest";
import { hash2, stainedGlassOwner, stainedGlass2D, STAINED_GLASS_MAX } from "./stainedGlass";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();
const unique = (h: number, w: number) => grid(h, w, (x, y) => y * w + x);
const rows = (w: number, s: string): number[][] => {
  const v = s.trim().split(/\s+/).map(Number);
  return Array.from({ length: v.length / w }, (_, y) => v.slice(y * w, y * w + w));
};
const FG200 = 200 * 257; // 51400

describe("hash2 / stainedGlassOwner", () => {
  it("shares the Voronoi hash with Crystallize (deterministic u32 pin)", () => {
    expect(hash2(3, 7)).toBe(2872573864);
    expect(hash2(-1, 0)).not.toBe(hash2(0, 0));
  });
  it("the owner search returns an in-bounds sample location", () => {
    for (let y = 0; y < 10; y++) for (let x = 0; x < 14; x++) {
      const [, , sx, sy] = stainedGlassOwner(x, y, 5, 14, 10);
      expect(sx >= 0 && sx < 14 && sy >= 0 && sy < 10).toBe(true);
    }
  });
});

describe("stainedGlass2D", () => {
  const u = unique(16, 16);

  it("with no glow, emits only sampled cell values or the lead colour", () => {
    const allowed = new Set([...flat(u), FG200]);
    for (const v of flat(stainedGlass2D(u, 5, 1, 0, 200))) expect(allowed.has(v)).toBe(true);
  });

  it("a wider border grows the lead seams", () => {
    const lead1 = flat(stainedGlass2D(u, 5, 1, 0, 200)).filter((v) => v === FG200).length;
    const lead2 = flat(stainedGlass2D(u, 5, 2, 0, 200)).filter((v) => v === FG200).length;
    expect(lead2).toBeGreaterThan(lead1);
  });

  it("a positive light brightens cells toward the centre (above their source value)", () => {
    const out = stainedGlass2D(grid(20, 20, () => 1000), 6, 1, 0.5, 200);
    expect(flat(out).some((v) => v > 1000 && v !== FG200)).toBe(true);
  });

  it("coerces cell to i32≥2 and border to i32≥1 (the engine max(2)/max(1))", () => {
    const base = stainedGlass2D(u, 2, 1, 0, 200);
    expect(stainedGlass2D(u, 1, 1, 0, 200)).toEqual(base); // <2 → 2
    expect(stainedGlass2D(u, 0, 1, 0, 200)).toEqual(base); // 0 → 2
    expect(stainedGlass2D(u, 5.9, 1, 0, 200)).toEqual(stainedGlass2D(u, 5, 1, 0, 200)); // i32 trunc
    expect(stainedGlass2D(u, 5, 0, 0, 200)).toEqual(stainedGlass2D(u, 5, 1, 0, 200)); // border <1 → 1
    expect(stainedGlass2D(u, 5, 1, 0, 200)).not.toEqual(stainedGlass2D(u, 8, 1, 0, 200)); // cell matters
  });

  it("handles empty / 1×1 images, is deterministic and does not mutate the input", () => {
    expect(stainedGlass2D([], 5, 1, 0)).toEqual([]);
    expect(stainedGlass2D([[], []], 5, 1, 0)).toEqual([[], []]);
    expect(stainedGlass2D([[42]], 5, 1, 0, 200)).toEqual([[42]]); // lone pixel: its own cell, no seam, no glow
    const snapshot = u.map((r) => [...r]);
    const out = stainedGlass2D(u, 5, 1, 0.3, 200);
    expect(u).toEqual(snapshot);
    expect(stainedGlass2D(u, 5, 1, 0.3, 200)).toEqual(out);
  });

  it("is shape-preserving on a non-square image", () => {
    const out = stainedGlass2D(unique(7, 11), 4, 1, 0, 200);
    expect(out.length).toBe(7);
    expect(out.every((r) => r.length === 11)).toBe(true);
    for (const v of flat(out)) expect(v).toBeLessThanOrEqual(STAINED_GLASS_MAX);
  });
});

// ── Cross-implementation goldens from the Rust engine's `stained_glass` over a positionally-unique
//    field (v = y·w + x), fg 200 (51400) / 240 (61680). Covers lead seams, a glow (light 0.5), a wide
//    border, and odd dims. The hash + cell + lead are bit-exact; with glow the cell value is f32-scaled. ──
describe("engine golden (stained_glass)", () => {
  it("matches the engine bit-exactly — 14×10, cell 5, border 1, no glow", () => {
    expect(stainedGlass2D(unique(10, 14), 5, 1, 0, 200)).toEqual(
      rows(14, "0 51400 51400 51400 51400 19 51400 51400 51400 51400 51400 25 51400 51400 0 51400 51400 51400 51400 19 51400 51400 51400 51400 51400 25 51400 51400 0 51400 51400 51400 19 19 51400 51400 51400 51400 51400 25 25 25 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 102 51400 51400 51400 90 90 51400 51400 51400 51400 109 109 51400 51400 102 102 51400 51400 51400 90 51400 51400 109 109 109 109 51400 51400 102 102 51400 51400 51400 90 51400 51400 109 109 109 109 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400"),
    );
  });
  it("matches the engine bit-exactly — 16×16, cell 5, border 1, light 0.5 (central glow)", () => {
    expect(stainedGlass2D(unique(16, 16), 5, 1, 0.5, 200)).toEqual(
      rows(16, "0 51400 51400 51400 51400 23 51400 51400 51400 51400 51400 30 51400 51400 51400 51400 0 51400 51400 51400 51400 24 51400 51400 51400 51400 51400 31 51400 51400 51400 51400 0 51400 51400 51400 24 25 51400 51400 51400 51400 51400 32 31 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 139 51400 51400 51400 136 138 51400 51400 51400 51400 157 51400 51400 51400 51400 51400 141 146 51400 51400 51400 142 51400 51400 169 164 160 51400 51400 130 51400 51400 142 147 51400 51400 51400 146 51400 51400 172 167 162 51400 51400 131 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 163 51400 51400 51400 51400 51400 248 51400 51400 238 233 227 51400 51400 51400 51400 51400 51400 51400 223 51400 51400 242 51400 51400 231 227 223 217 211 51400 51400 51400 51400 51400 219 51400 51400 235 51400 51400 51400 221 217 212 206 51400 51400 51400 51400 51400 51400 51400 51400 228 51400 51400 51400 214 211 206 51400 51400 51400 253 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 247 255 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400"),
    );
  });
  it("matches the engine bit-exactly — 12×12, cell 4, border 2 (wide lead), fg 240", () => {
    expect(stainedGlass2D(unique(12, 12), 4, 2, 0, 240)).toEqual(
      rows(12, "61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 61680 104 104 104 61680 61680 61680 61680 61680 61680 61680 61680 61680 104 104 104"),
    );
  });
  it("matches the engine bit-exactly — 13×9, cell 3, border 1 (odd dims)", () => {
    expect(stainedGlass2D(unique(9, 13), 3, 1, 0, 200)).toEqual(
      rows(13, "51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 84 84 51400 51400 51400 51400 115 51400 51400 51400 51400 51400 51400 84 84 51400 51400 115 115 115"),
    );
  });
});

// ── f32-vs-f64 glow discriminators. The structural goldens above truncate the cell·glow identically
//    in f32 and f64; these pixels do not — the radial glow's `src·glow` rounds to a different u16. A
//    pure-f64 mirror gets the other value. Captured from the real engine (positional field). ──
describe("engine f32-vs-f64 glow discriminator (stained_glass)", () => {
  it("a glow-scaled cell value truncates one way in f32 (engine), the other in f64 — 64×48", () => {
    expect(stainedGlass2D(unique(48, 64), 5, 1, 0.5, 200)[42][32]).toBe(3468); // f64 → 3467
  });
  it("…and the opposite direction — 120×90", () => {
    expect(stainedGlass2D(unique(90, 120), 5, 1, 0.5, 200)[21][53]).toBe(3431); // f64 → 3432
  });
  it("pins the maxd ≥ 1 clamp — a 1×1 with glow (sqrt(cx²+cy²)=0.707 < 1, so the clamp is load-bearing)", () => {
    // Without maxd.max(1) the glow at the lone pixel collapses to 1 (d/maxd = 1), giving 30000/1000;
    // the engine clamps maxd to 1 → glow 1.146… → 34393 / 1146 (engine-verified). 2×2+ never trips this.
    expect(stainedGlass2D([[30000]], 5, 1, 0.5, 200)).toEqual([[34393]]);
    expect(stainedGlass2D([[1000]], 5, 1, 0.5, 200)).toEqual([[1146]]);
    expect(stainedGlass2D([[30000]], 5, 1, 0, 200)).toEqual([[30000]]); // light 0 control: no glow
  });
  it("witnesses the cell-assignment frounds — a light=0 lead seam that flips under f64 (204×320)", () => {
    // The lead pattern is decided by the f32 `d < best` nearest-seed comparison. At (16,285) the f32
    // owner makes this a LEAD pixel (fg16=51400); a pure-f64 mirror reassigns the cell so it becomes a
    // non-lead sampled value (58364). 51400 is engine-verified — the only assertion guarding the
    // seed/distance frounds (the structural goldens above are blind, the glow ones hit non-lead pixels).
    expect(stainedGlass2D(unique(320, 204), 8, 1, 0, 200)[285][16]).toBe(51400);
  });
});
