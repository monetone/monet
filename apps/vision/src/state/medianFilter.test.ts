// Unit tests for the Median filter. Engine-free (node). These pin the order-
// statistic (must match filters.rs median: sort the (2r+1)² edge-clamped window,
// take window[len/2]) and the median's defining behaviours: salt-and-pepper
// removal, edge preservation, and introducing no new values.
import { describe, it, expect } from "vitest";
import { medianOf, median2D } from "./medianFilter";

// Build an h×w grid from a (x,y)→value function.
const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("medianOf", () => {
  it("is the middle of the sorted values (order-independent)", () => {
    expect(medianOf([1, 2, 3])).toBe(2);
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([9, 1, 5, 2, 8, 3, 7])).toBe(5); // sorted [1,2,3,5,7,8,9] → idx 3
  });

  it("constants and singletons", () => {
    expect(medianOf([5, 5, 5])).toBe(5);
    expect(medianOf([7])).toBe(7);
  });

  it("takes the upper-middle for even lengths (engine's len/2)", () => {
    expect(medianOf([1, 2, 3, 4])).toBe(3); // sorted, idx 2
  });

  it("does not mutate the input", () => {
    const v = [3, 1, 2];
    medianOf(v);
    expect(v).toEqual([3, 1, 2]);
  });
});

describe("median2D", () => {
  it("radius < 1 returns an unchanged copy", () => {
    const g = grid(3, 3, (x, y) => x + y * 3);
    const out = median2D(g, 0);
    expect(out).toEqual(g);
    expect(out).not.toBe(g); // fresh copy
  });

  it("leaves a constant image unchanged", () => {
    const g = grid(4, 4, () => 128);
    expect(median2D(g, 1)).toEqual(g);
  });

  it("removes an isolated salt outlier (the median ignores it)", () => {
    const salt = grid(5, 5, (x, y) => (x === 2 && y === 2 ? 255 : 100));
    const out = median2D(salt, 1);
    expect(out.every((row) => row.every((v) => v === 100))).toBe(true);
  });

  it("removes pepper too (a single 0 in a bright field)", () => {
    const pepper = grid(5, 5, (x, y) => (x === 2 && y === 2 ? 0 : 200));
    expect(median2D(pepper, 1).every((row) => row.every((v) => v === 200))).toBe(true);
  });

  it("preserves a sharp edge (no blur, only the two original values appear)", () => {
    const edge = grid(4, 6, (x) => (x < 3 ? 50 : 200));
    const out = median2D(edge, 1);
    const allowed = new Set([50, 200]);
    expect(out.every((row) => row.every((v) => allowed.has(v)))).toBe(true);
    // the edge stays where it was: column 2 = 50, column 3 = 200
    expect(out.every((row) => row[2] === 50 && row[3] === 200)).toBe(true);
  });

  it("introduces no new values — every output is one of the inputs (order statistic)", () => {
    const g = grid(5, 7, (x, y) => (x * 31 + y * 17) % 256);
    const inputs = new Set(flat(g));
    expect(flat(median2D(g, 2)).every((v) => inputs.has(v))).toBe(true);
  });

  it("a radius-2 (5×5) window also clears a small noise cluster", () => {
    const noisy = grid(7, 7, (x, y) => {
      if (x >= 2 && x <= 3 && y >= 2 && y <= 3) return 255; // 2×2 noise blob
      return 80;
    });
    const out = median2D(noisy, 2);
    // a 5×5 window has 25 samples; ≤4 noise pixels can't reach the median → cleared
    expect(out.every((row) => row.every((v) => v === 80))).toBe(true);
  });

  it("clamps at the borders (corner uses the replicated edge window)", () => {
    // top-left corner of a constant-with-one-outlier field still resolves cleanly
    const g = grid(3, 3, (x, y) => (x === 0 && y === 0 ? 255 : 100));
    expect(median2D(g, 1)[0][0]).toBe(100); // the lone corner outlier is outvoted
  });

  it("is transpose-covariant (pins positional/axis correctness on non-square images)", () => {
    // median(transpose) === transpose(median): a wrong x↔y clamp would break this.
    const transpose = (g: number[][]) => g[0].map((_, x) => g.map((row) => row[x]));
    const g = grid(3, 5, (x, y) => (x * 7 + y * 11) % 200);
    expect(median2D(transpose(g), 1)).toEqual(transpose(median2D(g, 1)));
    expect(median2D(transpose(g), 2)).toEqual(transpose(median2D(g, 2)));
  });

  it("handles an empty image safely", () => {
    expect(median2D([], 1)).toEqual([]);
    expect(median2D([[], []], 1)).toEqual([[], []]); // zero-width rows
  });

  it("a NaN radius is treated as a no-op (defensive)", () => {
    const g = grid(3, 3, (x, y) => x + y);
    expect(median2D(g, NaN)).toEqual(g);
  });

  it("is deterministic", () => {
    const g = grid(5, 5, (x, y) => (x * 13 + y * 7) % 200);
    expect(median2D(g, 1)).toEqual(median2D(g, 1));
  });
});

