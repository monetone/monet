// filterPresets — saved Library filter presets (LR's filter-bar preset menu):
// a named snapshot of every filter dimension, persisted in localStorage like
// export presets (UI-workflow convenience, not catalog data). Built-ins mirror
// Lightroom's stock presets; they are neither persisted nor deletable.

import type { RatingOp, TextTarget } from "../catalog/types";
import type { PresetStorage } from "./exportPresets";

export interface FilterSnapshot {
  minRating: number;
  ratingOp: RatingOp;
  flag: number | null;
  label: string | null;
  text: string;
  textTarget: TextTarget;
  camera: string | null;
  lens: string | null;
  year: number | null;
}

export interface FilterPreset {
  name: string;
  snapshot: FilterSnapshot;
}

export const NEUTRAL_FILTER: FilterSnapshot = {
  minRating: 0,
  ratingOp: ">=",
  flag: null,
  label: null,
  text: "",
  textTarget: "path",
  camera: null,
  lens: null,
  year: null,
};

/** Lightroom's stock filter presets. */
export const BUILTIN_FILTER_PRESETS: FilterPreset[] = [
  { name: "Flagged", snapshot: { ...NEUTRAL_FILTER, flag: 1 } },
  { name: "Rated", snapshot: { ...NEUTRAL_FILTER, minRating: 1 } },
  { name: "Unrated", snapshot: { ...NEUTRAL_FILTER, ratingOp: "=" } },
  { name: "Rejected Photos", snapshot: { ...NEUTRAL_FILTER, flag: -1 } },
];

const KEY = "galerie.filterPresets";

/** localStorage, or null where it's unavailable (SSR, locked-down contexts). */
function defaultStorage(): PresetStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // access itself can throw when storage is blocked
  }
}

/** All saved filter presets, sorted by name. Missing/malformed storage → []. */
export function listFilterPresets(storage: PresetStorage | null = defaultStorage()): FilterPreset[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as FilterPreset[])
      .filter((p) => p && typeof p.name === "string" && p.snapshot != null)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return []; // corrupt JSON — behave as if there are no presets
  }
}

/** Upsert a preset by name (trimmed); returns the updated list. Blank name or
 *  unavailable storage is a no-op that returns the current list. */
export function saveFilterPreset(
  name: string,
  snapshot: FilterSnapshot,
  storage: PresetStorage | null = defaultStorage(),
): FilterPreset[] {
  const trimmed = name.trim();
  if (!trimmed || !storage) return listFilterPresets(storage);
  const next = listFilterPresets(storage).filter((p) => p.name !== trimmed);
  next.push({ name: trimmed, snapshot });
  next.sort((a, b) => a.name.localeCompare(b.name));
  try {
    storage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage full / unavailable — the caller still gets the intended list
  }
  return next;
}

/** Remove a saved preset by name; returns the updated list. */
export function deleteFilterPreset(
  name: string,
  storage: PresetStorage | null = defaultStorage(),
): FilterPreset[] {
  if (!storage) return [];
  const next = listFilterPresets(storage).filter((p) => p.name !== name);
  try {
    storage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore write failure — next read just returns the prior contents
  }
  return next;
}
