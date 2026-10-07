// Unit tests for the ZigZag distortion. Engine-free (node). These pin the radial sine warp
// (must match mod.rs zigzag_buf) via each style's geometric invariant: style 0 (Around
// Center) preserves the radius (rotation only), style 1 (Out From Center) preserves the
// angle (radial only), style 2 does both. The dead-centre pixel is copied unchanged, and
// at amount 0 a constant image is exact.
import { describe, it, expect } from "vitest";
import { zigzagSource, zigZag2D, ZIGZAG_MAX } from "./zigZag";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();
const hyp = Math.hypot;

describe("zigzagSource", () => {
  const W = 13;
  const H = 13;
  const cx = W / 2;
  const cy = H / 2;

  it("returns null at the dead centre (r < 1e-3)", () => {
    // odd dims → pixel (6,6) sits exactly at cx=cy=6.5 → dx=dy=0 → r=0
    expect(zigzagSource(6, 6, W, H, 80, 3, 0)).toBeNull();
    expect(zigzagSource(6, 6, W, H, 80, 3, 1)).toBeNull();
  });

  it("amount 0 maps (almost) to the pixel itself for every style", () => {
    for (const style of [0, 1, 2]) {
      for (const [x, y] of [
        [3, 5],
        [9, 8],
        [2, 10],
      ]) {
        const s = zigzagSource(x, y, W, H, 0, 4, style)!;
        expect(s.fx).toBeCloseTo(x, 3);
        expect(s.fy).toBeCloseTo(y, 3);
      }
    }
  });

  it("style 0 (Around Center) preserves the radius — pure rotation", () => {
    for (const [x, y] of [
      [3, 6],
      [8, 4],
      [10, 9],
    ]) {
      const s = zigzagSource(x, y, W, H, 90, 3, 0)!;
      const srcR = hyp(s.fx + 0.5 - cx, s.fy + 0.5 - cy);
      const dstR = hyp(x + 0.5 - cx, y + 0.5 - cy);
      expect(srcR).toBeCloseTo(dstR, 3); // radius unchanged
    }
  });

  it("style 1 (Out From Center) preserves the angle — pure radial displacement", () => {
    for (const [x, y] of [
      [3, 6],
      [8, 4],
      [10, 9],
    ]) {
      const s = zigzagSource(x, y, W, H, 90, 3, 1)!;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const cross = (s.fx + 0.5 - cx) * dy - (s.fy + 0.5 - cy) * dx;
      expect(cross).toBeCloseTo(0, 2); // collinear with the radius → no angular twist
      // and the radius is actually displaced (not preserved) for a non-trivial s
      const srcR = hyp(s.fx + 0.5 - cx, s.fy + 0.5 - cy);
      expect(srcR).not.toBeCloseTo(hyp(dx, dy), 1);
    }
  });

  it("ridges 0 behaves like ridges 1 (max(ridges,1))", () => {
    expect(zigzagSource(3, 5, W, H, 80, 0, 1)).toEqual(zigzagSource(3, 5, W, H, 80, 1, 1));
  });

  it("style 2 (Pond Ripples) does 0.7× the radial push and 0.5× the angular twist", () => {
    // pins BOTH style-2 coefficients via cross-style relations (a 0.7↔0.5 swap or a dropped
    // factor would fail): the radial push is 0.7× style 1's, the angular twist 0.5× style 0's.
    for (const [x, y] of [
      [3, 6],
      [8, 4],
      [10, 9],
    ]) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const r = hyp(dx, dy);
      const theta = Math.atan2(dy, dx);
      const s0 = zigzagSource(x, y, W, H, 90, 3, 0)!; // angle-only
      const s1 = zigzagSource(x, y, W, H, 90, 3, 1)!; // radius-only
      const s2 = zigzagSource(x, y, W, H, 90, 3, 2)!; // both
      const push1 = hyp(s1.fx + 0.5 - cx, s1.fy + 0.5 - cy) - r;
      const push2 = hyp(s2.fx + 0.5 - cx, s2.fy + 0.5 - cy) - r;
      expect(push2).toBeCloseTo(0.7 * push1, 3); // pins amp·s·0.7
      const twist0 = Math.atan2(s0.fy + 0.5 - cy, s0.fx + 0.5 - cx) - theta;
      const twist2 = Math.atan2(s2.fy + 0.5 - cy, s2.fx + 0.5 - cx) - theta;
      expect(twist2).toBeCloseTo(0.5 * twist0, 3); // pins amp/r·s·0.5
    }
  });

  it("any out-of-range style behaves as style 2 (the Pond-Ripples fall-through)", () => {
    expect(zigzagSource(3, 5, W, H, 90, 3, 5)).toEqual(zigzagSource(3, 5, W, H, 90, 3, 2));
    expect(zigzagSource(8, 4, W, H, 90, 3, 99)).toEqual(zigzagSource(8, 4, W, H, 90, 3, 2));
  });
});

