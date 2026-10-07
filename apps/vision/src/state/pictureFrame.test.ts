// Unit tests for the Picture Frame filter. Engine-free (node), single grey-channel model (exact
// for a grey frame colour). Picture Frame is PROCEDURAL: a frame pixel's value depends on its
// position, not the underlying pixel. These pin the distance/bevel geometry, the raised-bevel
// shade branches (top-left lighter / bottom-right darker / inner lip / flat band), the colour
// scaling with clamp+round, and the untouched interior (must match filters.rs picture_frame),
// plus cross-implementation goldens captured from the Rust engine.
import { describe, it, expect } from "vitest";
import {
  pictureFrameDist,
  pictureFrameBevel,
  pictureFrameShade,
  pictureFramePixel,
  pictureFrame2D,
  PICTURE_FRAME_MAX,
} from "./pictureFrame";

const fill = (h: number, w: number, v: number): number[][] =>
  Array.from({ length: h }, () => Array.from({ length: w }, () => v));
const flat = (g: number[][]) => g.flat();

describe("pictureFrameDist / pictureFrameBevel", () => {
  it("distance is min to the nearest edge (0 at corners, max at centre)", () => {
    expect(pictureFrameDist(0, 0, 17, 17)).toBe(0);
    expect(pictureFrameDist(16, 16, 17, 17)).toBe(0);
    expect(pictureFrameDist(8, 8, 17, 17)).toBe(8);
    expect(pictureFrameDist(3, 8, 17, 17)).toBe(3);
  });
  it("width clamps to ≥1 and bevel = max(width/4, 1)", () => {
    expect(pictureFrameBevel(0)).toEqual({ width: 1, bevel: 1 });
    expect(pictureFrameBevel(8)).toEqual({ width: 8, bevel: 2 });
    expect(pictureFrameBevel(3)).toEqual({ width: 3, bevel: 1 });
    expect(pictureFrameBevel(20)).toEqual({ width: 20, bevel: 5 });
  });
});

describe("pictureFrameShade", () => {
  it("raises the top/left bevel (>1) and lowers the bottom/right bevel (<1)", () => {
    expect(pictureFrameShade(0, 0, 17, 17, 8)).toBeGreaterThan(1); // top-left corner → lighter
    expect(pictureFrameShade(16, 16, 17, 17, 8)).toBeLessThan(1); // bottom-right corner → darker
  });
  it("is flat (=1) in the band middle and slightly dark (<1) on the inner lip", () => {
    expect(pictureFrameShade(4, 8, 17, 17, 8)).toBe(1); // flat band
    expect(pictureFrameShade(7, 8, 17, 17, 8)).toBeLessThan(1); // inner lip (d=7 ≥ width-bevel=6)
  });
  it("the bevel slope decays with distance (outer ring is shaded harder than the next)", () => {
    const d0 = Math.abs(pictureFrameShade(0, 0, 17, 17, 8) - 1);
    const d1 = Math.abs(pictureFrameShade(1, 1, 17, 17, 8) - 1);
    expect(d0).toBeGreaterThan(d1);
  });
});

describe("pictureFramePixel", () => {
  it("leaves the interior (d ≥ width) untouched — returns the input value verbatim", () => {
    // on 17×17 with width 8 only the centre (8,8) has d ≥ 8; it echoes whatever input it is given.
    expect(pictureFramePixel(40000, 8, 8, 17, 17, 8, 128)).toBe(40000);
    expect(pictureFramePixel(123, 8, 8, 17, 17, 8, 128)).toBe(123);
  });

  it("paints the frame as frameColor·shade, rounded (top-left lighter, bottom-right darker)", () => {
    // grey colour 128 ⇒ flat = 128·257 = 32896; top-left corner ·1.24 = 40791; bottom-right ·0.76 = 25001.
    expect(pictureFramePixel(40000, 4, 8, 17, 17, 8, 128)).toBe(32896); // flat band
    expect(pictureFramePixel(40000, 0, 0, 17, 17, 8, 128)).toBe(40791); // top-left bevel (lighter)
    expect(pictureFramePixel(40000, 16, 16, 17, 17, 8, 128)).toBe(25001); // bottom-right bevel (darker)
    expect(pictureFramePixel(40000, 4, 8, 17, 17, 8, 128)).toBeGreaterThan(25001);
    expect(pictureFramePixel(40000, 0, 0, 17, 17, 8, 128)).toBeGreaterThan(32896);
  });

  it("clamps an over-bright frame colour (white ·1.12 saturates to 65535)", () => {
    // colour 255 ⇒ base 1.0; the lightened top-left bevel overshoots 1 and clamps to white.
    expect(pictureFramePixel(40000, 1, 1, 11, 11, 4, 255)).toBe(PICTURE_FRAME_MAX);
    expect(pictureFramePixel(40000, 10, 10, 11, 11, 4, 255)).toBe(57671); // bottom-right ·0.88, no clamp
  });
});

