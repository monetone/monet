// Unit tests for the Vibrance helpers. Engine-free (node); the dialog + engine
// wiring are covered by the e2e suite + the Rust side. These pin the pure math: the
// HSV round-trip (must match color.rs), the (1-s)-weighted saturation boost, the
// flat saturation add, and the achromatic short-circuits.
import { describe, it, expect } from "vitest";
import {
  defaultVibrance,
  rgbToHsv,
  hsvToRgb,
  vibranceArgs,
  packVibrance,
  vibranceSaturation,
  applyVibrance,
  VIBRANCE_MIN,
  VIBRANCE_MAX,
  SATURATION_MIN,
  SATURATION_MAX,
  type VibranceState,
} from "./vibrance";

const st = (over: Partial<VibranceState> = {}): VibranceState => ({ ...defaultVibrance(), ...over });

describe("defaults, ranges & packing", () => {
  it("default is identity (0,0)", () => {
    expect(defaultVibrance()).toEqual({ vibrance: 0, saturation: 0 });
  });

  it("range constants are the Photoshop slider bounds", () => {
    expect([VIBRANCE_MIN, VIBRANCE_MAX]).toEqual([-100, 100]);
    expect([SATURATION_MIN, SATURATION_MAX]).toEqual([-100, 100]);
  });

  it("vibranceArgs / packVibrance normalise by 100", () => {
    expect(vibranceArgs({ vibrance: 40, saturation: -20 })).toEqual([0.4, -0.2]);
    const m = packVibrance({ vibrance: 40, saturation: -20 });
    expect(m).toBeInstanceOf(Float32Array);
    expect(m.length).toBe(2);
    expect(m[0]).toBeCloseTo(0.4, 6);
    expect(m[1]).toBeCloseTo(-0.2, 6);
  });
});

