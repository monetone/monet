import { describe, expect, it } from "vitest";
import catalog from "./lensProfiles.catalog.json";
import { LENS_PROFILES, lensProfileById, normalizeLensCalibration, normalizeLensMetadata, resolveLensProfile } from "./lensProfiles";
const profileId = "61e436adf1f54d26f516e70aa45399df";
const capture = { make: "Canon", model: "Canon EOS 600D", lens: "EF-S 18-55mm f/3.5-5.6 IS STM", focalLengthMm: 18, aperture: 3.5 };
function resolved(metadata = capture, settings = {}) {
  const result = resolveLensProfile(metadata, settings);
  if (result.status !== "resolved") throw new Error(result.message);
  return result;
}

describe("published lens profiles (#445)", () => {
  it("pins the licensed catalog and unique stable IDs with finite measurements", () => {
    expect(catalog.revision).toBe("84401750ea96c67db927801cca9be28139db1a50");
    expect(catalog.license).toBe("CC-BY-SA-3.0");
    expect(LENS_PROFILES).toHaveLength(1538);
    expect(new Set(LENS_PROFILES.map((p) => p.id)).size).toBe(LENS_PROFILES.length);
    for (const p of LENS_PROFILES) {
      expect(p.id).toMatch(/^[a-f0-9]{32}$/);
      expect(p.cropFactor).toBeGreaterThan(0);
      for (const row of [...p.distortion, ...p.tca, ...p.vignetting]) {
        expect(row.focal).toBeGreaterThan(0);
        for (const value of Object.values(row)) if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
  it("matches a published camera/lens pair with harmless name punctuation differences", () => {
    const r = resolved({ ...capture, make: "CANON", model: "eos 600d", lens: "Canon EF S 18-55mm F/3.5-5.6 IS STM" });
    expect(r.profile.id).toBe(profileId);
    expect(r.cropFactor).toBe(1.613);
    expect(r.calibration.vignette).toEqual([-1.231, 1.1507, -0.5518]);
    expect(r.warnings.join()).toContain("Focus distance is unknown");
  });
  it("accepts the published corporate maker name and its common brand alias", () => {
    const metadata = { model: "NIKON D850", lens: "AF DC-Nikkor 105mm f/2D", focalLengthMm: 105, aperture: 2 };
    const corporate = resolveLensProfile({ ...metadata, make: "NIKON CORPORATION" });
    const brand = resolveLensProfile({ ...metadata, make: "Nikon" });
    expect(corporate.status).toBe("resolved");
    expect(brand).toEqual(corporate);
  });
  it("independently converts published PTLens and TCA coefficients", () => {
    const c = resolved().calibration;
    const s = Math.sqrt(3.25), d = 1 - 0.01786 + 0.05378 - 0.01216;
    expect(c.distortion[0]).toBeCloseTo(0.01216 * s / d ** 2, 12);
    expect(c.distortion[1]).toBeCloseTo(-0.05378 * 3.25 / d ** 3, 12);
    expect(c.distortion[2]).toBeCloseTo(0.01786 * s ** 3 / d ** 4, 12);
    expect(c.distortion[3]).toBe(0);
    expect(c.red).toEqual([1.0007525, 0, -0.0003128 * 3.25]);
    expect(c.blue[0]).toBe(0.9996711);
    expect(c.blue[1]).toBe(0);
    expect(c.blue[2]).toBeCloseTo(0.0002958 * 3.25, 12);
  });
  it("interpolates published measurements before nonlinear normalization", () => {
    const c = resolved({ ...capture, focalLengthMm: 21, aperture: 3.75 }).calibration;
    const a = (0.01786 + 0.0064) / 2, b = (-0.05378 - 0.02273) / 2, q = (0.01216 + 0.00328) / 2, d = 1 - a - b - q;
    expect(c.distortion[0]).toBeCloseTo(q * Math.sqrt(3.25) / d ** 2, 12);
    expect(c.distortion[1]).toBeCloseTo(b * 3.25 / d ** 3, 12);
    // At 20mm interpolate f/3.5 to f/4; at 24mm clamp to measured f/4, then interpolate focal.
    expect(c.vignette[0]).toBeCloseTo(((-1.2072 - 0.5605) / 2) * 0.75 + -1.1357 * 0.25, 12);
  });
  it("scales calibration coordinates for a narrower sensor and leaves trims for the renderer", () => {
    const a = resolved().calibration;
    const b = resolved(capture, { profileCropFactor: 3.226, profileDistortionAmount: 0, profileVignettingAmount: 0 }).calibration;
    a.distortion.forEach((v, i) => expect(b.distortion[i]).toBeCloseTo(v * 0.5 ** (i + 1), 12));
    a.vignette.forEach((v, i) => expect(b.vignette[i]).toBeCloseTo(v * 0.5 ** (2 * (i + 1)), 12));
    expect(b.red[0]).toBe(a.red[0]);
    expect(b.red[2]).toBeCloseTo(a.red[2] / 4, 12);
  });
  it("rejects incompatible, absent and ambiguous metadata without guessing", () => {
    expect(resolveLensProfile({ ...capture, model: "EOS 5D Mark II" }).status).toBe("missing");
    expect(resolveLensProfile({ ...capture, model: "Unknown" }).status).toBe("missing");
    expect(resolveLensProfile({ ...capture, lens: "18-55mm" }).status).toBe("missing");
    expect(resolveLensProfile({ ...capture, focalLengthMm: undefined }).status).toBe("missing");
    expect(resolveLensProfile({}).status).toBe("missing");
    expect(resolveLensProfile(capture, { profileId: "f".repeat(32) }).status).toBe("missing");
    expect(resolveLensProfile(capture, { profileName: "uninstalled profile" }).status).toBe("missing");
    for (const invalid of [0, -1, NaN, Infinity]) {
      expect(resolveLensProfile(capture, { profileFocalLengthMm: invalid }).status).toBe("missing");
      expect(resolveLensProfile(capture, { profileAperture: invalid }).status).toBe("missing");
      expect(resolveLensProfile(capture, { profileCropFactor: invalid }).status).toBe("missing");
    }
  });
  it("permits explicit selection and image-local capture settings without inventing metadata", () => {
    const r = resolveLensProfile({}, { profileId, profileFocalLengthMm: 18, profileAperture: 3.5 });
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") {
      expect(r.calibration).toEqual(resolved().calibration);
      expect(r.warnings.join()).toContain("Camera sensor size is unknown");
    }
    expect(resolveLensProfile({}, { profileId, profileFocalLengthMm: 18, profileCropFactor: 1 }).status).toBe("missing");
  });
  it("keeps disabled selections inspectable, skips only vignette without aperture, and bounds extrapolation", () => {
    const r = resolved({ ...capture, aperture: undefined as unknown as number }, { enableProfileCorrections: false });
    expect(r.calibration.vignette).toEqual([0, 0, 0]);
    expect(r.calibration.distortion).toEqual(resolved().calibration.distortion);
    expect(r.warnings.join()).toContain("Aperture is missing");
    const clamped = resolved({ ...capture, focalLengthMm: 1 });
    expect(clamped.calibration).toEqual(resolved().calibration);
    expect(clamped.warnings.join()).toContain("nearest measured");
  });
  it("reports conflicting source measurements instead of choosing arbitrary coefficients", () => {
    const p = LENS_PROFILES.find((p) => p.model.includes("EF-S 15-85mm") && p.cropFactor === 1.613)!;
    expect(p).toBeDefined();
    const r = resolved(capture, { profileId: p.id });
    expect(r.warnings.join()).toContain("Conflicting Lateral chromatic aberration");
    expect(r.calibration.red).toEqual([1, 0, 0]);
  });
  it("refuses profiles with no usable component instead of claiming an identity correction", () => {
    const p = { profileId: "828c28a51bbc45923195d150d8fe3c94", profileFocalLengthMm: 100 };
    expect(resolveLensProfile({}, p).status).toBe("missing");
    expect(resolveLensProfile({}, { ...p, profileAperture: 5.6 }).status).toBe("resolved");
  });
  it("validates untrusted capture data and calibration snapshots", () => {
    expect(normalizeLensMetadata({ make: " Canon\u0000 ", focalLengthMm: NaN, aperture: -2, cropFactor: Infinity })).toEqual({ make: "Canon" });
    const c = resolved().calibration;
    expect(normalizeLensCalibration({ ...c, profileId: c.profileId.toUpperCase() })).toEqual(c);
    expect(normalizeLensCalibration({ ...c, red: [1, NaN, 0] })).toBeUndefined();
    expect(normalizeLensCalibration({ ...c, distortion: [0, 0, 0] })).toBeUndefined();
    expect(normalizeLensCalibration({ ...c, vignette: [1001, 0, 0] })).toBeUndefined();
    expect(normalizeLensCalibration({ ...c, vignette: [-2, 0, 0] })).toBeUndefined();
    // Positive at both endpoints, negative inside: endpoints alone are insufficient.
    expect(normalizeLensCalibration({ ...c, vignette: [-8, 8, 0] })).toBeUndefined();
    expect(normalizeLensCalibration({ ...c, profileId: "bad" })).toBeUndefined();
    expect(lensProfileById(profileId)?.id).toBe(profileId);
  });
});
