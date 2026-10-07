// Unit tests for the Spherize distortion. Engine-free (node). These pin the radial warp
// (must match mod.rs spherize_buf: warp only where 1e-4 < d < 1, scale = d^amount, source
// along the same ray) and its defining behaviours: amount 0 and the region outside the
// lens are the exact identity, the warp is purely radial (no rotation), and a positive
// amount bulges (source pulled toward the centre) while a negative one pinches.
import { describe, it, expect } from "vitest";
import {
  spherizeSource,
  spherize2D,
  packSpherizeParams,
  unpackSpherizeParams,
  SPHERIZE_MAX,
} from "./spherize";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();
const hyp = Math.hypot;

describe("spherizeSource", () => {
  const W = 11;
  const H = 11;
  const cx = W / 2;
  const cy = H / 2;

  it("amount 0 maps every in-lens pixel to itself exactly", () => {
    for (const [x, y] of [
      [4, 5],
      [6, 6],
      [5, 3],
    ]) {
      const s = spherizeSource(x, y, W, H, 0)!;
      expect(s).not.toBeNull();
      expect(s.fx).toBe(x);
      expect(s.fy).toBe(y);
    }
  });

  it("returns null outside the lens (d ≥ 1) — those pixels are left unchanged", () => {
    // corner: d ≈ 7.07/5.5 = 1.29 ≥ 1
    expect(spherizeSource(0, 0, W, H, 0.5)).toBeNull();
    expect(spherizeSource(10, 10, W, H, 0.5)).toBeNull();
  });

  it("returns null at the dead centre (d ≤ 1e-4)", () => {
    // odd dims → pixel (5,5) sits exactly at cx=cy=5.5 offset 0 → d = 0
    expect(spherizeSource(5, 5, W, H, 0.5)).toBeNull();
  });

  it("warps purely along the radius (the source is parallel to the offset — no rotation)", () => {
    for (const [x, y] of [
      [3, 6],
      [7, 4],
      [4, 7],
    ]) {
      const s = spherizeSource(x, y, W, H, 0.7)!;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const cross = (s.fx + 0.5 - cx) * dy - (s.fy + 0.5 - cy) * dx;
      expect(cross).toBeCloseTo(0, 3); // collinear with the centre → no angular twist
    }
  });

  it("bulges with a positive amount (source pulled toward centre) and pinches with a negative one", () => {
    const x = 3;
    const y = 5;
    const dst = hyp(x + 0.5 - cx, y + 0.5 - cy);
    const bulge = spherizeSource(x, y, W, H, 0.6)!;
    const pinch = spherizeSource(x, y, W, H, -0.6)!;
    expect(hyp(bulge.fx + 0.5 - cx, bulge.fy + 0.5 - cy)).toBeLessThan(dst); // closer in
    expect(hyp(pinch.fx + 0.5 - cx, pinch.fy + 0.5 - cy)).toBeGreaterThan(dst); // farther out
  });
});

describe("spherize2D", () => {
  it("amount 0 is the exact identity", () => {
    const g = grid(9, 9, (x, y) => (x * 31 + y * 17) % SPHERIZE_MAX);
    expect(spherize2D(g, 0)).toEqual(g);
  });

  it("leaves a constant image unchanged at any amount", () => {
    const g = grid(11, 11, () => 33000);
    for (const a of [0.5, -0.5, 1, -1]) expect(spherize2D(g, a)).toEqual(g);
  });

  it("leaves the corners (outside the lens) unchanged", () => {
    const g = grid(11, 11, (x, y) => (x * 53 + y * 97) % SPHERIZE_MAX);
    const out = spherize2D(g, 0.7);
    expect(out[0][0]).toBe(g[0][0]);
    expect(out[0][10]).toBe(g[0][10]);
    expect(out[10][0]).toBe(g[10][0]);
    expect(out[10][10]).toBe(g[10][10]);
  });

  it("warps the interior at a non-zero amount (not the identity)", () => {
    const g = grid(11, 11, (x, y) => (x + y) * 2000);
    expect(spherize2D(g, 0.6)).not.toEqual(g);
    expect(spherize2D(g, -0.6)).not.toEqual(g);
  });

  it("keeps every output within [0, 65535]", () => {
    const g = grid(10, 12, (x, y) => (x * 6151 + y * 3079) % SPHERIZE_MAX);
    for (const v of flat(spherize2D(g, 0.8))) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(SPHERIZE_MAX);
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(spherize2D([], 0.5)).toEqual([]);
    expect(spherize2D([[], []], 0.5)).toEqual([[], []]);
    expect(spherize2D([[42]], 0.9)).toEqual([[42]]); // lone pixel is the dead centre
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % 40000);
    expect(spherize2D(g, 0.5)).toEqual(spherize2D(g, 0.5));
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => (x + y) * 3000);
    const snapshot = g.map((row) => [...row]);
    spherize2D(g, 0.6);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 11, (x, y) => (x * 11 + y * 5) % 50000);
    const out = spherize2D(g, 0.5);
    expect(out.length).toBe(5);
    expect(out.every((row) => row.length === 11)).toBe(true);
  });
});

describe("smart-filter params (id 13)", () => {
  it("packs and unpacks [amount], f32-rounded", () => {
    expect(packSpherizeParams(0.5)).toEqual([0.5]);
    expect(unpackSpherizeParams([0.5])).toBe(0.5);
    expect(unpackSpherizeParams([])).toBe(0);
    expect(unpackSpherizeParams([0.7])).toBe(Math.fround(0.7));
  });

  it("round-trips and replays the same warp", () => {
    const g = grid(8, 8, (x, y) => (x * 13 + y * 7) % 60000);
    const amount = unpackSpherizeParams(packSpherizeParams(0.65));
    expect(spherize2D(g, amount)).toEqual(spherize2D(g, Math.fround(0.65)));
  });
});

// ── Several amount/image fixtures swept for in-range, shape, and constant invariance ──
const FIXTURES: { name: string; amount: number }[] = [
  { name: "gentle bulge", amount: 0.3 },
  { name: "strong bulge", amount: 1 },
  { name: "gentle pinch", amount: -0.3 },
  { name: "strong pinch", amount: -1 },
];

describe.each(FIXTURES)("fixture: $name", ({ amount }) => {
  it("stays in range, keeps shape, and leaves the constant region invariant", () => {
    const g = grid(13, 13, (x, y) => (x * 4099 + y * 8191) % SPHERIZE_MAX);
    const out = spherize2D(g, amount);
    expect(out.length).toBe(13);
    expect(out.every((row) => row.length === 13)).toBe(true);
    for (const v of flat(out)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(SPHERIZE_MAX);
    }
    expect(spherize2D(grid(13, 13, () => 41000), amount).every((r) => r.every((v) => v === 41000))).toBe(true);
  });
});
