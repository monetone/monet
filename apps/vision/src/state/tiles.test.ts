// Unit tests for the Tiles filter. Engine-free (node), single grey-channel model (exact for grey
// R=G=B input). Tiles breaks the image into an nt×nt grid and shifts each tile by a hashed offset
// onto a canvas (fill 0 bg · 1 fg · 2 inverse · 3 unaltered); every output pixel is a canvas value
// or a COPY of a source pixel, so it is exact. These pin hash2, the offset (round of an f32 chain),
// the per-tile placement/clamp, and the four fill modes (must match filters.rs tiles), plus cross-
// implementation goldens from the Rust engine over a positionally-unique field (so the tile copies
// are located exactly). The copies/fills are bit-exact; the f32 OFFSET frounds are load-bearing and
// witnessed by `tileOffset(0,5,…)` and the `engine f32-vs-f64 discriminator` golden below.
import { describe, it, expect } from "vitest";
import { hash2, tileOffset, tiles2D, TILES_MAX } from "./tiles";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();
const unique = (h: number, w: number) => grid(h, w, (x, y) => y * w + x);
const rows = (w: number, s: string): number[][] => {
  const v = s.trim().split(/\s+/).map(Number);
  return Array.from({ length: v.length / w }, (_, y) => v.slice(y * w, y * w + w));
};
const fr = Math.fround;

describe("hash2", () => {
  it("is a deterministic u32 mix (concrete pin)", () => {
    expect(hash2(3, 7)).toBe(2872573864);
    expect(hash2(-1, 0)).toBe(1404390209); // u32 wrap of a negative coordinate
  });
});

describe("tileOffset", () => {
  it("scales the centred hash fraction by tile size and maxOffset, then rounds", () => {
    expect(tileOffset(65535, 5, fr(0.9))).toBe(5); // frac→1 ⇒ +tw·mo
    expect(tileOffset(32768, 8, fr(0.5))).toBe(0); // frac→½ ⇒ centred ≈ 0
    expect(tileOffset(0, 10, fr(1))).toBe(-10); // frac 0 ⇒ centred −1 ⇒ −tw·mo
  });
  it("rounds the f32 product, not an f64 one (offset frounds are load-bearing)", () => {
    // (0/65535·2−1)·5·f32(0.9): the f32 product rounds to −4.5 → −5 (engine), but a mirror that drops
    // the inner frounds gets −4.4999998… → −4. (A *fully* plain-double mirror happens to also get −5
    // here, so the stronger engine-verified witness below is needed to pin the whole chain.)
    expect(tileOffset(0, 5, fr(0.9))).toBe(-5);
    // −15 in f32/engine, but −14 in BOTH a fround-free-inner mirror AND a fully-plain-double mirror.
    expect(tileOffset(0, 25, fr(0.58))).toBe(-15);
  });
});

describe("tiles2D", () => {
  const img = unique(12, 12);

  it("is the identity at maxOffset 0 or NaN (no shift ⇒ every tile copies onto itself)", () => {
    for (const fm of [0, 1, 2, 3]) expect(tiles2D(img, 3, 0, fm, 200, 210)).toEqual(img);
    // Rust `NaN as i32 == 0`, so a NaN maxOffset is also a no-op (the engine emits the unaltered image).
    expect(tiles2D(img, 3, NaN, 0, 200, 210)).toEqual(img);
  });

  it("coerces numTiles like the engine's u32→i32 and fillMode like u8", () => {
    expect(tiles2D(img, 0, 0.3, 0, 200, 210)).toEqual(tiles2D(img, 1, 0.3, 0, 200, 210)); // 0 → 1
    // a negative count is ToUint32 then `as i32` → negative nt → zero tiles → the pure canvas fill
    expect(tiles2D(img, -5, 0.3, 0, 200, 210)).toEqual(grid(12, 12, () => 210 * 257));
    expect(tiles2D(img, 3, 0.3, 5, 200, 210)).toEqual(tiles2D(img, 3, 0.3, 0, 200, 210)); // fm 5 → bg
    expect(tiles2D(img, 3, 0.3, 2.5, 200, 210)).toEqual(tiles2D(img, 3, 0.3, 2, 200, 210)); // u8: 2.5 → 2 (inverse)
    expect(tiles2D(img, 3, 0.3, -1, 200, 210)).toEqual(tiles2D(img, 3, 0.3, 0, 200, 210)); // u8: −1 → 255 → bg
  });

  it("emits only source values or the chosen fill (bg canvas + copied tiles)", () => {
    const allowed = new Set([...flat(img), 210 * 257]); // src values ∪ bg16
    for (const v of flat(tiles2D(img, 3, 0.3, 0, 200, 210))) expect(allowed.has(v)).toBe(true);
  });

  it("handles empty / 1×1 images, is deterministic and does not mutate the input", () => {
    expect(tiles2D([], 3, 0.3, 0)).toEqual([]);
    expect(tiles2D([[], []], 3, 0.3, 0)).toEqual([[], []]);
    expect(tiles2D([[42]], 3, 0.3, 3)).toEqual([[42]]); // lone pixel: its tile copies onto itself
    const snapshot = img.map((r) => [...r]);
    const out = tiles2D(img, 4, 0.5, 2, 200, 210);
    expect(img).toEqual(snapshot);
    expect(tiles2D(img, 4, 0.5, 2, 200, 210)).toEqual(out);
  });

  it("is shape-preserving on a non-square image", () => {
    const out = tiles2D(unique(5, 9), 3, 0.3, 0, 200, 210);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 9)).toBe(true);
    for (const v of flat(out)) expect(v).toBeLessThanOrEqual(TILES_MAX);
  });
});

