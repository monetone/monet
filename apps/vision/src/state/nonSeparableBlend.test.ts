// Unit tests for the non-separable (whole-pixel) blend modes. Engine-free (node).
// These pin the W3C helpers (lum/sat/clipColor/setLum/setSat) and the six modes
// against blend.rs / color.rs, plus the load-bearing luminosity-preservation and
// identity invariants.
import { describe, it, expect } from "vitest";
import {
  lum,
  sat,
  clipColor,
  setLum,
  setSat,
  blendNonSeparable,
  blendNonSeparablePixel,
  NON_SEPARABLE_BLEND_MODES,
  LUM_R,
  LUM_G,
  LUM_B,
  type C3,
  type NonSeparableBlendKey,
} from "./nonSeparableBlend";

const KEYS = NON_SEPARABLE_BLEND_MODES.map((m) => m.key);
const GRID = [0, 0.25, 0.5, 0.75, 1];

describe("metadata & weights", () => {
  it("six modes with the engine u8 values (21-24, 26, 27)", () => {
    expect(NON_SEPARABLE_BLEND_MODES.map((m) => m.value)).toEqual([21, 22, 23, 24, 26, 27]);
    expect(KEYS).toEqual(["hue", "saturation", "color", "luminosity", "darkerColor", "lighterColor"]);
    expect(new Set(NON_SEPARABLE_BLEND_MODES.map((m) => m.label)).size).toBe(6);
  });

  it("uses the W3C luminosity weights (0.3/0.59/0.11, sum 1)", () => {
    expect([LUM_R, LUM_G, LUM_B]).toEqual([0.3, 0.59, 0.11]);
    expect(lum([1, 1, 1])).toBeCloseTo(1, 9);
    expect(lum([1, 0, 0])).toBeCloseTo(0.3, 9);
    expect(lum([0, 1, 0])).toBeCloseTo(0.59, 9);
    expect(lum([0, 0, 1])).toBeCloseTo(0.11, 9);
  });
});

