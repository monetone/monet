// Unit tests for the Threshold helpers. Engine-free (node); the dialog + engine
// wiring are covered by the e2e suite + the Rust side. These pin the pure math: the
// Rec.601 luminance, the `>= level` binarization, and the boundary edge cases.
import { describe, it, expect } from "vitest";
import {
  clampThreshold,
  thresholdFraction,
  thresholdLuminance,
  applyThreshold,
  THRESHOLD_MIN,
  THRESHOLD_MAX,
  DEFAULT_THRESHOLD,
  LUMA_R,
  LUMA_G,
  LUMA_B,
} from "./threshold";

const BLACK = { r: 0, g: 0, b: 0 };
const WHITE = { r: 255, g: 255, b: 255 };

describe("constants & clamp", () => {
  it("range + default + Rec.601 weights", () => {
    expect([THRESHOLD_MIN, THRESHOLD_MAX, DEFAULT_THRESHOLD]).toEqual([0, 255, 128]);
    expect([LUMA_R, LUMA_G, LUMA_B]).toEqual([0.299, 0.587, 0.114]);
  });

  it("clampThreshold rounds + clamps to 0..255", () => {
    expect(clampThreshold(128)).toBe(128);
    expect(clampThreshold(-10)).toBe(0);
    expect(clampThreshold(999)).toBe(255);
    expect(clampThreshold(127.4)).toBe(127);
    expect(clampThreshold(127.6)).toBe(128);
  });

  it("thresholdFraction = level/255 (single precision)", () => {
    expect(thresholdFraction(0)).toBe(0);
    expect(thresholdFraction(255)).toBe(1);
    expect(thresholdFraction(128)).toBeCloseTo(128 / 255, 6);
  });
});

describe("thresholdLuminance (Rec.601, 0..1, single precision)", () => {
  it("matches the engine's normalised luminance (within f32 precision)", () => {
    expect(thresholdLuminance(0, 0, 0)).toBe(0);
    expect(thresholdLuminance(255, 0, 0)).toBeCloseTo(0.299, 6);
    expect(thresholdLuminance(0, 255, 0)).toBeCloseTo(0.587, 6);
    expect(thresholdLuminance(0, 0, 255)).toBeCloseTo(0.114, 6);
    expect(thresholdLuminance(128, 128, 128)).toBeCloseTo(128 / 255, 6);
    expect(thresholdLuminance(255, 255, 255)).toBe(1); // f32 weights sum to exactly 1.0
  });
});

describe("applyThreshold — binary output", () => {
  it("output is always pure black or pure white", () => {
    for (const lvl of [0, 64, 128, 200, 255]) {
      for (const [r, g, b] of [
        [0, 0, 0],
        [255, 255, 255],
        [200, 30, 70],
        [128, 128, 128],
        [17, 240, 91],
      ]) {
        const out = applyThreshold(lvl, r, g, b);
        expect(out.r).toBe(out.g);
        expect(out.g).toBe(out.b);
        expect(out.r === 0 || out.r === 255).toBe(true);
      }
    }
  });

  it("level 128: primaries/grays split by luminance", () => {
    expect(applyThreshold(128, 255, 0, 0)).toEqual(BLACK); // 0.299 < 0.502
    expect(applyThreshold(128, 0, 255, 0)).toEqual(WHITE); // 0.587 ≥ 0.502
    expect(applyThreshold(128, 0, 0, 255)).toEqual(BLACK); // 0.114 < 0.502
    expect(applyThreshold(128, 255, 255, 255)).toEqual(WHITE);
    expect(applyThreshold(128, 0, 0, 0)).toEqual(BLACK);
    expect(applyThreshold(128, 128, 128, 128)).toEqual(WHITE); // == level → white
    expect(applyThreshold(128, 127, 127, 127)).toEqual(BLACK); // just below
  });

  it("level 0 makes everything white (every luminance ≥ 0)", () => {
    expect(applyThreshold(0, 0, 0, 0)).toEqual(WHITE);
    expect(applyThreshold(0, 10, 20, 30)).toEqual(WHITE);
  });

  it("level 255: only pure white passes (f32 luminance reaches exactly 1.0)", () => {
    expect(applyThreshold(255, 255, 255, 255)).toEqual(WHITE); // f32 white luma == 1.0 ≥ 1.0
    expect(applyThreshold(255, 254, 254, 254)).toEqual(BLACK); // just below white → black
    expect(applyThreshold(255, 200, 200, 200)).toEqual(BLACK);
  });

  it("level 1: a faint gray is white, pure black is black", () => {
    expect(applyThreshold(1, 1, 1, 1)).toEqual(WHITE);
    expect(applyThreshold(1, 0, 0, 0)).toEqual(BLACK);
  });

  it("is deterministic", () => {
    expect(applyThreshold(140, 70, 130, 180)).toEqual(applyThreshold(140, 70, 130, 180));
  });
});

describe("monotonicity", () => {
  it("raising the level never turns a black pixel white (fewer/equal whites)", () => {
    const pixels: [number, number, number][] = [
      [0, 0, 0],
      [60, 120, 200],
      [200, 200, 60],
      [128, 128, 128],
      [255, 255, 255],
    ];
    for (const [r, g, b] of pixels) {
      let prevWhite = true; // at level 0 everything is white
      for (let lvl = 0; lvl <= 255; lvl++) {
        const white = applyThreshold(lvl, r, g, b).r === 255;
        if (!prevWhite) expect(white).toBe(false); // once black, stays black as level rises
        prevWhite = white;
      }
    }
  });

  it("at a fixed level, a brighter pixel is white whenever a darker one is", () => {
    const dark = applyThreshold(120, 90, 90, 90);
    const bright = applyThreshold(120, 200, 200, 200);
    if (dark.r === 255) expect(bright.r).toBe(255);
  });
});

// ── Several level fixtures swept over a ramp ────────────────────────────────
describe.each([1, 64, 128, 192, 254])("fixture: level=%i", (lvl) => {
  it("partitions a gray ramp into a black run then a white run", () => {
    let seenWhite = false;
    let violated = false;
    for (let v = 0; v <= 255; v++) {
      const white = applyThreshold(lvl, v, v, v).r === 255;
      if (white) seenWhite = true;
      else if (seenWhite) violated = true; // a black after a white = not a clean step
    }
    expect(violated).toBe(false);
    expect(seenWhite).toBe(true); // some bright grays pass every level ≤ 254
  });
});