// ── Several image fixtures swept for in-range + no-new-values ────────────────
const FIXTURES: { name: string; image: number[][] }[] = [
  { name: "checkerboard", image: grid(6, 6, (x, y) => ((x + y) % 2 ? 255 : 0)) },
  { name: "vertical edge", image: grid(5, 8, (x) => (x < 4 ? 30 : 210)) },
  { name: "gradient", image: grid(5, 5, (x) => x * 50) },
  { name: "single impulse", image: grid(7, 7, (x, y) => (x === 3 && y === 3 ? 255 : 60)) },
];

describe.each(FIXTURES)("fixture: $name", ({ image }) => {
  it("output is in range, same shape, and contains no new values for r=1 and r=2", () => {
    const inputs = new Set(flat(image));
    for (const r of [1, 2]) {
      const out = median2D(image, r);
      expect(out.length).toBe(image.length);
      expect(out[0].length).toBe(image[0].length);
      for (const v of flat(out)) {
        expect(Number.isInteger(v)).toBe(true);
        expect(inputs.has(v)).toBe(true);
      }
    }
  });
});

// ── Cross-implementation goldens captured from the Rust engine's `median` (via filters::median on a
//    grey u16 buffer with a full Selection ⇒ straight copy). Pure integer median ⇒ bit-exact (strict
//    equality). The invariant tests above pin the median's *properties*; these pin the exact engine
//    output. Covers an asymmetric hash at radius 1 and 2, salt-and-pepper removal, a border-clamp-
//    sensitive ramp, and radius > image (every sample clamps to the edge). ──
const goldenRows = (w: number, s: string): number[][] => {
  const v = s.trim().split(/\s+/).map(Number);
  return Array.from({ length: v.length / w }, (_, y) => v.slice(y * w, y * w + w));
};

describe("engine golden (median)", () => {
  it("matches the engine bit-exactly — 6×5 hash, radius 1", () => {
    const hash = grid(5, 6, (x, y) => (x * 9973 + y * 9931) % 65535);
    expect(median2D(hash, 1)).toEqual(
      goldenRows(6, "9931 9973 19946 29919 39892 49865 9973 19904 29877 39850 49781 49865 19904 29835 39808 49739 49781 14123 29835 39766 49697 49739 14123 14123 39724 49697 49697 14081 14081 14123"),
    );
  });

  it("matches the engine bit-exactly — 6×5 hash, radius 2", () => {
    const hash = grid(5, 6, (x, y) => (x * 9973 + y * 9931) % 65535);
    expect(median2D(hash, 2)).toEqual(
      goldenRows(6, "9973 19862 29835 29919 39892 49865 19862 19946 29877 39766 39892 49781 29793 29835 29919 39766 39808 29919 39724 39724 39724 39766 24054 24054 39724 39724 39724 29835 24054 14123"),
    );
  });

  it("matches the engine bit-exactly — 5×5 salt-and-pepper, radius 1 (outliers voted out)", () => {
    const sp = grid(5, 5, () => 30000);
    sp[0][0] = 0; sp[1][1] = 65535; sp[2][2] = 0; sp[2][3] = 65535; sp[4][4] = 0;
    expect(median2D(sp, 1)).toEqual(grid(5, 5, () => 30000));
  });

  it("matches the engine bit-exactly — 4×4 ramp, radius 1 (border clamp)", () => {
    const ramp = grid(4, 4, (x, y) => (y * 4 + x) * 4000);
    expect(median2D(ramp, 1)).toEqual(
      goldenRows(4, "4000 8000 12000 12000 16000 20000 24000 28000 32000 36000 40000 44000 48000 48000 52000 56000"),
    );
  });

  it("matches the engine bit-exactly — 3×3, radius 3 > image (every sample clamps)", () => {
    const small = grid(3, 3, (x, y) => [10, 20, 30, 40, 50, 60, 70, 80, 90][y * 3 + x] * 600);
    expect(median2D(small, 3)).toEqual(goldenRows(3, "18000 18000 18000 24000 30000 36000 42000 42000 42000"));
  });
});
