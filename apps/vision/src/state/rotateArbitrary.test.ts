// Unit tests for Arbitrary Rotation. Engine-free (node), per-channel. These pin the
// rem_euclid dispatch (no-op / 90 / 180 / 270 / arbitrary), the bounding-box canvas growth,
// the dest→source inverse map, and the ZERO-PAD bilinear (out-of-bounds taps contribute 0,
// not edge-clamped — must match mod.rs rotate_arbitrary + rotate_buf), plus cross-
// implementation goldens captured from the Rust engine across five angles.
import { describe, it, expect } from "vitest";
import { sampleZeroPad, rotateArbitrary2D, ROTATE_MAX } from "./rotateArbitrary";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("sampleZeroPad", () => {
  const img = [
    [100, 200],
    [300, 400],
  ];
  it("returns the exact pixel at integer coordinates", () => {
    expect(sampleZeroPad(img, 0, 0, 2, 2)).toBe(100);
    expect(sampleZeroPad(img, 1, 1, 2, 2)).toBe(400);
  });
  it("blends in-bounds taps (interior)", () => {
    expect(sampleZeroPad(img, 0.5, 0, 2, 2)).toBe(150); // ½·100 + ½·200
  });
  it("zero-pads off the edge (fades to 0, NOT edge-clamped)", () => {
    // fx=−0.5: the left tap (sx=−1) is out of bounds → contributes 0, so only ½·100 remains
    expect(sampleZeroPad(img, -0.5, 0, 2, 2)).toBe(50);
  });
  it("returns the fill (0) when the floor is fully outside", () => {
    expect(sampleZeroPad(img, 5, 5, 2, 2)).toBe(0); // x0=5 > w
    expect(sampleZeroPad(img, -2, 0, 2, 2)).toBe(0); // x0=−2 < −1
  });
  it("accumulates each tap as src·wx·wy (the engine's order), not src·(wx·wy)", () => {
    // a value/weight combination where the two f32 reassociations round differently:
    // src·wx·wy rounds to 58220, but src·(wx·wy) would give 58219 — pins the multiply order.
    const g = [
      [57254, 21070],
      [60780, 65522],
    ];
    expect(sampleZeroPad(g, 0.0135, 0.3565, 2, 2)).toBe(58220);
  });
});

