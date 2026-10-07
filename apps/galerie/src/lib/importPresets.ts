// importPresets — save/load named Import-dialog configurations (Lightroom's
// Import Preset menu). Like export/filter presets these are a UI-workflow
// convenience, not catalog data, so they live in localStorage under one JSON
// key with injectable storage so the list/save/delete logic unit-tests without
// a DOM. Catalog row ids (metadata/develop preset, collection) are stored as
// ids; a preset opened against a catalog that lacks them resolves to none.

import type { PreviewTier } from "../import";
import type { PresetStorage } from "./exportPresets";
import type { ImportHandling } from "./importPlan";

/** The full set of Import-dialog choices a preset restores (mirrors the
 *  dialog's own state minus the chosen files). All JSON-serializable. */
export interface ImportConfig {
  handling: ImportHandling;
  destDir: string | null;
  organizeByDate: boolean;
  secondCopyDir: string | null;
  rename: boolean;
  template: string;
  startNumber: number;
  skipDupes: boolean;
  keywords: string;
  /** LR's Build Previews ladder (import.ts PreviewTier) — what the dialog shows. */
  previewTier: PreviewTier;
  /** Legacy mirror of `previewTier === "standard"`, kept because presets saved
   *  before the ladder existed only stored this. ponytail: drop once nothing
   *  reads it; importConfigFrom already maps it forward. */
  buildPreviews: boolean;
  metadataPresetId: number | null;
  developPresetId: number | null;
  collectionId: number | null;
}

export interface ImportPreset {
  name: string;
  config: ImportConfig;
}

export const DEFAULT_IMPORT_CONFIG: ImportConfig = {
  handling: "add",
  destDir: null,
  organizeByDate: false,
  secondCopyDir: null,
  rename: false,
  template: "{name}",
  startNumber: 1,
  skipDupes: true,
  keywords: "",
  previewTier: "none",
  buildPreviews: false,
  metadataPresetId: null,
  developPresetId: null,
  collectionId: null,
};

/** Fill a stored (possibly older) config with current defaults — a preset saved
 *  before a field existed must never feed `undefined` into a dialog input. A
 *  pre-ladder preset carries only the boolean, so derive the tier from it. */
export function importConfigFrom(stored: Partial<ImportConfig> | null | undefined): ImportConfig {
  const config = { ...DEFAULT_IMPORT_CONFIG, ...(stored ?? {}) };
  if (stored?.previewTier == null) config.previewTier = config.buildPreviews ? "standard" : "none";
  else config.buildPreviews = config.previewTier === "standard"; // keep the mirror honest
  return config;
}

const KEY = "galerie.importPresets";

/** localStorage, or null where it's unavailable (SSR, locked-down contexts). */
function defaultStorage(): PresetStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // access itself can throw when storage is blocked
  }
}

/** All saved import presets, sorted by name. Missing/malformed storage → []. */
export function listImportPresets(storage: PresetStorage | null = defaultStorage()): ImportPreset[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as ImportPreset[])
      .filter((p) => p && typeof p.name === "string" && p.config != null)
      .map((p) => ({ name: p.name, config: importConfigFrom(p.config) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return []; // corrupt JSON — behave as if there are no presets
  }
}

/** Upsert a preset by name (trimmed); returns the updated list. Blank name or
 *  unavailable storage is a no-op that returns the current list. */
export function saveImportPreset(
  name: string,
  config: ImportConfig,
  storage: PresetStorage | null = defaultStorage(),
): ImportPreset[] {
  const trimmed = name.trim();
  if (!trimmed || !storage) return listImportPresets(storage);
  const next = listImportPresets(storage).filter((p) => p.name !== trimmed);
  next.push({ name: trimmed, config });
  next.sort((a, b) => a.name.localeCompare(b.name));
  try {
    storage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage full / unavailable — the caller still gets the intended list
  }
  return next;
}

/** Remove a preset by name; returns the updated list. */
export function deleteImportPreset(
  name: string,
  storage: PresetStorage | null = defaultStorage(),
): ImportPreset[] {
  if (!storage) return [];
  const next = listImportPresets(storage).filter((p) => p.name !== name);
  try {
    storage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore write failure — next read just returns the prior contents
  }
  return next;
}
