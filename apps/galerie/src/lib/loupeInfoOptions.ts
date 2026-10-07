// loupeInfoOptions — Lightroom's Loupe Info 1 / Info 2 field pickers: which
// metadata labels each overlay set shows (the `I` key cycles 1 → 2 → off).
// Same localStorage + module cache idiom as gridViewOptions; the View Options
// dialog is the only writer. Order is the stored token order, NOT the
// metadataRows order — Info 1 reads File → Captured → Dimensions.

import type { PresetStorage } from "./exportPresets";

/** Every label `metadataRows` can produce, in its order. Kept in sync by the
 *  test — a rename there fails loudly instead of rendering a blank row. */
export const LOUPE_INFO_FIELDS = [
  "File",
  "Dimensions",
  "Camera",
  "Lens",
  "Focal",
  "Aperture",
  "Shutter",
  "ISO",
  "Captured",
  "GPS",
] as const;

export type LoupeInfoVariant = 1 | 2;
export type LoupeInfo = Record<LoupeInfoVariant, string[]>;

export const DEFAULT_LOUPE_INFO: LoupeInfo = {
  1: ["File", "Captured", "Dimensions"],
  2: ["File", "Shutter", "Aperture", "ISO", "Lens"],
};

const KEY = "galerie.loupeInfo";

function defaultStorage(): PresetStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Keep the persisted order, drop anything metadataRows no longer emits. */
function sanitize(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  return value.filter((f): f is string => typeof f === "string" && (LOUPE_INFO_FIELDS as readonly string[]).includes(f));
}

let cache: LoupeInfo | null = null;

/** The current field sets (defaults fill gaps; corrupt storage yields defaults).
 *  Cached because the overlay re-renders on every Loupe pan frame. */
export function loupeInfo(storage: PresetStorage | null = defaultStorage()): LoupeInfo {
  if (cache) return cache;
  let opts: LoupeInfo = { 1: [...DEFAULT_LOUPE_INFO[1]], 2: [...DEFAULT_LOUPE_INFO[2]] };
  if (storage) {
    try {
      const raw = storage.getItem(KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          const rec = parsed as Record<string, unknown>;
          opts = {
            1: rec["1"] === undefined ? opts[1] : sanitize(rec["1"], DEFAULT_LOUPE_INFO[1]),
            2: rec["2"] === undefined ? opts[2] : sanitize(rec["2"], DEFAULT_LOUPE_INFO[2]),
          };
        }
      }
    } catch {
      opts = { 1: [...DEFAULT_LOUPE_INFO[1]], 2: [...DEFAULT_LOUPE_INFO[2]] };
    }
  }
  cache = opts;
  return opts;
}

/** Persist the field sets and refresh the cache. */
export function saveLoupeInfo(opts: LoupeInfo, storage: PresetStorage | null = defaultStorage()): void {
  const next: LoupeInfo = { 1: [...opts[1]], 2: [...opts[2]] };
  try {
    storage?.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage unavailable — the in-memory cache still serves this session
  }
  cache = next;
}

/** Test hook: drop the module cache. */
export function resetLoupeInfoCache(): void {
  cache = null;
}
