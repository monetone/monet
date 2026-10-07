// Unit tests for the Photo Filter helpers. Engine-free (node); the dialog + engine
// wiring are covered by the e2e suite + the Rust side. These pin the pure math: the
// tint formula (must match the engine), density/colour normalisation, preserve
// luminosity, and the named presets.
import { describe, it, expect } from "vitest";
import {
  defaultPhotoFilter,
  photoFilterPreset,
  densityFraction,
  normalizedColor,
  packPhotoFilter,
  applyPhotoFilter,
  PHOTO_FILTER_PRESETS,
  DEFAULT_PHOTO_FILTER,
  DEFAULT_DENSITY,
  LUMA_R,
  LUMA_G,
  LUMA_B,
  type PhotoFilterState,
} from "./photoFilter";

const lum = (r: number, g: number, b: number) => LUMA_R * r + LUMA_G * g + LUMA_B * b;
const RED = { r: 255, g: 0, b: 0 };
const state = (over: Partial<PhotoFilterState> = {}): PhotoFilterState => ({
  ...defaultPhotoFilter(),
  ...over,
});

describe("defaults", () => {
  it("default is Warming (85), 25% density, preserve on", () => {
    const s = defaultPhotoFilter();
    expect(s.color).toEqual({ r: 236, g: 138, b: 0 });
    expect(s.density).toBe(DEFAULT_DENSITY);
    expect(s.density).toBe(25);
    expect(s.preserveLuminosity).toBe(true);
    expect(DEFAULT_PHOTO_FILTER.name).toBe("Warming Filter (85)");
  });

  it("returns a fresh colour object (no shared mutation)", () => {
    const a = defaultPhotoFilter();
    a.color.r = 1;
    expect(defaultPhotoFilter().color.r).toBe(236);
  });
});

describe("normalisation & packing", () => {
  it("densityFraction maps 0..100 → 0..1 and clamps", () => {
    expect(densityFraction(0)).toBe(0);
    expect(densityFraction(25)).toBe(0.25);
    expect(densityFraction(100)).toBe(1);
    expect(densityFraction(150)).toBe(1);
    expect(densityFraction(-5)).toBe(0);
  });

  it("normalizedColor divides by 255 and clamps", () => {
    expect(normalizedColor({ r: 255, g: 0, b: 128 })).toEqual([1, 0, 128 / 255]);
    expect(normalizedColor({ r: 300, g: -5, b: 255 })).toEqual([1, 0, 1]);
  });

  it("packPhotoFilter → [fr,fg,fb,density,preserve] normalised (kind-11 layout)", () => {
    const m = packPhotoFilter(state({ color: { r: 236, g: 138, b: 0 }, density: 25 }));
    expect(m).toBeInstanceOf(Float32Array);
    expect(m.length).toBe(5);
    expect(m[0]).toBeCloseTo(236 / 255, 6);
    expect(m[1]).toBeCloseTo(138 / 255, 6);
    expect(m[2]).toBe(0);
    expect(m[3]).toBeCloseTo(0.25, 6);
  });

  it("packing carries preserveLuminosity — the kind-11 layer honours it", () => {
    const on = packPhotoFilter(state({ preserveLuminosity: true }));
    const off = packPhotoFilter(state({ preserveLuminosity: false }));
    expect(on[4]).toBe(1);
    expect(off[4]).toBe(0);
    expect(Array.from(on.slice(0, 4))).toEqual(Array.from(off.slice(0, 4)));
  });
});

