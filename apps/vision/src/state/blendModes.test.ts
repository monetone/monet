// Unit tests for the separable blend modes. Engine-free (node); the engine applies
// these per channel in its compositor. These pin the pure math (must match
// blend.rs blend_channel / hard_light / soft_light), the standard blend identities,
// and the per-mode invariants.
import { describe, it, expect } from "vitest";
import {
  blendChannel,
  blendChannel8,
  blendPixel,
  hardLight,
  softLight,
  SEPARABLE_BLEND_MODES,
  type BlendModeKey,
} from "./blendModes";

const KEYS = SEPARABLE_BLEND_MODES.map((m) => m.key);
const GRID = [0, 0.25, 0.5, 0.75, 1];

describe("mode metadata", () => {
  it("lists 21 separable modes in engine u8 order with unique keys/labels", () => {
    expect(SEPARABLE_BLEND_MODES.length).toBe(21);
    expect(SEPARABLE_BLEND_MODES.map((m) => m.value)).toEqual([...Array(21).keys()]); // 0..20
    expect(new Set(KEYS).size).toBe(21);
    expect(new Set(SEPARABLE_BLEND_MODES.map((m) => m.label)).size).toBe(21);
    expect(SEPARABLE_BLEND_MODES[3]).toMatchObject({ value: 3, key: "multiply", label: "Multiply" });
  });
});

