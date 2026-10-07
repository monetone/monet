import { describe, expect, it, vi } from "vitest";
vi.mock("@engine", () => ({ default: vi.fn(), Engine: class {} }));

import { createDefaultRecipe, LENS_PROFILES, resolveLensProfile } from "@monet-ui/monet-photo";
import { Store } from "./store";
import { applyWorkingPreset, syncWorkingRecipe } from "./visionDevelopRecipe";
import { decodeProjectEnvelope, encodeProjectEnvelope, normalizeCaptureMetadata } from "./projectEnvelope";

const profile = () => LENS_PROFILES[0];
const selected = () => ({ ...createDefaultRecipe(), optics: {
  ...createDefaultRecipe().optics, enableProfileCorrections: true, profileId: profile().id, profileName: profile().name,
  profileFocalLengthMm: 50, profileAperture: 5.6, profileCropFactor: profile().cropFactor,
} });

describe("lens profile integration", () => {
  it("resolves capture metadata for pixel documents and staged RAWs without requiring a RAW Smart Object", () => {
    const store = new Store({ engine: null, onCommit: null, lastBrush: [] } as never);
    const metadata = { make: "Canon", model: "EOS", lens: profile().model, focalLengthMm: 55, aperture: 8 };
    const internal = store as unknown as { docs: unknown[]; activeDocId: number; cameraRawSessions: Map<string, unknown> };
    internal.docs = [{ id: 1, captureMetadata: metadata }, { id: 2, cameraRaw: { metadata }, cameraRawLayerId: null }];
    internal.activeDocId = 1;
    internal.cameraRawSessions.set("staged", { state: { source: { metadata: { ...metadata, focalLengthMm: 18 } } } });
    expect(store.lensMetadata()).toEqual(metadata);
    expect(store.lensMetadata({ documentId: 2 })).toEqual(metadata);
    expect(store.lensMetadata({ sessionId: "staged" }).focalLengthMm).toBe(18);
    internal.cameraRawSessions.set("unknown", { state: { source: { metadata: {} } } });
    expect(store.lensMetadata({ sessionId: "unknown" })).toEqual({});
    const prepared = store.prepareCameraRawProfile(selected(), { documentId: 2 });
    const resolved = resolveLensProfile(metadata, selected().optics);
    expect(resolved.status).toBe("resolved");
    if (resolved.status !== "resolved") throw new Error(resolved.message);
    expect(prepared.recipe.optics.profileCalibration).toEqual(resolved.calibration);
    const invalid = store.prepareCameraRawProfile(selected(), { documentId: 2 }, { ...selected().optics, profileFocalLengthMm: 0 });
    expect(invalid.recipe.optics.profileCalibration).toBeUndefined();
    expect(invalid.missing).toBeNull();
    expect(invalid.lensWarning).toContain("Focal");
    const missing = selected();
    missing.optics.profileId = "0".repeat(32);
    missing.optics.profileName = "Missing lens";
    const refused = store.prepareCameraRawProfile(missing, { documentId: 2 });
    expect(refused.recipe.optics.profileName).toBe("Missing lens");
    expect(refused.recipe.optics.profileCalibration).toBeUndefined();
    expect(refused.missing).toBeNull();
    expect(refused.lensWarning).toBeTruthy();
    const off = store.prepareCameraRawProfile({ ...missing, optics: { ...missing.optics, enableProfileCorrections: false } }, { documentId: 2 });
    expect(off.missing).toBeNull();
    expect(off.lensWarning).toBeNull();
    expect(off.recipe.optics.profileName).toBe("Missing lens");
    const color = store.prepareCameraRawProfile({ ...missing, profile: { ...missing.profile, id: "adobe-color", amount: 0.5 } }, { documentId: 2 });
    expect(color.recipe.profile).toMatchObject({ id: "adobe-color", amount: 0.5 });
    expect(color.missing).toBeNull(); // the Amount control remains enabled
    expect(color.lensWarning).toBeTruthy();
  });

  it("presets and synchronization preserve target capture overrides and discard donor calibration", () => {
    const donor = selected();
    const target = createDefaultRecipe();
    donor.optics.profileFocalLengthMm = 18;
    target.optics.profileFocalLengthMm = 55;
    target.optics.profileAperture = 8;
    target.optics.profileCropFactor = 1.5;
    const resolved = resolveLensProfile({}, donor.optics);
    if (resolved.status !== "resolved") throw new Error(resolved.message);
    donor.optics.profileCalibration = resolved.calibration;
    for (const next of [applyWorkingPreset(donor, target), syncWorkingRecipe(donor, target)]) {
      expect(next.optics).toMatchObject({ profileId: profile().id, profileFocalLengthMm: 55, profileAperture: 8, profileCropFactor: 1.5 });
      expect(next.optics.profileCalibration).toBeUndefined();
    }
    expect(donor.optics.profileFocalLengthMm).toBe(18);
  });

  it("ordinary image capture metadata survives project saves, without unknown or invalid fields", () => {
    const metadata = { make: "Canon", model: "EOS R", lens: "RF 50mm", focalLengthMm: 50, aperture: 1.8, focalLength35Mm: 50, subjectDistanceM: 3 };
    const encoded = encodeProjectEnvelope(new Uint8Array([1, 2, 3]), [], { colorProfileAssigned: true, captureMetadata: metadata });
    expect(decodeProjectEnvelope(encoded)?.document.captureMetadata).toEqual(metadata);
    expect(normalizeCaptureMetadata({ lens: "Lens", focalLengthMm: NaN, aperture: -1, secret: "ignored" })).toEqual({ lens: "Lens" });
  });

  it("the Store writes an envelope when capture metadata is the only non-default document field", () => {
    const engineBytes = new Uint8Array([77, 86, 83, 78]);
    const engine = { engine: null, onCommit: null, lastBrush: [], projectBytes: () => engineBytes };
    const store = new Store(engine as never);
    const metadata = { make: "Canon", model: "EOS 600D", lens: "EF-S 18-55mm", focalLengthMm: 18, aperture: 3.5 };
    const internal = store as unknown as { docs: unknown[]; activeDocId: number };
    const entry = { id: 100, engine: { layer_count: () => 0 }, captureMetadata: {} };
    internal.docs = [entry];
    internal.activeDocId = 100;
    expect(store.saveProjectForDoc(100)).toBe(engineBytes); // prove every other field takes the fast path
    entry.captureMetadata = metadata;
    expect(store.docDocumentMeta(100)?.captureMetadata).toEqual(metadata);
    const saved = store.saveProjectForDoc(100)!;
    expect(saved).not.toBe(engineBytes);
    expect(decodeProjectEnvelope(saved)?.document.captureMetadata).toEqual(metadata);
  });
});
