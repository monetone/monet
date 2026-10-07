// Unit tests for the Ripple distortion. Engine-free (node). These pin the sine
// displacement (must match mod.rs ripple_buf: wl=[6,14,30][s], amp=amount/100·[3,6,12][s],
// dx=amp·sin(τy/wl), dy=amp·sin(τx/wl), source=(x−dx, y−dy)) and its defining behaviours:
// amount 0 and the pixel (0,0) are the exact identity, the displacement is bounded by amp,
// and a large amplitude pushes edge samples off the image → 0 (like the engine).
import { describe, it, expect } from "vitest";
import { rippleParams, rippleSource, ripple2D, RIPPLE_MAX } from "./ripple";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("rippleParams", () => {
  it("gives the per-size wavelength and amplitude", () => {
    expect(rippleParams(100, 0)).toEqual({ wl: 6, amp: 3 }); // 100/100·3
    expect(rippleParams(100, 1)).toEqual({ wl: 14, amp: 6 });
    expect(rippleParams(100, 2)).toEqual({ wl: 30, amp: 12 });
    expect(rippleParams(50, 0).amp).toBeCloseTo(1.5, 6);
    expect(rippleParams(0, 2)).toEqual({ wl: 30, amp: 0 });
  });

  it("clamps the size selector to [0, 2] (truncating fractions)", () => {
    expect(rippleParams(100, 3).wl).toBe(30); // size 3 → 2
    expect(rippleParams(100, -1).wl).toBe(6); // negative → 0
    expect(rippleParams(100, 1.9).wl).toBe(14); // truncates to 1
  });
});

describe("rippleSource", () => {
  it("amount 0 maps every pixel to itself exactly", () => {
    for (const [x, y] of [
      [0, 0],
      [3, 4],
      [7, 2],
    ]) {
      const s = rippleSource(x, y, 0, 1);
      expect(s.fx).toBe(x);
      expect(s.fy).toBe(y);
    }
  });

  it("the pixel (0,0) is identity at any amount/size (both sines are 0)", () => {
    for (const [amt, size] of [
      [100, 0],
      [50, 1],
      [200, 2],
    ]) {
      expect(rippleSource(0, 0, amt, size)).toEqual({ fx: 0, fy: 0 });
    }
  });

  it("shifts horizontally by a wave of the row, vertically by a wave of the column", () => {
    // size 0 → wl=6, amp=3. (1,0): dx=3·sin(0)=0, dy=3·sin(τ/6)=3·sin(60°)≈2.598
    const a = rippleSource(1, 0, 100, 0);
    expect(a.fx).toBe(1); // row 0 → no horizontal shift
    expect(a.fy).toBeCloseTo(-2.598, 3); // 0 − 2.598
    // (0,1): dx=3·sin(τ/6)≈2.598, dy=3·sin(0)=0
    const b = rippleSource(0, 1, 100, 0);
    expect(b.fx).toBeCloseTo(-2.598, 3);
    expect(b.fy).toBe(1); // column 0 → no vertical shift
  });

  it("never displaces more than the amplitude", () => {
    const { amp } = rippleParams(100, 2); // amp = 12
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < 30; x++) {
        const s = rippleSource(x, y, 100, 2);
        expect(Math.abs(x - s.fx)).toBeLessThanOrEqual(amp + 1e-4);
        expect(Math.abs(y - s.fy)).toBeLessThanOrEqual(amp + 1e-4);
      }
    }
  });
});

describe("ripple2D", () => {
  it("amount 0 is the exact identity", () => {
    const g = grid(9, 9, (x, y) => (x * 31 + y * 17) % RIPPLE_MAX);
    expect(ripple2D(g, 0, 1)).toEqual(g);
  });

  it("keeps the pixel (0,0) unchanged", () => {
    const g = grid(8, 8, (x, y) => (x * 53 + y * 97) % RIPPLE_MAX);
    expect(ripple2D(g, 100, 0)[0][0]).toBe(g[0][0]);
  });

  it("leaves a constant image unchanged when the amplitude stays within the border (amp ≤ 1)", () => {
    // amount 30, size 0 → amp = 0.9 ≤ 1, so no source ever leaves the ±1 border → invariant
    const g = grid(12, 12, () => 33000);
    expect(ripple2D(g, 30, 0)).toEqual(g);
  });

  it("paints edge pixels black where a large amplitude pushes the source off the image", () => {
    // amount 100, size 0 → amp = 3; at (0,1) source y = −2.598 < −1 → sample_bi returns 0
    const g = grid(12, 12, () => 50000);
    const out = ripple2D(g, 100, 0);
    expect(out[0][1]).toBe(0); // displaced past the top edge → transparent/black
    expect(out.some((row) => row.some((v) => v === 0))).toBe(true);
  });

  it("warps the interior at a non-zero amount (not the identity)", () => {
    const g = grid(13, 13, (x, y) => (x + y) * 2000);
    expect(ripple2D(g, 60, 1)).not.toEqual(g);
  });

  it("reconstructs an interior pixel by the exact bilinear blend (end-to-end)", () => {
    // vertical gradient value=y·1000. Output (x=4,y=0), amount 100, size 0 (wl=6, amp=3):
    // dx=3·sin(0)=0 → fx=4; dy=3·sin(τ·4/6)=3·sin(240°)≈−2.598 → fy≈2.598076. The blend
    // samples column 4, rows 2,3: round(2000·(1−0.598076) + 3000·0.598076) = round(2598.08).
    const g = grid(6, 6, (_x, y) => y * 1000);
    expect(ripple2D(g, 100, 0)[0][4]).toBe(2598);
  });

  it("keeps every output within [0, 65535]", () => {
    const g = grid(10, 12, (x, y) => (x * 6151 + y * 3079) % RIPPLE_MAX);
    for (const v of flat(ripple2D(g, 80, 2))) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(RIPPLE_MAX);
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(ripple2D([], 50, 0)).toEqual([]);
    expect(ripple2D([[], []], 50, 0)).toEqual([[], []]);
    expect(ripple2D([[42]], 100, 0)).toEqual([[42]]); // lone pixel is (0,0) → identity
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % 40000);
    expect(ripple2D(g, 50, 1)).toEqual(ripple2D(g, 50, 1));
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => (x + y) * 3000);
    const snapshot = g.map((row) => [...row]);
    ripple2D(g, 70, 1);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 11, (x, y) => (x * 11 + y * 5) % 50000);
    const out = ripple2D(g, 40, 0);
    expect(out.length).toBe(5);
    expect(out.every((row) => row.length === 11)).toBe(true);
  });
});

// ── Several amount/size fixtures swept for in-range, shape, and small-amp invariance ──
const FIXTURES: { name: string; amount: number; size: number }[] = [
  { name: "small gentle", amount: 25, size: 0 },
  { name: "medium strong", amount: 100, size: 1 },
  { name: "large strong", amount: 150, size: 2 },
  { name: "negative amount", amount: -60, size: 1 },
];

describe.each(FIXTURES)("fixture: $name", ({ amount, size }) => {
  it("stays in range, keeps shape, and (0,0) is preserved", () => {
    const g = grid(13, 13, (x, y) => (x * 4099 + y * 8191) % RIPPLE_MAX);
    const out = ripple2D(g, amount, size);
    expect(out.length).toBe(13);
    expect(out.every((row) => row.length === 13)).toBe(true);
    for (const v of flat(out)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(RIPPLE_MAX);
    }
    expect(out[0][0]).toBe(g[0][0]); // (0,0) always identity
  });
});
