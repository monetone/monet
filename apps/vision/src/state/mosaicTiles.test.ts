// Unit tests for the Mosaic Tiles filter. Engine-free (node), single grey-channel model (exact for
// grey R=G=B input). These pin the tile/grout geometry (clamps + the integer modulo grout mask),
// the grout wash toward the target colour by strength 0.85, the grout≤0 no-op, and the truncating
// output (must match filters.rs mosaic_tiles), plus cross-implementation goldens from the Rust engine.
import { describe, it, expect } from "vitest";
import { mosaicTilesGeometry, isGrout, mosaicTiles2D, MOSAIC_TILES_MAX } from "./mosaicTiles";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("mosaicTilesGeometry", () => {
  it("tile = max(tile_size,2); grout = clamp(grout_width, 0, tile−1)", () => {
    expect(mosaicTilesGeometry(5, 1)).toEqual({ tile: 5, grout: 1 });
    expect(mosaicTilesGeometry(4, 2)).toEqual({ tile: 4, grout: 2 });
    expect(mosaicTilesGeometry(1, 3)).toEqual({ tile: 2, grout: 1 }); // tile clamped up; grout clamped to tile−1
    expect(mosaicTilesGeometry(5, -1)).toEqual({ tile: 5, grout: 0 }); // grout floored at 0
    expect(mosaicTilesGeometry(5, 10)).toEqual({ tile: 5, grout: 4 }); // grout capped at tile−1
  });
});

describe("isGrout", () => {
  it("flags the first `grout` px of each `tile` cell on either axis", () => {
    // tile 5, grout 1 ⇒ x∈{0,5,10,…} or y∈{0,5,10,…} are grout lines.
    expect(isGrout(0, 3, 5, 1)).toBe(true); // x on a line
    expect(isGrout(3, 5, 5, 1)).toBe(true); // y on a line
    expect(isGrout(0, 0, 5, 1)).toBe(true); // corner
    expect(isGrout(1, 1, 5, 1)).toBe(false); // interior
    expect(isGrout(2, 3, 5, 1)).toBe(false); // interior
    expect(isGrout(6, 7, 5, 1)).toBe(false); // 6%5=1, 7%5=2 → interior of the next tile
  });
});

describe("mosaicTiles2D", () => {
  const g = grid(12, 12, (x, y) => (x * 9973 + y * 9931) % MOSAIC_TILES_MAX);

  it("is a no-op when there is no grout (grout_width ≤ 0)", () => {
    expect(mosaicTiles2D(g, 5, 0, 0.9)).toEqual(g);
    expect(mosaicTiles2D(g, 5, -3, 0.9)).toEqual(g);
  });

  it("washes grout pixels toward the target and leaves tile interiors untouched", () => {
    const out = mosaicTiles2D(g, 5, 1, 0.9);
    expect(out[1][1]).toBe(g[1][1]); // interior pixel unchanged (19904)
    expect(out[0][0]).toBe(50134); // grout: 0 + (0.9·65535 − 0)·0.85 = 50134.27 → 50134
    expect(out[0][0]).not.toBe(g[0][0]); // grout actually changed
  });

  it("respects the grout colour: lighten 0 darkens the grout toward black, lighten 1 toward white", () => {
    expect(mosaicTiles2D(g, 5, 1, 1)[0][0]).toBe(55704); // 0 + (65535)·0.85 = 55704.75 → trunc 55704
    expect(mosaicTiles2D(grid(6, 6, () => 60000), 5, 1, 0)[0][0]).toBe(9000); // 60000 + (0−60000)·0.85
  });

  it("pins the per-op f32 rounding — a fractional lighten where an f64 wash truncates differently", () => {
    // g[0][0]=0 is grout. lighten 0.884 ⇒ target = fround(0.884·65535) ≠ the f64 0.884·65535, so the
    // engine's f32 wash truncates to 49243 while a no-fround f64 mirror gives 49242. Captured from the engine.
    expect(mosaicTiles2D(g, 5, 1, 0.884)[0][0]).toBe(49243);
  });

  it("keeps every output an integer within [0, 65535]", () => {
    for (const [ts, gw, lg] of [
      [5, 1, 0.9],
      [4, 2, 0.2],
      [3, 1, 0.5],
    ]) {
      for (const v of flat(mosaicTiles2D(g, ts, gw, lg))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(MOSAIC_TILES_MAX);
      }
    }
  });

  it("handles empty / 1×1 images, is deterministic and does not mutate the input", () => {
    expect(mosaicTiles2D([], 5, 1, 0.9)).toEqual([]);
    expect(mosaicTiles2D([[], []], 5, 1, 0.9)).toEqual([[], []]);
    expect(mosaicTiles2D([[40000]], 5, 1, 0.9)).toEqual([[56134]]); // (0,0) is grout: 40000+(58981.5−40000)·0.85
    const snapshot = g.map((r) => [...r]);
    const out = mosaicTiles2D(g, 4, 2, 0.2);
    expect(g).toEqual(snapshot);
    expect(mosaicTiles2D(g, 4, 2, 0.2)).toEqual(out);
  });

  it("is shape-preserving on a non-square image", () => {
    const ng = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = mosaicTiles2D(ng, 4, 1, 0.6);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 13)).toBe(true);
  });
});

