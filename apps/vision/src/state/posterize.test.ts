// Unit tests for the Posterize helpers. Engine-free (node); the dialog + engine
// wiring are covered by the e2e suite + the Rust side. These pin the pure math: the
// round(c*n)/n quantizer, the levels clamp, the exact step values, and idempotence.
import { describe, it, expect } from "vitest";
import {
  clampLevels,
  posterizeStep,
  quantize,
  posterizeLevels,
  applyPosterize,
  POSTERIZE_MIN,
  POSTERIZE_MAX,
  DEFAULT_LEVELS,
} from "./posterize";

describe("clampLevels & posterizeStep", () => {
  it("rounds and clamps to 2..255", () => {
    expect(clampLevels(6)).toBe(6);
    expect(clampLevels(1)).toBe(POSTERIZE_MIN);
    expect(clampLevels(0)).toBe(2);
    expect(clampLevels(-5)).toBe(2);
    expect(clampLevels(999)).toBe(POSTERIZE_MAX);
    expect(clampLevels(4.4)).toBe(4);
    expect(clampLevels(4.6)).toBe(5);
  });

  it("step n = levels − 1 (≥1)", () => {
    expect(posterizeStep(2)).toBe(1);
    expect(posterizeStep(4)).toBe(3);
    expect(posterizeStep(1)).toBe(1); // clamped to 2 → n=1
    expect([POSTERIZE_MIN, POSTERIZE_MAX, DEFAULT_LEVELS]).toEqual([2, 255, 6]);
  });
});

describe("quantize", () => {
  it("snaps to the nearest of n+1 levels", () => {
    expect(quantize(0, 3)).toBe(0);
    expect(quantize(1, 3)).toBe(1);
    expect(quantize(0.2, 3)).toBeCloseTo(1 / 3, 9); // round(0.6)=1
    expect(quantize(0.5, 3)).toBeCloseTo(2 / 3, 9); // round(1.5)=2 (half-up)
  });
});

describe("posterizeLevels — output value set", () => {
  it("levels 2 → [0,255]; 3 → [0,128,255]; 4 → [0,85,170,255]", () => {
    expect(posterizeLevels(2)).toEqual([0, 255]);
    expect(posterizeLevels(3)).toEqual([0, 128, 255]);
    expect(posterizeLevels(4)).toEqual([0, 85, 170, 255]);
  });

  it("has exactly `levels` entries, ascending, spanning 0..255", () => {
    for (const L of [2, 5, 6, 10, 16]) {
      const lv = posterizeLevels(L);
      expect(lv.length).toBe(L);
      expect(lv[0]).toBe(0);
      expect(lv[lv.length - 1]).toBe(255);
      for (let i = 1; i < lv.length; i++) expect(lv[i]).toBeGreaterThan(lv[i - 1]);
    }
  });
});

describe("applyPosterize — pixels", () => {
  it("the max level (255) is near-identity — every value within ±1 of itself", () => {
    // 255 levels (n=254) doesn't align to the 256 8-bit codes, so it's near- but
    // not exactly identity; endpoints are exact. (Photoshop caps levels at 255.)
    for (let v = 0; v <= 255; v++) {
      expect(Math.abs(applyPosterize(POSTERIZE_MAX, v, v, v).r - v)).toBeLessThanOrEqual(1);
    }
    expect(applyPosterize(POSTERIZE_MAX, 0, 0, 0)).toEqual({ r: 0, g: 0, b: 0 });
    expect(applyPosterize(POSTERIZE_MAX, 255, 255, 255)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("levels 2 is a binary threshold at 0.5 (127→black, 128→white)", () => {
    expect(applyPosterize(2, 127, 127, 127)).toEqual({ r: 0, g: 0, b: 0 });
    expect(applyPosterize(2, 128, 128, 128)).toEqual({ r: 255, g: 255, b: 255 });
    expect(applyPosterize(2, 0, 0, 0)).toEqual({ r: 0, g: 0, b: 0 });
    expect(applyPosterize(2, 255, 255, 255)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("levels 4 quantizes each channel independently to {0,85,170,255}", () => {
    expect(applyPosterize(4, 40, 128, 220)).toEqual({ r: 0, g: 170, b: 255 });
    expect(applyPosterize(4, 200, 60, 150)).toEqual({ r: 170, g: 85, b: 170 });
    const allowed = new Set([0, 85, 170, 255]);
    const out = applyPosterize(4, 17, 99, 233);
    for (const c of [out.r, out.g, out.b]) expect(allowed.has(c)).toBe(true);
  });

  it("levels below 2 clamp to 2 (binary)", () => {
    expect(applyPosterize(1, 200, 200, 200)).toEqual(applyPosterize(2, 200, 200, 200));
    expect(applyPosterize(0, 60, 60, 60)).toEqual(applyPosterize(2, 60, 60, 60));
  });

  it("is idempotent: posterizing an already-posterized pixel is a no-op", () => {
    for (const L of [2, 3, 4, 6, 8, 16, 32]) {
      for (const [r, g, b] of [
        [10, 130, 240],
        [255, 0, 128],
        [77, 77, 77],
        [200, 33, 190],
      ]) {
        const once = applyPosterize(L, r, g, b);
        const twice = applyPosterize(L, once.r, once.g, once.b);
        expect(twice).toEqual(once);
      }
    }
  });

  it("is monotonic per channel (brighter input never darkens)", () => {
    for (const L of [2, 4, 8]) {
      let prev = -1;
      for (let v = 0; v <= 255; v++) {
        const out = applyPosterize(L, v, v, v).r;
        expect(out).toBeGreaterThanOrEqual(prev);
        prev = out;
      }
    }
  });

  it("a gray ramp collapses to exactly `levels` distinct values", () => {
    for (const L of [2, 3, 4, 6]) {
      const seen = new Set<number>();
      for (let v = 0; v <= 255; v++) seen.add(applyPosterize(L, v, v, v).r);
      expect(seen.size).toBe(L);
    }
  });

  it("is deterministic", () => {
    expect(applyPosterize(5, 70, 130, 180)).toEqual(applyPosterize(5, 70, 130, 180));
  });
});

// ── Several level fixtures swept for in-gamut + allowed-value membership ─────
describe.each([2, 3, 4, 6, 8, 12])("fixture: levels=%i", (L) => {
  it("every channel lands on an allowed level and stays in-gamut", () => {
    const allowed = new Set(posterizeLevels(L));
    const pixels: [number, number, number][] = [
      [0, 0, 0],
      [64, 128, 192],
      [255, 255, 255],
      [220, 30, 70],
      [128, 128, 128],
      [13, 240, 91],
    ];
    for (const [r, g, b] of pixels) {
      const out = applyPosterize(L, r, g, b);
      for (const c of [out.r, out.g, out.b]) {
        expect(Number.isInteger(c)).toBe(true);
        expect(allowed.has(c)).toBe(true);
      }
    }
  });
});
