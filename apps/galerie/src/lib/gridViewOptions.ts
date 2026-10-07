// gridViewOptions — Lightroom's Grid View Options (⌘J): which cell extras the
// grid draws. The J cycle picks the STYLE (clean/compact/expanded); these
// toggles refine what the non-clean styles include. Same localStorage + module
// cache idiom as the label set; the dialog is the only writer.

import type { PresetStorage } from "./exportPresets";

export interface GridViewOptions {
  flags: boolean;
  ratings: boolean;
  labels: boolean;
  filename: boolean;
  quickMarker: boolean;
  stackCount: boolean;
  /** The expanded style's camera · date · size line. */
  metaLine: boolean;
}

export const DEFAULT_GRID_VIEW_OPTIONS: GridViewOptions = {
  flags: true,
  ratings: true,
  labels: true,
  filename: true,
  quickMarker: true,
  stackCount: true,
  metaLine: true,
};

const KEY = "galerie.gridViewOptions";

function defaultStorage(): PresetStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

let cache: GridViewOptions | null = null;

/** The current toggles (defaults fill gaps; corrupt storage yields defaults). */
export function gridViewOptions(storage: PresetStorage | null = defaultStorage()): GridViewOptions {
  if (cache) return cache;
  let opts = { ...DEFAULT_GRID_VIEW_OPTIONS };
  if (storage) {
    try {
      const raw = storage.getItem(KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          for (const k of Object.keys(DEFAULT_GRID_VIEW_OPTIONS) as (keyof GridViewOptions)[]) {
            const v = (parsed as Record<string, unknown>)[k];
            if (typeof v === "boolean") opts[k] = v;
          }
        }
      }
    } catch {
      opts = { ...DEFAULT_GRID_VIEW_OPTIONS };
    }
  }
  cache = opts;
  return opts;
}

/** Persist the toggles and refresh the cache. */
export function saveGridViewOptions(
  opts: GridViewOptions,
  storage: PresetStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(opts));
  } catch {
    // storage unavailable — the in-memory cache still serves this session
  }
  cache = { ...opts };
}

/** Test hook: drop the module cache. */
export function resetGridViewOptionsCache(): void {
  cache = null;
}
