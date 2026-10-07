import { describe, expect, it } from "vitest";
import {
  cmykWorkingSpace,
  colorSettingsPreset,
  matchColorSettingsPreset,
  normalizeColorPolicyPrefs,
  parseColorSettings,
  serializeColorSettings,
  COLOR_SETTINGS_PRESETS,
  DEFAULT_COLOR_POLICY_PREFS,
} from "./colorManagement";

describe("working spaces", () => {
  it("keeps SWOP as the default CMYK press so the soft proof's numbers are unchanged", () => {
    const swop = cmykWorkingSpace(DEFAULT_COLOR_POLICY_PREFS.workingCmyk);
    expect(swop.label).toContain("SWOP");
    expect(swop.dotGain).toBeCloseTo(0.12);
    expect(swop.totalInkLimit).toBeCloseTo(3.0);
  });

  it("gives uncoated stock more gain and less ink than its coated sibling", () => {
    const coated = cmykWorkingSpace(0); // U.S. Web Coated (SWOP) v2
    const uncoated = cmykWorkingSpace(4); // U.S. Web Uncoated v2
    expect(uncoated.dotGain).toBeGreaterThan(coated.dotGain);
    expect(uncoated.totalInkLimit).toBeLessThan(coated.totalInkLimit);
  });

  it("falls back to the default press for an unknown id", () => {
    expect(cmykWorkingSpace(99)).toBe(cmykWorkingSpace(0));
  });
});

describe("color policy prefs normalization", () => {
  it("fills the working-space and advanced fields when they are absent", () => {
    expect(normalizeColorPolicyPrefs({ intent: 3 })).toEqual({ ...DEFAULT_COLOR_POLICY_PREFS, intent: 3 });
  });

  it("rejects out-of-range and wrong-typed values instead of storing them", () => {
    const prefs = normalizeColorPolicyPrefs({
      workingCmyk: 42,
      workingGray: "1",
      workingSpot: 2,
      desaturateMonitorColors: "yes",
      desaturateMonitorAmount: 500,
      blendRgbColorsUsingGamma: true,
      blendRgbGamma: Number.NaN,
      blendTextGamma: -4,
      blackPointCompensation: "off",
      blendTextColorsUsingGamma: 1,
    });
    expect(prefs.workingCmyk).toBe(DEFAULT_COLOR_POLICY_PREFS.workingCmyk);
    expect(prefs.workingGray).toBe(DEFAULT_COLOR_POLICY_PREFS.workingGray);
    expect(prefs.workingSpot).toBe(2);
    expect(prefs.desaturateMonitorColors).toBe(false);
    expect(prefs.desaturateMonitorAmount).toBe(100);
    expect(prefs.blendRgbColorsUsingGamma).toBe(true);
    expect(prefs.blendRgbGamma).toBe(DEFAULT_COLOR_POLICY_PREFS.blendRgbGamma);
    expect(prefs.blendTextGamma).toBe(1);
    expect(prefs.blackPointCompensation).toBe(true);
    expect(prefs.blendTextColorsUsingGamma).toBe(false);
  });

  it("defaults BPC on (Photoshop) and every rendering option off, so composites are unchanged", () => {
    expect(DEFAULT_COLOR_POLICY_PREFS.blackPointCompensation).toBe(true);
    expect(DEFAULT_COLOR_POLICY_PREFS.desaturateMonitorColors).toBe(false);
    expect(DEFAULT_COLOR_POLICY_PREFS.blendRgbColorsUsingGamma).toBe(false);
    expect(DEFAULT_COLOR_POLICY_PREFS.blendTextColorsUsingGamma).toBe(false);
    // Settings saved before these fields existed keep loading, with the defaults.
    const { blackPointCompensation: _b, blendTextColorsUsingGamma: _t, ...legacy } = DEFAULT_COLOR_POLICY_PREFS;
    expect(normalizeColorPolicyPrefs({ ...legacy, blendTextGamma: 2 })).toEqual({ ...DEFAULT_COLOR_POLICY_PREFS, blendTextGamma: 2 });
  });
});

describe("color settings presets", () => {
  it("round-trips every preset through the matcher", () => {
    for (const p of COLOR_SETTINGS_PRESETS) {
      expect(matchColorSettingsPreset(p.workingRgb, p.prefs)?.id).toBe(p.id);
    }
  });

  it("reports Custom (null) once any field drifts from the preset", () => {
    const prepress = colorSettingsPreset("na-prepress");
    expect(prepress).not.toBeNull();
    expect(matchColorSettingsPreset(prepress!.workingRgb, { ...prepress!.prefs, blendTextGamma: 2 })).toBeNull();
    expect(matchColorSettingsPreset(0, prepress!.prefs)).toBeNull(); // preset is Adobe RGB
  });

  it("gives the prepress presets their regional press and gray", () => {
    expect(cmykWorkingSpace(colorSettingsPreset("europe-prepress")!.prefs.workingCmyk).label).toContain("FOGRA39");
    expect(cmykWorkingSpace(colorSettingsPreset("japan-prepress")!.prefs.workingCmyk).label).toContain("Japan Color 2001");
    expect(colorSettingsPreset("europe-prepress")!.prefs.workingGray).toBe(1); // Dot Gain 15%
  });
});

describe("color settings files", () => {
  const file = {
    workingRgb: 2 as const,
    prefs: {
      ...DEFAULT_COLOR_POLICY_PREFS, workingCmyk: 2 as const, blendTextGamma: 1.45, desaturateMonitorAmount: 35,
      blackPointCompensation: false, blendTextColorsUsingGamma: true,
    },
  };

  it("round-trips a saved settings file", () => {
    expect(parseColorSettings(serializeColorSettings(file))).toEqual(file);
  });

  it("refuses anything that isn't ours rather than resetting the user's setup", () => {
    expect(parseColorSettings("not json")).toBeNull();
    expect(parseColorSettings("[]")).toBeNull();
    expect(parseColorSettings(JSON.stringify({ prefs: file.prefs }))).toBeNull();
    expect(parseColorSettings(JSON.stringify({ monetColorSettings: 2, prefs: file.prefs }))).toBeNull();
  });

  it("sanitizes a tampered but well-formed file", () => {
    const hostile = JSON.stringify({
      monetColorSettings: 1,
      workingRgb: 99,
      prefs: { ...file.prefs, workingCmyk: -1, desaturateMonitorAmount: 1e9 },
    });
    const parsed = parseColorSettings(hostile);
    expect(parsed).not.toBeNull();
    expect(parsed!.workingRgb).toBe(0);
    expect(parsed!.prefs.workingCmyk).toBe(DEFAULT_COLOR_POLICY_PREFS.workingCmyk);
    expect(parsed!.prefs.desaturateMonitorAmount).toBe(100);
  });
});