describe("pictureFrame2D", () => {
  it("leaves the interior block exactly equal to the input", () => {
    const img = fill(17, 17, 40000);
    const out = pictureFrame2D(img, 8, 128);
    for (let y = 8; y <= 8; y++) for (let x = 8; x <= 8; x++) expect(out[y][x]).toBe(40000);
  });

  it("keeps every output an integer within [0, 65535]", () => {
    const img = Array.from({ length: 13 }, (_, y) => Array.from({ length: 15 }, (_, x) => (x * 6151 + y * 3079) % PICTURE_FRAME_MAX));
    for (const [wd, fc] of [
      [4, 128],
      [6, 200],
      [10, 64],
    ]) {
      for (const v of flat(pictureFrame2D(img, wd, fc))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(PICTURE_FRAME_MAX);
      }
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(pictureFrame2D([], 4, 128)).toEqual([]);
    expect(pictureFrame2D([[], []], 4, 128)).toEqual([[], []]);
    expect(pictureFrame2D([[40000]], 4, 128)).toEqual([[36844]]); // 1×1: all frame, shade 1.12
    const img = fill(11, 11, 30000);
    expect(pictureFrame2D(img, 4, 200)).toEqual(pictureFrame2D(img, 4, 200));
  });

  it("does not mutate the input", () => {
    const img = fill(11, 11, 30000);
    const snapshot = img.map((r) => [...r]);
    pictureFrame2D(img, 4, 200);
    expect(img).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const img = fill(7, 15, 25000);
    const out = pictureFrame2D(img, 4, 128);
    expect(out.length).toBe(7);
    expect(out.every((r) => r.length === 15)).toBe(true);
  });
});

// ── Cross-implementation goldens: exact u16 output captured from the Rust engine's picture_frame
//    on an interior fill of 40000 with a grey frame colour. The 17×17/width-8 case exercises the
//    bevel gradient (1.24/1.12 lighter, 0.88/0.76 darker), flat band, inner lip and a 1×1 interior;
//    the 11×11/width-4/colour-255 case exercises the upper clamp. Fully bit-exact (no trig/sqrt). ──
describe("engine golden (picture_frame)", () => {
  const rows = (n: number, vals: number[]): number[][] => Array.from({ length: n }, (_, y) => vals.slice(y * n, y * n + n));

  it("matches the engine bit-exactly — 17×17, width 8, grey colour 128", () => {
    expect(pictureFrame2D(fill(17, 17, 40000), 8, 128)).toEqual(
      rows(17, [
        40791, 40791, 40791, 40791, 40791, 40791, 40791, 40791, 40791, 40791, 40791, 40791, 40791, 40791, 40791, 40791,
        40791, 40791, 36844, 36844, 36844, 36844, 36844, 36844, 36844, 36844, 36844, 36844, 36844, 36844, 36844, 36844,
        36844, 40791, 40791, 36844, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896,
        32896, 36844, 40791, 40791, 36844, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896,
        32896, 32896, 36844, 40791, 40791, 36844, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896,
        32896, 32896, 32896, 36844, 40791, 40791, 36844, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896,
        32896, 32896, 32896, 32896, 36844, 40791, 40791, 36844, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896,
        32896, 32896, 32896, 32896, 32896, 36844, 40791, 40791, 36844, 32896, 32896, 32896, 32896, 32896, 30264, 30264,
        30264, 32896, 32896, 32896, 32896, 32896, 36844, 40791, 40791, 36844, 32896, 32896, 32896, 32896, 32896, 30264,
        40000, 30264, 32896, 32896, 32896, 32896, 32896, 36844, 40791, 40791, 36844, 32896, 32896, 32896, 32896, 32896,
        30264, 30264, 30264, 32896, 32896, 32896, 32896, 32896, 28948, 25001, 40791, 36844, 32896, 32896, 32896, 32896,
        32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 28948, 25001, 40791, 36844, 32896, 32896, 32896,
        32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 28948, 25001, 40791, 36844, 32896, 32896,
        32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 28948, 25001, 40791, 36844, 32896,
        32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 28948, 25001, 40791, 36844,
        32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 32896, 28948, 25001, 40791,
        36844, 36844, 36844, 36844, 36844, 36844, 36844, 36844, 28948, 28948, 28948, 28948, 28948, 28948, 28948, 25001,
        40791, 40791, 40791, 40791, 40791, 40791, 40791, 40791, 40791, 25001, 25001, 25001, 25001, 25001, 25001, 25001,
        25001,
      ]),
    );
  });

  it("matches the engine bit-exactly — 11×11, width 4, grey colour 255 (clamp)", () => {
    expect(pictureFrame2D(fill(11, 11, 40000), 4, 255)).toEqual([
      [65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535],
      [65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535],
      [65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535],
      [65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535],
      [65535, 65535, 65535, 65535, 40000, 40000, 40000, 65535, 65535, 65535, 65535],
      [65535, 65535, 65535, 65535, 40000, 40000, 40000, 65535, 65535, 65535, 65535],
      [65535, 65535, 65535, 65535, 40000, 40000, 40000, 65535, 65535, 65535, 57671],
      [65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 57671],
      [65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 57671],
      [65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 57671],
      [65535, 65535, 65535, 65535, 65535, 65535, 57671, 57671, 57671, 57671, 57671],
    ]);
  });
});
