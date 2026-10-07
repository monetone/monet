// Unit tests for the Color Lookup adjustment. Engine-free (node). These pin the three
// primitives (contrast, luma, sat) and every preset's grade (must match
// pixel_adjust.rs color_lookup_pixel), plus the contract: preset 0 / unknown ids are
// the identity, output is clamped to [0,1], and the kind-16 params are [preset] with
// empty → identity.
import { describe, it, expect } from "vitest";
import {
  contrast,
  luma,
  sat,
  colorLookupPixel,
  applyColorLookup,
  packColorLookup,
  unpackColorLookupPreset,
  COLOR_LOOKUP_PRESETS,
  IDENTITY_PRESET,
} from "./colorLookup";

const close = (got: readonly number[], want: readonly number[], digits = 9) => {
  expect(got.length).toBe(want.length);
  got.forEach((v, i) => expect(v).toBeCloseTo(want[i], digits));
};

describe("primitives", () => {
  it("contrast pivots around mid-grey", () => {
    for (const k of [1, 1.12, 1.4, 2]) expect(contrast(0.5, k)).toBeCloseTo(0.5, 12);
    expect(contrast(1, 2)).toBeCloseTo(1.5, 12);
    expect(contrast(0, 2)).toBeCloseTo(-0.5, 12);
    expect(contrast(0.75, 2)).toBeCloseTo(1, 12);
  });

  it("luma is the Rec.601 weighted sum", () => {
    expect(luma(1, 1, 1)).toBeCloseTo(1, 12);
    expect(luma(1, 0, 0)).toBeCloseTo(0.299, 12);
    expect(luma(0, 1, 0)).toBeCloseTo(0.587, 12);
    expect(luma(0, 0, 1)).toBeCloseTo(0.114, 12);
  });

  it("sat interpolates toward/away from luminance", () => {
    expect(sat(0.8, 0.4, 1)).toBeCloseTo(0.8, 12); // amt 1 → identity
    expect(sat(0.8, 0.4, 0)).toBeCloseTo(0.4, 12); // amt 0 → full desaturate to luma
    expect(sat(0.8, 0.4, 2)).toBeCloseTo(1.2, 12); // amt 2 → boost past the channel
    expect(sat(0.2, 0.4, 0.5)).toBeCloseTo(0.3, 12); // halfway
  });
});

describe("colorLookupPixel — identity & unknown presets", () => {
  it("preset 0 is the exact identity", () => {
    for (const px of [
      [0, 0, 0],
      [0.3, 0.5, 0.7],
      [1, 1, 1],
    ] as const) {
      expect(colorLookupPixel(0, px[0], px[1], px[2])).toEqual([px[0], px[1], px[2]]);
    }
  });

  it("unknown / out-of-range ids fall back to identity", () => {
    for (const id of [9, 99, 255, 256, -1, -100]) {
      expect(colorLookupPixel(id, 0.3, 0.5, 0.7)).toEqual([0.3, 0.5, 0.7]);
    }
  });

  it("a fractional preset truncates toward zero (1.9 → preset 1, not identity)", () => {
    expect(colorLookupPixel(1.9, 0.5, 0.5, 0.5)).not.toEqual([0.5, 0.5, 0.5]);
    close(colorLookupPixel(1.9, 0.5, 0.5, 0.5), colorLookupPixel(1, 0.5, 0.5, 0.5));
  });
});

describe("colorLookupPixel — every preset graded at mid-grey (luma 0.5)", () => {
  // At mid-grey contrast(x,·)=0.5 and sat(x,·)=0.5, so each preset reduces to its
  // channel scales/offsets — hand-computable exact anchors.
  const G = 0.5;
  it("1 Crisp Warm", () => close(colorLookupPixel(1, G, G, G), [0.55, 0.5, 0.46]));
  it("2 Crisp Winter", () => close(colorLookupPixel(2, G, G, G), [0.46, 0.5, 0.56]));
  it("3 Bleach Bypass (neutral grey is unchanged)", () =>
    close(colorLookupPixel(3, G, G, G), [0.5, 0.5, 0.5]));
  it("4 Candlelight", () => close(colorLookupPixel(4, G, G, G), [0.59, 0.51, 0.39]));
  it("5 Drop Blues", () => close(colorLookupPixel(5, G, G, G), [0.475, 0.51, 0.36]));
  it("6 Fall Colors", () => close(colorLookupPixel(6, G, G, G), [0.54, 0.49, 0.45]));
  it("7 Moonlight", () => close(colorLookupPixel(7, G, G, G), [0.34, 0.41, 0.56]));
  it("8 Soft Warming", () => close(colorLookupPixel(8, G, G, G), [0.55, 0.52, 0.5]));
});

describe("colorLookupPixel — sat-driven presets on a saturated colour", () => {
  // (0.8, 0.2, 0.2): luma = 0.299·0.8 + 0.587·0.2 + 0.114·0.2 = 0.3794
  it("6 Fall Colors couples each channel to luminance", () => {
    close(colorLookupPixel(6, 0.8, 0.2, 0.2), [0.93948, 0.160838, 0.147708], 5);
  });
  it("3 Bleach Bypass desaturates then adds contrast", () => {
    close(colorLookupPixel(3, 0.8, 0.2, 0.2), [0.537254, 0.243254, 0.243254], 5);
  });
});

