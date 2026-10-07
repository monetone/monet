// Unit tests for the Hue/Saturation helpers. Engine-free (node); the dialog +
// engine wiring are covered by the e2e suite + the Rust side. These pin the pure
// math: the HSL round-trip (must match color.rs), hue rotation, saturation scale,
// lightness shift, and the achromatic short-circuits.
import { describe, it, expect } from "vitest";
import {
  defaultHueSaturation,
  rgbToHsl,
  hslToRgb,
  hueSaturationArgs,
  packHueSaturation,
  unpackHueSaturation,
  applyHueSaturation,
  HS_PARAMS,
  HS_RANGES,
  HUE_MIN,
  HUE_MAX,
  SAT_MIN,
  SAT_MAX,
  LIGHT_MIN,
  LIGHT_MAX,
  type HueSaturationState,
} from "./hueSaturation";

const st = (over: Partial<HueSaturationState> = {}): HueSaturationState => ({ ...defaultHueSaturation(), ...over });

describe("defaults, ranges & packing", () => {
  it("default is identity (0,0,0)", () => {
    expect(defaultHueSaturation()).toEqual({
      hue: 0,
      saturation: 0,
      lightness: 0,
      colorize: false,
      ranges: HS_RANGES.map(() => [0, 0, 0]),
    });
  });

  it("range constants are the Photoshop slider bounds", () => {
    expect([HUE_MIN, HUE_MAX]).toEqual([-180, 180]);
    expect([SAT_MIN, SAT_MAX]).toEqual([-100, 100]);
    expect([LIGHT_MIN, LIGHT_MAX]).toEqual([-100, 100]);
  });

  it("hueSaturationArgs / packHueSaturation normalise sat & light by 100", () => {
    expect(hueSaturationArgs({ hue: 120, saturation: 50, lightness: -20 })).toEqual([120, 0.5, -0.2]);
    const m = packHueSaturation({ hue: 120, saturation: 50, lightness: -20 });
    expect(m).toBeInstanceOf(Float32Array);
    expect(m.length).toBe(3);
    expect(m[0]).toBeCloseTo(120, 6);
    expect(m[1]).toBeCloseTo(0.5, 6);
    expect(m[2]).toBeCloseTo(-0.2, 6);
  });

  it("packs and unpacks Colorize plus all six colour ranges", () => {
    const state = defaultHueSaturation();
    state.hue = 215;
    state.saturation = 40;
    state.lightness = -10;
    state.colorize = true;
    state.ranges![4] = [30, -25, 15];
    const packed = packHueSaturation(state);
    expect(packed).toHaveLength(HS_PARAMS);
    expect(packed[3]).toBe(1);
    expect(packed[4 + 4 * 3]).toBe(30);
    expect(packed[5 + 4 * 3]).toBeCloseTo(-0.25, 6);
    expect(unpackHueSaturation(packed)).toEqual(expect.objectContaining({
      hue: 215,
      saturation: expect.closeTo(40, 5),
      lightness: expect.closeTo(-10, 5),
      colorize: true,
    }));
  });

  it("canonicalizes persisted master values to the engine's active mode", () => {
    const colorize = new Float32Array(HS_PARAMS);
    colorize.set([-60, -0.4, 0, 1]);
    expect(unpackHueSaturation(colorize)).toEqual(expect.objectContaining({
      hue: 300,
      saturation: 0,
      colorize: true,
    }));

    const shifted = new Float32Array(HS_PARAMS);
    shifted.set([300, 0.4, 0, 0]);
    expect(unpackHueSaturation(shifted)).toEqual(expect.objectContaining({
      hue: -60,
      saturation: expect.closeTo(40, 5),
      colorize: false,
    }));
  });
});

