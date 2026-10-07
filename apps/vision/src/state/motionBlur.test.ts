// Unit tests for the Motion Blur filter. Engine-free (node). These pin the streak
// geometry (must match filters.rs motion_blur: steps=round(distance), half=steps/2,
// 2·half+1 samples at round(x+dx·s),round(y+dy·s) edge-clamped, averaged), the
// half-away-from-zero rounding (Rust f32::round), and the defining properties: at 0°/90°
// it reduces to a box blur (cross-checked against the independent boxBlur1D), it streaks
// only along its direction, and distance<1 is a no-op.
import { describe, it, expect } from "vitest";
import {
  roundHalfAway,
  motionSteps,
  motionOffsets,
  motionBlur2D,
  packMotionBlurParams,
  unpackMotionBlurParams,
} from "./motionBlur";
import { boxBlur1D } from "./boxBlur";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();
// boxBlur1D applied down each column (the vertical-streak reference).
const blurCols = (img: number[][], r: number): number[][] => {
  const h = img.length;
  const w = img[0].length;
  const out = img.map((row) => [...row]);
  for (let x = 0; x < w; x++) {
    const col = boxBlur1D(
      img.map((row) => row[x]),
      r,
    );
    for (let y = 0; y < h; y++) out[y][x] = col[y];
  }
  return out;
};

describe("roundHalfAway (Rust f32::round)", () => {
  it("rounds half away from zero (unlike Math.round at negatives)", () => {
    expect(roundHalfAway(2.5)).toBe(3);
    expect(roundHalfAway(-2.5)).toBe(-3); // Math.round(-2.5) === -2
    expect(roundHalfAway(0.5)).toBe(1);
    expect(roundHalfAway(-0.5)).toBe(-1);
    expect(roundHalfAway(3.5)).toBe(4);
    expect(roundHalfAway(-3.5)).toBe(-4);
  });

  it("rounds non-halves normally and leaves integers alone", () => {
    expect(roundHalfAway(2.4)).toBe(2);
    expect(roundHalfAway(-2.4)).toBe(-2);
    expect(roundHalfAway(2.6)).toBe(3);
    expect(roundHalfAway(-2.6)).toBe(-3);
    expect(roundHalfAway(7)).toBe(7);
  });
});

describe("motionSteps", () => {
  it("distance < 1 (and NaN) is a no-op (all zero)", () => {
    for (const d of [0, 0.5, 0.99, NaN]) expect(motionSteps(d)).toEqual({ steps: 0, half: 0, samples: 0 });
  });

  it("rounds distance to step count and halves toward zero", () => {
    expect(motionSteps(1)).toEqual({ steps: 1, half: 0, samples: 1 }); // single sample → identity
    expect(motionSteps(1.4)).toEqual({ steps: 1, half: 0, samples: 1 });
    expect(motionSteps(1.5)).toEqual({ steps: 2, half: 1, samples: 3 }); // 1.5 rounds away to 2
    expect(motionSteps(2)).toEqual({ steps: 2, half: 1, samples: 3 });
    expect(motionSteps(2.5)).toEqual({ steps: 3, half: 1, samples: 3 });
    expect(motionSteps(9)).toEqual({ steps: 9, half: 4, samples: 9 });
    expect(motionSteps(10)).toEqual({ steps: 10, half: 5, samples: 11 });
    expect(motionSteps(20)).toEqual({ steps: 20, half: 10, samples: 21 });
  });
});

