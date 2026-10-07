// ─────────────────────────────────────────────────────────────
// Camera Raw develop presets — saved "looks" for the develop workspace. Mirrors
// brushPresets.ts: pure helpers (a starter set, auto-numbered names, add/remove,
// persisted-library parse) so they unit-test in node; the workspace applies a
// preset by seeding its recipe state. A preset is a full CameraRawRecipe snapshot
// (a partial one from an older app version is normalised on apply via the recipe
// defaults). Engine-free.
// ─────────────────────────────────────────────────────────────
import { serializeCameraRawXmp as serializeXmpDocument } from "@monet-ui/monet-photo";
import { defaultRecipe, type CameraRawRecipe } from "./cameraRaw";
import { parseCameraRawLookXmp, parseCameraRawXmp } from "./cameraRawSidecar";
import { normalizeWorkingRecipe, type VisionDevelopRecipe } from "./visionDevelopRecipe";
import { persistLocalStorage } from "./persistLocalStorage";

export interface CameraRawPreset {
  name: string;
  recipe: VisionDevelopRecipe;
}

/** Author a starter look in the compact Canonical shape, then migrate it to the
 *  working V2 recipe the library now stores. Apply-time re-normalization is a
 *  no-op on these, and older Canonical-shaped saved presets still migrate. */
function look(mut: (r: CameraRawRecipe) => void): VisionDevelopRecipe {
  const r = structuredClone(defaultRecipe());
  mut(r);
  return normalizeWorkingRecipe(r);
}

/** A Photoshop/ACR-like starter set of one-click develop looks. */
export const DEFAULT_CAMERA_RAW_PRESETS: CameraRawPreset[] = [
  { name: "Punchy", recipe: look((r) => { r.basic.contrast = 0.25; r.basic.clarity = 0.3; r.basic.vibrance = 0.35; r.basic.saturation = 0.1; }) },
  { name: "Warm Portrait", recipe: look((r) => { r.basic.temp = 0.2; r.basic.clarity = -0.1; r.grade.highlights = { hue: 40, sat: 0.25 }; }) },
  { name: "Cool Cinematic", recipe: look((r) => { r.basic.contrast = 0.2; r.basic.saturation = -0.15; r.grade.shadows = { hue: 200, sat: 0.35 }; r.grade.highlights = { hue: 40, sat: 0.2 }; }) },
  { name: "B&W High Contrast", recipe: look((r) => { r.basic.saturation = -1; r.basic.contrast = 0.4; r.basic.clarity = 0.2; }) },
  { name: "Faded Film", recipe: look((r) => { r.basic.blacks = 0.25; r.basic.contrast = -0.2; r.effects.grainAmount = 0.15; r.grade.shadows = { hue: 60, sat: 0.15 }; }) },
];

/** The next "Preset N" name, one past the highest existing "Preset <int>"
 *  (auto-numbering); names not of that form are ignored. */
export function defaultCameraRawPresetName(names: string[]): string {
  let max = 0;
  for (const n of names) {
    const m = /^Preset (\d+)$/.exec(n);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `Preset ${max + 1}`;
}

/** Append a preset; a preset whose name is already present replaces it in place
 *  (saving over a name updates it, matching ACR). */
export function addCameraRawPresetTo(list: CameraRawPreset[], preset: CameraRawPreset): CameraRawPreset[] {
  const i = list.findIndex((p) => p.name === preset.name);
  if (i < 0) return [...list, preset];
  return list.map((p, j) => (j === i ? preset : p));
}

/** Remove the preset at index `i`; out-of-range is a same-ref no-op. */
export function removeCameraRawPresetAt(list: CameraRawPreset[], i: number): CameraRawPreset[] {
  if (i < 0 || i >= list.length) return list;
  return list.filter((_, j) => j !== i);
}

/** Parse a persisted preset library (localStorage JSON) → the list, or null when
 *  missing/empty/malformed. Validates each entry's shape so a corrupt store can't
 *  break the app (recipe completeness is handled on apply, not here). */
export function parseCameraRawPresets(json: string | null): CameraRawPreset[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v) || v.length === 0) return null;
    if (!v.every((p) => p && typeof p.name === "string" && p.recipe && typeof p.recipe === "object")) return null;
    return v as CameraRawPreset[];
  } catch { return null; }
}

/** Export a preset as `.xmp` in the shared Camera Raw dialect — the interchange
 *  form Galerie and Lightroom/ACR both read, so a look authored here lands
 *  there. Only ABI-backed develop params travel, which is what a *preset* means:
 *  it carries the look, not the image-local crop/heal/masks of the recipe it was
 *  captured from.
 *  ponytail: `crs:`-only. If Vision→Vision presets ever need the non-ABI tail
 *  (parametric curve, calibration), add an mvcr payload here and prefer it in
 *  parseCameraRawPresetXmp. */
export function serializeCameraRawPresetXmp(preset: CameraRawPreset): string {
  return serializeXmpDocument({ name: preset.name, recipe: preset.recipe });
}

/** Read a `.xmp` develop preset — ours, Galerie's, or Lightroom/ACR's. Null when
 *  it isn't a Camera Raw XMP or carries no develop settings at all. */
export function parseCameraRawPresetXmp(input: string | Uint8Array, fallbackName = "Preset"): CameraRawPreset | null {
  const look = parseCameraRawLookXmp(input);
  const sidecar = parseCameraRawXmp(input);
  if (!look && !sidecar) return null;
  return {
    name: look?.name?.trim() || fallbackName,
    recipe: sidecar?.recipe ?? look!.recipe,
  };
}

const LS_KEY = "mv.cameraRawPresets";

/** Load the user's saved presets from localStorage, or [] when none/malformed. */
export function loadCameraRawPresets(): CameraRawPreset[] {
  try { return parseCameraRawPresets(localStorage.getItem(LS_KEY)) ?? []; } catch { return []; }
}

/** False when quota, permissions, or an unavailable store rejects the library. */
export function saveCameraRawPresets(list: CameraRawPreset[]): boolean {
  return persistLocalStorage(LS_KEY, JSON.stringify(list));
}
