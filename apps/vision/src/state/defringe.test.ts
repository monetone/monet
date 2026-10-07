// Unit tests for the Defringe filter. Engine-free (node), grey value-channel + alpha-mask model
// (exact for grey R=G=B input). These pin the fringe predicate (opaque ∧ touching transparency or
// the border), the 8-neighbour average of opaque non-fringe pixels with round-to-u16, the n=0
// no-op, and the idempotent multi-pass (must match filters.rs defringe), plus cross-implementation
// goldens captured from the Rust engine. Bit-exact (Σ of ≤8 u16 < 2²⁴; correctly-rounded divide).
import { describe, it, expect } from "vitest";
import { isFringe, defringe2D, DEFRINGE_MAX } from "./defringe";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const val = (x: number, y: number) => (x * 9973 + y * 9931) % DEFRINGE_MAX;
const flat = (g: number[][]) => g.flat();

describe("isFringe", () => {
  it("flags opaque pixels that touch transparency (including the image border)", () => {
    const opaqueBlock = grid(7, 7, (x, y) => (x >= 1 && x <= 5 && y >= 1 && y <= 5 ? 65535 : 0));
    expect(isFringe(opaqueBlock, 1, 1)).toBe(true); // block corner, touches transparent
    expect(isFringe(opaqueBlock, 3, 3)).toBe(false); // block interior, fully surrounded
    expect(isFringe(opaqueBlock, 0, 0)).toBe(false); // transparent → never fringe
  });
  it("treats the border ring of a fully-opaque image as fringe (out-of-bounds = transparent)", () => {
    const opaque = grid(5, 5, () => 65535);
    expect(isFringe(opaque, 0, 0)).toBe(true); // corner: OOB neighbours read transparent
    expect(isFringe(opaque, 2, 0)).toBe(true); // top edge
    expect(isFringe(opaque, 2, 2)).toBe(false); // interior
  });

  it("uses 4-neighbour (orthogonal) transparency, NOT 8-neighbour: a diagonal-only contact is not fringe", () => {
    // 3×3 opaque except the (0,0) corner. The centre touches the transparent corner only
    // diagonally, so it is NOT fringe (an 8-neighbour/Moore mutant would wrongly flag it).
    const notch = grid(3, 3, (x, y) => (x === 0 && y === 0 ? 0 : 65535));
    expect(isFringe(notch, 1, 1)).toBe(false);
  });
});

describe("defringe2D", () => {
  const value = grid(7, 7, val);

  it("leaves a fringe pixel with NO opaque non-fringe neighbour untouched (n=0)", () => {
    // single opaque pixel: it is fringe (touches transparency) but has no interior neighbour to
    // borrow from, so it is left as-is.
    const v = grid(3, 3, (x, y) => 10000 + x * 100 + y * 50);
    const a = grid(3, 3, (x, y) => (x === 1 && y === 1 ? 65535 : 0));
    expect(defringe2D(v, a, 1)).toEqual(v);
    // a 2×2 opaque block: every pixel is fringe and none has a non-fringe opaque neighbour → no-op
    const v4 = grid(4, 4, (x, y) => 20000 + x * 100 + y * 50);
    const a4 = grid(4, 4, (x, y) => (x >= 1 && x <= 2 && y >= 1 && y <= 2 ? 65535 : 0));
    expect(defringe2D(v4, a4, 1)).toEqual(v4);
  });

  it("leaves a fully-transparent image untouched", () => {
    const v = grid(5, 5, (x, y) => (x * 7 + y * 3) % 1000);
    expect(defringe2D(v, grid(5, 5, () => 0), 1)).toEqual(v);
  });

  it("preserves the interior of a fully-opaque image (only the border ring is fringe)", () => {
    const v = grid(5, 5, (x, y) => (x * 7 + y * 3) % 200 + 100);
    const out = defringe2D(v, grid(5, 5, () => 65535), 1);
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) expect(out[y][x]).toBe(v[y][x]);
  });

  it("is idempotent in width: width 1, 3 and 5 give the same result", () => {
    const a = grid(7, 7, () => 65535);
    const w1 = defringe2D(value, a, 1);
    expect(defringe2D(value, a, 3)).toEqual(w1);
    expect(defringe2D(value, a, 5)).toEqual(w1);
  });

  it("does not mutate its inputs and is deterministic", () => {
    const a = grid(7, 7, (x, y) => (x >= 1 && x <= 5 && y >= 1 && y <= 5 ? 65535 : 0));
    const vSnap = value.map((r) => [...r]);
    const aSnap = a.map((r) => [...r]);
    const out = defringe2D(value, a, 2);
    expect(value).toEqual(vSnap);
    expect(a).toEqual(aSnap);
    expect(defringe2D(value, a, 2)).toEqual(out);
  });

  it("keeps every output an integer within [0, 65535] and shape-preserving (non-square)", () => {
    const v = grid(5, 13, (x, y) => (x * 4099 + y * 8191) % DEFRINGE_MAX);
    const a = grid(5, 13, (x, y) => (x + y) % 2 === 0 ? 65535 : 0);
    const out = defringe2D(v, a, 1);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 13)).toBe(true);
    for (const o of flat(out)) {
      expect(Number.isInteger(o)).toBe(true);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(DEFRINGE_MAX);
    }
  });

  it("handles empty images", () => {
    expect(defringe2D([], [], 1)).toEqual([]);
    expect(defringe2D([[], []], [[], []], 1)).toEqual([[], []]);
  });
});

