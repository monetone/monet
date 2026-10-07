// metadataStatus — LR's Metadata Status: has the catalog or the on-disk .xmp
// sidecar changed since the two were last in sync? Every Save/Read Metadata
// to/from File records a baseline (digest of the sidecar text on disk + digest
// of the catalog's payload-free render at that moment); comparing today's
// digests against the baseline classifies the divergence, which the grid badge
// (↑ / ↓ / ⇅) and the Metadata panel's resolve row render.
//
// ponytail: baselines live in ONE localStorage blob keyed by photo id — move
// them to catalog DB columns when Metadata Status must become a SQL-backed
// Library filter / smart-collection criterion, or when multi-catalog photo ids
// start colliding.

import type { PresetStorage } from "./exportPresets";

export type MetadataStatus =
  /** Never synced (or outside Tauri) — no baseline to compare against. */
  | "unknown"
  | "synced"
  /** ↑ catalog changed since the last sync — not saved to the file. */
  | "catalogNewer"
  /** ↓ sidecar changed on disk since the last sync — not read into the catalog. */
  | "fileNewer"
  /** ⇅ both sides diverged from the baseline. */
  | "conflict";

/** What the two sides looked like when they were last in sync. */
export interface MetadataBaseline {
  /** Digest of the sidecar text on disk at sync time. */
  file: string;
  /** Digest of the catalog's payload-free sidecar render at sync time. */
  catalog: string;
}

const KEY = "galerie.metadataBaselines";

function defaultStorage(): PresetStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

let cache: Record<string, MetadataBaseline> | null = null;

function baselines(storage: PresetStorage | null): Record<string, MetadataBaseline> {
  if (cache) return cache;
  try {
    cache = JSON.parse(storage?.getItem(KEY) ?? "{}") as Record<string, MetadataBaseline>;
  } catch {
    cache = {};
  }
  return cache;
}

/** FNV-1a 32-bit — a cheap content digest for change detection, not security. */
export function contentDigest(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

const listeners = new Set<() => void>();

/** Subscribe to baseline changes (a sync just happened); returns unsubscribe. */
export function onMetadataStatusChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The baseline recorded at a photo's last metadata sync, or null. */
export function getMetadataBaseline(
  photoId: number,
  storage: PresetStorage | null = defaultStorage(),
): MetadataBaseline | null {
  return baselines(storage)[photoId] ?? null;
}

/** Record a sync point: the sidecar text now on disk + the catalog's
 *  payload-free render. Called after Save Metadata to File (incl. auto-write)
 *  and after Read Metadata from File. */
export function recordMetadataSync(
  photoId: number,
  fileXml: string,
  catalogXml: string,
  storage: PresetStorage | null = defaultStorage(),
): void {
  const all = baselines(storage);
  all[photoId] = { file: contentDigest(fileXml), catalog: contentDigest(catalogXml) };
  try {
    storage?.setItem(KEY, JSON.stringify(all));
  } catch {
    // storage unavailable — the in-memory cache still serves this session
  }
  for (const fn of listeners) fn();
}

/** Classify a photo's divergence from its baseline. `fileXml` is the sidecar
 *  text on disk (null = missing, which counts as an external change once a
 *  baseline exists); `catalogXml` is the current payload-free render. */
export function compareMetadataSync(
  base: MetadataBaseline,
  fileXml: string | null,
  catalogXml: string,
): MetadataStatus {
  const fileChanged = contentDigest(fileXml ?? "") !== base.file;
  const catalogChanged = contentDigest(catalogXml) !== base.catalog;
  if (fileChanged && catalogChanged) return "conflict";
  if (fileChanged) return "fileNewer";
  if (catalogChanged) return "catalogNewer";
  return "synced";
}

/** Test hook: drop the in-memory baseline cache (mirrors resetXmpAutoWriteCache). */
export function resetMetadataBaselines(): void {
  cache = null;
}
