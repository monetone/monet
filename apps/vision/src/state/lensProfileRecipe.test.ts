import { describe, expect, it } from "vitest";
import { createDefaultRecipe, lensFilterParams, lensProfileWords, normalizeRecipe, parseCameraRawXmp, recipeToParams, serializeCameraRawXmp, type LensCalibration } from "@monet-ui/monet-photo";
import { engineParamsToWorkingRecipe, workingRecipeToParams } from "./visionDevelopRecipe";
import { paramsToRecipe, recipeToParams as canonicalParams } from "./cameraRaw";

const calibration: LensCalibration = { profileId: "0123456789abcdef0123456789abcdef", distortion: [0.125, -0.0625, 0, 0], red: [1, 0.03125, 0], blue: [1, -0.03125, 0], vignette: [-0.125, 0, 0] };
const lens = { enableProfileCorrections: false, profileName: "Published Lens & Ω", profileId: calibration.profileId,
  profileDistortionAmount: 1.5, profileVignettingAmount: 0.5, profileFocalLengthMm: 35, profileAperture: 4, profileCropFactor: 1.5, profileCalibration: calibration };

describe("lens-profile V8 authoring and rendering state", () => {
  it("preserves disabled selections and calibrated coefficients across both layouts and canonical/working readback", () => {
    const r = createDefaultRecipe(); r.optics = { ...r.optics, distortionAmount: 0.25, ...lens };
    for (const p of [recipeToParams(r), workingRecipeToParams(r)]) {
      expect(p[1087]).toBe(8);
      expect(p[1050]).toBe(0.25); // manual controls stay in their old slots
      expect(engineParamsToWorkingRecipe(p).optics).toMatchObject(lens);
      expect(engineParamsToWorkingRecipe(canonicalParams(paramsToRecipe(p))).optics).toMatchObject(lens);
      expect(Array.from(workingRecipeToParams(engineParamsToWorkingRecipe(p)).slice(-lensProfileWords(r.optics)!.length)))
        .toEqual(lensProfileWords(r.optics));
    }
  });

  it("keeps the V7 camera source basis together with V8 lens corrections", () => {
    const r = createDefaultRecipe(); r.optics = { ...r.optics, ...lens, enableProfileCorrections: true };
    r.profile = { id: "custom", name: "Camera", group: "Custom", amount: 0.75, digest: "A".repeat(32), asShotKelvin: 6500,
      sourceCamera: { cameraToXyz: [1,0,0,0,1,0,0,0,1], whiteBalance: [2,1,1.5] } };
    const p = workingRecipeToParams(r), back = engineParamsToWorkingRecipe(p);
    expect(back.profile).toMatchObject({ digest: r.profile.digest, sourceCamera: r.profile.sourceCamera, amount: 0.75 });
    expect(back.optics.profileCalibration).toEqual(calibration);
    expect(Array.from(workingRecipeToParams(back))).toEqual(Array.from(p));
    const broken = p.slice(); broken[broken.length - 1] = NaN;
    expect(engineParamsToWorkingRecipe(broken).optics.profileCalibration).toBeUndefined();
  });

  it("keeps old neutral recipes byte-identical and bounds malformed calibration before the engine", () => {
    const r = createDefaultRecipe(); expect(recipeToParams(r)).toHaveLength(1086);
    expect(lensFilterParams(calibration)).toEqual([0,0,0,0,1,0,1,1,...calibration.distortion,...calibration.red,...calibration.blue,...calibration.vignette]);
    expect(() => lensFilterParams({ ...calibration, red: [NaN,0,0] })).toThrow("Invalid lens");
    const malformed = normalizeRecipe({ optics: { ...lens, profileCalibration: { ...calibration, blue: [1] }, profileCropFactor: -1 } });
    expect(malformed.optics.profileCalibration).toBeUndefined();
    expect(malformed.optics.profileCropFactor).toBeUndefined();
  });

  it("round-trips enabled and disabled named choices plus amount trims through Adobe XMP fields", () => {
    for (const enabled of [true, false]) {
      const recipe = createDefaultRecipe(); recipe.optics = { ...recipe.optics, ...lens, enableProfileCorrections: enabled };
      const xml = serializeCameraRawXmp({ recipe });
      expect(xml).toContain(`crs:LensProfileEnable="${enabled ? 1 : 0}"`);
      const parsed = parseCameraRawXmp(xml);
      expect(parsed.recipe?.optics).toMatchObject({ enableProfileCorrections: enabled, profileName: lens.profileName, profileId: lens.profileId,
        profileDistortionAmount: 1.5, profileVignettingAmount: 0.5 });
      expect(parsed.skipped.filter((s) => /LensProfile(Enable|Name|Digest|Setup|DistortionScale|VignettingScale)/.test(s))).toEqual([]);
    }
  });

  it("treats Adobe Auto/LensDefaults identities as cached while preserving unknown Custom choices", () => {
    const recipe = createDefaultRecipe();
    recipe.optics = { ...recipe.optics, ...lens, enableProfileCorrections: true, profileName: "Unknown Adobe profile" };
    const custom = serializeCameraRawXmp({ recipe });
    for (const mode of ["Auto", "LensDefaults"]) {
      const parsed = parseCameraRawXmp(custom.replace('crs:LensProfileSetup="Custom"', `crs:LensProfileSetup="${mode}"`));
      const merged = { ...recipe.optics, ...parsed.recipe?.optics };
      expect(merged.profileId).toBeUndefined();
      expect(merged.profileName).toBeNull();
      expect(merged.enableProfileCorrections).toBe(true);
    }
    expect(parseCameraRawXmp(custom).recipe?.optics).toMatchObject({ profileId: lens.profileId, profileName: "Unknown Adobe profile" });
  });
});
