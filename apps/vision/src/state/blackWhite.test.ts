import { describe, expect, it } from "vitest";
import {
  applyBlackWhite,
  applyBlackWhitePreset,
  autoBlackWhite,
  BLACK_WHITE_BANDS,
  BLACK_WHITE_PRESETS,
  blackWhitePresetName,
  BW_PARAMS,
  defaultBlackWhite,
  packBlackWhite,
  unpackBlackWhite,
} from "./blackWhite";

describe("Black & White state", () => {
  it("has six editable bands and the full preset catalog", () => {
    expect(defaultBlackWhite().bands).toHaveLength(BLACK_WHITE_BANDS.length);
    expect(BLACK_WHITE_PRESETS.length).toBeGreaterThanOrEqual(12);
    expect(applyBlackWhitePreset(defaultBlackWhite(), "Infrared").bands).not.toEqual(defaultBlackWhite().bands);
    expect(autoBlackWhite(applyBlackWhitePreset(defaultBlackWhite(), "Infrared")).bands).toEqual(defaultBlackWhite().bands);
  });

  it("packs and unpacks six bands plus Tint", () => {
    const state = { neutral: 1, bands: [10, 20, 30, 40, 50, 60], tint: true, tintHue: 215, tintSaturation: 35 };
    const packed = packBlackWhite(state);
    expect(packed).toHaveLength(BW_PARAMS);
    expect([...packed.slice(3, 9)]).toEqual([...new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6])]);
    const back = unpackBlackWhite(packed);
    expect(back.tint).toBe(true);
    expect(back.tintHue).toBe(215);
    expect(back.tintSaturation).toBeCloseTo(35, 5);
    expect(back.bands).toEqual(expect.arrayContaining(state.bands.map((value) => expect.closeTo(value, 5))));
    expect(blackWhitePresetName(unpackBlackWhite(packBlackWhite(defaultBlackWhite())))).toBe("Default");
  });

  it("migrates the legacy RGB weights without changing their normal look", () => {
    const migrated = unpackBlackWhite([0.3, 0.59, 0.11]);
    for (const [r, g, b] of [[255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255], [0, 0, 255], [255, 0, 255]] as const) {
      const expected = Math.round((0.3 * r + 0.59 * g + 0.11 * b));
      expect(applyBlackWhite(migrated, r, g, b)).toEqual({ r: expected, g: expected, b: expected });
    }

    const black = unpackBlackWhite([0, 0, 0]);
    expect(applyBlackWhite(black, 128, 128, 128)).toEqual({ r: 0, g: 0, b: 0 });
    expect(applyBlackWhite(unpackBlackWhite(packBlackWhite(black)), 128, 128, 128)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("preserves mixed and signed legacy RGB weights through the widened format", () => {
    const check = (weights: readonly number[], pixels: readonly (readonly [number, number, number])[]) => {
      const migrated = unpackBlackWhite(packBlackWhite(unpackBlackWhite(weights)));
      const sum = Math.max(Math.abs(weights[0] + weights[1] + weights[2]), 1e-4);
      for (const [r, g, b] of pixels) {
        const value = Math.round(Math.max(0, Math.min(255, (weights[0] * r + weights[1] * g + weights[2] * b) / sum)));
        expect(applyBlackWhite(migrated, r, g, b)).toEqual({ r: value, g: value, b: value });
      }
    };

    check([0.37, 0.52, 0.11], [[41, 127, 233]]);
    check([1, -1, 0], [[200, 100, 20], [100, 200, 20], [255, 0, 20]]);
  });

  it("maps each pure hue to its slider and leaves neutrals unchanged", () => {
    const state = { ...defaultBlackWhite(), bands: [10, 20, 30, 40, 50, 60] };
    const primaries = [[255, 0, 0, 26], [255, 255, 0, 51], [0, 255, 0, 77], [0, 255, 255, 102], [0, 0, 255, 128], [255, 0, 255, 153]] as const;
    for (const [r, g, b, value] of primaries) expect(applyBlackWhite(state, r, g, b)).toEqual({ r: value, g: value, b: value });
    expect(applyBlackWhite(state, 128, 128, 128)).toEqual({ r: 128, g: 128, b: 128 });
  });

  it("Tint colours the gray while retaining its HSL lightness", () => {
    const state = { ...defaultBlackWhite(), bands: [50, 50, 50, 50, 50, 50], tint: true, tintHue: 40, tintSaturation: 40 };
    const out = applyBlackWhite(state, 255, 0, 0);
    expect(out.r).toBeGreaterThan(out.b);
    expect(Math.max(out.r, out.g, out.b) + Math.min(out.r, out.g, out.b)).toBeCloseTo(255, -1);
  });
});
