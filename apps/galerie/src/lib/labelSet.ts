// labelSet — Lightroom's Color Label Set: the five label colors keep their
// storage keys (red/yellow/green/blue/purple) but the user can rename what
// each MEANS ("Review", "Approved", …). Names persist in localStorage like the
// other UI-workflow presets; a module cache keeps per-render reads cheap and is
// invalidated by the only writer (the editor dialog).

import type { PresetStorage } from "./exportPresets";

export const LABEL_COLORS_ORDER = ["red", "yellow", "green", "blue", "purple"] as const;
export type LabelColor = (typeof LABEL_COLORS_ORDER)[number];

export const DEFAULT_LABEL_NAMES: Record<LabelColor, string> = {
  red: "Red",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
};

const KEY = "galerie.labelSet";

function defaultStorage(): PresetStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

let cache: Record<LabelColor, string> | null = null;

/** The current color→display-name map (defaults fill gaps). */
export function labelNames(storage: PresetStorage | null = defaultStorage()): Record<LabelColor, string> {
  if (cache) return cache;
  let names = { ...DEFAULT_LABEL_NAMES };
  if (storage) {
    try {
      const raw = storage.getItem(KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          for (const c of LABEL_COLORS_ORDER) {
            const v = (parsed as Record<string, unknown>)[c];
            if (typeof v === "string" && v.trim()) names[c] = v.trim();
          }
        }
      }
    } catch {
      names = { ...DEFAULT_LABEL_NAMES }; // corrupt storage — fall back whole
    }
  }
  cache = names;
  return names;
}

/** The display name for one label color. */
export function labelName(color: string, storage: PresetStorage | null = defaultStorage()): string {
  const names = labelNames(storage);
  return (names as Record<string, string>)[color] ?? color;
}

/** Persist a full name map (blank entries fall back to defaults) and refresh
 *  the cache. Returns the effective map. */
export function saveLabelNames(
  input: Partial<Record<LabelColor, string>>,
  storage: PresetStorage | null = defaultStorage(),
): Record<LabelColor, string> {
  const next = { ...DEFAULT_LABEL_NAMES };
  for (const c of LABEL_COLORS_ORDER) {
    const v = input[c]?.trim();
    if (v) next[c] = v;
  }
  try {
    storage?.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage unavailable — the in-memory cache still serves this session
  }
  cache = next;
  return next;
}

/** Test hook: drop the module cache. */
export function resetLabelNameCache(): void {
  cache = null;
}