describe("blendChannel — exact per-mode math (normalised)", () => {
  it("Normal/Dissolve return the source", () => {
    expect(blendChannel("normal", 0.2, 0.7)).toBe(0.7);
    expect(blendChannel("dissolve", 0.2, 0.7)).toBe(0.7);
  });

  it("Multiply / Screen are inverses around their identities", () => {
    expect(blendChannel("multiply", 0.5, 0.5)).toBeCloseTo(0.25, 9);
    expect(blendChannel("multiply", 0.6, 1)).toBeCloseTo(0.6, 9); // ×white = identity
    expect(blendChannel("multiply", 0.6, 0)).toBe(0); // ×black = black
    expect(blendChannel("screen", 0.5, 0.5)).toBeCloseTo(0.75, 9);
    expect(blendChannel("screen", 0.6, 0)).toBeCloseTo(0.6, 9); // ×black = identity
    expect(blendChannel("screen", 0.6, 1)).toBeCloseTo(1, 9); // ×white = white
  });

  it("Darken / Lighten are min / max", () => {
    expect(blendChannel("darken", 0.3, 0.7)).toBe(0.3);
    expect(blendChannel("lighten", 0.3, 0.7)).toBe(0.7);
  });

  it("Difference / Exclusion / Subtract", () => {
    expect(blendChannel("difference", 0.8, 0.3)).toBeCloseTo(0.5, 9);
    expect(blendChannel("difference", 0.4, 0.4)).toBe(0);
    expect(blendChannel("exclusion", 0.5, 0.5)).toBeCloseTo(0.5, 9);
    expect(blendChannel("exclusion", 0.6, 0)).toBeCloseTo(0.6, 9);
    expect(blendChannel("exclusion", 0.6, 1)).toBeCloseTo(0.4, 9); // 1-cb
    expect(blendChannel("subtract", 0.8, 0.3)).toBeCloseTo(0.5, 9);
    expect(blendChannel("subtract", 0.3, 0.8)).toBe(0);
  });

  it("Linear Burn / Linear Dodge", () => {
    expect(blendChannel("linearBurn", 1, 0.5)).toBeCloseTo(0.5, 9);
    expect(blendChannel("linearBurn", 0.3, 0.3)).toBe(0);
    expect(blendChannel("linearDodge", 0.5, 0.5)).toBe(1);
    expect(blendChannel("linearDodge", 0.3, 0.3)).toBeCloseTo(0.6, 9);
  });

  it("Color Burn / Color Dodge / Divide edge cases", () => {
    expect(blendChannel("colorBurn", 0.6, 0)).toBe(0); // cs 0 → black
    expect(blendChannel("colorBurn", 0.6, 1)).toBeCloseTo(0.6, 9); // cs 1 → identity
    expect(blendChannel("colorDodge", 0.6, 1)).toBe(1); // cs 1 → white
    expect(blendChannel("colorDodge", 0.6, 0)).toBeCloseTo(0.6, 9); // cs 0 → identity
    expect(blendChannel("divide", 0.5, 1)).toBeCloseTo(0.5, 9);
    expect(blendChannel("divide", 0.5, 0.25)).toBe(1); // 2 → clamped
    expect(blendChannel("divide", 0.5, 0)).toBe(1); // cs 0 → white
  });

  it("Light modes (hardLight/softLight/vivid/linear/pin/hardMix) at the midline", () => {
    expect(blendChannel("hardLight", 0.5, 0.25)).toBeCloseTo(0.25, 9);
    expect(blendChannel("hardLight", 0.5, 0.75)).toBeCloseTo(0.75, 9);
    expect(blendChannel("softLight", 0.5, 0.25)).toBeCloseTo(0.375, 9);
    expect(blendChannel("softLight", 0.5, 0.75)).toBeCloseTo(0.6035534, 6);
    expect(blendChannel("vividLight", 0.5, 0.25)).toBe(0);
    expect(blendChannel("vividLight", 0.5, 0.75)).toBe(1);
    expect(blendChannel("vividLight", 0.6, 0)).toBe(0); // burn guard d<=0
    expect(blendChannel("vividLight", 0.6, 1)).toBe(1); // dodge guard d>=1
    expect(blendChannel("linearLight", 0.5, 0.5)).toBeCloseTo(0.5, 9);
    expect(blendChannel("linearLight", 0.5, 0.75)).toBe(1);
    expect(blendChannel("linearLight", 0, 0)).toBe(0); // low clamp
  });

  it("SoftLight's cb≤0.25 polynomial branch (not the sqrt branch)", () => {
    // cs>0.5 so the upper branch runs; cb=0.1≤0.25 so d uses the polynomial
    // ((16cb−12)cb+4)cb = 0.296, then cb+(2cs−1)(d−cb) = 0.1 + 1·(0.296−0.1) = 0.296.
    expect(blendChannel("softLight", 0.1, 1)).toBeCloseTo(0.296, 6);
    expect(blendChannel("pinLight", 0.5, 0.75)).toBeCloseTo(0.5, 9);
    expect(blendChannel("pinLight", 0.5, 0.25)).toBeCloseTo(0.5, 9);
  });

  it("Hard Mix is binary (0 or 1)", () => {
    for (const cb of GRID) for (const cs of GRID) {
      const v = blendChannel("hardMix", cb, cs);
      expect(v === 0 || v === 1).toBe(true);
    }
    expect(blendChannel("hardMix", 0.5, 0.25)).toBe(0);
    expect(blendChannel("hardMix", 0.5, 0.75)).toBe(1);
  });
});

describe("helpers", () => {
  it("hardLight = multiply below 0.5, screen above", () => {
    expect(hardLight(0.5, 0.25)).toBeCloseTo(0.25, 9); // 0.5·0.5
    expect(hardLight(0.5, 0.75)).toBeCloseTo(0.75, 9); // screen(0.5, 0.5)
    expect(hardLight(0.4, 0.5)).toBeCloseTo(0.4, 9); // boundary: 0.4·1
  });

  it("softLight is gentle and fixed at the endpoints", () => {
    expect(softLight(0, 0.8)).toBe(0);
    expect(softLight(1, 0.2)).toBe(1);
    expect(softLight(0.5, 0.5)).toBeCloseTo(0.5, 9); // cs=0.5 → no change
  });
});

