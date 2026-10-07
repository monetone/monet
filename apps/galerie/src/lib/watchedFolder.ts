// watchedFolder — Lightroom's Auto Import settings: one watched folder whose
// new files import automatically while enabled, plus the Destination the files
// MOVE to, their File Naming, the Apply During Import ("Information") choices
// and the Initial Previews tier. Same localStorage idiom as the other
// UI-workflow settings; the watcher glue lives in src/autoImport.ts.

import type { PreviewTier } from "../import";
import type { PresetStorage } from "./exportPresets";

export interface WatchedFolder {
  path: string | null;
  enabled: boolean;
  /** LR's "Move to" — files are moved OUT of the watched folder into here.
   *  Null keeps the legacy behaviour: import in place, leave the files put. */
  moveTo: string | null;
  /** LR's "Subfolder Name" under `moveTo`; blank means moveTo itself. */
  subfolder: string;
  /** LR's File Naming (applies to the moved copy, like the Import dialog's). */
  rename: boolean;
  template: string;
  startNumber: number;
  /** LR's Information section — resolved to rows at import time so a deleted
   *  preset degrades to "none" instead of wedging the watcher. */
  developPresetId: number | null;
  metadataPresetId: number | null;
  /** Comma-separated, exactly like the Import dialog's Keywords field. */
  keywords: string;
  /** LR's Initial Previews. */
  previewTier: PreviewTier;
}

export const DEFAULT_WATCHED_FOLDER: WatchedFolder = {
  path: null,
  enabled: false,
  moveTo: null,
  subfolder: "Auto Imported Photos", // LR's own default subfolder name
  rename: false,
  template: "{name}",
  startNumber: 1,
  developPresetId: null,
  metadataPresetId: null,
  keywords: "",
  previewTier: "standard",
};

const KEY = "galerie.autoImport";

const PREVIEW_TIERS: readonly PreviewTier[] = ["none", "minimal", "standard", "oneToOne"];

function defaultStorage(): PresetStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);
const dir = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const id = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Where the watcher lands its files: `moveTo/subfolder`, or null when no
 *  destination is set (import in place). Trailing slashes and a blank subfolder
 *  both collapse cleanly, so the plan never grows a `//` or a trailing `/`. */
export function autoImportDestDir(setting: WatchedFolder): string | null {
  if (!setting.moveTo) return null;
  const root = setting.moveTo.replace(/[/\\]+$/, "");
  const sub = setting.subfolder.trim().replace(/^[/\\]+|[/\\]+$/g, "");
  return sub ? `${root}/${sub}` : root;
}

/** The stored setting; missing/corrupt storage yields the disabled default.
 *  Every field is validated field-by-field — a half-written record from an
 *  older build still yields a usable setting rather than a broken watcher. */
export function loadWatchedFolder(storage: PresetStorage | null = defaultStorage()): WatchedFolder {
  if (!storage) return { ...DEFAULT_WATCHED_FOLDER };
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return { ...DEFAULT_WATCHED_FOLDER };
    const p = JSON.parse(raw) as Partial<WatchedFolder>;
    const start = Number(p.startNumber);
    return {
      path: dir(p.path),
      enabled: p.enabled === true,
      moveTo: dir(p.moveTo),
      subfolder: str(p.subfolder, DEFAULT_WATCHED_FOLDER.subfolder),
      rename: p.rename === true,
      template: str(p.template, DEFAULT_WATCHED_FOLDER.template),
      startNumber: Number.isFinite(start) ? Math.max(0, Math.floor(start)) : DEFAULT_WATCHED_FOLDER.startNumber,
      developPresetId: id(p.developPresetId),
      metadataPresetId: id(p.metadataPresetId),
      keywords: str(p.keywords, ""),
      previewTier: PREVIEW_TIERS.includes(p.previewTier as PreviewTier)
        ? (p.previewTier as PreviewTier)
        : DEFAULT_WATCHED_FOLDER.previewTier,
    };
  } catch {
    return { ...DEFAULT_WATCHED_FOLDER };
  }
}

export function saveWatchedFolder(
  setting: WatchedFolder,
  storage: PresetStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(setting));
  } catch {
    // storage unavailable — the in-memory watcher still honors this session
  }
}
