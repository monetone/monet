// recipePatch — merge a partial develop recipe (e.g. the crs: block parsed from
// an XMP sidecar by parseXmpPreset) onto an existing recipe. Deep-merges so a
// partial panel — the parser emits only the fields present in the XMP, and
// colorGrading is two levels deep (shadows.hue/sat but not .lum) — overlays the
// baseline instead of resetting the photo's untouched fields to default. Panels
// absent from the patch (masks, crop, …) are preserved untouched. Pure +
// normalizeRecipe'd so the result is always a well-formed recipe.

import { normalizeRecipe, type DevelopRecipeV2 } from "@monet-ui/monet-photo";

/** Every field (and nested field) optional — the honest shape of a develop patch
 *  (parseXmpPreset emits partial panels; colorGrading is two levels deep). */
export type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

/** Recursively overlay `patch` onto `base`: plain objects merge key-by-key;
 *  scalars, arrays (a tone-curve point list is a whole curve), and keys new to
 *  base replace outright. */
function deepMerge(base: unknown, patch: unknown): unknown {
  const isPlain = (v: unknown): v is Record<string, unknown> =>
    v != null && typeof v === "object" && !Array.isArray(v);
  if (!isPlain(base) || !isPlain(patch)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(out[k], v);
  return out;
}

/** Overlay an ABI-backed develop patch onto a baseline recipe, preserving every
 *  field (and nested field) the patch doesn't mention. */
export function mergeRecipePatch(base: DevelopRecipeV2, patch: DeepPartial<DevelopRecipeV2>): DevelopRecipeV2 {
  return normalizeRecipe(deepMerge(base, patch));
}
