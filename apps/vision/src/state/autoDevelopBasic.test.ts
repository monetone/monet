// Unit tests for the Camera Raw Auto tone heuristic. Engine-free (node); the
// Auto button + recipe application are covered by the camera-raw-workspace e2e.
import { describe, it, expect } from "vitest";
import { autoDevelopBasic } from "./autoDevelopBasic";

/** A w×h opaque grey field at `base`. */
function field(w: number, h: number, base: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < px.length; i += 4) { px[i] = base; px[i + 1] = base; px[i + 2] = base; px[i + 3] = 255; }
  return px;
}

describe("autoDevelopBasic", () => {
  it("raises exposure on a dark image", () => {
    expect(autoDevelopBasic(field(16, 16, 25), 16, 16).exposure).toBeGreaterThan(0);
  });

  it("lowers exposure on a bright image", () => {
    expect(autoDevelopBasic(field(16, 16, 230), 16, 16).exposure).toBeLessThan(0);
  });

  it("stretches whites up and blacks down on a low-contrast image", () => {
    const w = 32, h = 32;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      const v = 123 + (p % 11); // a narrow midtone band (123..133)
      px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255;
    }
    const a = autoDevelopBasic(px, w, h);
    expect(a.whites).toBeGreaterThan(0);
    expect(a.blacks).toBeLessThan(0);
  });

  it("keeps values in recipe range (exposure ±2 EV, rest ±1)", () => {
    const a = autoDevelopBasic(field(16, 16, 10), 16, 16);
    expect(a.exposure).toBeGreaterThanOrEqual(-2);
    expect(a.exposure).toBeLessThanOrEqual(2);
    for (const k of ["contrast", "highlights", "shadows", "whites", "blacks"] as const) {
      expect(a[k]).toBeGreaterThanOrEqual(-1);
      expect(a[k]).toBeLessThanOrEqual(1);
    }
  });
});

// The engine applies the Auto recipe in a fixed order (develop.rs): camera_raw
// (exposure → contrast → highlights/shadows, clamped to [0,1]) and only THEN
// whites_blacks. This mirrors that order for a neutral grey, so the endpoint
// derivation can be checked against what the engine actually renders (#150).
function develop(v: number, a: ReturnType<typeof autoDevelopBasic>): number {
  const cl = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const t = (v * 2 ** a.exposure - 0.5) * (1 + a.contrast) + 0.5;
  const hw = cl(t * 2 - 1), sw = cl(1 - t * 2);
  const stage1 = cl(t + a.highlights * hw * 0.5 + a.shadows * sw * 0.5);
  const whitePt = 1 - a.whites * 0.5, blackPt = -a.blacks * 0.5;
  return cl((stage1 - blackPt) / Math.max(1e-4, whitePt - blackPt)); // adjust::levels_one
}

/** A 1×n grey ramp spanning `from`..`to` (8-bit). */
function ramp(n: number, from: number, to: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(n * 4);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const v = Math.round(from + (p * (to - from)) / (n - 1));
    px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255;
  }
  return px;
}

function clipped(px: Uint8ClampedArray, a: ReturnType<typeof autoDevelopBasic>) {
  let white = 0, black = 0;
  for (let p = 0; p < px.length / 4; p++) {
    const o = develop(px[p * 4] / 255, a);
    if (o >= 1) white++;
    if (o <= 0) black++;
  }
  return { white: white / (px.length / 4), black: black / (px.length / 4) };
}

describe("autoDevelopBasic endpoints vs the engine's apply order", () => {
  it("does not blow an underexposed frame to white (#150)", () => {
    // The issue's repro: a 1000px ramp over bytes 0..153 (median 0.30, p99 0.59).
    const px = ramp(1000, 0, 153);
    const c = clipped(px, autoDevelopBasic(px, 1000, 1));
    expect(c.white).toBeLessThan(0.01); // was 0.448 with pre-exposure percentiles
    expect(c.black).toBeLessThan(0.01);
  });

  it("does not crush an overexposed frame to black", () => {
    const px = ramp(1000, 180, 255);
    const c = clipped(px, autoDevelopBasic(px, 1000, 1));
    expect(c.white).toBeLessThan(0.02);
    expect(c.black).toBeLessThan(0.02);
  });

  it("lands the toned percentiles on the tone endpoints", () => {
    const px = ramp(1000, 30, 200);
    const a = autoDevelopBasic(px, 1000, 1);
    const out = Array.from({ length: 1000 }, (_, p) => develop(px[p * 4] / 255, a)).sort((x, y) => x - y);
    expect(out[9]).toBeCloseTo(0.01, 1);   // 1st percentile → black point
    expect(out[989]).toBeCloseTo(0.99, 1); // 99th percentile → white point
  });

  it("leaves the endpoints alone on a flat field (nothing to stretch)", () => {
    const a = autoDevelopBasic(field(16, 16, 128), 16, 16);
    expect(a.whites).toBe(0);
    expect(a.blacks).toBe(0);
  });
});
