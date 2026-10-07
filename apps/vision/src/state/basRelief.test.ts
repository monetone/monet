// Unit tests for the Bas Relief filter. Engine-free (node), single luminance-channel model
// (exact for grey R=G=B input). These pin the smoothing radius, the emboss gain, the
// per-direction slope, and the rel = clamp(0.5 + slope·gain) lerp between fg·257 and bg·257
// (must match filters.rs bas_relief), plus cross-implementation goldens captured from the Rust
// engine that exercise the CONTINUOUS lerp (intermediate values, not just fg/bg).
import { describe, it, expect } from "vitest";
import {
  basReliefRadius,
  basReliefGain,
  basReliefLightOffset,
  basRelief2D,
  BAS_RELIEF_MAX,
} from "./basRelief";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("basReliefRadius / basReliefGain", () => {
  it("radius = clamp((clamp(smoothness,1,15)−1)/3, 0, 5)", () => {
    expect(basReliefRadius(1)).toBe(0);
    expect(basReliefRadius(4)).toBe(1);
    expect(basReliefRadius(7)).toBe(2);
    expect(basReliefRadius(10)).toBe(3); // the 2↔3↔4 boundary, not just 0/1/4
    expect(basReliefRadius(13)).toBe(4);
    expect(basReliefRadius(15)).toBe(4);
    expect(basReliefRadius(0)).toBe(0); // clamped up to 1
    expect(basReliefRadius(99)).toBe(4); // clamped down to 15
  });

  it("maps every light direction to its offset (all 8 switch arms)", () => {
    // pins the whole lightOffset table — a mis-transcribed arm (incl. the diagonals 1/3/5/7,
    // which the axis-only goldens never exercise) fails here.
    expect(basReliefLightOffset(0)).toEqual([0, -1]); // Top
    expect(basReliefLightOffset(1)).toEqual([1, -1]); // Top-Right
    expect(basReliefLightOffset(2)).toEqual([1, 0]); // Right
    expect(basReliefLightOffset(3)).toEqual([1, 1]); // Bottom-Right
    expect(basReliefLightOffset(4)).toEqual([0, 1]); // Bottom
    expect(basReliefLightOffset(5)).toEqual([-1, 1]); // Bottom-Left
    expect(basReliefLightOffset(6)).toEqual([-1, 0]); // Left
    expect(basReliefLightOffset(7)).toEqual([-1, -1]); // Top-Left
    expect(basReliefLightOffset(99)).toEqual([0, -1]); // out of range → Top (default)
  });
  it("gain = 1.5 + 0.6·clamp(detail,1,15)", () => {
    expect(basReliefGain(1)).toBeCloseTo(2.1, 4);
    expect(basReliefGain(3)).toBeCloseTo(3.3, 4);
    expect(basReliefGain(15)).toBeCloseTo(10.5, 4);
    expect(basReliefGain(0)).toBeCloseTo(2.1, 4); // clamped to 1
    expect(basReliefGain(99)).toBeCloseTo(10.5, 4); // clamped to 15
  });
});

describe("basRelief2D", () => {
  it("renders a flat field as the uniform fg↔bg midpoint (no slope ⇒ rel = 0.5)", () => {
    // slope is 0 everywhere ⇒ rel = clamp(0.5) = 0.5 ⇒ out = trunc((fg·257 + bg·257)/2),
    // independent of the flat VALUE — only of fg/bg.
    const mid = Math.trunc((0 + 255 * 257) / 2); // 32767
    expect(basRelief2D(grid(8, 8, () => 30000), 3, 1, 0, 0, 255)).toEqual(grid(8, 8, () => mid));
    expect(basRelief2D(grid(8, 8, () => 5000), 3, 1, 0, 0, 255)).toEqual(grid(8, 8, () => mid));
  });

  it("opposite light directions produce opposite relief on a gradient", () => {
    const g = grid(9, 9, (x, y) => (x + y) * 4000);
    expect(basRelief2D(g, 3, 1, 2, 0, 255)).not.toEqual(basRelief2D(g, 3, 1, 6, 0, 255)); // Right vs Left
    expect(basRelief2D(g, 3, 1, 0, 0, 255)).not.toEqual(basRelief2D(g, 3, 1, 4, 0, 255)); // Top vs Bottom
  });

  it("strong edges saturate the relief to fg AND bg (rel clamps to 0 and 1)", () => {
    // a bright vertical bar (cols 2..4) lit from the right: its RISING edge has slope ≫ 0 → rel
    // clamps to 1 (bg), its FALLING edge has slope ≪ 0 → rel clamps to 0 (fg).
    const g = grid(5, 7, (x) => (x >= 2 && x <= 4 ? BAS_RELIEF_MAX : 0));
    const out = basRelief2D(g, 10, 1, 2, 0, 255); // high detail (gain), light Right
    const vals = new Set(flat(out));
    expect(vals.has(0)).toBe(true); // falling edge → fully shadow (fg)
    expect(vals.has(65535)).toBe(true); // rising edge → fully lit (bg)
  });

  it("produces continuous intermediate tones on a smooth field (not just fg/bg)", () => {
    const g = grid(9, 9, (x, y) => 200 * x * x + 150 * y * y);
    const out = basRelief2D(g, 3, 1, 0, 0, 255);
    const intermediate = flat(out).filter((v) => v > 0 && v < 65535).length;
    expect(intermediate).toBeGreaterThan(0); // genuine lerp, not a two-tone threshold
  });

  it("keeps every output an integer within [0, 65535]", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % BAS_RELIEF_MAX);
    for (const [detail, smoothness, light] of [
      [3, 1, 0],
      [5, 7, 2],
      [15, 15, 5],
    ]) {
      for (const v of flat(basRelief2D(g, detail, smoothness, light, 0, 255))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(BAS_RELIEF_MAX);
      }
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(basRelief2D([], 3, 1, 0, 0, 255)).toEqual([]);
    expect(basRelief2D([[], []], 3, 1, 0, 0, 255)).toEqual([[], []]);
    // 1×1: every offset clamps to the lone pixel → slope 0 → rel 0.5 → midpoint
    expect(basRelief2D([[40000]], 3, 1, 0, 0, 255)).toEqual([[Math.trunc(255 * 257 / 2)]]);
    const g = grid(7, 7, (x, y) => (x * 53 + y * 97) % 40000);
    expect(basRelief2D(g, 5, 7, 2, 50, 200)).toEqual(basRelief2D(g, 5, 7, 2, 50, 200));
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => (x * 5000 + y * 4000) % BAS_RELIEF_MAX);
    const snapshot = g.map((r) => [...r]);
    basRelief2D(g, 3, 1, 0, 0, 255);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = basRelief2D(g, 3, 7, 3, 0, 255);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 13)).toBe(true);
  });
});

