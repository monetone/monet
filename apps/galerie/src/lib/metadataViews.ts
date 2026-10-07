// metadataViews — LR's Metadata panel view chooser: named field sets over the
// shared metadataRows labels. Same localStorage idiom as gridViewOptions; the
// panel's select is the only writer. "All" (the default) shows every row, so
// existing behavior is unchanged until the user picks a narrower view.

import type { PresetStorage } from "./exportPresets";

export const METADATA_VIEWS: Record<string, readonly string[] | null> = {
  All: null, // null = every row
  Default: ["File", "Dimensions", "Camera", "Lens", "Captured"],
  EXIF: ["Dimensions", "Camera", "Lens", "Focal", "Aperture", "Shutter", "ISO", "Captured"],
  Location: ["File", "Captured", "GPS"],
  Minimal: ["File", "Captured"],
};

export type MetadataViewName = keyof typeof METADATA_VIEWS & string;

const KEY = "galerie.metadataView";

function defaultStorage(): PresetStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The persisted view choice; unknown/corrupt → "All". */
export function loadMetadataView(storage: PresetStorage | null = defaultStorage()): MetadataViewName {
  try {
    const raw = storage?.getItem(KEY);
    return raw != null && raw in METADATA_VIEWS ? raw : "All";
  } catch {
    return "All";
  }
}

export function saveMetadataView(
  name: MetadataViewName,
  storage: PresetStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(KEY, name);
  } catch {
    // storage unavailable — the choice just won't survive a restart
  }
}

/** Filter label/value rows to the named view ("All"/unknown → unchanged). */
export function filterMetadataRows<T>(
  rows: readonly [string, T][],
  view: MetadataViewName,
): [string, T][] {
  const keep = METADATA_VIEWS[view];
  return keep == null ? [...rows] : rows.filter(([k]) => keep.includes(k));
}
