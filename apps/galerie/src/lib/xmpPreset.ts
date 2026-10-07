// xmpPreset — Galerie's entry point for reading an Adobe Camera Raw / Lightroom
// develop preset .xmp.
//
// The crs: rule table used to live here, duplicated field-for-field in Vision.
// It now lives once in `@monet-ui/monet-photo`'s `xmp` module — THE Camera Raw
// dialect both photo apps share — so a preset either app writes reads identically
// in the other, and the "no dead sliders" rule (only ABI-backed params map) is
// enforced in one place. This file is just the adapter to Galerie's call shape.

import { parseCameraRawXmp, type DevelopRecipeV2 } from "@monet-ui/monet-photo";

export interface XmpPresetParse {
  name: string | null;
  recipe: Partial<DevelopRecipeV2>;
  mapped: string[];
  skipped: string[];
}

/** Parse an ACR/Lightroom preset. Accepts the file's bytes directly (strict
 *  UTF-8, size-bounded) or already-decoded text. Throws on input that isn't a
 *  usable Camera Raw XMP — a corrupt file must surface, not import as a preset
 *  that silently does nothing. */
export function parseXmpPreset(input: string | Uint8Array): XmpPresetParse {
  // A namespace-only `xmlns:crs=` document parses as an empty preset in the
  // shared dialect, so no local carve-out is needed here.
  const doc = parseCameraRawXmp(input);
  // The shared parser reports "no develop settings" as null; Galerie's callers
  // expect an empty patch they can hand to normalizeRecipe.
  return { name: doc.name, recipe: doc.recipe ?? {}, mapped: doc.mapped, skipped: doc.skipped };
}