describe("tint math (mirrors the engine)", () => {
  it("density 0 is a no-op for any pixel and either preserve setting", () => {
    for (const preserve of [true, false]) {
      const s = state({ color: RED, density: 0, preserveLuminosity: preserve });
      for (const [r, g, b] of [
        [0, 0, 0],
        [255, 255, 255],
        [128, 128, 128],
        [10, 90, 200],
      ]) {
        expect(applyPhotoFilter(s, r, g, b)).toEqual({ r, g, b });
      }
    }
  });

  it("red filter at 50% (no preserve) tints mid-gray to (192,64,64)", () => {
    const s = state({ color: RED, density: 50, preserveLuminosity: false });
    expect(applyPhotoFilter(s, 128, 128, 128)).toEqual({ r: 192, g: 64, b: 64 });
  });

  it("full density (no preserve) drives channels by 2·f and clamps", () => {
    const s = state({ color: RED, density: 100, preserveLuminosity: false });
    // white: r → clamp(2·1)=1 → 255; g,b → 0
    expect(applyPhotoFilter(s, 255, 255, 255)).toEqual({ r: 255, g: 0, b: 0 });
    // mid-gray: r → clamp(0.5·2)=1 → 255; g,b → 0
    expect(applyPhotoFilter(s, 128, 128, 128)).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("is deterministic", () => {
    const s = state({ color: { r: 25, g: 25, b: 251 }, density: 40 });
    expect(applyPhotoFilter(s, 70, 130, 180)).toEqual(applyPhotoFilter(s, 70, 130, 180));
  });
});

describe("preserve luminosity", () => {
  it("keeps output luminance ≈ input (within rounding) for non-clamping mids", () => {
    const warming = photoFilterPreset("Warming Filter (85)")!.color;
    for (const [r, g, b] of [
      [120, 140, 160],
      [90, 110, 70],
      [60, 80, 130],
    ]) {
      const out = applyPhotoFilter(state({ color: warming, density: 25, preserveLuminosity: true }), r, g, b);
      expect(Math.abs(lum(out.r, out.g, out.b) - lum(r, g, b))).toBeLessThanOrEqual(2);
    }
  });

  it("pins an exact rescaled output (red filter @50%, preserve on, mid-gray)", () => {
    // Without preserve this is (192,64,64); preserve rescales back up to the
    // original luminance (128), giving the brighter (240,80,80).
    const out = applyPhotoFilter(state({ color: RED, density: 50, preserveLuminosity: true }), 128, 128, 128);
    expect(out).toEqual({ r: 240, g: 80, b: 80 });
  });

  it("matters: turning it off shifts luminance more than leaving it on", () => {
    const warming = photoFilterPreset("Warming Filter (85)")!.color;
    const px: [number, number, number] = [120, 140, 160];
    const on = applyPhotoFilter(state({ color: warming, density: 30, preserveLuminosity: true }), ...px);
    const off = applyPhotoFilter(state({ color: warming, density: 30, preserveLuminosity: false }), ...px);
    const base = lum(...px);
    expect(Math.abs(lum(on.r, on.g, on.b) - base)).toBeLessThan(Math.abs(lum(off.r, off.g, off.b) - base));
  });
});

describe("presets", () => {
  it("there are 20 presets with valid 8-bit colours and unique names", () => {
    expect(PHOTO_FILTER_PRESETS.length).toBe(20);
    const names = PHOTO_FILTER_PRESETS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    for (const p of PHOTO_FILTER_PRESETS) {
      for (const c of [p.color.r, p.color.g, p.color.b]) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
    }
  });

  it("lookup returns the preset or undefined", () => {
    expect(photoFilterPreset("Sepia")?.color).toEqual({ r: 172, g: 122, b: 51 });
    expect(photoFilterPreset("does-not-exist")).toBeUndefined();
  });
});

// ── Several preset fixtures applied to a small pixel set ─────────────────────
// Direction the tint should push a neutral gray (no preserve, so the bias is clear).
const DIRECTION_FIXTURES: { name: string; expect: (o: { r: number; g: number; b: number }) => void }[] = [
  { name: "Red", expect: (o) => { expect(o.r).toBeGreaterThan(o.g); expect(o.r).toBeGreaterThan(o.b); } },
  { name: "Green", expect: (o) => { expect(o.g).toBeGreaterThan(o.r); expect(o.g).toBeGreaterThan(o.b); } },
  { name: "Blue", expect: (o) => { expect(o.b).toBeGreaterThan(o.r); expect(o.b).toBeGreaterThan(o.g); } },
  { name: "Cooling Filter (80)", expect: (o) => { expect(o.b).toBeGreaterThan(o.r); } },
  { name: "Warming Filter (85)", expect: (o) => { expect(o.r).toBeGreaterThan(o.b); } },
];

describe.each(DIRECTION_FIXTURES)("preset fixture: $name biases gray correctly", ({ name, expect: check }) => {
  it("pushes a neutral gray toward the filter colour", () => {
    const preset = photoFilterPreset(name)!;
    const out = applyPhotoFilter({ color: preset.color, density: 60, preserveLuminosity: false }, 128, 128, 128);
    expect(out.r).toBeGreaterThanOrEqual(0);
    expect(out.r).toBeLessThanOrEqual(255);
    check(out);
  });
});

describe("preset sweep — every preset yields valid bytes at a range of densities", () => {
  it("stays in-gamut and deterministic", () => {
    const pixels: [number, number, number][] = [
      [0, 0, 0],
      [64, 128, 192],
      [255, 255, 255],
      [230, 40, 90],
    ];
    for (const preset of PHOTO_FILTER_PRESETS) {
      for (const density of [0, 25, 50, 100]) {
        for (const preserveLuminosity of [true, false]) {
          const s: PhotoFilterState = { color: preset.color, density, preserveLuminosity };
          for (const [r, g, b] of pixels) {
            const out = applyPhotoFilter(s, r, g, b);
            for (const c of [out.r, out.g, out.b]) {
              expect(Number.isInteger(c)).toBe(true);
              expect(c).toBeGreaterThanOrEqual(0);
              expect(c).toBeLessThanOrEqual(255);
            }
            expect(applyPhotoFilter(s, r, g, b)).toEqual(out); // deterministic
          }
        }
      }
    }
  });
});
