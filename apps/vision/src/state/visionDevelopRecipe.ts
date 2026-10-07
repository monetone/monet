// Vision's working develop-recipe type + the two engine-boundary seams that let
// Vision's state migrate off CanonicalCameraRawRecipe onto DevelopRecipeV2 in
// later slices — WITHOUT a one-shot flip (docs/plans/10 Phase 5(d2a)).
//
// ADDITIVE ONLY: nothing here is wired into store.ts / CameraRawWorkspace.tsx /
// persistence yet. It just adds the target type + read/write seams so a future
// slice can adopt them incrementally, proven byte-exact by the round-trip test.
//
// The GAP a full state migration must close: Vision's UI keys masks/heal/point
// colours on a STABLE per-item id/name (activeMaskId, masksRef/healSpotsRef/
// pointColorsRef, React keys), which DevelopRecipeV2's EngineMask/HealSpot/
// PointColorSample omit. VisionDevelopRecipe augments EXACTLY those entries with
// an optional id/name — a structural SUPERSET of DevelopRecipeV2, so it stays
// assignable to it and recipeToParams/normalizeRecipe accept it unchanged.
import {
  normalizeRecipe as monetPhotoNormalizeRecipe,
  recipeToParams as monetPhotoRecipeToParams,
  type DevelopRecipeV2,
  type EngineMask,
  type HealSpot,
  type PointColorSample,
} from "@monet-ui/monet-photo";
import {
  normalizeCameraRawRecipe,
  paramsToRecipe,
  readAdvancedTrailer,
  type CanonicalCameraRawRecipe,
} from "./cameraRaw";
import { visionRecipeToV2 } from "./cameraRawToV2";

/** An EngineMask carrying Vision's UI identity (activeMaskId + display name). */
export type WorkingEngineMask = EngineMask & { id?: string; name?: string };
/** A HealSpot carrying Vision's stable list id (healSpotsRef React keys). */
export type WorkingHealSpot = HealSpot & { id?: string };
/** A PointColorSample carrying Vision's stable list id (pointColorsRef keys). */
export type WorkingPointColorSample = PointColorSample & { id?: string };

/** Vision's working recipe: DevelopRecipeV2 with per-item id/name only where the
 *  workspace needs stable UI identity. A structural superset — assignable to
 *  DevelopRecipeV2, so the shared codec consumes it unchanged. */
export interface VisionDevelopRecipe
  extends Omit<DevelopRecipeV2, "engineMasks" | "heal" | "pointColor"> {
  engineMasks?: WorkingEngineMask[];
  heal: { spots: WorkingHealSpot[] };
  pointColor: { samples: WorkingPointColorSample[] };
}

/** Canonical → working map: run the canonical Vision→V2 map, then re-attach the
 *  stable per-item ids/names the canonical recipe carries (masks/heal/point
 *  colours) — visionRecipeToV2 drops them because they're not in the ABI. This
 *  is the store's Canonical→working boundary; downstream UIs stay byte-for-byte
 *  unchanged. */
export function canonicalToWorking(c: CanonicalCameraRawRecipe): VisionDevelopRecipe {
  const v2 = visionRecipeToV2(c);
  // visionRecipeToV2 slices to the same caps Vision's normalize already applied,
  // so entries align 1:1 by index with the canonical recipe's ids/names.
  return {
    ...v2,
    heal: { spots: v2.heal.spots.map((s, i) => ({ ...s, id: c.healSpots[i].id })) },
    pointColor: { samples: v2.pointColor.samples.map((s, i) => ({ ...s, id: c.pointColors[i].id })) },
    engineMasks: (v2.engineMasks ?? []).map((m, i) => ({ ...m, id: c.masks[i].id, name: c.masks[i].name })),
  };
}

/** Read-back seam: engine params → Vision's working recipe. Decodes to the
 *  canonical recipe (which synthesizes stable ids/names) then maps to working.
 *  The Canonical recipe has no slot for the V4/V5 tail fields (Transform extras,
 *  Detail sub-sliders, lens Vignetting, colour Defringe, Upright), so those are
 *  read straight off the tail — otherwise undo, redo or a reopen resets them. */