// ── Cross-implementation goldens from the Rust engine's `tiles` over a positionally-unique field
//    (v = y·w + x), fg=200 (51400) / bg=210 (53970). The 12×12 nt3 mo0.3 set covers all four fill
//    modes; nt4/odd cover overlapping tiles and uneven division. These pin the structure/hash/copy/
//    fill bit-exactly (but not the offset frounds — they truncate the same in f32/f64). ──
describe("engine golden (tiles)", () => {
  const img = unique(12, 12);
  it("matches the engine bit-exactly — fill 0 background", () => {
    expect(tiles2D(img, 3, 0.3, 0, 200, 210)).toEqual(
      rows(12, "13 14 15 16 17 18 19 20 21 22 23 53970 25 26 27 28 29 30 31 32 33 34 35 53970 37 38 39 40 41 42 43 44 45 46 47 53970 53970 53970 53970 52 53 54 55 53970 53970 53970 53970 53970 53970 48 49 64 65 66 67 56 57 58 59 53970 53970 60 61 76 77 78 79 68 69 70 71 53970 53970 72 73 88 89 90 91 80 81 82 83 53970 53970 96 97 100 101 102 103 104 105 106 107 53970 53970 108 109 112 113 114 115 116 117 118 119 53970 53970 120 121 124 125 126 127 128 129 130 131 53970 53970 132 133 136 137 138 139 140 141 142 143 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970"),
    );
  });
  it("matches the engine bit-exactly — fill 1 foreground", () => {
    expect(tiles2D(img, 3, 0.3, 1, 200, 210)).toEqual(
      rows(12, "13 14 15 16 17 18 19 20 21 22 23 51400 25 26 27 28 29 30 31 32 33 34 35 51400 37 38 39 40 41 42 43 44 45 46 47 51400 51400 51400 51400 52 53 54 55 51400 51400 51400 51400 51400 51400 48 49 64 65 66 67 56 57 58 59 51400 51400 60 61 76 77 78 79 68 69 70 71 51400 51400 72 73 88 89 90 91 80 81 82 83 51400 51400 96 97 100 101 102 103 104 105 106 107 51400 51400 108 109 112 113 114 115 116 117 118 119 51400 51400 120 121 124 125 126 127 128 129 130 131 51400 51400 132 133 136 137 138 139 140 141 142 143 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400 51400"),
    );
  });
  it("matches the engine bit-exactly — fill 2 inverse image", () => {
    expect(tiles2D(img, 3, 0.3, 2, 200, 210)).toEqual(
      rows(12, "13 14 15 16 17 18 19 20 21 22 23 65524 25 26 27 28 29 30 31 32 33 34 35 65512 37 38 39 40 41 42 43 44 45 46 47 65500 65499 65498 65497 52 53 54 55 65492 65491 65490 65489 65488 65487 48 49 64 65 66 67 56 57 58 59 65476 65475 60 61 76 77 78 79 68 69 70 71 65464 65463 72 73 88 89 90 91 80 81 82 83 65452 65451 96 97 100 101 102 103 104 105 106 107 65440 65439 108 109 112 113 114 115 116 117 118 119 65428 65427 120 121 124 125 126 127 128 129 130 131 65416 65415 132 133 136 137 138 139 140 141 142 143 65404 65403 65402 65401 65400 65399 65398 65397 65396 65395 65394 65393 65392"),
    );
  });
  it("matches the engine bit-exactly — fill 3 unaltered image", () => {
    expect(tiles2D(img, 3, 0.3, 3, 200, 210)).toEqual(
      rows(12, "13 14 15 16 17 18 19 20 21 22 23 11 25 26 27 28 29 30 31 32 33 34 35 23 37 38 39 40 41 42 43 44 45 46 47 35 36 37 38 52 53 54 55 43 44 45 46 47 48 48 49 64 65 66 67 56 57 58 59 59 60 60 61 76 77 78 79 68 69 70 71 71 72 72 73 88 89 90 91 80 81 82 83 83 84 96 97 100 101 102 103 104 105 106 107 95 96 108 109 112 113 114 115 116 117 118 119 107 108 120 121 124 125 126 127 128 129 130 131 119 120 132 133 136 137 138 139 140 141 142 143 131 132 133 134 135 136 137 138 139 140 141 142 143"),
    );
  });
  it("matches the engine bit-exactly — nt 4, mo 0.5 (overlapping tiles)", () => {
    expect(tiles2D(img, 4, 0.5, 0, 200, 210)).toEqual(
      rows(12, "26 53970 15 16 17 18 19 20 53970 53970 53970 53970 53970 53970 27 28 29 30 31 32 9 10 11 53970 53970 36 39 40 41 42 43 44 45 46 47 53970 53970 48 51 52 53 54 55 56 57 58 59 53970 53970 60 63 64 65 66 67 68 69 70 71 53970 53970 72 75 76 77 78 79 80 53970 53970 53970 53970 53970 84 87 88 89 90 91 92 53970 53970 53970 53970 53970 96 99 100 101 102 103 104 53970 53970 81 82 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 93 94 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 105 106 109 110 53970 111 112 114 115 116 117 118 119 53970 121 122 53970 123 124 126 127 128 129 130 131 53970"),
    );
  });
  it("matches the engine bit-exactly — 10×7, nt 3, mo 0.25 (uneven division)", () => {
    expect(tiles2D(unique(7, 10), 3, 0.25, 0, 200, 210)).toEqual(
      rows(10, "11 12 3 4 5 6 7 8 9 53970 53970 53970 13 14 15 16 17 18 19 53970 20 21 22 23 24 26 27 28 29 53970 30 31 32 33 34 46 47 48 49 53970 53970 40 43 44 45 56 57 58 59 53970 53970 50 53 54 55 66 67 68 69 53970 53970 60 63 64 65 53970 53970 53970 53970 53970"),
    );
  });
});

