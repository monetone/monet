// Unit tests for the Exposure helpers. Engine-free (node); the dialog + engine
// wiring are covered by the e2e suite + the Rust side. These pin the pure math: the
// 2^stops multiply, offset, gamma (1/gamma power), the load-bearing max(…,0) clamp
// (no NaN), and the gamma floor.
import { describe, it, expect } from "vitest";
import {
  defaultExposure,
  exposureMultiplier,
  packExposure,
  applyExposureChannel,
  applyExposure,
  GAMMA_FLOOR,
  EXPOSURE_MIN,
  EXPOSURE_MAX,
  OFFSET_MIN,
  OFFSET_MAX,
  GAMMA_MIN,
  GAMMA_MAX,
  type ExposureState,
} from "./exposure";

const st = (over: Partial<ExposureState> = {}): ExposureState => ({ ...defaultExposure(), ...over });

describe("defaults & packing", () => {
  it("default is identity (0 stops, 0 offset, gamma 1)", () => {
    expect(defaultExposure()).toEqual({ exposure: 0, offset: 0, gamma: 1 });
  });

  it("packExposure → [exposure, offset, gamma] (kind-9 layout)", () => {
    const m = packExposure({ exposure: 1.5, offset: -0.25, gamma: 2.2 });
    expect(m).toBeInstanceOf(Float32Array);
    expect(m.length).toBe(3);
    expect(m[0]).toBeCloseTo(1.5, 6);
    expect(m[1]).toBeCloseTo(-0.25, 6);
    expect(m[2]).toBeCloseTo(2.2, 6);
  });

  it("exposureMultiplier is 2^stops", () => {
    expect(exposureMultiplier(0)).toBe(1);
    expect(exposureMultiplier(1)).toBe(2);
    expect(exposureMultiplier(-1)).toBe(0.5);
    expect(exposureMultiplier(3)).toBe(8);
  });

  it("range constants are the Photoshop-ish slider bounds", () => {
    expect([EXPOSURE_MIN, EXPOSURE_MAX]).toEqual([-3, 3]);
    expect([OFFSET_MIN, OFFSET_MAX]).toEqual([-0.5, 0.5]);
    expect([GAMMA_MIN, GAMMA_MAX]).toEqual([0.1, 3]);
  });
});

describe("applyExposureChannel (mirrors the engine)", () => {
  it("max(base,0) before the power — negative base → 0, never NaN", () => {
    expect(applyExposureChannel(0.1, 1, -0.5, 0.5)).toBe(0); // base -0.4 → 0
    expect(Number.isNaN(applyExposureChannel(0.1, 1, -0.5, 0.5))).toBe(false);
  });

  it("identity passes the channel through", () => {
    expect(applyExposureChannel(0.42, 1, 0, 1)).toBeCloseTo(0.42, 9);
  });
});

describe("applyExposure — tone math", () => {
  it("identity is a no-op for any pixel", () => {
    for (const [r, g, b] of [
      [0, 0, 0],
      [255, 255, 255],
      [64, 128, 192],
      [200, 40, 90],
    ]) {
      expect(applyExposure(defaultExposure(), r, g, b)).toEqual({ r, g, b });
    }
  });

  it("EV +1 doubles linearly (and clamps at the top)", () => {
    expect(applyExposure(st({ exposure: 1 }), 64, 64, 64)).toEqual({ r: 128, g: 128, b: 128 });
    expect(applyExposure(st({ exposure: 1 }), 128, 128, 128)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("EV −1 halves", () => {
    expect(applyExposure(st({ exposure: -1 }), 128, 128, 128)).toEqual({ r: 64, g: 64, b: 64 });
  });

  it("offset shifts the floor; negative offset can crush to black (no NaN)", () => {
    expect(applyExposure(st({ offset: 0.5 }), 0, 0, 0)).toEqual({ r: 128, g: 128, b: 128 });
    expect(applyExposure(st({ offset: -0.5 }), 64, 64, 64)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("gamma > 1 brightens midtones; gamma < 1 darkens them", () => {
    // gamma 2 ⇒ ig 0.5 ⇒ sqrt: 64/255 ≈ 0.251 → 0.501 → 128
    expect(applyExposure(st({ gamma: 2 }), 64, 64, 64)).toEqual({ r: 128, g: 128, b: 128 });
    // gamma 0.5 ⇒ ig 2 ⇒ square: darker than the input midtone
    expect(applyExposure(st({ gamma: 0.5 }), 180, 180, 180).r).toBeLessThan(180);
  });

  it("white stays white and black stays black under identity-ish ops", () => {
    expect(applyExposure(st({ gamma: 2 }), 255, 255, 255)).toEqual({ r: 255, g: 255, b: 255 });
    expect(applyExposure(st({ gamma: 2 }), 0, 0, 0)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("is deterministic", () => {
    const s = st({ exposure: 0.7, offset: 0.1, gamma: 1.4 });
    expect(applyExposure(s, 70, 130, 180)).toEqual(applyExposure(s, 70, 130, 180));
  });
});

describe("gamma floor guard", () => {
  it("gamma 0 uses the 1e-4 floor — huge but finite power, no crash/NaN", () => {
    expect(GAMMA_FLOOR).toBe(1e-4);
    const out = applyExposure(st({ gamma: 0 }), 200, 200, 200);
    for (const c of [out.r, out.g, out.b]) {
      expect(Number.isFinite(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(255);
    }
    // c<1 raised to ~10000 → ~0; pure white (c=1) stays 1 → 255.
    expect(applyExposure(st({ gamma: 0 }), 255, 255, 255)).toEqual({ r: 255, g: 255, b: 255 });
  });
});

// ── Several fixtures swept for finiteness + in-gamut + determinism ───────────
const FIXTURES: { name: string; state: ExposureState }[] = [
  { name: "brighten +1.5 EV", state: { exposure: 1.5, offset: 0, gamma: 1 } },
  { name: "darken -2 EV", state: { exposure: -2, offset: 0, gamma: 1 } },
  { name: "lift shadows (offset)", state: { exposure: 0, offset: 0.25, gamma: 1 } },
  { name: "crush + gamma", state: { exposure: 0, offset: -0.3, gamma: 1.8 } },
  { name: "extreme combo", state: { exposure: 3, offset: -0.5, gamma: 0.1 } },
  { name: "low gamma", state: { exposure: -1, offset: 0.1, gamma: 0.2 } },
];

describe.each(FIXTURES)("fixture: $name", ({ state }) => {
  it("produces finite, in-gamut, deterministic output for a pixel set", () => {
    const pixels: [number, number, number][] = [
      [0, 0, 0],
      [32, 64, 96],
      [128, 128, 128],
      [255, 255, 255],
      [220, 30, 70],
    ];
    for (const [r, g, b] of pixels) {
      const out = applyExposure(state, r, g, b);
      for (const c of [out.r, out.g, out.b]) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
      expect(applyExposure(state, r, g, b)).toEqual(out);
    }
  });
});

describe("monotonicity — brighter input never yields a darker output (fixed op)", () => {
  it("holds for a positive-EV op across the ramp", () => {
    const s = st({ exposure: 0.8, offset: 0.05, gamma: 1.3 });
    let prev = -1;
    for (let v = 0; v <= 255; v++) {
      const out = applyExposure(s, v, v, v).r;
      expect(out).toBeGreaterThanOrEqual(prev);
      prev = out;
    }
  });
});
