// Unit tests for the Remove Matte filter. Engine-free (node). Remove Matte is the one alpha-
// DEPENDENT mirror: it un-premultiplies a white/black matte from partial-alpha edge pixels only.
// These pin the un-matte formula (c − matte·(1−a))/a per channel, the white-vs-black matte, the
// 0<a<1 gate (opaque/transparent untouched), the clamp, and the round-to-u16 (must match
// filters.rs remove_matte), plus cross-implementation goldens captured from the Rust engine —
// including fround-sensitive ones that pin the f32 op order.
import { describe, it, expect } from "vitest";
import { removeMatteChannel, removeMattePixel, removeMatte2D, REMOVE_MATTE_MAX, type RGBA } from "./removeMatte";

describe("removeMatteChannel", () => {
  it("leaves fully-opaque (a=65535) and fully-transparent (a=0) channels unchanged", () => {
    for (const white of [true, false]) {
      expect(removeMatteChannel(30000, REMOVE_MATTE_MAX, white)).toBe(30000);
      expect(removeMatteChannel(30000, 0, white)).toBe(30000);
    }
  });

  it("black matte is a plain un-multiply c/a (brightens the dim edge)", () => {
    // a≈0.5, c=10000 → c/a ≈ 20000; g=40000 → 40000/0.5 > 65535 → clamped.
    expect(removeMatteChannel(10000, 32768, false)).toBe(20000);
    expect(removeMatteChannel(40000, 32768, false)).toBe(REMOVE_MATTE_MAX); // clamps high
  });

  it("white matte subtracts the white bleed (1−a) before un-multiplying", () => {
    // a≈0.5, c=10000 → (0.1526−0.5)/0.5 < 0 → clamps to 0; c=40000 → (0.610−0.5)/0.5 ≈ 0.2207.
    expect(removeMatteChannel(10000, 32768, true)).toBe(0); // clamps low
    expect(removeMatteChannel(40000, 32768, true)).toBe(14466);
  });

  it("white and black mattes give different results on the same input (matte choice matters)", () => {
    expect(removeMatteChannel(40000, 49151, true)).not.toBe(removeMatteChannel(40000, 49151, false));
  });
});

describe("removeMattePixel", () => {
  it("un-mattes R,G,B with the shared alpha and preserves alpha", () => {
    expect(removeMattePixel(10000, 40000, 60000, 32768, true)).toEqual([0, 14466, 54465, 32768]);
    expect(removeMattePixel(10000, 40000, 60000, 32768, false)).toEqual([20000, REMOVE_MATTE_MAX, REMOVE_MATTE_MAX, 32768]);
  });

  it("matches the engine on white-matte probes", () => {
    expect(removeMattePixel(10000, 40000, 60000, 16384, true)).toEqual([0, 0, 43395, 16384]);
    expect(removeMattePixel(5000, 5000, 5000, 6554, true)).toEqual([0, 0, 0, 6554]);
    expect(removeMattePixel(40000, 50000, 60000, 49151, true)).toEqual([31488, 44822, 58155, 49151]);
  });

  it("matches the engine on black-matte probes", () => {
    expect(removeMattePixel(10000, 40000, 60000, 16384, false)).toEqual([39999, REMOVE_MATTE_MAX, REMOVE_MATTE_MAX, 16384]);
    expect(removeMattePixel(5000, 5000, 5000, 6554, false)).toEqual([49996, 49996, 49996, 6554]);
    expect(removeMattePixel(40000, 50000, 60000, 49151, false)).toEqual([53334, REMOVE_MATTE_MAX, REMOVE_MATTE_MAX, 49151]);
  });

  it("pins the per-op f32 rounding (fround-sensitive goldens an f64 computation would miss)", () => {
    // A mirror that dropped the per-op Math.fround (computing in f64) would give 57686 / 43690 /
    // 36960 here instead of the engine's values below. Captured from the real engine.
    expect(removeMatteChannel(147, 167, false)).toBe(57687); // f64 → 57686
    expect(removeMatteChannel(65534, 3, true)).toBe(43689); // f64 → 43690
    expect(removeMatteChannel(119, 211, false)).toBe(36961); // f64 → 36960
  });
});

describe("removeMatte2D", () => {
  const grid = (h: number, w: number, fn: (x: number, y: number) => RGBA): RGBA[][] =>
    Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));

  it("applies per pixel, preserves shape + alpha, and does not mutate the input", () => {
    const g = grid(4, 5, (x, y) => [(x * 9973) % REMOVE_MATTE_MAX, (y * 7919) % REMOVE_MATTE_MAX, (x + y) % REMOVE_MATTE_MAX, 1 + ((x * 4099 + y * 8191) % 65533)]);
    const snapshot = g.map((row) => row.map((p) => [...p]));
    const out = removeMatte2D(g, true);
    expect(out.length).toBe(4);
    expect(out.every((r) => r.length === 5)).toBe(true);
    expect(g).toEqual(snapshot); // not mutated
    expect(removeMatte2D(g, true)).toEqual(out); // deterministic
    for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) {
      expect(out[y][x][3]).toBe(g[y][x][3]); // alpha preserved
      for (const v of out[y][x]) expect(v).toBeGreaterThanOrEqual(0);
      for (let c = 0; c < 3; c++) expect(out[y][x][c]).toBeLessThanOrEqual(REMOVE_MATTE_MAX);
    }
  });

  it("handles empty and 1×1 images", () => {
    expect(removeMatte2D([], true)).toEqual([]);
    expect(removeMatte2D([[]], true)).toEqual([[]]);
    expect(removeMatte2D([[[30000, 40000, 50000, 65535]]], true)).toEqual([[[30000, 40000, 50000, 65535]]]); // opaque → unchanged
  });
});

// ── Cross-implementation golden: exact u16 RGB output captured from the Rust engine's
//    remove_matte on a 4×4 PARTIAL-alpha colour fixture (white matte). Every pixel is un-matted
//    (all 0<a<1). r=(x·9973+y·9931), g=(x·7919+y·6553), b=(x·4099+y·8191) all mod 65535;
//    a = 4096 + (x·5000+y·9000) mod 57000. Fully bit-exact (no trig/sqrt). ──
describe("engine golden (remove_matte, 4×4 white matte)", () => {
  it("matches the engine bit-exactly", () => {
    const input: RGBA[][] = Array.from({ length: 4 }, (_, y) =>
      Array.from({ length: 4 }, (_, x) => [
        (x * 9973 + y * 9931) % REMOVE_MATTE_MAX,
        (x * 7919 + y * 6553) % REMOVE_MATTE_MAX,
        (x * 4099 + y * 8191) % REMOVE_MATTE_MAX,
        4096 + ((x * 5000 + y * 9000) % 57000),
      ] as RGBA),
    );
    const out = removeMatte2D(input, true);
    const rgb = out.map((row) => row.map(([r, g, b]) => [r, g, b]));
    expect(rgb).toEqual([
      [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
      [[0, 0, 0], [0, 0, 0], [0, 0, 0], [5624, 0, 0]],
      [[0, 0, 0], [0, 0, 0], [13005, 0, 0], [37703, 14882, 424]],
      [[0, 0, 0], [18749, 0, 0], [40345, 17634, 13287], [57256, 34088, 24782]],
    ]);
    // alpha preserved across the grid
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) expect(out[y][x][3]).toBe(input[y][x][3]);
  });
});