describe("zigZag2D", () => {
  it("amount 0 leaves a constant image exact (every source samples the constant)", () => {
    const g = grid(13, 13, () => 33000);
    for (const style of [0, 1, 2]) expect(zigZag2D(g, 0, 3, style)).toEqual(g);
  });

  it("copies the dead-centre pixel unchanged at any amount/style (odd dims)", () => {
    const g = grid(13, 13, (x, y) => (x * 53 + y * 97) % ZIGZAG_MAX);
    for (const style of [0, 1, 2]) {
      expect(zigZag2D(g, 90, 4, style)[6][6]).toBe(g[6][6]);
    }
  });

  it("warps the interior at a non-zero amount (not the identity, every style)", () => {
    const g = grid(13, 13, (x, y) => (x + y) * 2000);
    for (const style of [0, 1, 2]) expect(zigZag2D(g, 80, 3, style)).not.toEqual(g);
  });

  it("more ridges change the pattern", () => {
    const g = grid(13, 13, (x, y) => (x * 17 + y * 31) % ZIGZAG_MAX);
    expect(zigZag2D(g, 70, 2, 1)).not.toEqual(zigZag2D(g, 70, 6, 1));
  });

  it("pushes off-edge sources to black (0) at large amount", () => {
    // every source value is 30000 (>= 1), so a 0 is unambiguously the off-edge sentinel —
    // proves nr/ang ran a source past the image edge → sample_bi returns 0 (a clamp-to-max_r
    // regression would keep all pixels in-image and produce no zeros).
    const g = grid(11, 13, () => 30000);
    for (const style of [0, 1, 2]) {
      expect(flat(zigZag2D(g, 100, 4, style)).some((v) => v === 0)).toBe(true);
    }
  });

  it("warps every pixel on even dimensions (no dead centre) and stays in range", () => {
    // even dims → cx/cy land on a pixel boundary, so no pixel has r=0; the warp resamples
    // everywhere (the `r < CENTER_EPS` copy path never fires).
    const g = grid(12, 12, (x, y) => (x * 41 + y * 23) % ZIGZAG_MAX);
    const out = zigZag2D(g, 80, 3, 1);
    expect(out).not.toEqual(g);
    for (const v of flat(out)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(ZIGZAG_MAX);
    }
  });

  it("keeps every output within [0, 65535] for all styles", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % ZIGZAG_MAX);
    for (const style of [0, 1, 2]) {
      for (const v of flat(zigZag2D(g, 100, 4, style))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(ZIGZAG_MAX);
      }
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(zigZag2D([], 50, 3, 1)).toEqual([]);
    expect(zigZag2D([[], []], 50, 3, 0)).toEqual([[], []]);
    expect(zigZag2D([[42]], 90, 4, 2)).toEqual([[42]]); // lone pixel is the dead centre
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % 40000);
    expect(zigZag2D(g, 60, 3, 1)).toEqual(zigZag2D(g, 60, 3, 1));
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => (x + y) * 3000);
    const snapshot = g.map((row) => [...row]);
    for (const style of [0, 1, 2]) zigZag2D(g, 80, 3, style);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = zigZag2D(g, 60, 3, 1);
    expect(out.length).toBe(5);
    expect(out.every((row) => row.length === 13)).toBe(true);
  });
});

// ── Several amount/ridges/style fixtures swept for in-range, shape, centre-copy ──
const FIXTURES: { name: string; amount: number; ridges: number; style: number }[] = [
  { name: "swirl (style 0)", amount: 80, ridges: 5, style: 0 },
  { name: "radial (style 1)", amount: 60, ridges: 3, style: 1 },
  { name: "pond ripples (style 2)", amount: 100, ridges: 4, style: 2 },
  { name: "gentle high-ridge", amount: 25, ridges: 8, style: 1 },
];

describe.each(FIXTURES)("fixture: $name", ({ amount, ridges, style }) => {
  it("stays in range, keeps shape, and preserves the dead-centre pixel", () => {
    const g = grid(13, 13, (x, y) => (x * 4099 + y * 8191) % ZIGZAG_MAX);
    const out = zigZag2D(g, amount, ridges, style);
    expect(out.length).toBe(13);
    expect(out.every((row) => row.length === 13)).toBe(true);
    for (const v of flat(out)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(ZIGZAG_MAX);
    }
    expect(out[6][6]).toBe(g[6][6]); // dead centre untouched
  });
});