describe("HSL round-trip (mirrors color.rs)", () => {
  it("primaries convert to the expected HSL", () => {
    expect(rgbToHsl(1, 0, 0)).toMatchObject({ h: 0, s: 1, l: 0.5 });
    expect(rgbToHsl(0, 1, 0)).toMatchObject({ h: 120, s: 1, l: 0.5 });
    expect(rgbToHsl(0, 0, 1)).toMatchObject({ h: 240, s: 1, l: 0.5 });
    expect(rgbToHsl(0.5, 0.5, 0.5)).toMatchObject({ h: 0, s: 0, l: 0.5 });
  });

  it("hslToRgb inverts rgbToHsl byte-exactly across a pixel set", () => {
    for (const [r, g, b] of [
      [0, 0, 0],
      [255, 255, 255],
      [255, 0, 0],
      [12, 200, 90],
      [70, 130, 180],
      [240, 240, 10],
      [33, 33, 200],
    ]) {
      const hsl = rgbToHsl(r / 255, g / 255, b / 255);
      const back = hslToRgb(hsl.h, hsl.s, hsl.l);
      expect(Math.round(back.r * 255)).toBe(r);
      expect(Math.round(back.g * 255)).toBe(g);
      expect(Math.round(back.b * 255)).toBe(b);
    }
  });

  it("achromatic short-circuits: gray → s=0, and s≈0 → (l,l,l)", () => {
    expect(rgbToHsl(0.3, 0.3, 0.3)).toEqual({ h: 0, s: 0, l: 0.3 });
    expect(hslToRgb(123, 0, 0.42)).toEqual({ r: 0.42, g: 0.42, b: 0.42 });
  });
});

describe("identity", () => {
  it("(0,0,0) is a no-op for any pixel", () => {
    for (const [r, g, b] of [
      [0, 0, 0],
      [255, 255, 255],
      [255, 0, 0],
      [64, 128, 192],
      [200, 40, 90],
      [17, 240, 33],
    ]) {
      expect(applyHueSaturation(defaultHueSaturation(), r, g, b)).toEqual({ r, g, b });
    }
  });
});

describe("hue rotation", () => {
  it("rotates a primary onto the next primary", () => {
    expect(applyHueSaturation(st({ hue: 120 }), 255, 0, 0)).toEqual({ r: 0, g: 255, b: 0 });
    expect(applyHueSaturation(st({ hue: 240 }), 255, 0, 0)).toEqual({ r: 0, g: 0, b: 255 });
    expect(applyHueSaturation(st({ hue: -120 }), 255, 0, 0)).toEqual({ r: 0, g: 0, b: 255 });
    expect(applyHueSaturation(st({ hue: 120 }), 0, 255, 0)).toEqual({ r: 0, g: 0, b: 255 });
  });

  it("+180° red → cyan", () => {
    expect(applyHueSaturation(st({ hue: 180 }), 255, 0, 0)).toEqual({ r: 0, g: 255, b: 255 });
  });

  it("hue wraps (rem_euclid): +360° and −360° are no-ops", () => {
    expect(applyHueSaturation(st({ hue: 360 }), 200, 40, 90)).toEqual({ r: 200, g: 40, b: 90 });
    expect(applyHueSaturation(st({ hue: -360 }), 200, 40, 90)).toEqual({ r: 200, g: 40, b: 90 });
  });

  it("does not touch grays (saturation 0)", () => {
    expect(applyHueSaturation(st({ hue: 90 }), 128, 128, 128)).toEqual({ r: 128, g: 128, b: 128 });
  });
});

describe("colour ranges and Colorize", () => {
  it("applies a range at full strength to a dark fully saturated colour", () => {
    const state = defaultHueSaturation();
    state.ranges![0] = [120, 0, 0];
    expect(applyHueSaturation(state, 51, 0, 0)).toEqual({ r: 0, g: 51, b: 0 });
    expect(applyHueSaturation(state, 0, 0, 51)).toEqual({ r: 0, g: 0, b: 51 });
  });

  it("Colorize forces one hue while preserving each pixel's lightness", () => {
    const state = st({ hue: 120, saturation: 100, colorize: true });
    const a = applyHueSaturation(state, 120, 60, 20);
    const b = applyHueSaturation(state, 10, 40, 200);
    expect(a.g).toBeGreaterThan(a.r);
    expect(a.g).toBeGreaterThan(a.b);
    expect(b.g).toBeGreaterThan(b.r);
    expect(b.g).toBeGreaterThan(b.b);
  });
});