export function engineParamsToWorkingRecipe(p: ArrayLike<number>): VisionDevelopRecipe {
  const working = canonicalToWorking(paramsToRecipe(p));
  const trailer = readAdvancedTrailer(p);
  if (!trailer) return working;
  const { constrainCrop, ...transform } = trailer.transform;
  return {
    ...working,
    transform: {
      ...working.transform,
      ...transform,
      // Optional like createDefaultRecipe's: absent unless actually set.
      ...(constrainCrop ? { constrainCrop } : {}),
      ...(trailer.extras ? { upright: trailer.extras.upright } : {}),
    },
    detail: { ...working.detail, ...trailer.extras?.detail },
    optics: { ...working.optics, ...trailer.extras?.optics, ...trailer.lensProfile },
  };
}

/** Re-attach Vision's stable per-item ids/names, mirroring canonicalToWorking's
 *  index scheme (heal-N / point-color-N / mask-N + '<kind> N'). Names/ids aren't
 *  in the ABI, so byte-exactness is unaffected. */
function attachWorkingIds(v2: DevelopRecipeV2): VisionDevelopRecipe {
  return {
    ...v2,
    heal: { spots: v2.heal.spots.map((s, i) => ({ ...s, id: `heal-${i + 1}` })) },
    pointColor: { samples: v2.pointColor.samples.map((s, i) => ({ ...s, id: `point-color-${i + 1}` })) },
    engineMasks: (v2.engineMasks ?? []).map((m, i) => ({
      ...m, id: `mask-${i + 1}`, name: `${m.kind.replace(/-/g, " ")} ${i + 1}`,
    })),
  };
}

/** Working-recipe trust boundary: fill/clamp any input through monet-photo's
 *  shared normalizeRecipe (deep-merge onto the defaults + hostile-input clamps),
 *  then re-attach the synthetic ids/names Vision's UI keys on. The store's
 *  working setter uses this so a persisted-then-reloaded working recipe is
 *  byte-identical to a freshly authored one. */
/** Vision authors in its own Canonical vocabulary (`grade`, `hsl`, …) — that is
 *  a LIVE internal shape, not an old persisted one, and `defaultRecipe()` plus
 *  the built-in presets still speak it. The shared `normalizeRecipe` only
 *  deep-merges V2 keys, so a Canonical input has to cross the boundary
 *  converter first or its grade/hsl panels are silently dropped. */
function isCanonicalShaped(input: unknown): input is CanonicalCameraRawRecipe {
  return typeof input === "object" && input !== null && "grade" in input;
}

export function normalizeWorkingRecipe(input: unknown): VisionDevelopRecipe {
  if (isCanonicalShaped(input)) {
    // canonicalToWorking dereferences every section unguarded, so partial or
    // hostile Canonical JSON (sidecars, MCP, persisted presets) has to cross the
    // Canonical validator first (#159) — it deep-fills, clamps and caps. Junk
    // that even that rejects falls back to the defaults, never a throw.
    const c = normalizeCameraRawRecipe(input);
    return c ? canonicalToWorking(c) : attachWorkingIds(monetPhotoNormalizeRecipe({}));
  }
  return attachWorkingIds(monetPhotoNormalizeRecipe(input));
}

/** Working-domain "Synchronize Settings" (ACR): copy every global develop panel
 *  from `source` onto `target`, KEEPING the target's image-local panels — crop,
 *  heal, engine masks, Enhance and lens capture overrides. Mirrors cameraRaw.syncCameraRawRecipe in the
 *  V2 working domain. */
export function syncWorkingRecipe(source: VisionDevelopRecipe, target: VisionDevelopRecipe): VisionDevelopRecipe {
  return applyWorkingPreset({
    ...source,
    crop: target.crop,
    heal: target.heal,
    engineMasks: target.engineMasks,
    enhance: target.enhance,
  }, target);
}

/** Looks may copy lens choice/trims, but capture overrides belong to the target. */
export function applyWorkingPreset(source: VisionDevelopRecipe, target: VisionDevelopRecipe): VisionDevelopRecipe {
  return normalizeWorkingRecipe({ ...source, optics: {
    ...source.optics,
    profileFocalLengthMm: target.optics.profileFocalLengthMm,
    profileAperture: target.optics.profileAperture,
    profileCropFactor: target.optics.profileCropFactor,
    profileCalibration: undefined,
  } });
}

/** Write seam: Vision's working recipe → engine params. The recipe is a V2
 *  superset; the extra ids/names aren't in the ABI, so the serializer ignores
 *  them. `tailFormat: "visionV2"` emits Vision's exact advanced tail. */
export function workingRecipeToParams(r: VisionDevelopRecipe, proxyScale = 1): Float32Array {
  return monetPhotoRecipeToParams(r, proxyScale, { tailFormat: "visionV2" });
}