describe("motionOffsets", () => {
  it("0° streaks horizontally", () => {
    expect(motionOffsets(0, 5)).toEqual([
      [-2, 0],
      [-1, 0],
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
  });

  it("90° streaks vertically", () => {
    expect(motionOffsets(90, 5)).toEqual([
      [0, -2],
      [0, -1],
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
  });

  it("180° / 270° reverse the axis (same sample set)", () => {
    expect(motionOffsets(180, 5)).toEqual([
      [2, 0],
      [1, 0],
      [0, 0],
      [-1, 0],
      [-2, 0],
    ]);
    expect(motionOffsets(270, 5)).toEqual([
      [0, 2],
      [0, 1],
      [0, 0],
      [0, -1],
      [0, -2],
    ]);
  });

  it("45° streaks along the diagonal", () => {
    expect(motionOffsets(45, 5)).toEqual([
      [-1, -1],
      [-1, -1],
      [0, 0],
      [1, 1],
      [1, 1],
    ]);
  });

  it("distance 1 is a single centre tap, and the offsets are point-symmetric", () => {
    expect(motionOffsets(33, 1)).toEqual([[0, 0]]);
    const offs = motionOffsets(57, 9);
    expect(offs.length).toBe(9);
    for (let i = 0; i < offs.length; i++) {
      const j = offs.length - 1 - i;
      expect(offs[i][0] + offs[j][0]).toBe(0); // s and −s give opposite offsets
      expect(offs[i][1] + offs[j][1]).toBe(0);
    }
  });
});

describe("motionBlur2D", () => {
  it("distance < 1 returns an unchanged copy", () => {
    const g = grid(3, 3, (x, y) => x + y * 3);
    const out = motionBlur2D(g, 30, 0.5);
    expect(out).toEqual(g);
    expect(out).not.toBe(g);
  });

  it("distance in [1, 1.5) is the identity (a single sample)", () => {
    const g = grid(4, 4, (x, y) => x * 7 + y);
    expect(motionBlur2D(g, 45, 1)).toEqual(g);
    expect(motionBlur2D(g, 45, 1.4)).toEqual(g);
  });

  it("leaves a constant image unchanged", () => {
    const g = grid(4, 5, () => 128);
    for (const v of flat(motionBlur2D(g, 25, 8))) expect(v).toBeCloseTo(128, 12);
  });

  it("at 0° equals a horizontal box blur (row-wise boxBlur1D radius = half)", () => {
    const g = grid(5, 9, (x, y) => (x * 23 + y * 7) % 200);
    for (const d of [2, 5, 7, 20]) {
      const r = motionSteps(d).half;
      const expected = g.map((row) => boxBlur1D(row, r));
      expect(motionBlur2D(g, 0, d)).toEqual(expected);
    }
  });

  it("at 90° equals a vertical box blur (column-wise boxBlur1D radius = half)", () => {
    const g = grid(7, 4, (x, y) => (x * 11 + y * 29) % 200);
    for (const d of [2, 6, 13]) {
      const r = motionSteps(d).half;
      expect(motionBlur2D(g, 90, d)).toEqual(blurCols(g, r));
    }
  });

  it("computes an exact horizontal window mean (distance 2 → 3-tap, edge-clamped)", () => {
    // each row [0,3,6] → [1,3,5] (same as a radius-1 box blur)
    expect(motionBlur2D([[0, 3, 6]], 0, 2)).toEqual([[1, 3, 5]]);
  });

  it("streaks only along its direction: a horizontal blur leaves other rows untouched", () => {
    const g = grid(5, 5, (x, y) => (x === 2 && y === 2 ? 255 : 0));
    const out = motionBlur2D(g, 0, 5); // horizontal, half 2
    for (const y of [0, 1, 3, 4]) expect(out[y].every((v) => v === 0)).toBe(true); // untouched rows
    expect(out[2].some((v) => v > 0)).toBe(true); // the impulse spread across row 2
  });

  it("keeps the output within the input's min/max range", () => {
    const g = grid(6, 8, (x, y) => (x * 31 + y * 17) % 256);
    const lo = Math.min(...flat(g));
    const hi = Math.max(...flat(g));
    for (const angle of [0, 30, 45, 90, 135]) {
      for (const v of flat(motionBlur2D(g, angle, 6))) {
        expect(v).toBeGreaterThanOrEqual(lo);
        expect(v).toBeLessThanOrEqual(hi);
      }
    }
  });

  it("handles an empty image and is deterministic", () => {
    expect(motionBlur2D([], 45, 5)).toEqual([]);
    expect(motionBlur2D([[], []], 45, 5)).toEqual([[], []]);
    const g = grid(4, 4, (x, y) => (x * 7 + y * 13) % 50);
    expect(motionBlur2D(g, 45, 5)).toEqual(motionBlur2D(g, 45, 5));
  });

  it("does not mutate the input", () => {
    const g = grid(3, 3, (x, y) => x + y);
    const snapshot = g.map((row) => [...row]);
    motionBlur2D(g, 60, 4);
    expect(g).toEqual(snapshot);
  });
});

describe("oblique angles sample per-pixel (round(x+dx·s)), not via fixed offsets", () => {
  const fr = Math.fround;
  const DEG2RAD = fr(fr(Math.PI) / 180);
  const roundHA = (x: number): number => {
    const r = x < 0 ? -Math.round(-x) : Math.round(x);
    return r === 0 ? 0 : r;
  };
  const clamp = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);
  // An independent per-pixel oracle mirroring filters.rs motion_blur. Because Rust's
  // round-half-away is NOT translation-invariant (round(y−0.5) ≠ y+round(−0.5)), the
  // sample row/col must be re-rounded per pixel — a fixed-offset blur diverges by tens of
  // levels on ~all pixels at 30/60/120/150°, so this would fail if the impl took that path.
  const oracle = (img: number[][], angle: number, distance: number): number[][] => {
    const h = img.length;
    const w = img[0].length;
    const steps = roundHA(distance);
    const half = Math.trunc(steps / 2);
    const rad = fr(fr(angle) * DEG2RAD);
    const dx = fr(Math.cos(rad));
    const dy = fr(Math.sin(rad));
    const cnt = 2 * half + 1;
    return img.map((_, y) =>
      img[0].map((__, x) => {
        let sum = 0;
        for (let s = -half; s <= half; s++) {
          const sx = roundHA(fr(x + fr(dx * s)));
          const sy = roundHA(fr(y + fr(dy * s)));
          sum += img[clamp(sy, h - 1)][clamp(sx, w - 1)];
        }
        return sum / cnt;
      }),
    );
  };

  it("matches the per-pixel oracle at common oblique angles and several distances", () => {
    const g = grid(8, 8, (x, y) => (x * 23 + y * 41) % 200);
    for (const angle of [30, 60, 120, 150]) {
      for (const d of [2, 5, 9]) {
        expect(motionBlur2D(g, angle, d)).toEqual(oracle(g, angle, d));
      }
    }
  });
});

describe("smart-filter params (id 7)", () => {
  it("packs [angle, distance] and unpacks them back", () => {
    expect(packMotionBlurParams(45, 20)).toEqual([45, 20]);
    expect(unpackMotionBlurParams([45, 20])).toEqual({ angle: 45, distance: 20 });
    expect(unpackMotionBlurParams([])).toEqual({ angle: 0, distance: 0 });
  });

  it("round-trips and replays the same blur", () => {
    const g = grid(5, 6, (x, y) => (x * 13 + y * 5) % 200);
    const { angle, distance } = unpackMotionBlurParams(packMotionBlurParams(30, 9));
    expect(motionBlur2D(g, angle, distance)).toEqual(motionBlur2D(g, 30, 9));
  });
});

// ── Several angle/image fixtures swept for in-range + shape ───────────────────
const FIXTURES: { name: string; image: number[][] }[] = [
  { name: "checkerboard", image: grid(6, 6, (x, y) => ((x + y) % 2 ? 255 : 0)) },
  { name: "vertical edge", image: grid(5, 8, (x) => (x < 4 ? 30 : 210)) },
  { name: "gradient", image: grid(6, 6, (x, y) => x * 20 + y * 10) },
  { name: "single impulse", image: grid(7, 7, (x, y) => (x === 3 && y === 3 ? 255 : 10)) },
];

describe.each(FIXTURES)("fixture: $name", ({ image }) => {
  it("stays in range and keeps its shape across angles and distances", () => {
    const lo = Math.min(...flat(image));
    const hi = Math.max(...flat(image));
    const h = image.length;
    const w = image[0].length;
    for (const angle of [0, 45, 90, 135, 200]) {
      for (const d of [3, 8]) {
        const out = motionBlur2D(image, angle, d);
        expect(out.length).toBe(h);
        expect(out.every((row) => row.length === w)).toBe(true);
        for (const v of flat(out)) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(lo);
          expect(v).toBeLessThanOrEqual(hi);
        }
      }
    }
  });
});
