// recentCatalogs — Lightroom's File ▸ Open Recent: a most-recent-first list of
// catalog paths, capped and de-duplicated. Same localStorage idiom as the
// other UI-workflow settings.

import type { PresetStorage } from "./exportPresets";

const KEY = "galerie.recentCatalogs";
export const MAX_RECENT_CATALOGS = 5;

function defaultStorage(): PresetStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Most-recent-first catalog paths. Missing/corrupt storage → []. */
export function listRecentCatalogs(storage: PresetStorage | null = defaultStorage()): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === "string" && p.length > 0);
  } catch {
    return [];
  }
}

/** Record an opened catalog at the front (dedupe, cap); returns the list. */
export function recordRecentCatalog(
  path: string,
  storage: PresetStorage | null = defaultStorage(),
): string[] {
  const next = [path, ...listRecentCatalogs(storage).filter((p) => p !== path)].slice(
    0,
    MAX_RECENT_CATALOGS,
  );
  try {
    storage?.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage unavailable — the menu just won't remember across sessions
  }
  return next;
}