// ── Cross-implementation goldens: exact u16 output captured from the Rust engine's bas_relief
//    on a 7×7 SMOOTH grey field v = 200x² + 150y² + 80xy (gentle slopes ⇒ rel in (0,1) ⇒ ~all
//    distinct intermediate values: 49 and 48 of 49). Fully bit-exact (no trig/sqrt). ──
describe("engine golden (bas_relief, 7×7 smooth grey)", () => {
  const input = grid(7, 7, (x, y) => 200 * x * x + 150 * y * y + 80 * x * y);

  it("matches the engine bit-exactly — detail 3, smoothness 1 (r=0), light Top, black/white", () => {
    expect(basRelief2D(input, 3, 1, 0, 0, 255)).toEqual([
      [32272, 32008, 31744, 31480, 31216, 30952, 30688],
      [30787, 30259, 29731, 29203, 28675, 28147, 27619],
      [28807, 28279, 27751, 27223, 26695, 26167, 25639],
      [26827, 26299, 25771, 25243, 24715, 24187, 23659],
      [24847, 24319, 23791, 23263, 22735, 22207, 21679],
      [22867, 22339, 21811, 21283, 20755, 20227, 19699],
      [27322, 27058, 26794, 26530, 26266, 26002, 25738],
    ]);
  });

  it("matches the engine bit-exactly — detail 5, smoothness 7 (r=2 blur), light Right, grey fg/bg", () => {
    expect(basRelief2D(input, 5, 7, 2, 50, 200)).toEqual([
      [33154, 34949, 36694, 38732, 39447, 38549, 35060],
      [33230, 35127, 36923, 38986, 39676, 38727, 35136],
      [33332, 35365, 37228, 39325, 39981, 38965, 35237],
      [33459, 35661, 37609, 39748, 40362, 39261, 35365],
      [33586, 35957, 37990, 40172, 40743, 39557, 35492],
      [33687, 36195, 38295, 40510, 41048, 39795, 35593],
      [33764, 36373, 38524, 40764, 41277, 39973, 35669],
    ]);
  });

  it("matches the engine bit-exactly — detail 3, smoothness 1, light Bottom-Right (a DIAGONAL offset)", () => {
    // the axis-only goldens above cover lights Top/Right; this pins a DIAGONAL light offset
    // (3 → (1,1)) against the engine, so the relief direction is exercised on a non-axis arm.
    expect(basRelief2D(input, 3, 1, 3, 0, 255)).toEqual([
      [34186, 36430, 39334, 42238, 45142, 48046, 42106],
      [35935, 38443, 41611, 44779, 47947, 51115, 45175],
      [38179, 40951, 44119, 47287, 50455, 53623, 47419],
      [40423, 43459, 46627, 49795, 52963, 56131, 49663],
      [42667, 45967, 49135, 52303, 55471, 58639, 51907],
      [44911, 48475, 51643, 54811, 57979, 61147, 54151],
      [40456, 44020, 46924, 49828, 52732, 55636, 48376],
    ]);
  });
});

// ── Several detail/smoothness/light fixtures swept for in-range, shape, flat→midpoint ──
const FIXTURES: { name: string; detail: number; smoothness: number; light: number }[] = [
  { name: "sharp top", detail: 8, smoothness: 1, light: 0 },
  { name: "soft bottom-right", detail: 3, smoothness: 10, light: 3 },
  { name: "left light", detail: 12, smoothness: 4, light: 6 },
];

describe.each(FIXTURES)("fixture: $name", ({ detail, smoothness, light }) => {
  it("stays in range, keeps shape, and renders a flat field as the fg↔bg midpoint", () => {
    const g = grid(13, 13, (x, y) => (x * 4099 + y * 8191) % BAS_RELIEF_MAX);
    const out = basRelief2D(g, detail, smoothness, light, 0, 255);
    expect(out.length).toBe(13);
    expect(out.every((r) => r.length === 13)).toBe(true);
    for (const v of flat(out)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(BAS_RELIEF_MAX);
    }
    const mid = Math.trunc((0 + 255 * 257) / 2);
    expect(basRelief2D(grid(13, 13, () => 41000), detail, smoothness, light, 0, 255)).toEqual(
      grid(13, 13, () => mid),
    );
  });
});
