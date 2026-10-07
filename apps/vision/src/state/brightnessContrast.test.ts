// Unit tests for the Brightness/Contrast helpers. Engine-free (node); the dialog +
// engine wiring are covered by the e2e suite + the Rust side. These pin the pure
// math: the (1+contrast) scale around mid-gray + the brightness offset, the pivot
// collapse at contrast −100, and clamping.
import { describe, it, expect } from "vitest";
import {
  defaultBrightnessContrast,
  brightnessContrastArgs,
  packBrightnessContrast,
  applyBrightnessContrastChannel,
  applyBrightnessContrast,
  BRIGHTNESS_MIN,
  BRIGHTNESS_MAX,
  CONTRAST_MIN,
  CONTRAST_MAX,
  type BrightnessContrastState,
} from "./brightnessContrast";

const st = (over: Partial<BrightnessContrastState> = {}): BrightnessContrastState => ({
  ...defaultBrightnessContrast(),
  ...over,
});

describe("defaults, ranges & packing", () => {
  it("default is identity (0,0)", () => {
    expect(defaultBrightnessContrast()).toEqual({ brightness: 0, contrast: 0 });
  });

  it("range constants are the Photoshop slider bounds", () => {
    expect([BRIGHTNESS_MIN, BRIGHTNESS_MAX]).toEqual([-100, 100]);
    expect([CONTRAST_MIN, CONTRAST_MAX]).toEqual([-100, 100]);
  });

  it("args / packBrightnessContrast normalise by 100 (kind-0 layout)", () => {
    expect(brightnessContrastArgs({ brightness: 40, contrast: -20 })).toEqual([0.4, -0.2]);
    const m = packBrightnessContrast({ brightness: 40, contrast: -20 });
    expect(m).toBeInstanceOf(Float32Array);
    expect(m.length).toBe(2);
    expect(m[0]).toBeCloseTo(0.4, 6);
    expect(m[1]).toBeCloseTo(-0.2, 6);
  });
});

describe("applyBrightnessContrastChannel (mirrors the engine)", () => {
  it("identity (b=0, contrastMul=1) passes through", () => {
    expect(applyBrightnessContrastChannel(0.42, 0, 1)).toBeCloseTo(0.42, 9);
  });

  it("contrast pivots around 0.5; brightness is a flat add", () => {
    expect(applyBrightnessContrastChannel(0.5, 0, 2)).toBeCloseTo(0.5, 9); // pivot fixed
    expect(applyBrightnessContrastChannel(0.25, 0, 2)).toBeCloseTo(0, 9);
    expect(applyBrightnessContrastChannel(0.75, 0, 2)).toBeCloseTo(1, 9);
    expect(applyBrightnessContrastChannel(0.3, 0.2, 1)).toBeCloseTo(0.5, 9);
  });

  it("returns unclamped values (callers clamp once at the byte boundary)", () => {
    expect(applyBrightnessContrastChannel(0.9, 0, 2)).toBeCloseTo(1.3, 9); // > 1, not clamped here
    expect(applyBrightnessContrastChannel(0.1, 0, 2)).toBeCloseTo(-0.3, 9); // < 0, not clamped here
  });
});

describe("applyBrightnessContrast — pixels", () => {
  it("identity is a no-op for any pixel", () => {
    for (const [r, g, b] of [
      [0, 0, 0],
      [255, 255, 255],
      [64, 128, 192],
      [200, 40, 90],
    ]) {
      expect(applyBrightnessContrast(defaultBrightnessContrast(), r, g, b)).toEqual({ r, g, b });
    }
  });

  it("brightness +50 lifts black to mid-gray", () => {
    expect(applyBrightnessContrast(st({ brightness: 50 }), 0, 0, 0)).toEqual({ r: 128, g: 128, b: 128 });
  });

  it("brightness ±100 crushes to black / white", () => {
    expect(applyBrightnessContrast(st({ brightness: -100 }), 255, 255, 255)).toEqual({ r: 0, g: 0, b: 0 });
    expect(applyBrightnessContrast(st({ brightness: 100 }), 0, 0, 0)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("contrast −100 collapses every pixel to the mid-gray pivot", () => {
    for (const [r, g, b] of [
      [255, 0, 0],
      [0, 0, 0],
      [255, 255, 255],
      [30, 200, 120],
    ]) {
      expect(applyBrightnessContrast(st({ contrast: -100 }), r, g, b)).toEqual({ r: 128, g: 128, b: 128 });
    }
  });

  it("contrast +100 keeps black/white and pushes darks down / lights up", () => {
    expect(applyBrightnessContrast(st({ contrast: 100 }), 0, 0, 0)).toEqual({ r: 0, g: 0, b: 0 });
    expect(applyBrightnessContrast(st({ contrast: 100 }), 255, 255, 255)).toEqual({ r: 255, g: 255, b: 255 });
    // a quarter-tone is pushed to (near) black; a three-quarter tone to (near) white
    expect(applyBrightnessContrast(st({ contrast: 100 }), 64, 64, 64).r).toBeLessThan(64);
    expect(applyBrightnessContrast(st({ contrast: 100 }), 192, 192, 192).r).toBeGreaterThan(192);
  });

  it("combined brightness + contrast (exact)", () => {
    // 128/255≈0.50196; (0.50196−0.5)*2 + 0.5 + 0.2 = 0.70392·255 = 179.4999… → 179.
    expect(applyBrightnessContrast(st({ brightness: 20, contrast: 100 }), 128, 128, 128)).toEqual({
      r: 179,
      g: 179,
      b: 179,
    });
  });

  it("is deterministic", () => {
    const s = st({ brightness: 15, contrast: -35 });
    expect(applyBrightnessContrast(s, 70, 130, 180)).toEqual(applyBrightnessContrast(s, 70, 130, 180));
  });
});

describe("monotonicity — brighter input never yields darker output (contrast ≥ 0)", () => {
  it("holds across the ramp for a positive-contrast op", () => {
    const s = st({ brightness: 10, contrast: 60 });
    let prev = -1;
    for (let v = 0; v <= 255; v++) {
      const out = applyBrightnessContrast(s, v, v, v).r;
      expect(out).toBeGreaterThanOrEqual(prev);
      prev = out;
    }
  });
});

// ── Several fixtures swept for finite, in-gamut, deterministic output ────────
const FIXTURES: { name: string; state: BrightnessContrastState }[] = [
  { name: "brighten +30", state: { brightness: 30, contrast: 0 } },
  { name: "darken -40", state: { brightness: -40, contrast: 0 } },
  { name: "punch +50 contrast", state: { brightness: 0, contrast: 50 } },
  { name: "flatten -70 contrast", state: { brightness: 0, contrast: -70 } },
  { name: "bright + contrasty", state: { brightness: 25, contrast: 40 } },
  { name: "extreme", state: { brightness: -100, contrast: 100 } },
];

describe.each(FIXTURES)("fixture: $name", ({ state }) => {
  it("produces finite, in-gamut, deterministic output across a pixel set", () => {
    const pixels: [number, number, number][] = [
      [0, 0, 0],
      [64, 128, 192],
      [255, 255, 255],
      [220, 30, 70],
      [128, 128, 128],
    ];
    for (const [r, g, b] of pixels) {
      const out = applyBrightnessContrast(state, r, g, b);
      for (const c of [out.r, out.g, out.b]) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
      expect(applyBrightnessContrast(state, r, g, b)).toEqual(out);
    }
  });
});