describe("rotateArbitrary2D — dispatch & invariants", () => {
  const g = grid(7, 7, (x, y) => (x * 9973 + y * 9931) % ROTATE_MAX);

  it("is a no-op at 0° and 360° (and ~tiny angles)", () => {
    expect(rotateArbitrary2D(g, 0)).toEqual(g);
    expect(rotateArbitrary2D(g, 360)).toEqual(g);
    expect(rotateArbitrary2D(g, 0.00001)).toEqual(g);
  });

  it("swaps the dimensions for a 90°/270° turn and keeps them for 180°", () => {
    const r = grid(3, 5, (x, y) => (x * 11 + y * 7) % ROTATE_MAX); // 3 rows × 5 cols
    expect(rotateArbitrary2D(r, 90).length).toBe(5); // → 5 rows × 3 cols
    expect(rotateArbitrary2D(r, 90)[0].length).toBe(3);
    expect(rotateArbitrary2D(r, 270).length).toBe(5);
    expect(rotateArbitrary2D(r, 180).length).toBe(3); // dims unchanged
    expect(rotateArbitrary2D(r, 180)[0].length).toBe(5);
  });

  it("four 90° turns return the original image (rotation group)", () => {
    let r = g as number[][];
    for (let i = 0; i < 4; i++) r = rotateArbitrary2D(r, 90);
    expect(r).toEqual(g);
  });

  it("180° applied twice is the identity", () => {
    expect(rotateArbitrary2D(rotateArbitrary2D(g, 180), 180)).toEqual(g);
  });

  it("90° then 270° is the identity", () => {
    expect(rotateArbitrary2D(rotateArbitrary2D(g, 90), 270)).toEqual(g);
  });

  it("grows the canvas and zero-fills the corners for an arbitrary angle", () => {
    const out = rotateArbitrary2D(g, 30);
    expect(out.length).toBe(10); // ceil(7·cos30 + 7·sin30) = 10
    expect(out[0].length).toBe(10);
    expect(out[0][0]).toBe(0); // a corner is outside the rotated content → fill 0
    expect(out[9][9]).toBe(0);
  });

  it("uses ceil (not round) for the canvas and keeps nw≠nh on a non-square turn", () => {
    // 9×5 rotated 30°: nh = ceil(5·sin30 + 9·cos30) = ceil(10.29) = 11 (round would give 10),
    // nw = ceil(5·cos30 + 9·sin30) = ceil(8.83) = 9. The exact dims pin ceil-over-round (nh)
    // and the nw/nh asymmetry (a swap of the two formulas would give 9 rows × 11 cols).
    const r = grid(9, 5, (x, y) => (x * 9973 + y * 9931) % ROTATE_MAX);
    const out = rotateArbitrary2D(r, 30);
    expect(out.length).toBe(11); // nh = ceil(10.29)
    expect(out[0].length).toBe(9); // nw = ceil(8.83)
  });

  it("keeps every output an integer within [0, 65535]", () => {
    for (const angle of [30, 45, 137, 200, 305]) {
      for (const v of flat(rotateArbitrary2D(g, angle))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(ROTATE_MAX);
      }
    }
  });

  it("does not mutate the input", () => {
    const snapshot = g.map((r) => [...r]);
    for (const angle of [30, 90, 180, 270]) rotateArbitrary2D(g, angle);
    expect(g).toEqual(snapshot);
  });

  it("handles empty / 1×1 images", () => {
    expect(rotateArbitrary2D([], 30)).toEqual([]);
    expect(rotateArbitrary2D([[], []], 30)).toEqual([[], []]);
    expect(rotateArbitrary2D([[42]], 0)).toEqual([[42]]); // no-op
    expect(rotateArbitrary2D([[42]], 180)).toEqual([[42]]); // 1×1 180° = itself
  });
});