describe("helpers", () => {
  it("sat = max − min", () => {
    expect(sat([1, 0, 0])).toBe(1);
    expect(sat([0.5, 0.5, 0.5])).toBe(0);
    expect(sat([0.8, 0.4, 0.2])).toBeCloseTo(0.6, 9);
  });

  it("setSat rescales mid into [0,s]; min→0, max→s; ordering preserved", () => {
    const ss = setSat([0.8, 0.4, 0.2], 0.6); // max→0.6, mid (0.4) → (0.4-0.2)/0.6·0.6 = 0.2, min→0
    expect(ss[0]).toBeCloseTo(0.6, 9);
    expect(ss[1]).toBeCloseTo(0.2, 9);
    expect(ss[2]).toBe(0);
    const out = setSat([0.2, 0.9, 0.5], 0.4); // order b>mid>r: idx max=1,mid=2,min=0
    expect(sat(out)).toBeCloseTo(0.4, 9);
    expect(Math.min(...out)).toBe(0);
    expect(Math.max(...out)).toBeCloseTo(0.4, 9);
  });

  it("setSat of a flat colour stays flat (no max>min)", () => {
    expect(setSat([0.5, 0.5, 0.5], 0.7)).toEqual([0, 0, 0]);
  });

  it("setLum hits the target luminosity and stays in gamut", () => {
    expect(setLum([0.6, 0.2, 0], 0.5)).toEqual([0.802, 0.402, 0.202]);
    for (const target of [0, 0.2, 0.5, 0.8, 1]) {
      const out = setLum([0.9, 0.1, 0.3], target);
      expect(lum(out)).toBeCloseTo(target, 5);
      for (const v of out) {
        expect(v).toBeGreaterThanOrEqual(-1e-9);
        expect(v).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it("clipColor brings an out-of-gamut colour into [0,1] preserving luminosity", () => {
    const c: C3 = [1.2, 0.5, -0.2];
    const out = clipColor(c);
    expect(lum(out)).toBeCloseTo(lum(c), 5);
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(-1e-9);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe("the four hue/sat/lum modes", () => {
  it("are the identity when source equals backdrop", () => {
    const c: C3 = [0.6, 0.3, 0.8];
    for (const m of ["hue", "saturation", "color", "luminosity"] as NonSeparableBlendKey[]) {
      const out = blendNonSeparable(m, c, c);
      out.forEach((v, i) => expect(v).toBeCloseTo(c[i], 6));
    }
  });

  it("Color / Hue / Saturation preserve the BACKDROP luminosity", () => {
    for (const m of ["color", "hue", "saturation"] as NonSeparableBlendKey[]) {
      for (const cb of [[0.2, 0.5, 0.9], [0.8, 0.1, 0.4], [0.5, 0.5, 0.5]] as C3[]) {
        for (const cs of [[0.9, 0.1, 0.2], [0.3, 0.7, 0.6]] as C3[]) {
          expect(lum(blendNonSeparable(m, cb, cs))).toBeCloseTo(lum(cb), 5);
        }
      }
    }
  });

  it("Luminosity takes the SOURCE luminosity (backdrop hue/sat)", () => {
    for (const cb of [[0.2, 0.5, 0.9], [0.8, 0.1, 0.4]] as C3[]) {
      for (const cs of [[0.9, 0.1, 0.2], [0.3, 0.7, 0.6]] as C3[]) {
        expect(lum(blendNonSeparable("luminosity", cb, cs))).toBeCloseTo(lum(cs), 5);
      }
    }
  });

  it("Color of a colour over a gray backdrop = computed pin", () => {
    // red onto 50% gray → fully saturated red at the gray's luminosity.
    expect(blendNonSeparablePixel("color", { r: 128, g: 128, b: 128 }, { r: 255, g: 0, b: 0 })).toEqual({
      r: 255,
      g: 74,
      b: 74,
    });
  });

  it("Saturation transfers the source's saturation onto the backdrop", () => {
    // gray source (sat 0) desaturates the backdrop while keeping its luminosity.
    const out = blendNonSeparable("saturation", [0.8, 0.2, 0.4], [0.5, 0.5, 0.5]);
    expect(sat(out)).toBeCloseTo(0, 6);
    expect(lum(out)).toBeCloseTo(lum([0.8, 0.2, 0.4]), 5);
  });
});

describe("Darker / Lighter Color (whole pixel by channel sum)", () => {
  it("pick the whole pixel with the smaller / larger channel sum", () => {
    const dark: C3 = [0.2, 0.2, 0.2]; // sum 0.6
    const bright: C3 = [0.8, 0.1, 0.1]; // sum 1.0
    expect(blendNonSeparable("darkerColor", dark, bright)).toEqual(dark);
    expect(blendNonSeparable("darkerColor", bright, dark)).toEqual(dark);
    expect(blendNonSeparable("lighterColor", dark, bright)).toEqual(bright);
    expect(blendNonSeparable("lighterColor", bright, dark)).toEqual(bright);
  });

  it("ties keep the backdrop", () => {
    // Dyadic values so the channel sums are exactly equal (1.0) in float.
    const cb: C3 = [0.5, 0.25, 0.25];
    const cs: C3 = [0.25, 0.25, 0.5]; // same sum 1.0
    expect(blendNonSeparable("darkerColor", cb, cs)).toBe(cb); // <= → cb
    expect(blendNonSeparable("lighterColor", cb, cs)).toBe(cb); // >= → cb
  });

  it("matches the engine's f32 sum at an integer-sum tie (not f64)", () => {
    // (1,3,10) and (3,10,1) both sum to 14/255 in f64 (a tie → backdrop), but their
    // f32 sums differ: cb is f32-larger, so Darker → cs and Lighter → cb.
    expect(blendNonSeparablePixel("darkerColor", { r: 1, g: 3, b: 10 }, { r: 3, g: 10, b: 1 })).toEqual({ r: 3, g: 10, b: 1 });
    expect(blendNonSeparablePixel("lighterColor", { r: 1, g: 3, b: 10 }, { r: 3, g: 10, b: 1 })).toEqual({ r: 1, g: 3, b: 10 });
  });
});

describe("invariants & blendNonSeparablePixel", () => {
  it("every mode yields an in-gamut colour across a grid", () => {
    for (const m of KEYS) for (const r of GRID) for (const g of GRID) for (const b of GRID) {
      const out = blendNonSeparable(m, [r, g, b], [g, b, r]);
      for (const v of out) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(-1e-6);
        expect(v).toBeLessThanOrEqual(1 + 1e-6);
      }
    }
  });

  it("blendNonSeparablePixel yields valid 8-bit ints and is deterministic", () => {
    const backdrop = { r: 60, g: 140, b: 200 };
    const source = { r: 220, g: 90, b: 40 };
    for (const m of KEYS) {
      const out = blendNonSeparablePixel(m, backdrop, source);
      for (const c of [out.r, out.g, out.b]) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
      expect(blendNonSeparablePixel(m, backdrop, source)).toEqual(out);
    }
  });
});

// ── Several backdrop/source fixtures swept across all six modes ──────────────
const FIXTURES: { name: string; backdrop: Rgbish; source: Rgbish }[] = [
  { name: "colour over photo", backdrop: { r: 60, g: 120, b: 200 }, source: { r: 220, g: 90, b: 40 } },
  { name: "gray over colour", backdrop: { r: 200, g: 40, b: 90 }, source: { r: 128, g: 128, b: 128 } },
  { name: "white over dark", backdrop: { r: 20, g: 20, b: 20 }, source: { r: 255, g: 255, b: 255 } },
  { name: "saturated swap", backdrop: { r: 240, g: 200, b: 10 }, source: { r: 10, g: 60, b: 220 } },
];
interface Rgbish { r: number; g: number; b: number; }

describe.each(FIXTURES)("fixture: $name", ({ backdrop, source }) => {
  it("every non-separable mode yields in-gamut, deterministic pixels", () => {
    for (const m of KEYS) {
      const out = blendNonSeparablePixel(m, backdrop, source);
      for (const c of [out.r, out.g, out.b]) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
      expect(blendNonSeparablePixel(m, backdrop, source)).toEqual(out);
    }
  });
});
