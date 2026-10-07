// xmpAutoWrite — Lightroom's "Automatically write changes into XMP": when
// enabled, metadata/develop mutations queue a debounced per-photo XMP write
// (embedded or sidecar — xmpSidecar's `writeXmpFor` routes it by format).
// Callers pass the PhotoRow they just mutated — this module never
// imports the store, keeping the dependency graph acyclic. Writes are
// best-effort: a failed sidecar never interrupts the edit that caused it
// (matching LR, which writes XMP silently in the background).

import { isTauri } from "@tauri-apps/api/core";

import { tryParseCameraRawXmp } from "@monet-ui/monet-photo";

import { getRecipe, listKeywords, listPhotoKeywords, listSnapshots } from "../catalog/catalog";
import type { KeywordRow, PhotoRow } from "../catalog/types";
import type { PresetStorage } from "./exportPresets";
import {
  compareMetadataSync,
  getMetadataBaseline,
  recordMetadataSync,
  type MetadataStatus,
} from "./metadataStatus";
import { buildXmpSidecar, readXmpText, writeXmpFor } from "./xmpSidecar";

const KEY = "galerie.xmpAutoWrite";
const DEBOUNCE_MS = 2000;

function defaultStorage(): PresetStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

let cache: boolean | null = null;

/** Is auto-write on? (Off by default, like LR.) */
export function xmpAutoWriteEnabled(storage: PresetStorage | null = defaultStorage()): boolean {
  if (cache != null) return cache;
  cache = storage?.getItem(KEY) === "1";
  return cache;
}

export function setXmpAutoWriteEnabled(
  on: boolean,
  storage: PresetStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(KEY, on ? "1" : "0");
  } catch {
    // storage unavailable — the in-memory cache still serves this session
  }
  cache = on;
}

/** Test hook: drop the cached toggle. */
export function resetXmpAutoWriteCache(): void {
  cache = null;
}

/** Keyword names → lr:hierarchicalSubject paths WITHOUT vocabulary context:
 *  each name is treated as a root keyword (its path is itself). A name carrying
 *  the '|' separator cannot be a single path segment (LR forbids it in names),
 *  so it stays dc:subject-only rather than reading back as fabricated levels.
 *  ponytail: name-only fallback — callers with photo ids should move to
 *  [`exportKeywords`], which walks the real tree and honors export flags. */
export function hierarchicalPaths(names: string[]): string[] {
  return names.filter((n) => !n.includes("|"));
}

/** A vocabulary row as `catalog_list_keywords` serializes it — the tree
 *  position + LR export flags (types.ts's KeywordCountRow does not declare the
 *  newer fields yet, so this module names the shape it needs). */
export interface KeywordVocabRow {
  id: number;
  name: string;
  parentId: number | null;
  /** Comma-separated synonym list (LR's Synonyms field verbatim). */
  synonyms: string;
  includeOnExport: boolean;
  exportContaining: boolean;
  exportSynonyms: boolean;
}

/** A photo's tagged keywords → what actually goes into a sidecar/export,
 *  honoring LR's per-keyword flags: Include On Export drops the keyword
 *  entirely, Export Synonyms adds its synonyms to dc:subject, Export
 *  Containing Keywords adds its (exportable) ancestors to dc:subject, and
 *  lr:hierarchicalSubject carries the full root→leaf path with non-export
 *  ancestors omitted. A keyword missing from `vocab` (or an empty vocabulary —
 *  callers outside Tauri) degrades to the flat name-only behavior. */
export function exportKeywords(
  tagged: KeywordRow[],
  vocab: KeywordVocabRow[],
): { flat: string[]; hierarchical: string[] } {
  const byId = new Map(vocab.map((r) => [r.id, r]));
  const flat: string[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return;
    seen.add(key);
    flat.push(name);
  };
  const hierarchical: string[] = [];
  for (const t of tagged) {
    const row = byId.get(t.id);
    if (!row) {
      push(t.name);
      if (!t.name.includes("|")) hierarchical.push(t.name);
      continue;
    }
    if (!row.includeOnExport) continue;
    push(row.name);
    if (row.exportSynonyms) for (const s of row.synonyms.split(",")) push(s.trim());
    // Walk to the root; `visited` makes a corrupt parent cycle terminate.
    const path = [row.name];
    const visited = new Set([row.id]);
    let up = row.parentId;
    while (up != null && !visited.has(up)) {
      visited.add(up);
      const anc = byId.get(up);
      if (!anc) break;
      if (anc.includeOnExport) {
        path.unshift(anc.name);
        if (row.exportContaining) push(anc.name);
      }
      up = anc.parentId;
    }
    if (path.every((s) => !s.includes("|"))) hierarchical.push(path.join("|"));
  }
  return { flat, hierarchical };
}

/** The vocabulary for export computation — best-effort: no catalog (or a test
 *  stubbing the module without `listKeywords`) degrades to flat keywords.
 *  Shared by every writer that emits keywords (auto-write, Export, Edit In), so
 *  all three honour the same per-keyword export flags. */
export async function exportVocab(): Promise<KeywordVocabRow[]> {
  try {
    if (typeof listKeywords !== "function") return [];
    return (await listKeywords()) as unknown as KeywordVocabRow[];
  } catch {
    return [];
  }
}