// ── Cross-implementation goldens captured from the Rust engine's defringe on a 7×7 grey value
//    pattern v = (x·9973 + y·9931) mod 65535. Fixture A is fully opaque (the border ring is fringe
//    via the out-of-bounds edge); fixture B is an opaque 5×5 block on a transparent background (a
//    fringe ring at the block edge). Bit-exact (no trig/sqrt). ──
describe("engine golden (defringe, 7×7 grey)", () => {
  const value = grid(7, 7, val);
  const asRows = (vals: number[]): number[][] => Array.from({ length: 7 }, (_, y) => vals.slice(y * 7, y * 7 + 7));

  it("matches the engine bit-exactly — fixture A (fully opaque, border ring defringed)", () => {
    const alpha = grid(7, 7, () => 65535);
    expect(defringe2D(value, alpha, 1)).toEqual(
      asRows([
        19904, 24891, 29877, 39850, 49823, 54810, 59796, 24870, 19904, 29877, 39850, 49823, 59796, 31994, 29835, 29835,
        39808, 49781, 59754, 4192, 26037, 39766, 39766, 49739, 59712, 4150, 14123, 14123, 49697, 49697, 59670, 4108,
        14081, 24054, 24054, 54663, 59628, 4066, 14039, 24012, 33985, 29020, 59628, 31847, 25911, 14039, 24012, 28999,
        33985,
      ]),
    );
  });

  it("matches the engine bit-exactly — fixture B (opaque 5×5 block on transparent bg)", () => {
    const alpha = grid(7, 7, (x, y) => (x >= 1 && x <= 5 && y >= 1 && y <= 5 ? 65535 : 0));
    expect(defringe2D(value, alpha, 1)).toEqual(
      asRows([
        0, 9973, 19946, 29919, 39892, 49865, 59838, 9931, 39808, 44795, 49781, 54768, 59754, 4234, 19862, 44774, 39808,
        49781, 59754, 31952, 14165, 29793, 49739, 49739, 59712, 4150, 25995, 24096, 39724, 54705, 59670, 4108, 14081,
        9116, 34027, 49655, 59670, 31889, 25953, 9095, 14081, 43958, 59586, 4024, 13997, 23970, 33943, 43916, 53889,
      ]),
    );
  });

  it("matches the engine bit-exactly — diagonal NOTCH (pins 4-neighbour connectivity)", () => {
    // 3×3 opaque except (0,0). Under the engine's 4-neighbour predicate the centre (1,1) is the
    // only non-fringe pixel, so every opaque pixel averages to its value (19904); the transparent
    // corner stays 0. An 8-neighbour mutant makes the centre fringe ⇒ n=0 everywhere ⇒ the gradient
    // survives unchanged — a completely different grid. So this golden pins the connectivity.
    const v = grid(3, 3, val);
    const alpha = grid(3, 3, (x, y) => (x === 0 && y === 0 ? 0 : 65535));
    expect(defringe2D(v, alpha, 1)).toEqual([
      [0, 19904, 19904],
      [19904, 19904, 19904],
      [19904, 19904, 19904],
    ]);
  });
});