// ── Cross-implementation goldens: exact u16 output captured from the Rust engine's mosaic_tiles on
//    a 12×12 grey pattern v = (x·9973 + y·9931) mod 65535 (multiple tile cells, coords reach 11).
//    Fully bit-exact (integer grout mask + a single lerp; no trig/sqrt). ──
describe("engine golden (mosaic_tiles, 12×12 grey)", () => {
  const g = grid(12, 12, (x, y) => (x * 9973 + y * 9931) % MOSAIC_TILES_MAX);
  const rows = (vals: number[]): number[][] => Array.from({ length: 12 }, (_, y) => vals.slice(y * 12, y * 12 + 12));

  it("matches the engine bit-exactly — tile 5, grout 1, lighten 0.9", () => {
    expect(mosaicTiles2D(g, 5, 1, 0.9)).toEqual(
      rows([
        50134, 51630, 53126, 54622, 56118, 57614, 59109, 50775, 52271, 53767, 55263, 56759, 51623, 19904, 29877, 39850,
        49823, 59103, 4234, 14207, 24180, 34153, 56753, 54099, 53113, 29835, 39808, 49781, 59754, 50763, 14165, 24138,
        34111, 44084, 58242, 64030, 54603, 39766, 49739, 59712, 4150, 52252, 24096, 34069, 44042, 54015, 59732, 8426,
        56092, 49697, 59670, 4108, 14081, 53742, 34027, 44000, 53973, 63946, 51391, 18357, 57582, 59078, 50744, 52240,
        53736, 55232, 56727, 58223, 59719, 51385, 52881, 54377, 59072, 4024, 13997, 23970, 33943, 56721, 53889, 63862,
        8300, 18273, 54371, 38219, 50731, 13955, 23928, 33901, 43874, 58211, 63820, 8258, 18231, 28204, 55860, 48150,
        52221, 23886, 33859, 43832, 53805, 59700, 8216, 18189, 28162, 38135, 57350, 58081, 53710, 33817, 43790, 53763,
        63736, 51360, 18147, 28120, 38093, 48066, 58840, 2477, 55200, 56696, 58192, 59688, 51354, 52850, 54345, 55841,
        57337, 58833, 50499, 51995, 56690, 53679, 63652, 8090, 18063, 54339, 38009, 47982, 57955, 2393, 51989, 22339,
      ]),
    );
  });

  it("matches the engine bit-exactly — tile 4, grout 2, lighten 0.2", () => {
    expect(mosaicTiles2D(g, 4, 2, 0.2)).toEqual(
      rows([
        11140, 12636, 14132, 15628, 17124, 18620, 20116, 11782, 13278, 14774, 16270, 17766, 12630, 14126, 15622, 17118,
        18614, 20110, 11776, 13272, 14767, 16263, 17759, 19255, 14120, 15616, 39808, 49781, 20104, 11769, 14165, 24138,
        16257, 17753, 54057, 64030, 15609, 17105, 49739, 59712, 11763, 13259, 24096, 34069, 17747, 19243, 63988, 8426,
        17099, 18595, 20091, 11757, 13253, 14749, 16245, 17740, 19236, 20732, 12398, 13894, 18589, 20085, 11750, 13246,
        14742, 16238, 17734, 19230, 20726, 12392, 13888, 15384, 20078, 11744, 13997, 23970, 16232, 17728, 53889, 63862,
        12385, 13881, 28246, 38219, 11738, 13234, 23928, 33901, 17722, 19218, 63820, 8258, 13875, 15371, 38177, 48150,
        13227, 14723, 16219, 17715, 19211, 20707, 12373, 13869, 15365, 16861, 18357, 19853, 14717, 16213, 17709, 19205,
        20701, 12367, 13863, 15358, 16854, 18350, 19846, 11512, 16207, 17703, 53721, 63694, 12360, 13856, 28078, 38051,
        18344, 19840, 2435, 12408, 17696, 19192, 63652, 8090, 13850, 15346, 38009, 47982, 19834, 11499, 12366, 22339,
      ]),
    );
  });
});