// ── f32-vs-f64 offset-round discriminator. The structural goldens above truncate the same in f32 and
//    f64, so they don't witness the offset frounds. Here tile (0,0)'s offset is −5 in f32/engine but
//    −4 in a fround-free mirror, shifting that whole tile by one pixel — captured from the real
//    engine (16×16, nt 3, mo 0.9, fill bg). ──
describe("engine f32-vs-f64 discriminator (tiles)", () => {
  it("matches the engine where the f32 offset rounds differently than f64 (16×16, nt 3, mo 0.9)", () => {
    expect(tiles2D(unique(16, 16), 3, 0.9, 0, 200, 210)).toEqual(
      rows(16, "53970 53 54 55 56 57 42 43 44 45 46 47 53970 53970 53970 53970 53970 69 70 71 72 73 58 59 60 61 62 63 53970 53970 53970 53970 53970 53970 85 86 87 88 89 75 76 77 78 79 53970 53970 53970 53970 53970 53970 101 102 103 104 105 90 91 92 93 94 95 53970 53970 53970 53970 53970 117 118 119 120 121 106 107 108 109 110 111 53970 53970 53970 53970 53970 133 134 135 170 171 172 173 174 175 126 127 53970 53970 53970 53970 53970 149 150 151 186 187 188 189 190 191 142 143 53970 53970 53970 53970 165 166 167 168 202 203 204 205 206 207 158 159 53970 53970 53970 53970 181 182 183 184 218 219 220 221 222 223 53970 53970 53970 53970 53970 53970 197 198 199 200 234 235 236 237 238 239 53970 53970 53970 53970 53970 53970 213 214 215 216 250 251 252 253 254 255 53970 53970 53970 53970 53970 53970 229 230 231 232 233 227 228 53970 53970 53970 53970 53970 53970 53970 53970 53970 245 246 247 248 249 243 244 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970 53970"),
    );
  });
});