// ── Cross-implementation goldens: exact u16 output captured from the Rust engine's
//    rotate_arbitrary on a 7×7 grey pattern v = (x·9973 + y·9931) mod 65535, across the three
//    lossless turns and two arbitrary angles. Per-channel & f32-faithful, so bit-for-bit.
//    NOTE: 30°/200° were chosen because JS and the engine's native f32 trig AGREE there; a
//    strict golden at an arbitrary angle where they disagree (~0.03% of angles) would fail by
//    ≤1 LSB — see the FIDELITY CAVEAT in rotateArbitrary.ts. ──
describe("engine golden (rotate_arbitrary, 7×7 grey)", () => {
  const input = grid(7, 7, (x, y) => (x * 9973 + y * 9931) % ROTATE_MAX);

  it("matches the engine bit-exactly — 90° (lossless CW)", () => {
    expect(rotateArbitrary2D(input, 90)).toEqual([
      [59586, 49655, 39724, 29793, 19862, 9931, 0],
      [4024, 59628, 49697, 39766, 29835, 19904, 9973],
      [13997, 4066, 59670, 49739, 39808, 29877, 19946],
      [23970, 14039, 4108, 59712, 49781, 39850, 29919],
      [33943, 24012, 14081, 4150, 59754, 49823, 39892],
      [43916, 33985, 24054, 14123, 4192, 59796, 49865],
      [53889, 43958, 34027, 24096, 14165, 4234, 59838],
    ]);
  });

  it("matches the engine bit-exactly — 180° (lossless)", () => {
    expect(rotateArbitrary2D(input, 180)).toEqual([
      [53889, 43916, 33943, 23970, 13997, 4024, 59586],
      [43958, 33985, 24012, 14039, 4066, 59628, 49655],
      [34027, 24054, 14081, 4108, 59670, 49697, 39724],
      [24096, 14123, 4150, 59712, 49739, 39766, 29793],
      [14165, 4192, 59754, 49781, 39808, 29835, 19862],
      [4234, 59796, 49823, 39850, 29877, 19904, 9931],
      [59838, 49865, 39892, 29919, 19946, 9973, 0],
    ]);
  });

  it("matches the engine bit-exactly — 270° (lossless CCW)", () => {
    expect(rotateArbitrary2D(input, 270)).toEqual([
      [59838, 4234, 14165, 24096, 34027, 43958, 53889],
      [49865, 59796, 4192, 14123, 24054, 33985, 43916],
      [39892, 49823, 59754, 4150, 14081, 24012, 33943],
      [29919, 39850, 49781, 59712, 4108, 14039, 23970],
      [19946, 29877, 39808, 49739, 59670, 4066, 13997],
      [9973, 19904, 29835, 39766, 49697, 59628, 4024],
      [0, 9931, 19862, 29793, 39724, 49655, 59586],
    ]);
  });

  it("matches the engine bit-exactly — 30° (arbitrary, zero-pad bilinear, 10×10)", () => {
    expect(rotateArbitrary2D(input, 30)).toEqual([
      [0, 0, 0, 0, 1116, 0, 0, 0, 0, 0],
      [0, 0, 1028, 6789, 10322, 12067, 5565, 0, 0, 0],
      [0, 0, 12111, 20237, 23909, 27580, 31252, 22839, 4050, 0],
      [0, 7502, 30153, 33824, 37496, 41167, 44839, 48510, 50086, 23015],
      [0, 30821, 43740, 47411, 51083, 50952, 55800, 43088, 23948, 14896],
      [19916, 51030, 53525, 49593, 28100, 19778, 15846, 10149, 7920, 0],
      [22918, 18679, 17646, 9050, 12722, 16393, 20065, 23736, 4294, 0],
      [0, 527, 8683, 22637, 26309, 29980, 33652, 19410, 0, 0],
      [0, 0, 0, 6232, 26675, 43567, 44457, 3549, 0, 0],
      [0, 0, 0, 0, 0, 17901, 20727, 0, 0, 0],
    ]);
  });

  it("matches the engine bit-exactly — 200° (arbitrary, 9×9)", () => {
    expect(rotateArbitrary2D(input, 200)).toEqual([
      [0, 0, 37523, 27404, 9074, 0, 0, 0, 0],
      [0, 6489, 44356, 38381, 32406, 20831, 7682, 943, 0],
      [0, 16184, 31613, 25638, 19663, 13688, 13302, 15948, 41490],
      [0, 19495, 18870, 12895, 9521, 29079, 41594, 54530, 30744],
      [2535, 12411, 11534, 25167, 59712, 52385, 47762, 41787, 10464],
      [12451, 32456, 45668, 52944, 46969, 40994, 35019, 25713, 0],
      [41665, 51314, 46176, 40201, 34226, 28251, 22276, 10593, 0],
      [0, 7402, 19095, 24377, 21483, 15508, 9533, 1856, 0],
      [0, 0, 0, 0, 3926, 4027, 0, 0, 0],
    ]);
  });
});

// ── Several angle/shape fixtures swept for canvas growth, in-range, corner-fill, no-mutation ──
const FIXTURES: { name: string; angle: number; h: number; w: number }[] = [
  { name: "45° square", angle: 45, h: 9, w: 9 },
  { name: "120° tall", angle: 120, h: 11, w: 5 },
  { name: "330° wide", angle: 330, h: 5, w: 11 },
];

describe.each(FIXTURES)("fixture: $name", ({ angle, h, w }) => {
  it("grows to fit, stays in range, and zero-fills the corners", () => {
    const g = grid(h, w, (x, y) => (x * 4099 + y * 8191) % ROTATE_MAX);
    const out = rotateArbitrary2D(g, angle);
    // a rotated rectangle's bounding box grows in AREA (though a single dimension can shrink
    // for a non-square — e.g. a tall rect's bbox height decreases as it tilts toward 45°)
    expect(out.length * out[0].length).toBeGreaterThan(h * w);
    for (const v of flat(out)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(ROTATE_MAX);
    }
    expect(out[0][0]).toBe(0); // outermost corner is outside the rotated content
  });
});