describe("cross-checks & invariants over the grid", () => {
  it("Overlay matches the independent Photoshop formula (and = HardLight swapped)", () => {
    // Independent reference: Overlay(cb,cs) = cb≤0.5 ? 2·cb·cs : 1−2(1−cb)(1−cs).
    const overlayRef = (cb: number, cs: number) => (cb <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs));
    for (const cb of GRID) for (const cs of GRID) {
      expect(blendChannel("overlay", cb, cs)).toBeCloseTo(overlayRef(cb, cs), 12);
      expect(blendChannel("overlay", cb, cs)).toBeCloseTo(hardLight(cs, cb), 12);
    }
  });

  it("every mode stays in [0,1] across the grid", () => {
    for (const m of KEYS) for (const cb of GRID) for (const cs of GRID) {
      const v = blendChannel(m, cb, cs);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("commutative modes are symmetric in (cb,cs)", () => {
    const commutative: BlendModeKey[] = ["multiply", "screen", "darken", "lighten", "difference", "exclusion", "linearBurn", "linearDodge"];
    for (const m of commutative) for (const cb of GRID) for (const cs of GRID) {
      expect(blendChannel(m, cb, cs)).toBeCloseTo(blendChannel(m, cs, cb), 12);
    }
  });

  it("Normal always returns the source; black/white behave as expected", () => {
    for (const cb of GRID) for (const cs of GRID) expect(blendChannel("normal", cb, cs)).toBe(cs);
  });
});

describe("blendChannel8 — 8-bit", () => {
  it("clean 8-bit pins", () => {
    expect(blendChannel8("multiply", 200, 255)).toBe(200); // ×white identity
    expect(blendChannel8("multiply", 0, 200)).toBe(0);
    expect(blendChannel8("multiply", 200, 128)).toBe(100); // 0.7843·0.5020·255
    expect(blendChannel8("screen", 0, 128)).toBe(128); // ×black identity
    expect(blendChannel8("darken", 200, 128)).toBe(128);
    expect(blendChannel8("lighten", 200, 128)).toBe(200);
    expect(blendChannel8("difference", 255, 0)).toBe(255);
    expect(blendChannel8("normal", 200, 128)).toBe(128);
  });

  it("output is always a valid 8-bit integer for every mode", () => {
    for (const m of KEYS) for (const cb of [0, 64, 128, 200, 255]) for (const cs of [0, 64, 128, 200, 255]) {
      const v = blendChannel8(m, cb, cs);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });

  it("is deterministic", () => {
    expect(blendChannel8("softLight", 90, 200)).toBe(blendChannel8("softLight", 90, 200));
  });
});

describe("blendPixel", () => {
  it("blends each channel independently", () => {
    const out = blendPixel("multiply", { r: 255, g: 128, b: 0 }, { r: 128, g: 128, b: 128 });
    expect(out).toEqual({
      r: blendChannel8("multiply", 255, 128),
      g: blendChannel8("multiply", 128, 128),
      b: blendChannel8("multiply", 0, 128),
    });
  });

  it("Normal returns the source pixel; Multiply by white returns the backdrop", () => {
    const backdrop = { r: 30, g: 140, b: 220 };
    const source = { r: 200, g: 60, b: 90 };
    expect(blendPixel("normal", backdrop, source)).toEqual(source);
    expect(blendPixel("multiply", backdrop, { r: 255, g: 255, b: 255 })).toEqual(backdrop);
  });
});

// ── Several backdrop/source fixtures swept across all modes ──────────────────
const FIXTURES: { name: string; backdrop: Rgbish; source: Rgbish }[] = [
  { name: "mid over mid", backdrop: { r: 128, g: 128, b: 128 }, source: { r: 128, g: 128, b: 128 } },
  { name: "colour over photo", backdrop: { r: 60, g: 120, b: 200 }, source: { r: 220, g: 90, b: 40 } },
  { name: "white over dark", backdrop: { r: 20, g: 20, b: 20 }, source: { r: 255, g: 255, b: 255 } },
  { name: "black over light", backdrop: { r: 230, g: 230, b: 230 }, source: { r: 0, g: 0, b: 0 } },
];
interface Rgbish { r: number; g: number; b: number; }

describe.each(FIXTURES)("fixture: $name", ({ backdrop, source }) => {
  it("every mode yields in-gamut, deterministic pixels", () => {
    for (const m of KEYS) {
      const out = blendPixel(m, backdrop, source);
      for (const c of [out.r, out.g, out.b]) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
      expect(blendPixel(m, backdrop, source)).toEqual(out);
    }
  });
});
