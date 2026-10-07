import { beforeEach, describe, expect, it, vi } from "vitest";
const app = vi.hoisted(() => {
  let pushes = 0;
  return {
    applyLensProfileCorrection: vi.fn(),
    commit: () => { pushes++; },
    engine: { e: { undo_pushes: () => pushes }, onEditError: null },
    store: { activeCameraRawSession: () => null, lensMetadata: () => ({}) },
    adj: {}, fil: {}, xform: {}, ml: {}, actions: {},
  };
});
vi.mock("../state/app", () => app);
import { LENS_PROFILES, resolveLensProfile, type LensCorrectionSettings } from "@monet-ui/monet-photo";
import { applyLensProfile, inspectLensProfiles } from "./commands";

beforeEach(() => {
  app.applyLensProfileCorrection.mockReset();
  app.applyLensProfileCorrection.mockImplementation((settings: LensCorrectionSettings) => {
    const result = resolveLensProfile({}, settings);
    if (result.status === "missing") throw new Error(result.message);
    app.commit();
    return result;
  });
});

describe("lens profile tools", () => {
  it("inspects the same catalog and sends explicit capture overrides/trims through the common apply boundary", () => {
    const profile = LENS_PROFILES[0];
    const inspected = JSON.parse(inspectLensProfiles(profile.model, profile.id, 50, 5.6, profile.cropFactor));
    expect(inspected.profiles.some((p: { id: string }) => p.id === profile.id)).toBe(true);
    expect(inspected.resolution.status).toBe("resolved");
    expect(JSON.parse(applyLensProfile(profile.id, 75, 125, 50, 5.6, profile.cropFactor)).applied).toBe(profile.name);
    expect(app.applyLensProfileCorrection).toHaveBeenCalledWith(expect.objectContaining({
      profileId: profile.id, profileDistortionAmount: 0.75, profileVignettingAmount: 1.25,
      profileFocalLengthMm: 50, profileAperture: 5.6, profileCropFactor: profile.cropFactor,
    }));
  });

  it("fails automatic/missing calibration and invalid overrides instead of claiming application", () => {
    expect(() => applyLensProfile()).toThrow();
    expect(() => applyLensProfile("0".repeat(32), 100, 100, 50, 5.6, 1)).toThrow();
    app.applyLensProfileCorrection.mockClear();
    expect(() => applyLensProfile("", NaN)).toThrow("distortionAmount");
    expect(() => inspectLensProfiles("", "", -1)).toThrow("focalLengthMm");
    expect(app.applyLensProfileCorrection).not.toHaveBeenCalled();
  });
});