describe("HSV round-trip (mirrors color.rs)", () => {
  it("primaries and gray convert as expected", () => {
    expect(rgbToHsv(1, 0, 0)).toMatchObject({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv(0, 1, 0)).toMatchObject({ h: 120, s: 1, v: 1 });
    expect(rgbToHsv(0, 0, 1)).toMatchObject({ h: 240, s: 1, v: 1 });
    expect(rgbToHsv(0.5, 0.5, 0.5)).toMatchObject({ h: 0, s: 0, v: 0.5 });
    expect(rgbToHsv(0, 0, 0)).toMatchObject({ s: 0, v: 0 });
  });

  it("hsvToRgb inverts rgbToHsv byte-exactly across a pixel set", () => {
    for (const [r, g, b] of [
      [0, 0, 0],
      [255, 255, 255],
      [255, 0, 0],
      [12, 200, 90],
      [70, 130, 180],
      [240, 240, 10],
      [33, 33, 200],
      [200, 100, 50],
    ]) {
      const hsv = rgbToHsv(r / 255, g / 255, b / 255);
      const back = hsvToRgb(hsv.h, hsv.s, hsv.v);
      expect(Math.round(back.r * 255)).toBe(r);
      expect(Math.round(back.g * 255)).toBe(g);
      expect(Math.round(back.b * 255)).toBe(b);
    }
  });
});

describe("vibranceSaturation — the core remap", () => {
  it("identity leaves s unchanged", () => {
    for (const s of [0, 0.25, 0.5, 0.75, 1]) expect(vibranceSaturation(defaultVibrance(), s)).toBeCloseTo(s, 9);
  });

  it("vibrance boosts muted pixels more than vivid ones (the defining property)", () => {
    const v = st({ vibrance: 50 });
    const gainLow = vibranceSaturation(v, 0.2) - 0.2; // muted
    const gainHigh = vibranceSaturation(v, 0.8) - 0.8; // vivid
    expect(gainLow).toBeGreaterThan(gainHigh);
    expect(gainLow).toBeCloseTo(0.5 * (1 - 0.2), 9); // vib*(1-s)
    expect(gainHigh).toBeCloseTo(0.5 * (1 - 0.8), 9);
  });

  it("vibrance +100 drives every pixel to full saturation (s + (1-s) = 1)", () => {
    for (const s of [0, 0.3, 0.7]) expect(vibranceSaturation(st({ vibrance: 100 }), s)).toBeCloseTo(1, 9);
  });

  it("flat saturation adds uniformly and clamps", () => {
    expect(vibranceSaturation(st({ saturation: 30 }), 0.4)).toBeCloseTo(0.7, 9);
    expect(vibranceSaturation(st({ saturation: -100 }), 0.75)).toBe(0);
    expect(vibranceSaturation(st({ saturation: 100 }), 0.5)).toBe(1);
  });

  it("vibrance and flat saturation differ at partial values", () => {
    // both reach 1 at +100 but the path differs: vib weights by (1-s), sat is flat.
    expect(vibranceSaturation(st({ vibrance: 50 }), 0.2)).not.toBeCloseTo(
      vibranceSaturation(st({ saturation: 50 }), 0.2),
      3,
    );
  });
});

describe("applyVibrance — pixels", () => {
  it("identity is a no-op for any pixel", () => {
    for (const [r, g, b] of [
      [0, 0, 0],
      [255, 255, 255],
      [255, 0, 0],
      [64, 128, 192],
      [200, 100, 50],
      [17, 240, 33],
    ]) {
      expect(applyVibrance(defaultVibrance(), r, g, b)).toEqual({ r, g, b });
    }
  });

  it("saturation −100 desaturates to HSV gray at the max channel (value-preserving)", () => {
    expect(applyVibrance(st({ saturation: -100 }), 200, 100, 50)).toEqual({ r: 200, g: 200, b: 200 });
    expect(applyVibrance(st({ saturation: -100 }), 40, 160, 90)).toEqual({ r: 160, g: 160, b: 160 });
  });

  it("vibrance +100 yields a fully-saturated pixel (HSV s ≈ 1)", () => {
    const out = applyVibrance(st({ vibrance: 100 }), 200, 100, 50);
    const s = rgbToHsv(out.r / 255, out.g / 255, out.b / 255).s;
    expect(s).toBeGreaterThan(0.99);
  });

  it("pins exact golden RGB for a vibrance boost (full pipeline)", () => {
    // ns=1 at vib+100; value (max=200) preserved, hue 20° → saturated orange.
    expect(applyVibrance(st({ vibrance: 100 }), 200, 100, 50)).toEqual({ r: 200, g: 67, b: 0 });
  });

  it("engine-faithful: a neutral pixel under +saturation takes hue-0 (red), value preserved", () => {
    // Gray has no hue (forced to 0); adding saturation reproduces it as red — this
    // mirrors the engine (adjust.rs / kind 3), even if not Photoshop-intuitive.
    expect(applyVibrance(st({ vibrance: 100 }), 128, 128, 128)).toEqual({ r: 128, g: 0, b: 0 });
  });

  it("boosting a muted pixel raises its saturation more than a vivid one", () => {
    const v = st({ vibrance: 60 });
    const muted: [number, number, number] = [150, 120, 120];
    const vivid: [number, number, number] = [220, 30, 30];
    const dMuted = rgbToHsv(...rgbNorm(applyVibrance(v, ...muted))).s - rgbToHsv(...rgbNorm({ r: muted[0], g: muted[1], b: muted[2] })).s;
    const dVivid = rgbToHsv(...rgbNorm(applyVibrance(v, ...vivid))).s - rgbToHsv(...rgbNorm({ r: vivid[0], g: vivid[1], b: vivid[2] })).s;
    expect(dMuted).toBeGreaterThan(dVivid);
  });

  it("is deterministic", () => {
    const s = st({ vibrance: 35, saturation: -15 });
    expect(applyVibrance(s, 70, 130, 180)).toEqual(applyVibrance(s, 70, 130, 180));
  });
});

function rgbNorm(c: { r: number; g: number; b: number }): [number, number, number] {
  return [c.r / 255, c.g / 255, c.b / 255];
}

// ── Several fixtures swept for in-gamut + determinism ───────────────────────
const FIXTURES: { name: string; state: VibranceState }[] = [
  { name: "gentle vibrance", state: { vibrance: 30, saturation: 0 } },
  { name: "punchy both", state: { vibrance: 60, saturation: 20 } },
  { name: "desaturate", state: { vibrance: -50, saturation: -30 } },
  { name: "max vibrance", state: { vibrance: 100, saturation: 0 } },
  { name: "full grayscale", state: { vibrance: 0, saturation: -100 } },
  { name: "mixed extreme", state: { vibrance: -100, saturation: 80 } },
];

describe.each(FIXTURES)("fixture: $name", ({ state }) => {
  it("produces finite, in-gamut, deterministic output across a pixel set", () => {
    const pixels: [number, number, number][] = [
      [0, 0, 0],
      [64, 128, 192],
      [255, 255, 255],
      [220, 30, 70],
      [128, 128, 128],
      [200, 180, 60],
    ];
    for (const [r, g, b] of pixels) {
      const out = applyVibrance(state, r, g, b);
      for (const c of [out.r, out.g, out.b]) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
      expect(applyVibrance(state, r, g, b)).toEqual(out);
    }
  });
});