describe("saturation", () => {
  it("−100 fully desaturates to the pixel's gray (l)", () => {
    expect(applyHueSaturation(st({ saturation: -100 }), 255, 0, 0)).toEqual({ r: 128, g: 128, b: 128 });
    expect(applyHueSaturation(st({ saturation: -100 }), 0, 0, 255)).toEqual({ r: 128, g: 128, b: 128 });
  });

  it("+100 saturates a muted colour (spreads the channels apart)", () => {
    const muted: [number, number, number] = [150, 110, 110];
    const out = applyHueSaturation(st({ saturation: 100 }), ...muted);
    expect(out.r - out.b).toBeGreaterThan(muted[0] - muted[2]);
  });

  it("+100 on an already-fully-saturated colour clamps (exact no-op)", () => {
    // s*(1+1)=2 → clamp 1; red is already s=1 at l=0.5, so it is unchanged.
    expect(applyHueSaturation(st({ saturation: 100 }), 255, 0, 0)).toEqual({ r: 255, g: 0, b: 0 });
    expect(applyHueSaturation(st({ saturation: 100 }), 0, 255, 0)).toEqual({ r: 0, g: 255, b: 0 });
  });
});

describe("lightness", () => {
  it("+100 → white, −100 → black, for any colour", () => {
    expect(applyHueSaturation(st({ lightness: 100 }), 255, 0, 0)).toEqual({ r: 255, g: 255, b: 255 });
    expect(applyHueSaturation(st({ lightness: 100 }), 12, 90, 200)).toEqual({ r: 255, g: 255, b: 255 });
    expect(applyHueSaturation(st({ lightness: -100 }), 255, 0, 0)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("+50 brightens, −50 darkens (luminance moves the right way)", () => {
    const px: [number, number, number] = [120, 90, 60];
    const lum = (o: { r: number; g: number; b: number }) => 0.299 * o.r + 0.587 * o.g + 0.114 * o.b;
    expect(lum(applyHueSaturation(st({ lightness: 50 }), ...px))).toBeGreaterThan(lum({ r: px[0], g: px[1], b: px[2] }));
    expect(lum(applyHueSaturation(st({ lightness: -50 }), ...px))).toBeLessThan(lum({ r: px[0], g: px[1], b: px[2] }));
  });
});

describe("determinism", () => {
  it("repeats exactly", () => {
    const s = st({ hue: 35, saturation: 40, lightness: -15 });
    expect(applyHueSaturation(s, 70, 130, 180)).toEqual(applyHueSaturation(s, 70, 130, 180));
  });
});

// ── Several fixtures swept for in-gamut + determinism ───────────────────────
const FIXTURES: { name: string; state: HueSaturationState }[] = [
  { name: "warm shift +20°", state: { hue: 20, saturation: 0, lightness: 0 } },
  { name: "punchy +60 sat", state: { hue: 0, saturation: 60, lightness: 0 } },
  { name: "muted −60 sat", state: { hue: 0, saturation: -60, lightness: 0 } },
  { name: "teal rotate −90° + lift", state: { hue: -90, saturation: 20, lightness: 25 } },
  { name: "extreme", state: { hue: 180, saturation: 100, lightness: -40 } },
  { name: "dark + desat", state: { hue: -150, saturation: -80, lightness: -60 } },
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
      const out = applyHueSaturation(state, r, g, b);
      for (const c of [out.r, out.g, out.b]) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
      expect(applyHueSaturation(state, r, g, b)).toEqual(out);
    }
  });
});
