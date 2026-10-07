// Unit tests for the Extrude filter. Engine-free (node), single grey-channel model (exact for grey
// R=G=B input). Extrude tiles the image into blocks, floods each with its integer average, and keeps
// an inset "top face" bright while darkening the surrounding "sides" (×0.45). Block height comes from
// brightness (Rec.601 luma) or a seeded per-block hash. These pin the hash, the integer average, the
// luma, the inset round, and the top/side split (must match filters.rs extrude), plus engine goldens.
// The average/hash/side are bit-exact; the brightness-mode luma→inset frounds are load-bearing and
// witnessed by the `engine f32-vs-f64 inset discriminator` goldens (the ×0.45 side fround is faithful
// but absorbed by the truncation — no avg in 0..65535 makes it flip).
import { describe, it, expect } from "vitest";
import { extrudeHash, extrudeLuma, extrudeInset, extrude2D, EXTRUDE_MAX } from "./extrude";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();
const uniform = (h: number, w: number, v: number) => grid(h, w, () => v);
const rows = (w: number, s: string): number[][] => {
  const v = s.trim().split(/\s+/).map(Number);
  return Array.from({ length: v.length / w }, (_, y) => v.slice(y * w, y * w + w));
};

describe("extrudeHash / extrudeLuma / extrudeInset", () => {
  it("hash is deterministic, in [0,1), and seed-sensitive (concrete engine-faithful pins)", () => {
    expect(extrudeHash(0, 0, 0)).toBe(0); // degenerate: all-zero input mixes to 0
    expect(extrudeHash(1, 2, 12345)).toBe(0.502593994140625); // non-trivial exact pins (a wrong
    expect(extrudeHash(3, 5, 777)).toBe(0.9470062255859375); // constant/shift/seed-XOR breaks these
    expect(extrudeHash(7, 2, 0)).toBe(0.4473114013671875);
    expect(extrudeHash(1, 2, 12345)).not.toBe(extrudeHash(1, 2, 54321)); // seed matters
    for (let a = 0; a < 40; a++) for (let b = 0; b < 40; b++) {
      const v = extrudeHash(a, b, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it("luma of a grey average is ≈ avg/65535 (exact f32 pins — a weight/order change would flip these)", () => {
    expect(extrudeLuma(32768)).toBeCloseTo(0.5, 4);
    expect(extrudeLuma(32768)).toBe(0.50000762939453125); // exact f32 chain, not just ≈0.5
    expect(extrudeLuma(61166)).toBe(0.9333333373069763);
    expect(extrudeLuma(0)).toBe(0);
  });
  it("inset rounds the f32 product, not an f64 one (luma→inset frounds are load-bearing)", () => {
    // depth 0.9375 · luma(61166) · (8/2): the f32 chain rounds to 4, but a pure-f64 mirror gets 3.
    expect(extrudeInset(0.9375, extrudeLuma(61166), 8)).toBe(4);
    expect(extrudeInset(0, extrudeLuma(50000), 8)).toBe(0); // depth 0 ⇒ no inset
  });
});

describe("extrude2D", () => {
  const img = grid(12, 12, (x, y) => (x * 9973 + y * 9931) % EXTRUDE_MAX);

  it("at depth 0 every block is flat at its own average (a pixelate/mosaic, no relief)", () => {
    const out = extrude2D(img, 4, 0, true, 0);
    const cellAvg = (bx: number, by: number) => {
      let s = 0, c = 0;
      for (let y = by; y < Math.min(by + 4, 12); y++) for (let x = bx; x < Math.min(bx + 4, 12); x++) { s += img[y][x]; c++; }
      return Math.floor(s / c);
    };
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
      expect(out[y][x]).toBe(cellAvg(Math.floor(x / 4) * 4, Math.floor(y / 4) * 4));
    }
  });

  it("clamps size to ≥ 2 and depth to [0,1]", () => {
    expect(extrude2D(img, 1, 0.6, true, 0)).toEqual(extrude2D(img, 2, 0.6, true, 0));
    expect(extrude2D(img, 0, 0.6, true, 0)).toEqual(extrude2D(img, 2, 0.6, true, 0));
    expect(extrude2D(img, 4, 1.5, true, 0)).toEqual(extrude2D(img, 4, 1, true, 0));
    expect(extrude2D(img, 4, -1, true, 0)).toEqual(extrude2D(img, 4, 0, true, 0));
    // a NaN depth gives inset 0 (Rust `f32 NaN as i32 == 0`), i.e. the flat depth-0 mosaic — engine-verified.
    expect(extrude2D(img, 4, NaN, true, 0)).toEqual(extrude2D(img, 4, 0, true, 0));
  });

  it("ignores the seed in brightness mode but uses it in hash mode", () => {
    expect(extrude2D(img, 4, 0.6, true, 0)).toEqual(extrude2D(img, 4, 0.6, true, 99999)); // luma ⇒ seed unused
    expect(extrude2D(img, 4, 0.6, false, 1)).not.toEqual(extrude2D(img, 4, 0.6, false, 2)); // hash ⇒ seed used
    expect(extrude2D(img, 4, 0.6, true, 7)).not.toEqual(extrude2D(img, 4, 0.6, false, 7)); // modes differ
  });

  it("keeps every output an integer in [0, 65535]", () => {
    for (const byb of [true, false]) for (const v of flat(extrude2D(img, 5, 0.8, byb, 3))) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(EXTRUDE_MAX);
    }
  });

  it("handles empty / 1×1 images, is deterministic and does not mutate the input", () => {
    expect(extrude2D([], 4, 0.6, true)).toEqual([]);
    expect(extrude2D([[], []], 4, 0.6, true)).toEqual([[], []]);
    expect(extrude2D([[40000]], 4, 0.6, true, 0)).toEqual([[18000]]); // lone clipped block: a darkened side
    const snapshot = img.map((r) => [...r]);
    const out = extrude2D(img, 4, 0.6, false, 5);
    expect(img).toEqual(snapshot);
    expect(extrude2D(img, 4, 0.6, false, 5)).toEqual(out);
  });

  it("is shape-preserving on a non-square image", () => {
    const out = extrude2D(grid(7, 11, (x, y) => (x * 31 + y * 17) % EXTRUDE_MAX), 4, 0.5, false, 3);
    expect(out.length).toBe(7);
    expect(out.every((r) => r.length === 11)).toBe(true);
  });
});

// ── Cross-implementation goldens from the Rust engine's `extrude` over a grey field
//    v=(x·9973+y·9931)%65535. Covers brightness mode, hash mode (seed 12345), max depth (large
//    insets), and odd dims/edge blocks. The integer average + hash + side are bit-exact. ──
describe("engine golden (extrude)", () => {
  const img = grid(12, 12, (x, y) => (x * 9973 + y * 9931) % EXTRUDE_MAX);
  it("matches the engine bit-exactly — brightness mode, size 4 depth 0.6", () => {
    expect(extrude2D(img, 4, 0.6, true, 0)).toEqual(
      rows(12, "13435 13435 13435 13435 12954 12954 12954 12954 18004 18004 18004 18004 13435 29856 29856 13435 12954 28788 28788 12954 18004 40009 40009 18004 13435 29856 29856 13435 12954 28788 28788 12954 18004 40009 40009 18004 13435 13435 13435 13435 12954 12954 12954 12954 18004 18004 18004 18004 12879 12879 12879 12879 17928 17928 17928 17928 13761 13761 13761 13761 12879 28620 28620 12879 17928 39841 39841 17928 13761 30581 30581 13761 12879 28620 28620 12879 17928 39841 39841 17928 13761 30581 30581 13761 12879 12879 12879 12879 17928 17928 17928 17928 13761 13761 13761 13761 17852 17852 17852 17852 13685 13685 13685 13685 15048 15048 15048 15048 17852 39673 39673 17852 13685 30413 30413 13685 15048 33442 33442 15048 17852 39673 39673 17852 13685 30413 30413 13685 15048 33442 33442 15048 17852 17852 17852 17852 13685 13685 13685 13685 15048 15048 15048 15048"),
    );
  });
  it("matches the engine bit-exactly — hash mode, size 4 depth 0.6 seed 12345", () => {
    expect(extrude2D(img, 4, 0.6, false, 12345)).toEqual(
      rows(12, "13435 13435 13435 13435 28788 28788 28788 28788 18004 18004 18004 18004 13435 29856 29856 13435 28788 28788 28788 28788 18004 40009 40009 18004 13435 29856 29856 13435 28788 28788 28788 28788 18004 40009 40009 18004 13435 13435 13435 13435 28788 28788 28788 28788 18004 18004 18004 18004 28620 28620 28620 28620 17928 17928 17928 17928 30581 30581 30581 30581 28620 28620 28620 28620 17928 39841 39841 17928 30581 30581 30581 30581 28620 28620 28620 28620 17928 39841 39841 17928 30581 30581 30581 30581 28620 28620 28620 28620 17928 17928 17928 17928 30581 30581 30581 30581 17852 17852 17852 17852 13685 13685 13685 13685 33442 33442 33442 33442 17852 39673 39673 17852 13685 30413 30413 13685 33442 33442 33442 33442 17852 39673 39673 17852 13685 30413 30413 13685 33442 33442 33442 33442 17852 17852 17852 17852 13685 13685 13685 13685 33442 33442 33442 33442"),
    );
  });
  it("matches the engine bit-exactly — max depth 1.0, size 3 (large insets)", () => {
    const g = grid(10, 10, (x, y) => (x * 9973 + y * 9931) % EXTRUDE_MAX);
    expect(extrude2D(g, 3, 1.0, true, 0)).toEqual(
      rows(10, "19904 19904 19904 19143 19143 19143 21488 21488 21488 15368 19904 19904 19904 19143 42541 19143 21488 21488 21488 15368 19904 19904 19904 19143 19143 19143 21488 21488 21488 15368 19086 19086 19086 21362 21362 21362 19800 19800 19800 18945 19086 42415 19086 21362 21362 21362 19800 44000 19800 18945 19086 19086 19086 21362 21362 21362 19800 19800 19800 18945 21236 21236 21236 19743 19743 19743 13546 13546 13546 12691 21236 21236 21236 19743 43874 19743 13546 30103 13546 12691 21236 21236 21236 19743 19743 19743 13546 13546 13546 12691 15217 15217 15217 18850 18850 18850 12654 12654 12654 21629"),
    );
  });
  it("matches the engine bit-exactly — odd dims 13×9, size 5 depth 0.4 hash seed 999", () => {
    const g = grid(9, 13, (x, y) => (x * 9973 + y * 9931) % EXTRUDE_MAX);
    expect(extrude2D(g, 5, 0.4, false, 999)).toEqual(
      rows(13, "14374 14374 14374 14374 14374 32002 32002 32002 32002 32002 37816 37816 37816 14374 31943 31943 31943 14374 32002 32002 32002 32002 32002 37816 37816 37816 14374 31943 31943 31943 14374 32002 32002 32002 32002 32002 37816 37816 37816 14374 31943 31943 31943 14374 32002 32002 32002 32002 32002 37816 37816 37816 14374 14374 14374 14374 14374 32002 32002 32002 32002 32002 37816 37816 37816 28792 28792 28792 28792 28792 36060 36060 36060 36060 36060 16975 16975 16975 28792 28792 28792 28792 28792 36060 36060 36060 36060 36060 16975 37723 16975 28792 28792 28792 28792 28792 36060 36060 36060 36060 36060 16975 37723 16975 28792 28792 28792 28792 28792 36060 36060 36060 36060 36060 16975 16975 16975"),
    );
  });
});

// ── f32-vs-f64 inset-round discriminators (brightness mode, uniform blocks so avg == fill). The
//    structural goldens above don't witness the luma→inset frounds; these do: a pure-f64 mirror
//    rounds the inset to a smaller integer, enlarging the top face. Captured from the real engine. ──
describe("engine f32-vs-f64 inset discriminator (extrude)", () => {
  it("8×8 fill 61166, depth 0.9375: f32 inset 4 (all side) — f64 would inset 3 (a 2×2 top)", () => {
    expect(extrude2D(uniform(8, 8, 61166), 8, 0.9375, true, 0)).toEqual(uniform(8, 8, 27524));
  });
  it("14×14 fill 44464, depth 0.9475: f32 inset 5 (4×4 top) — f64 would inset 4 (6×6 top)", () => {
    const top = 44464, side = 20008; // side = trunc(44464·0.45)
    expect(extrude2D(uniform(14, 14, 44464), 14, 0.9475, true, 0)).toEqual(
      grid(14, 14, (x, y) => (x >= 5 && x < 9 && y >= 5 && y < 9 ? top : side)),
    );
  });
});