/** A photo's snapshots for the sidecar — best-effort like `exportVocab`: no
 *  catalog (or a test stubbing the module without `listSnapshots`) degrades to
 *  no snapshots rather than throwing. */
async function currentSnapshots(photoId: number): Promise<{ name: string; recipe: unknown }[]> {
  try {
    if (typeof listSnapshots !== "function") return [];
    const rows = await listSnapshots(photoId);
    return rows.map((s) => ({ name: s.name, recipe: JSON.parse(s.recipeJson) as unknown }));
  } catch {
    return [];
  }
}

/** Vision's `mvcr:Payload` from the XMP we're about to replace. Galerie owns
 *  the crs: block but is only a COURIER for Vision's — reading it back and
 *  re-emitting it is what stops a Galerie write from deleting Vision's lossless
 *  develop settings out of the shared packet. Best-effort: no XMP, an
 *  unreadable one, or one with no payload → nothing to carry. */
async function priorMonetPayload(sourcePath: string): Promise<string | null> {
  const xml = await readXmpText(sourcePath);
  return (xml == null ? null : tryParseCameraRawXmp(xml)?.monetRaw) ?? null;
}

/** The sidecar renders for a photo's current catalog state: `write` carries
 *  Vision's courier payload (the text that actually lands on disk), `status`
 *  is the payload-free render whose digest stands for "the catalog side" in
 *  metadataStatus — the payload is Vision's state, not ours, so including it
 *  would misread a Vision edit as a Galerie catalog change. `snapshots` is
 *  computed once and passed to BOTH builds — two independent reads of
 *  `listSnapshots` could race a concurrent add/delete and digest differently,
 *  flapping the status indicator. */
export async function renderSidecars(row: PhotoRow): Promise<{ write: string; status: string }> {
  const [recipeJson, kws, monetRaw, vocab, snapshots] = await Promise.all([
    getRecipe(row.id),
    listPhotoKeywords(row.id),
    priorMonetPayload(row.path),
    exportVocab(),
    currentSnapshots(row.id),
  ]);
  const { flat: keywords, hierarchical } = exportKeywords(kws, vocab);
  const meta = {
    rating: row.rating,
    label: row.colorLabel,
    title: row.title,
    caption: row.caption,
    creator: row.creator,
    copyright: row.copyright,
    city: row.city,
    stateProvince: row.stateProvince,
    country: row.country,
    jobTitle: row.jobTitle,
    credit: row.credit,
    source: row.source,
    keywords,
    hierarchical,
  };
  return {
    write: buildXmpSidecar(meta, recipeJson, monetRaw, snapshots),
    status: buildXmpSidecar(meta, recipeJson, null, snapshots),
  };
}

/** One photo's XMP from its current catalog state — shared by the manual
 *  "Save Metadata to File" path and the auto-write queue. `writeXmpFor` decides
 *  embedded-vs-sidecar by format; the baseline digests the text as it actually
 *  landed, so metadata status compares like with like. Returns the written
 *  path (the source itself when the packet went in-file). */
export async function writeSidecarForPhoto(row: PhotoRow): Promise<string> {
  const { write, status } = await renderSidecars(row);
  const { path, onDisk } = await writeXmpFor(row.path, write);
  recordMetadataSync(row.id, onDisk, status);
  return path;
}

/** Baseline after "Read Metadata from File": the catalog was just set FROM the
 *  sidecar, so record both sides as-of-now. Call with the POST-apply row. */
export async function recordMetadataRead(row: PhotoRow): Promise<void> {
  const fileXml = await readXmpText(row.path);
  if (fileXml == null) return; // no XMP — nothing was read, nothing to baseline
  const { status } = await renderSidecars(row);
  recordMetadataSync(row.id, fileXml, status);
}

/** A photo's current metadata status (LR's grid badge / resolve row). Cheap
 *  for the common case: no baseline short-circuits before any IO.
 *  ponytail: no fs watcher — external sidecar edits surface on the next probe
 *  (cell mount, sync, recipe change); add a watched-folder hook if staleness
 *  bites. */
export async function metadataStatusFor(row: PhotoRow): Promise<MetadataStatus> {
  if (!isTauri()) return "unknown";
  const base = getMetadataBaseline(row.id);
  if (!base) return "unknown";
  // XMP gone (sidecar deleted, packet stripped) — compareMetadataSync counts
  // that as an external change.
  const fileXml = await readXmpText(row.path);
  const { status } = await renderSidecars(row);
  return compareMetadataSync(base, fileXml, status);
}

const pending = new Map<number, ReturnType<typeof setTimeout>>();

/** Queue a debounced auto-write for a just-mutated photo. `latest` re-resolves
 *  the row when the timer fires, so a rapid edit burst writes its FINAL state
 *  once. No-op when the feature is off or outside Tauri. */
export function queueXmpWrite(row: PhotoRow, latest?: () => PhotoRow | undefined): void {
  if (!xmpAutoWriteEnabled() || !isTauri()) return;
  const prev = pending.get(row.id);
  if (prev) clearTimeout(prev);
  pending.set(
    row.id,
    setTimeout(() => {
      pending.delete(row.id);
      const r = latest?.() ?? row;
      void writeSidecarForPhoto(r).catch((e) =>
        console.error("galerie xmp auto-write failed", r.path, e),
      );
    }, DEBOUNCE_MS),
  );
}