describe("colorLookupPixel — contrast-slope presets on a non-grey colour", () => {
  // (0.8,0.2,0.2): these pin the 1.12 / 0.92 contrast slopes, which collapse to a no-op
  // at mid-grey — so without a coloured anchor a slope regression would slip through.
  it("2 Crisp Winter pins the 1.12 contrast slope", () => {
    // r=contrast(0.8,1.12)*0.92, g=contrast(0.2,1.12), b=contrast(0.2,1.12)*1.08+0.02
    close(colorLookupPixel(2, 0.8, 0.2, 0.2), [0.76912, 0.164, 0.19712], 9);
  });
  it("8 Soft Warming pins the 0.92 contrast slope", () => {
    // r=contrast(0.8,0.92)*1.04+0.03, g=contrast(0.2,0.92)+0.02, b=contrast(0.2,0.92)*0.96+0.02
    close(colorLookupPixel(8, 0.8, 0.2, 0.2), [0.83704, 0.244, 0.23504], 9);
  });
});

describe("colorLookupPixel — clamping", () => {
  it("clamps channels that overshoot 1 (Crisp Warm on white)", () => {
    close(colorLookupPixel(1, 1, 1, 1), [1, 1, 0.9752], 6); // 1.1436→1, 1.06→1, 0.9752
  });

  it("clamps channels that go below 0 (Crisp Winter on black)", () => {
    // contrast(0,1.12) = −0.06 → all three scaled stay ≤0 → clamp to 0
    expect(colorLookupPixel(2, 0, 0, 0)).toEqual([0, 0, 0]);
  });

  it("lifts black toward a tint where the preset adds an offset", () => {
    close(colorLookupPixel(5, 0, 0, 0), [0, 0, 0.05], 12); // Drop Blues lifts blue
    close(colorLookupPixel(7, 0, 0, 0), [0.02, 0.03, 0.08], 12); // Moonlight blue cast
  });

  it("always returns in-gamut values for every preset", () => {
    for (let p = 0; p < COLOR_LOOKUP_PRESETS.length; p++) {
      for (const px of [
        [0, 0, 0],
        [1, 1, 1],
        [0.9, 0.1, 0.4],
        [0.2, 0.8, 0.6],
      ] as const) {
        for (const v of colorLookupPixel(p, px[0], px[1], px[2])) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("applyColorLookup (8-bit)", () => {
  it("preset 0 leaves every pixel unchanged", () => {
    for (const [r, g, b] of [
      [10, 120, 240],
      [0, 0, 0],
      [255, 255, 255],
      [200, 50, 90],
    ]) {
      expect(applyColorLookup(0, r, g, b)).toEqual({ r, g, b });
    }
  });

  it("grades black exactly per preset (luma 0 avoids fractional inputs)", () => {
    expect(applyColorLookup(4, 0, 0, 0)).toEqual({ r: 10, g: 5, b: 0 }); // Candlelight 0.04/0.02/0
    expect(applyColorLookup(5, 0, 0, 0)).toEqual({ r: 0, g: 0, b: 13 }); // Drop Blues 0/0/0.05
    expect(applyColorLookup(7, 0, 0, 0)).toEqual({ r: 5, g: 8, b: 20 }); // Moonlight 0.02/0.03/0.08
  });

  it("keeps every channel a valid byte for all presets and is deterministic", () => {
    for (let p = 0; p < COLOR_LOOKUP_PRESETS.length; p++) {
      for (const [r, g, b] of [
        [12, 200, 64],
        [255, 0, 128],
        [33, 99, 200],
      ]) {
        const out = applyColorLookup(p, r, g, b);
        for (const v of [out.r, out.g, out.b]) {
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(255);
        }
        expect(applyColorLookup(p, r, g, b)).toEqual(out); // deterministic
      }
    }
  });
});

describe("kind-16 adjustment-layer params", () => {
  it("packs the preset into a Float32Array([preset])", () => {
    const packed = packColorLookup(3);
    expect(packed).toBeInstanceOf(Float32Array);
    expect(Array.from(packed)).toEqual([3]);
  });

  it("unpacks the preset, treating empty params as identity", () => {
    expect(unpackColorLookupPreset(new Float32Array([]))).toBe(IDENTITY_PRESET);
    expect(unpackColorLookupPreset([])).toBe(0);
    expect(unpackColorLookupPreset([5])).toBe(5);
    expect(unpackColorLookupPreset(new Float32Array([2.9]))).toBe(2); // truncates
    // -1 is the loaded-LUT marker, not a preset: those params grade through the
    // cube, so reading them as a preset must not answer "preset 0".
    expect(unpackColorLookupPreset([-1, 2, 0, 0, 0, 1, 1, 1, 0, 0, 0])).toBe(0);
    expect(unpackColorLookupPreset([NaN])).toBe(0); // NaN → 0 (Rust `NaN as u8`)
    expect(unpackColorLookupPreset([300])).toBe(255); // saturates to 255
  });

  it("round-trips a preset through pack → unpack", () => {
    for (let p = 0; p < COLOR_LOOKUP_PRESETS.length; p++) {
      expect(unpackColorLookupPreset(packColorLookup(p))).toBe(p);
    }
  });
});

// ── Every preset swept over several fixtures: in-gamut, finite, identity at 0 ──
const PIXELS: [number, number, number][] = [
  [0.05, 0.05, 0.05],
  [0.95, 0.95, 0.95],
  [0.7, 0.3, 0.1],
  [0.1, 0.4, 0.85],
  [0.5, 0.5, 0.5],
];

describe.each(COLOR_LOOKUP_PRESETS.map((name, id) => ({ name, id })))(
  "fixture: preset $id ($name)",
  ({ id }) => {
    it("returns finite, in-gamut RGB for every pixel (and preset 0 is identity)", () => {
      for (const [r, g, b] of PIXELS) {
        const out = colorLookupPixel(id, r, g, b);
        expect(out.length).toBe(3);
        for (const v of out) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
        if (id === 0) expect(out).toEqual([r, g, b]);
      }
    });
  },
);
