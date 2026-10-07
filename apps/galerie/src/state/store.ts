// state/store — Galerie's in-memory view/session store.
//
// Unlike a document editor (Anime/Vision), the catalog IS the source of truth
// (SQLite, src-tauri/src/catalog.rs). This store holds only *view* state over
// transactional, cursor-paged catalog queries: which catalog is open, the
// loaded page buffer, the active filter, selection, and the current module —
// never the whole catalog. No clone-on-write undo:
// edits go straight to the DB via the bridge.
//
// React binds via useSyncExternalStore, matching the sibling apps' idiom.

import type { KeywordVocabRow } from "../lib/xmpAutoWrite";
import { useSyncExternalStore } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  createDefaultRecipe,
  normalizeRecipe,
  type DevelopRecipeV2,
} from "@monet-ui/monet-photo";

import { exists, readFile } from "@tauri-apps/plugin-fs";

import * as cat from "../catalog/catalog";
import { fingerprint } from "../lib/fingerprint";
import { isDirectChild, mergeExtraFolders } from "../lib/folderTree";
import {
  QUICK_COLLECTION_NAME,
  findQuickCollection,
  membershipToggle,
  resolveTargetId,
} from "../lib/quickCollection";
import { persistDevelopRecipe } from "../lib/persistDevelopRecipe";
import type { FilterSnapshot } from "../lib/filterPresets";
import { queueXmpWrite } from "../lib/xmpAutoWrite";
import { mergeRecipePatch, type DeepPartial } from "../lib/recipePatch";
import { DEFAULT_SORT } from "../catalog/types";
import type {
  CollectionRow,
  Cursor,
  FilterOptions,
  FolderRow,
  GridSort,
  RatingOp,
  TextTarget,
  ImportPhoto,
  KeywordCountRow,
  MetadataPresetRow,
  PhotoFilter,
  PhotoMetadata,
  PhotoRow,
  PresetRow,
} from "../catalog/types";

/** Photos fetched per page (the grid loads more as it scrolls). */
export const PAGE_SIZE = 200;
/** Upper bound on buffered rows (LR's bounded grid window): the loaded buffer
 *  trims as the grid scrolls so a deep pass over a 100k catalog stays flat in
 *  memory, and every buffer-wide `.map()` mutation is O(BUFFER_CAP), not
 *  O(rows visited this session). Must comfortably exceed the largest physical
 *  viewport window (+ overscan/read-ahead) so a trim never drops visible cells. */
export const BUFFER_CAP = 6000;
/** Reserved manual collection replaced after every successful import batch. */
export const PREVIOUS_IMPORT_NAME = "Previous Import";
/** Stable marker stored in the otherwise-unused manual-collection rule field. */
export const PREVIOUS_IMPORT_MARKER = '{"monetSystemCollection":"previous-import"}';

export function findPreviousImport(collections: readonly CollectionRow[]): CollectionRow | undefined {
  return collections.find(
    (collection) =>
      collection.kind === "collection" && collection.ruleAst === PREVIOUS_IMPORT_MARKER,
  );
}

// ─────────────────────────────────────────────────────────────
// The universal container — `.mgal` (docs/plans/11-universal-container.md)
// ─────────────────────────────────────────────────────────────
//
// The work is native (src-tauri/src/catalog.rs → monet-db's
// `open_from_container` / `snapshot_to_container`): SQLite cannot be operated
// inside a zip, and the only connection lives in Rust. These two are the
// bridge, and they live here rather than in export.ts so the store never has to
// pull the render engine in with them.

/** What `catalog_open_container` found: what it opened, and what it left alone. */
export interface OpenedContainer {
  /** Catalog schema version, or null when the container carries no database —
   *  not an error, just a document with nothing Galerie understands (rule 1). */
  schemaVersion: number | null;
  /** The extracted working copy now open, or null when nothing was opened. */
  working: string | null;
  /** Entries Galerie did not consume, as `path (role)`. Couriered on save. */
  ignored: string[];
  /** Who wrote the container last, and what they called it. */
  app: string;
  kind: string;
}

/** Open any Monet container and extract the catalog it carries (if any). */
function openContainerFile(path: string): Promise<OpenedContainer> {
  return invoke<OpenedContainer>("plugin:catalog|catalog_open_container", { path });
}

/** Snapshot the open catalog into a container at `path`, couriering every entry
 *  and manifest field Galerie never read (rule 2). */
function saveContainerFile(path: string): Promise<void> {
  return invoke("plugin:catalog|catalog_save_container", { path });
}

// ─────────────────────────────────────────────────────────────
// Catalog interchange — "Export as Catalog…" / "Import from Another Catalog…"
// ─────────────────────────────────────────────────────────────
//
// The laptop→desktop round-trip. Native for the same reason the container is:
// the only SQLite connection lives in Rust, and a merge is one ATTACH plus a
// transaction (src-tauri/src/catalog.rs → `db::import_from_catalog`).

/** A path's last segment, either slash — what a toast names a file by. */
function baseName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
}

/** What a merge did — also what a dry run reports instead of writing. */
export interface CatalogMergeReport {
  photosAdded: number;
  /** Photos already here whose develop + metadata were taken from the other
   *  catalog (only when `replaceExisting`). */
  photosUpdated: number;
  /** Photos already here that were left exactly as they are. */
  photosSkipped: number;
  collectionsAdded: number;
  keywordsAdded: number;
}

/** Write `ids` to a new `.galcat` at `dest`; resolves with the photo count. */
function exportCatalogFile(ids: number[], dest: string): Promise<number> {
  return invoke<number>("plugin:catalog|catalog_export_as_catalog", { ids, dest });
}

/** Merge the catalog at `source` into the open one. */
function importCatalogFile(
  source: string,
  replaceExisting: boolean,
  dryRun: boolean,
): Promise<CatalogMergeReport> {
  return invoke<CatalogMergeReport>("plugin:catalog|catalog_import_from_catalog", {
    source,
    replaceExisting,
    dryRun,
  });
}

/** The merge summary as one line of prose — the dialog's preview and the
 *  post-merge toast are the same sentence. Exported for tests. */
export function mergeSummary(report: CatalogMergeReport): string {
  const parts = [`${report.photosAdded} new photo${report.photosAdded === 1 ? "" : "s"}`];
  if (report.photosUpdated) parts.push(`${report.photosUpdated} updated`);
  if (report.photosSkipped) parts.push(`${report.photosSkipped} already here, left alone`);
  if (report.collectionsAdded) parts.push(`${report.collectionsAdded} new collections`);
  if (report.keywordsAdded) parts.push(`${report.keywordsAdded} new keywords`);
  return `${parts.join(", ")}.`;
}

/** Beyond this many, the toast names a count instead of a wall of paths. */
const MAX_LISTED_IGNORED = 4;

/** Rule 1 as user-visible prose: what opened, and what did not. Exported for
 *  tests — this toast is the only report a user ever gets. */
export function containerOpenSummary(path: string, opened: OpenedContainer): string {
  const name = baseName(path);
  const writer = opened.app || "an unknown app";
  let kept = "";
  if (opened.ignored.length) {
    const rest = opened.ignored.length - MAX_LISTED_IGNORED;
    const shown = opened.ignored.slice(0, MAX_LISTED_IGNORED).join(", ");
    kept = ` Kept untouched: ${shown}${rest > 0 ? ` +${rest} more` : ""}.`;
  }
  return opened.schemaVersion == null
    ? `${name} carries no catalog — a ${opened.kind || "Monet"} document from ${writer}.${kept}`
    : `Opened the catalog in ${name} (last written by ${writer}).${kept}`;
}

export type Module = "grid" | "loupe" | "develop" | "compare" | "survey";

/** Grid cell rendering style — LR's J cycle. */
export type GridStyle = "clean" | "compact" | "expanded";

/** Human label for a culling edit (undo stack + Edit menu). */
export function cullUndoLabel(
  prior: { rating: number; flag: number; colorLabel: string | null },
  next: { rating: number; flag: number; colorLabel: string | null },
): string {
  if (prior.rating !== next.rating) return next.rating > 0 ? `Rate ${next.rating}★` : "Clear Rating";
  if (prior.flag !== next.flag) return next.flag === 1 ? "Pick" : next.flag === -1 ? "Reject" : "Unflag";
  if (prior.colorLabel !== next.colorLabel)
    return next.colorLabel ? `Label ${next.colorLabel}` : "Clear Label";
  return "Edit Photo";
}

/** Grid thumbnail box-width bounds (px). 256-decode thumbs stay acceptable to ~320. */
export const GRID_CELL_MIN = 120;
export const GRID_CELL_MAX = 320;

/** Painter spray payload (LR Painter tool): what a grid click applies. */
export type PainterPayload =
  | { kind: "rating"; value: number }
  | { kind: "flag"; value: 1 | 0 | -1 }
  | { kind: "label"; value: string }
  | { kind: "keyword"; value: string }
  | { kind: "quick" } // Target/Quick Collection membership toggle
  | { kind: "metadataPreset"; value: MetadataPresetRow }
  | { kind: "preset"; value: PresetRow }; // develop preset

/** One long-running task shown in the StatusBar progress stack (LR's identity
 *  plate): import, Build Previews, export. */
export interface BackgroundJob {
  id: number;
  /** Progress-row text, e.g. "Building 1:1 Previews". */
  label: string;
  done: number;
  total: number;
}

/** What a job's loop gets to report progress and notice the Cancel button. */
export interface JobHandle {
  tick(): void;
  setTotal(total: number): void;
  cancelled(): boolean;
}

export interface ViewState {
  /** Path of the open catalog, or null. */
  catalogPath: string | null;
  /** Native catalog reachable (running under Tauri). */
  available: boolean;
  /** A catalog is open and its first page has loaded. */
  ready: boolean;
  /** Loaded rows — a contiguous window over the filtered set starting at
   *  absolute index `photosStart`, bounded to BUFFER_CAP (trimmed as the grid
   *  scrolls; reset on reload). Browse drains (collection/keyword/duplicates/
   *  stack) still hold their whole source with photosStart 0. */
  photos: PhotoRow[];
  /** Absolute index (within the filtered set) of photos[0]. */
  photosStart: number;
  /** Cursor for the next page, or null when exhausted / not loaded. */
  next: Cursor | null;
  /** More pages remain to fetch. */
  hasMore: boolean;
  /** Total photos matching the current filter. */
  total: number;
  /** A page fetch is in flight. */
  loading: boolean;
  /** Minimum star rating shown (Filter bar). */
  filterMinRating: number;
  /** Flag filter: null = any, 1 picks, 0 unflagged, -1 rejects. */
  filterFlag: number | null;
  /** Color-label filter: null = any, else exact label. */
  filterLabel: string | null;
  /** Text (filename) filter: "" = any, else a case-insensitive path substring. */
  filterText: string;
  /** Text-filter search target (LR Text mode); "path" = filename search. */
  filterTextTarget: TextTarget;
  /** Rating comparison mode for filterMinRating. */
  filterRatingOp: RatingOp;
  /** Metadata-mode filters (Filter bar): null = any. */
  filterCamera: string | null;
  filterLens: string | null;
  filterYear: number | null;
  /** Metadata-mode option lists (cameras/lenses/years + counts); null until loaded. */
  filterOptions: FilterOptions | null;
  /** LR's filter lock: unlocked (default) clears the filter on source switches. */
  filterLocked: boolean;
  /** Library grid sort (key + direction), shared by every grid source. `user`
   *  is valid only for a manual collection. */
  sort: GridSort;
  /** Grid thumbnail box width in px (Lightroom's Thumbnails size). */
  gridCellSize: number;
  /** Grid columns at the current layout — published by LibraryGrid so keyboard
   *  row-navigation (↑/↓) knows the row pitch. */
  gridColumns: number;
  /** Grid cell style (LR's J cycle): bare thumbnails, the compact badge bar,
   *  or the expanded bar with a camera/date/size line. */
  gridStyle: GridStyle;
  /** Top of the library undo/redo stacks (Edit menu labels); null = empty. */
  undoLabel: string | null;
  redoLabel: string | null;
  /** Background export progress (StatusBar indicator); null = no job running. */
  exportJob: { done: number; total: number } | null;
  /** Every running background task, newest last (StatusBar progress stack). */
  jobs: BackgroundJob[];
  /** The sidebar's collection tree (empty until loaded). */
  collections: CollectionRow[];
  /** Grid source = this collection's photos, or the whole catalog when null. */
  activeCollectionId: number | null;
  /** Browse-by-keyword grid source (Keyword List panel); null = not active. */
  activeKeywordId: number | null;
  /** Folder filter (Folders panel); null = whole catalog. Applies to the
   *  paginated library query AND client-side reconciliation. */
  activeFolderPath: string | null;
  /** Source folders with counts (Folders panel). */
  folders: FolderRow[];
  /** Session-created empty folders (count 0 rows). Folders are otherwise
   *  derived from photo paths, so an empty one has nothing to list.
   *  ponytail: session-only — persist a folder table if they must survive. */
  extraFolders: string[];
  /** Folders panel "Show Photos in Subfolders": true (default) = the folder
   *  filter includes subfolders, false = direct children only. */
  folderRecursive: boolean;
  /** Paths a panel asked to import (per-folder Synchronize) — App opens the
   *  Import dialog seeded with these; null = no pending request. */
  importRequest: string[] | null;
  /** The keyword vocabulary with usage counts (Keyword List panel). */
  keywords: KeywordCountRow[];
  /** Explicit Target Collection for the B key; null = the Quick Collection. */
  targetCollectionId: number | null;
  /** Cached member ids of the Quick Collection (drives the count + B toggle). */
  quickMemberIds: number[];
  /** Grid source = exact-duplicate photos (overrides collection/library). */
  duplicatesActive: boolean;
  /** Grid source = one expanded stack's members (overrides all); null = normal. */
  expandedStackId: number | null;
  /** LR Expand All Stacks: list every stack member in place (no collapse). */
  stacksExpanded: boolean;
  /** Painter tool payload; non-null = grid clicks spray this instead of selecting. */
  painter: PainterPayload | null;
  /** Pinned Reference photo id (Develop Reference View), or null. */
  referencePhotoId: number | null;
  /** Reference View visible in Develop. */
  referenceActive: boolean;
  /** Active module (Library grid / Loupe / Develop). */
  module: Module;
  /** Selected photo ids. */
  selection: number[];
  /** The primary/active photo id (Loupe/Develop target), or null. */
  activeId: number | null;
  /** Compare view's Candidate photo id (the Select is `activeId`), or null. */
  compareCandidateId: number | null;
  /** A develop recipe is on the copy/paste clipboard (enables Paste Settings). */
  hasDevelopClip: boolean;
  /** Auto Sync (Develop): every committed edit mirrors to the rest of the selection. */
  autoSync: boolean;
  /** The photo that was active before this one — Develop's Previous button source. */
  prevActiveId: number | null;
  /** Last error message from a catalog operation, or null. */
  error: string | null;
  /** Transient status line (e.g. "Catalog optimized"); auto-clears. */
  notice: string | null;
  /** Bumped on every change (cheap selector equality escape hatch). */
  rev: number;
}

const INITIAL: ViewState = {
  catalogPath: null,
  available: cat.catalogAvailable(),
  ready: false,
  photos: [],
  photosStart: 0,
  next: null,
  hasMore: false,
  total: 0,
  loading: false,
  filterMinRating: 0,
  filterFlag: null,
  filterLabel: null,
  filterText: "",
  filterTextTarget: "path",
  filterRatingOp: ">=",
  filterCamera: null,
  filterLens: null,
  filterYear: null,
  filterOptions: null,
  filterLocked: false,
  sort: DEFAULT_SORT,
  gridCellSize: 200,
  gridColumns: 1,
  gridStyle: "compact",
  undoLabel: null,
  redoLabel: null,
  exportJob: null,
  jobs: [],
  collections: [],
  activeCollectionId: null,
  activeKeywordId: null,
  activeFolderPath: null,
  folders: [],
  extraFolders: [],
  folderRecursive: true,
  importRequest: null,
  keywords: [],
  targetCollectionId: null,
  quickMemberIds: [],
  duplicatesActive: false,
  expandedStackId: null,
  stacksExpanded: false,
  painter: null,
  referencePhotoId: null,
  referenceActive: false,
  module: "grid",
  selection: [],
  activeId: null,
  compareCandidateId: null,
  hasDevelopClip: false,
  autoSync: false,
  prevActiveId: null,
  error: null,
  notice: null,
  rev: 0,
};

/** Lift the chosen panels out of a recipe JSON into a develop patch — the shared
 *  half of scoped Paste Settings and scoped Sync Settings. Null if the JSON is
 *  malformed (nothing safe to apply). */
function scopedRecipePatch(json: string, scope: string[]): DeepPartial<DevelopRecipeV2> | null {
  let source: DevelopRecipeV2;
  try {
    source = normalizeRecipe(JSON.parse(json) as unknown);
  } catch {
    return null;
  }
  const patch: DeepPartial<DevelopRecipeV2> = {};
  for (const k of scope) {
    (patch as Record<string, unknown>)[k] = (source as unknown as Record<string, unknown>)[k];
  }
  return patch;
}

/** Capture EV of a shot (log2(N²/t) − log2(ISO/100)) — how dark the exposure
 *  triad rendered the scene. Null when any leg of the triad is missing. */
function captureEv(p: PhotoRow | undefined): number | null {
  if (!p || p.fNumber == null || p.exposureTime == null || p.iso == null) return null;
  if (p.fNumber <= 0 || p.exposureTime <= 0 || p.iso <= 0) return null;
  return Math.log2((p.fNumber * p.fNumber) / p.exposureTime) - Math.log2(p.iso / 100);
}

export class CatalogStore {
  private state: ViewState = INITIAL;
  private listeners = new Set<() => void>();
  private selectionSync = Promise.resolve();
  /** Serializes Quick/Target-Collection mutations so a rapid second B press sees
   *  the previous toggle's refreshed cache (no dropped/wrong-direction toggle). */
  private quickChain: Promise<void> = Promise.resolve();
  /** In-flight Quick Collection create — shared so concurrent first-use B presses
   *  can't insert duplicate reserved collections. */
  private quickEnsuring: Promise<number | null> | null = null;
  /** Request generation. Bumped on every open/reload; an async page load whose
   *  captured generation no longer matches is discarded (prevents an in-flight
   *  loadMore/reload from clobbering the buffer after the filter changed). */
  private epoch = 0;
  /** Copy/Paste Settings clipboard: a recipe JSON + its process version. */
  private developClip: { json: string; processVersion: number | null; scope: string[] | null } | null = null;
  /** Panel scope the last Sync… dialog picked (null = whole recipe). Auto Sync
   *  reuses it, the way LR's Sync checkboxes drive both. */
  private syncScope: string[] | null = null;

  getState = (): ViewState => this.state;
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private emit() {
    for (const l of this.listeners) l();
  }
  private set(patch: Partial<ViewState>) {
    const previous = this.state;
    const next = { ...previous, ...patch, rev: previous.rev + 1 };
    // Develop ▸ Previous needs the photo we just left. Tracked in the shared
    // setter because activeId moves from a dozen call sites (setActive, filters,
    // stacks, compare swap) — a patch that names prevActiveId itself wins.
    if (patch.prevActiveId === undefined && previous.activeId != null && next.activeId !== previous.activeId) {
      next.prevActiveId = previous.activeId;
    }
    this.state = next;
    this.emit();
    if (
      isTauri()
      && (previous.catalogPath !== next.catalogPath
        || previous.activeId !== next.activeId
        || previous.selection.length !== next.selection.length
        || previous.selection.some((id, index) => id !== next.selection[index]))
    ) {
      const payload = {
        catalogId: next.catalogPath,
        activePhotoId: next.catalogPath == null ? null : next.activeId,
        selection: next.catalogPath == null ? [] : [...next.selection],
      };
      this.selectionSync = this.selectionSync
        .then(() => invoke("plugin:secondary|set_shared_selection", payload))
        .then(() => undefined)
        .catch((e) => this.set({ error: `Secondary display sync failed: ${String(e)}` }));
    }
  }

  /** The current Library filter, as the catalog wire type. */
  private filter(): PhotoFilter {
    return {
      minRating: this.state.filterMinRating,
      flag: this.state.filterFlag,
      colorLabel: this.state.filterLabel,
      text: this.state.filterText.trim() || null,
      textTarget: this.state.filterTextTarget,
      ratingOp: this.state.filterRatingOp,
      folder: this.state.activeFolderPath,
      folderOnly: !this.state.folderRecursive,
      camera: this.state.filterCamera,
      lens: this.state.filterLens,
      year: this.state.filterYear,
      expandStacks: this.state.stacksExpanded,
    };
  }

  /** Does a photo (or a would-be updated flag state) pass the current filter?
   *  Used to reconcile the buffer client-side (cull, collection/duplicate views). */
  private matchesFilter(p: {
    rating: number;
    flag: number;
    colorLabel: string | null;
    path: string;
    title?: string | null;
    caption?: string | null;
    cameraModel?: string | null;
    lens?: string | null;
    captureTime?: number | null;
  }): boolean {
    const s = this.state;
    if (s.filterRatingOp === "=" ? p.rating !== s.filterMinRating
        : s.filterRatingOp === "<=" ? p.rating > s.filterMinRating
        : p.rating < s.filterMinRating) return false;
    if (s.filterFlag != null && p.flag !== s.filterFlag) return false;
    if (s.filterLabel != null && p.colorLabel !== s.filterLabel) return false;
    const text = s.filterText.trim().toLowerCase();
    if (text) {
      // Keyword-backed targets can't be checked from a row — keep the photo and
      // let the next reload settle it.
      const t = s.filterTextTarget;
      const inField = (v: string | null | undefined) => (v ?? "").toLowerCase().includes(text);
      if (t === "title" && !inField(p.title)) return false;
      if (t === "caption" && !inField(p.caption)) return false;
      if (t === "path" && !inField(p.path)) return false;
      if (t === "any" && !(inField(p.path) || inField(p.title) || inField(p.caption))) {
        // keywords may still match server-side; keep.
      }
    }
    if (s.activeFolderPath != null) {
      if (s.folderRecursive ? !p.path.startsWith(s.activeFolderPath + "/") : !isDirectChild(p.path, s.activeFolderPath))
        return false;
    }
    if (s.filterCamera != null && p.cameraModel !== s.filterCamera) return false;
    if (s.filterLens != null && p.lens !== s.filterLens) return false;
    if (s.filterYear != null) {
      const y = p.captureTime != null ? new Date(p.captureTime * 1000).getUTCFullYear() : null;
      if (y !== s.filterYear) return false;
    }
    return true;
  }

  /** Open (creating if absent) a catalog and load its first page. */
  async open(path: string): Promise<void> {
    if (!this.state.available) {
      this.set({ catalogPath: path, ready: false, error: "catalog unavailable (not running under Tauri)" });
      return;
    }
    this.set({ loading: true, error: null });
    try {
      await cat.openCatalog(path);
      await this.adoptCatalog(path);
    } catch (e) {
      this.set({ loading: false, ready: false, error: String(e) });
    }
  }

  /** Reset every per-catalog view slice and load the first page. Shared by
   *  `open` (a live `.galcat`) and `openContainer` (an extracted `.mgal`). */
  private async adoptCatalog(path: string): Promise<void> {
    this.undoStack = [];
    this.redoStack = [];
    this.set({ catalogPath: path, ready: true, photos: [], photosStart: 0, next: null, hasMore: false, selection: [], activeId: null, prevActiveId: null, compareCandidateId: null, activeCollectionId: null, activeKeywordId: null, activeFolderPath: null, folders: [], extraFolders: [], importRequest: null, keywords: [], targetCollectionId: null, quickMemberIds: [], expandedStackId: null, referencePhotoId: null, referenceActive: false, undoLabel: null, redoLabel: null });
    await this.reload();
    await this.loadCollections();
    await this.refreshQuickMembers();
  }

  /** Open a Monet container (ANY app's, ANY extension — dispatch is on the
   *  manifest) and load the catalog it carries. Returns true when a catalog was
   *  opened; a container with none is not an error, it is reported and left.
   *  See docs/plans/11-universal-container.md rule 1. */
  async openContainer(path: string): Promise<boolean> {
    if (!this.state.available) {
      this.set({ error: "catalog unavailable (not running under Tauri)" });
      return false;
    }
    this.set({ loading: true, error: null });
    try {
      const opened = await openContainerFile(path);
      // The report goes on screen, never to the console — a Rythme file opened
      // here is a document with no catalog in it, not a failure.
      this.notify(containerOpenSummary(path, opened));
      if (opened.working == null) {
        this.set({ loading: false });
        return false;
      }
      await this.adoptCatalog(opened.working);
      return true;
    } catch (e) {
      this.set({ loading: false, ready: false, error: String(e) });
      this.notify(`Could not open ${path}: ${String(e)}`);
      return false;
    }
  }

  /** Save the open catalog into a container at `path` (`.mgal`). Every entry
   *  and manifest field Galerie never read is couriered by the native side. */
  async saveContainer(path: string): Promise<boolean> {
    if (!this.state.ready) {
      this.notify("Open a catalog before saving a container.");
      return false;
    }
    try {
      await saveContainerFile(path);
      this.notify(`Saved ${path}.`);
      return true;
    } catch (e) {
      this.set({ error: String(e) });
      this.notify(`Container save failed: ${String(e)}`);
      return false;
    }
  }

  /** "Export as Catalog…": write `ids` to a new `.galcat` at `path`. Source
   *  files are not copied — the new catalog references the same paths. */
  async exportAsCatalog(path: string, ids: readonly number[]): Promise<boolean> {
    if (!this.state.ready) {
      this.notify("Open a catalog before exporting one.");
      return false;
    }
    try {
      const n = await exportCatalogFile([...ids], path);
      this.notify(`Exported ${n} photo${n === 1 ? "" : "s"} to ${baseName(path)}.`);
      return true;
    } catch (e) {
      this.notify(`Export as Catalog failed: ${String(e)}`);
      return false;
    }
  }

  /** "Import from Another Catalog…": merge the catalog at `path` into the open
   *  one. `dryRun` previews without writing; a real merge reloads the library
   *  because the incoming photos, collections and keywords are all new rows. */
  async importFromCatalog(
    path: string,
    replaceExisting: boolean,
    dryRun = false,
  ): Promise<CatalogMergeReport | null> {
    if (!this.state.ready) {
      this.notify("Open a catalog before merging one into it.");
      return null;
    }
    try {
      const report = await importCatalogFile(path, replaceExisting, dryRun);
      if (dryRun) return report;
      this.notify(`Merged ${baseName(path)}: ${mergeSummary(report)}`);
      await this.reload();
      await this.loadCollections();
      await this.refreshKeywordList();
      return report;
    } catch (e) {
      this.notify(`Import from Another Catalog failed: ${String(e)}`);
      return null;
    }
  }

  /** Reset the page buffer and load page 1 + the total (after a filter change). */
  async reload(): Promise<void> {
    if (!this.state.ready) return;
    const gen = ++this.epoch; // new generation — supersedes any in-flight load
    this.cursorLadder.clear();
    this.cursorLadder.set(0, null); // a fetch from the very start uses no cursor
    const filter = this.filter();
    const colId = this.state.activeCollectionId;
    const userOrderAvailable =
      this.state.expandedStackId == null &&
      !this.state.duplicatesActive &&
      this.state.activeKeywordId == null &&
      colId != null &&
      this.state.collections.some((c) => c.id === colId && c.kind === "collection");
    const sort =
      this.state.sort.key === "user" && !userOrderAvailable ? DEFAULT_SORT : this.state.sort;
    if (sort !== this.state.sort) this.set({ sort });
    this.set({ loading: true, error: null, photos: [], photosStart: 0, next: null, hasMore: false });
    try {
      // Special grid sources: an expanded stack loads in one shot (stacks are
      // small); duplicates / collections / keywords drain their FULL result in
      // offset chunks — the filter is applied client-side either way.
      if (this.state.expandedStackId != null) {
        const all = await cat.listStack(this.state.expandedStackId, sort);
        if (gen !== this.epoch) return;
        const photos = all.filter((p) => this.matchesFilter(p));
        this.set({ photos, next: null, hasMore: false, total: photos.length, loading: false });
        return;
      }
      if (this.state.duplicatesActive) {
        await this.drainSource(gen, (limit, offset) => cat.duplicatePhotos(limit, offset, sort));
        return;
      }
      if (colId != null) {
        await this.drainSource(gen, (limit, offset) =>
          cat.listCollectionPhotos(colId, limit, offset, sort),
        );
        return;
      }
      const kwId = this.state.activeKeywordId;
      if (kwId != null) {
        await this.drainSource(gen, (limit, offset) =>
          cat.listKeywordPhotos(kwId, limit, offset, sort),
        );
        return;
      }
      const [page, total] = await Promise.all([
        cat.listPhotos(PAGE_SIZE, null, filter, sort),
        cat.countPhotos(filter),
      ]);
      if (gen !== this.epoch) return; // a newer reload/filter change won
      this.cursorLadder.set(page.photos.length, page.next);
      this.set({ photos: page.photos, next: page.next, hasMore: page.next != null, total, loading: false });
    } catch (e) {
      if (gen === this.epoch) this.set({ loading: false, error: String(e) });
    }
  }

  /** Drain an offset-windowed browse source (collection / keyword / duplicates)
   *  COMPLETELY into the buffer — these can span the whole catalog, so a single
   *  capped fetch would silently hide photos and misreport the total. Chunks
   *  keep each IPC payload bounded and paint progressively as they land.
   *  ponytail: whole source in memory, offset re-scan per chunk — upgrade to
   *  keyset pagination + a windowed buffer if 100k-photo collections drag. */
  private async drainSource(
    gen: number,
    fetch: (limit: number, offset: number) => Promise<PhotoRow[]>,
  ): Promise<void> {
    const CHUNK = 2000;
    let offset = 0;
    let photos: PhotoRow[] = [];
    for (;;) {
      const chunk = await fetch(CHUNK, offset);
      if (gen !== this.epoch) return; // superseded by a newer reload
      offset += chunk.length;
      photos = photos.concat(chunk.filter((p) => this.matchesFilter(p)));
      const done = chunk.length < CHUNK;
      // hasMore stays false: the drain itself finishes the load, loadMore never
      // applies to these sources. `total` converges on the true filtered count.
      this.set({ photos, next: null, hasMore: false, total: photos.length, loading: !done });
      if (done) return;
    }
  }

  /** Rename Folder (Folders panel): rename the directory on disk, repoint the
   *  catalog, and reload — grid membership under the folder filter and the
   *  filename-sort pagination cursor both change with the paths, so an
   *  in-place buffer patch cannot stay consistent. One undoable step. */
  async renameFolder(oldDir: string, newDir: string, recordUndo = true): Promise<void> {
    let n: number;
    try {
      n = await cat.renameFolder(oldDir, newDir);
    } catch (e) {
      this.set({ error: String(e) });
      if (!recordUndo) throw e; // replay: undo()/redo() must not migrate the entry
      return;
    }
    const af = this.state.activeFolderPath;
    if (af === oldDir) this.set({ activeFolderPath: newDir });
    else if (af != null && (af.startsWith(oldDir + "/") || af.startsWith(oldDir + "\\")))
      this.set({ activeFolderPath: newDir + af.slice(oldDir.length) });
    await this.reload();
    await this.refreshFolders();
    if (recordUndo) {
      this.pushUndo({
        label: "Rename Folder",
        undo: () => this.renameFolder(newDir, oldDir, false),
        redo: () => this.renameFolder(oldDir, newDir, false),
      });
    }
    this.notify(`Renamed folder — ${n} photo${n === 1 ? "" : "s"} repointed`);
  }

  /** Batch Rename (LR's Rename Photos / F2): rename each step's file on disk
   *  and repoint the catalog; per-file failures are collected, successes are
   *  reconciled in the buffer and recorded as one undoable batch. */
  async renamePhotos(steps: { id: number; from: string; to: string }[], recordUndo = true): Promise<void> {
    if (steps.length === 0) return;
    const done: { id: number; from: string; to: string }[] = [];
    const failed: string[] = [];
    for (const s of steps) {
      try {
        await cat.renamePhotoFile(s.id, s.to);
        done.push(s);
      } catch (e) {
        failed.push(`${s.from}: ${String(e)}`);
      }
    }
    if (done.length) {
      const byId = new Map(done.map((s) => [s.id, s.to]));
      this.set({
        photos: this.state.photos.map((p) => {
          const to = byId.get(p.id);
          if (to == null) return p;
          // readPath mirrors path for unmanaged sources; managed DNGs keep theirs.
          return { ...p, path: to, readPath: p.readPath === p.path ? to : p.readPath };
        }),
      });
      if (recordUndo) {
        const inverse = done.map((s) => ({ id: s.id, from: s.to, to: s.from }));
        this.pushUndo({
          label: `Rename ${done.length} Photo${done.length === 1 ? "" : "s"}`,
          undo: () => this.renamePhotos(inverse, false),
          redo: () => this.renamePhotos(done, false),
        });
      }
    }
    this.notify(
      failed.length
        ? `Renamed ${done.length}, failed ${failed.length}: ${failed[0]}`
        : `Renamed ${done.length} photo${done.length === 1 ? "" : "s"}`,
    );
    // Replay: a partial batch means the op did not apply — undo()/redo() must
    // keep the history entry where it was.
    if (!recordUndo && failed.length > 0) throw new Error(failed[0]);
  }

  /** Edit Capture Time (LR's Metadata dialog). Reconciles the buffer row in
   *  place (the visual sort order updates on the next reload) and records a
   *  library-undo entry unless it IS an undo/redo replay. */
  async setCaptureTime(id: number, captureTime: number | null, recordUndo = true): Promise<void> {
    const prior = this.state.photos.find((p) => p.id === id)?.captureTime ?? null;
    try {
      await cat.setCaptureTime(id, captureTime);
    } catch (e) {
      this.set({ error: String(e) });
      if (!recordUndo) throw e; // replay: undo()/redo() must not migrate the entry
      return;
    }
    this.set({
      photos: this.state.photos.map((p) => (p.id === id ? { ...p, captureTime } : p)),
    });
    if (recordUndo && prior !== captureTime) {
      this.pushUndo({
        label: "Edit Capture Time",
        undo: () => this.setCaptureTime(id, prior, false),
        redo: () => this.setCaptureTime(id, captureTime, false),
      });
    }
    this.notify("Capture time updated");
  }

  /** Geotag a photo (LR's Map module). Both halves move together — a null pair
   *  is Delete GPS Location. Undoable back to the prior coordinate. */
  async setGps(id: number, lat: number | null, lon: number | null, recordUndo = true): Promise<void> {
    const cur = this.state.photos.find((p) => p.id === id);
    const priorLat = cur?.gpsLat ?? null;
    const priorLon = cur?.gpsLon ?? null;
    try {
      await cat.setGps(id, lat, lon);
    } catch (e) {
      this.set({ error: String(e) });
      if (!recordUndo) throw e; // replay: undo()/redo() must not migrate the entry
      return;
    }
    this.set({
      photos: this.state.photos.map((p) => (p.id === id ? { ...p, gpsLat: lat, gpsLon: lon } : p)),
    });
    if (recordUndo && (priorLat !== lat || priorLon !== lon)) {
      this.pushUndo({
        label: lat == null ? "Delete GPS Location" : "Edit GPS Location",
        undo: () => this.setGps(id, priorLat, priorLon, false),
        redo: () => this.setGps(id, lat, lon, false),
      });
    }
    this.notify(lat == null ? "GPS location removed" : "GPS location updated");
  }

  /** Switch the grid source to a keyword's photos (null = whole catalog). */
  async setActiveKeyword(id: number | null): Promise<void> {
    if (id === this.state.activeKeywordId) return;
    this.set({ ...this.filterResetPatch(), activeKeywordId: id, activeCollectionId: null, activeFolderPath: null, duplicatesActive: false, expandedStackId: null, selection: [], activeId: null });
    await this.reload();
  }

  /** Filter the library to a folder's photos (null = whole catalog). */
  async setActiveFolder(path: string | null): Promise<void> {
    if (path === this.state.activeFolderPath) return;
    this.set({ ...this.filterResetPatch(), activeFolderPath: path, activeCollectionId: null, activeKeywordId: null, duplicatesActive: false, expandedStackId: null, selection: [], activeId: null });
    await this.reload();
  }

  /** Refresh the Folders panel's source-folder list, keeping session-created
   *  empty folders visible (pruning any the catalog now lists itself). */
  async refreshFolders(): Promise<void> {
    if (!this.state.ready) return;
    try {
      const listed = await cat.listFolders();
      const extras = this.state.extraFolders.filter((p) => !listed.some((f) => f.path === p));
      this.set({ folders: mergeExtraFolders(listed, extras), extraFolders: extras });
    } catch (e) {
      this.set({ error: String(e) });
    }
  }

  /** Folders panel "Show Photos in Subfolders": recursive (default) vs
   *  direct-children-only folder filtering. */
  async setFolderRecursive(v: boolean): Promise<void> {
    if (v === this.state.folderRecursive) return;
    this.set({ folderRecursive: v });
    if (this.state.activeFolderPath != null) await this.reload();
  }

  /** Create Folder (Folders panel): mkdir on disk (a no-op for an existing
   *  directory, so Add Folder can register one) and show it as an empty row. */
  async createFolder(dir: string): Promise<void> {
    try {
      await cat.createFolder(dir);
    } catch (e) {
      this.set({ error: String(e) });
      return;
    }
    if (!this.state.extraFolders.includes(dir)) this.set({ extraFolders: [...this.state.extraFolders, dir] });
    await this.refreshFolders();
  }

  /** Remove from Catalog (Folders panel): drop every cataloged photo under the
   *  folder — the files stay on disk. Not undoable (develop edits are gone);
   *  the caller confirms first. */
  async removeFolder(dir: string): Promise<void> {
    let deleted: number[];
    try {
      deleted = await cat.removeFolder(dir);
    } catch (e) {
      this.set({ error: String(e) });
      return;
    }
    const underDir = (p: string) => p === dir || p.startsWith(dir + "/") || p.startsWith(dir + "\\");
    const af = this.state.activeFolderPath;
    this.set({
      extraFolders: this.state.extraFolders.filter((p) => !underDir(p)),
      ...(af != null && underDir(af) ? { activeFolderPath: null } : {}),
    });
    const gone = new Set(deleted);
    if (gone.size) {
      await this.reconcileRemoved(gone, `Removed folder — ${gone.size} photo${gone.size === 1 ? "" : "s"} left the catalog`);
    } else {
      this.notify("Removed folder from the panel");
    }
    await this.refreshFolders();
  }

  /** Update Folder Location (Folders panel): the folder was moved outside the
   *  app — repoint the catalog at its new path without touching the disk.
   *  ponytail: not undoable — the old directory no longer exists to repoint to. */
  async updateFolderLocation(oldDir: string, newDir: string): Promise<void> {
    let n: number;
    try {
      n = await cat.updateFolderLocation(oldDir, newDir);
    } catch (e) {
      this.set({ error: String(e) });
      return;
    }
    const af = this.state.activeFolderPath;
    if (af === oldDir) this.set({ activeFolderPath: newDir });
    else if (af != null && (af.startsWith(oldDir + "/") || af.startsWith(oldDir + "\\")))
      this.set({ activeFolderPath: newDir + af.slice(oldDir.length) });
    await this.reload();
    await this.refreshFolders();
    this.notify(`Folder location updated — ${n} photo${n === 1 ? "" : "s"} repointed`);
  }

  /** A panel asks App to open the Import dialog seeded with these paths. */
  requestImportPaths(paths: string[]): void {
    this.set({ importRequest: paths });
  }

  clearImportRequest(): void {
    if (this.state.importRequest != null) this.set({ importRequest: null });
  }

  /** Refresh the keyword vocabulary + counts (Keyword List panel). */
  async refreshKeywordList(): Promise<void> {
    if (!this.state.ready) return;
    try {
      this.set({ keywords: await cat.listKeywords() });
    } catch (e) {
      this.set({ error: String(e) });
    }
  }

  /** The keyword vocabulary, refreshed first so callers that run before the
   *  Keyword List panel ever mounted still see it. `keywords` is stored as
   *  KeywordCountRow (name + count); the export/import flags ride along on the
   *  same rows, so the widening cast lives here rather than at each caller. */
  async keywordVocab(): Promise<KeywordVocabRow[]> {
    await this.refreshKeywordList();
    return this.state.keywords as unknown as KeywordVocabRow[];
  }

  /** Delete a keyword everywhere (vocabulary + photo links). */
  async deleteKeyword(id: number): Promise<void> {
    try {
      await cat.deleteKeyword(id);
    } catch (e) {
      this.set({ error: String(e) });
      return;
    }
    if (this.state.activeKeywordId === id) await this.setActiveKeyword(null);
    await this.refreshKeywordList();
    this.notify("Keyword deleted");
  }

  /** Reload the sidebar collection tree from the catalog. */
  async loadCollections(): Promise<void> {
    if (!this.state.ready) return;
    try {
      const collections = await cat.listCollections();
      this.set({ collections });
    } catch (e) {
      this.set({ error: String(e) });
    }
  }

  /** Switch the grid source to a collection (null = whole catalog) and reload. */
  async setActiveCollection(id: number | null): Promise<void> {
    if (id === this.state.activeCollectionId && !this.state.duplicatesActive) return;
    this.set({ ...this.filterResetPatch(), activeCollectionId: id, activeKeywordId: null, activeFolderPath: null, duplicatesActive: false, expandedStackId: null, selection: [], activeId: null });
    await this.reload();
  }

  /** Switch the grid source to exact-duplicate photos (v15's Duplicates view). */
  async showDuplicates(): Promise<void> {
    if (this.state.duplicatesActive) return;
    this.set({ ...this.filterResetPatch(), duplicatesActive: true, activeCollectionId: null, activeKeywordId: null, activeFolderPath: null, expandedStackId: null, selection: [], activeId: null, module: "grid" });
    await this.reload();
  }

  /** Create a collection/set/smart node and refresh the tree; returns its id. */
  async createCollection(
    name: string,
    kind = "collection",
    ruleAst: string | null = null,
    parentId: number | null = null,
  ): Promise<number | null> {
    if (!this.state.ready) return null;
    try {
      const id = await cat.createCollection(name, kind, parentId, ruleAst);
      await this.loadCollections();
      return id;
    } catch (e) {
      this.set({ error: String(e) });
      return null;
    }
  }

  /** Rename/reparent a node and replace a smart rule, then refresh its source. */
  async updateCollection(
    id: number,
    name: string,
    parentId: number | null,
    ruleAst: string | null,
  ): Promise<boolean> {
    try {
      await cat.updateCollection(id, name, parentId, ruleAst);
      await this.loadCollections();
      if (this.state.activeCollectionId === id) await this.reload();
      return true;
    } catch (e) {
      this.set({ error: String(e) });
      return false;
    }
  }

  /** Delete a collection; if it was the active grid source, fall back to All. */
  async removeCollection(id: number): Promise<void> {
    try {
      await cat.deleteCollection(id);
    } catch (e) {
      this.set({ error: String(e) });
      return;
    }
    if (this.state.activeCollectionId === id) {
      this.set({ activeCollectionId: null });
      await this.reload();
    }
    await this.loadCollections();
  }

  /** Add photos to a manual collection (drag-drop, Library menu). Skips ids
   *  already in it so undo removes only what this call actually added. */
  addToCollection(collectionId: number, ids: number[]): Promise<void> {
    return this.runQuick(() => this.changeMembership(collectionId, ids, "add"));
  }

  /** Remove photos from a manual collection (Library menu while viewing it). */
  removeFromCollection(collectionId: number, ids: number[]): Promise<void> {
    return this.runQuick(() => this.changeMembership(collectionId, ids, "remove"));
  }

  /** Move selected photos one slot in a manual collection's persisted User
   *  Order. Native code operates on the complete membership, including rows
   *  hidden by the current filter. */
  async moveUserOrder(delta: number): Promise<void> {
    const id = this.state.activeCollectionId;
    const manual = this.state.collections.some((c) => c.id === id && c.kind === "collection");
    if (id == null || !manual || this.state.sort.key !== "user" || this.state.selection.length === 0)
      return;
    try {
      await cat.moveCollectionMembers(id, this.state.selection, delta);
      await this.reload();
    } catch (e) {
      this.set({ error: String(e) });
    }
  }

  /** Shared add/remove path: plan against current membership, apply, refresh
   *  (incl. the Quick marker cache — the target may be the Quick Collection),
   *  toast, and push an invertible Library-undo entry. Callers serialize via
   *  runQuick so a drop can't interleave with a B-key toggle. */
  private async changeMembership(collectionId: number, ids: number[], action: "add" | "remove"): Promise<void> {
    if (!this.state.ready || ids.length === 0) return;
    let affected: number[] = [];
    try {
      // ponytail: 1e6-row membership fetch, not the 2000 default — a member past
      // a paged fetch would be re-planned as an add and undone into data loss.
      const members = new Set((await cat.listCollectionPhotos(collectionId, 1_000_000)).map((p) => p.id));
      affected = [...new Set(ids)].filter((id) => (action === "add" ? !members.has(id) : members.has(id)));
      for (const id of affected) {
        if (action === "add") await cat.addToCollection(collectionId, id);
        else await cat.removeFromCollection(collectionId, id);
      }
    } catch (e) {
      this.set({ error: String(e) });
      return;
    }
    if (affected.length === 0) return; // dropping members back on their collection is a no-op
    const refresh = async () => {
      await this.loadCollections();
      await this.refreshQuickMembers();
      if (this.state.activeCollectionId === collectionId) await this.reload();
    };
    await refresh();
    const name = this.state.collections.find((c) => c.id === collectionId)?.name ?? "collection";
    this.notify(`${action === "add" ? "Added to" : "Removed from"} ${name} (${affected.length})`);
    // Invertible: the same ids with the opposite membership action.
    const apply = async (a: "add" | "remove") => {
      for (const id of affected) {
        if (a === "add") await cat.addToCollection(collectionId, id);
        else await cat.removeFromCollection(collectionId, id);
      }
      await refresh();
    };
    const inverse = action === "add" ? "remove" : "add";
    this.pushUndo({
      label: action === "add" ? `Add to ${name}` : `Remove from ${name}`,
      undo: () => this.runQuick(() => apply(inverse)),
      redo: () => this.runQuick(() => apply(action)),
    });
  }

  // ── Quick Collection / Target Collection (LR Catalog panel, B key) ──────────

  /** The reserved Quick Collection's id, or null if it hasn't been created yet. */
  quickCollectionId(): number | null {
    return findQuickCollection(this.state.collections)?.id ?? null;
  }

  /** Find (or lazily create) the reserved Quick Collection; returns its id.
   *  Concurrent callers share one create so no duplicate reserved rows appear. */
  async ensureQuickCollection(): Promise<number | null> {
    if (!this.state.ready) return null;
    const existing = this.quickCollectionId();
    if (existing != null) return existing;
    if (this.quickEnsuring) return this.quickEnsuring;
    this.quickEnsuring = this.createCollection(QUICK_COLLECTION_NAME, "collection").finally(() => {
      this.quickEnsuring = null;
    });
    return this.quickEnsuring;
  }

  // ── Library undo/redo (LR's Edit ▸ Undo for catalog edits). Develop has its
  // own per-photo history; these stacks cover invertible library operations
  // (culls — incl. Painter sprays — and Quick Collection toggles). ──
  private undoStack: { label: string; undo: () => Promise<void>; redo: () => Promise<void> }[] = [];
  private redoStack: { label: string; undo: () => Promise<void>; redo: () => Promise<void> }[] = [];

  private pushUndo(entry: { label: string; undo: () => Promise<void>; redo: () => Promise<void> }): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > 50) this.undoStack.shift(); // ponytail: fixed cap
    this.redoStack = []; // a new edit invalidates the redo branch
    this.syncUndoLabels();
  }

  private syncUndoLabels(): void {
    this.set({
      undoLabel: this.undoStack[this.undoStack.length - 1]?.label ?? null,
      redoLabel: this.redoStack[this.redoStack.length - 1]?.label ?? null,
    });
  }

  async undo(): Promise<void> {
    const e = this.undoStack.pop();
    if (!e) return;
    try {
      await e.undo();
    } catch {
      this.undoStack.push(e); // the op did not apply — keep history truthful
      this.syncUndoLabels();
      return;
    }
    this.redoStack.push(e);
    this.syncUndoLabels();
    this.notify(`Undid ${e.label}`);
  }

  async redo(): Promise<void> {
    const e = this.redoStack.pop();
    if (!e) return;
    try {
      await e.redo();
    } catch {
      this.redoStack.push(e); // the op did not apply — keep history truthful
      this.syncUndoLabels();
      return;
    }
    this.undoStack.push(e);
    this.syncUndoLabels();
    this.notify(`Redid ${e.label}`);
  }

  // ── Background jobs (LR stacks every long task — import, preview build,
  // export — in the identity plate with its own Cancel). A loop begins a job,
  // ticks per item and polls jobCancelled() between items. ──
  private jobSeq = 0;
  private cancelledJobs = new Set<number>();

  beginJob(label: string, total: number): number {
    const id = ++this.jobSeq;
    this.set({ jobs: [...this.state.jobs, { id, label, done: 0, total }] });
    return id;
  }

  tickJob(id: number): void {
    this.patchJob(id, (j) => ({ ...j, done: j.done + 1 }));
  }

  /** Correct the denominator once a loop knows its real size (a dropped folder
   *  is one path but N files). */
  setJobTotal(id: number, total: number): void {
    this.patchJob(id, (j) => ({ ...j, total }));
  }

  endJob(id: number): void {
    this.cancelledJobs.delete(id);
    if (this.state.jobs.some((j) => j.id === id)) {
      this.set({ jobs: this.state.jobs.filter((j) => j.id !== id) });
    }
  }

  /** StatusBar Cancel: the owning loop stops before its next item. */
  cancelJob(id: number): void {
    this.cancelledJobs.add(id);
  }

  jobCancelled(id: number): boolean {
    return this.cancelledJobs.has(id);
  }

  private patchJob(id: number, fn: (j: BackgroundJob) => BackgroundJob): void {
    const jobs = this.state.jobs;
    if (!jobs.some((j) => j.id === id)) return; // ended/never began — no churn
    this.set({ jobs: jobs.map((j) => (j.id === id ? fn(j) : j)) });
  }

  /** Run `fn` as a StatusBar job: begins it, hands it the tick/total/cancel
   *  handle, and always ends it — a throwing loop must not leak a progress row. */
  async runJob<T>(label: string, total: number, fn: (job: JobHandle) => Promise<T>): Promise<T> {
    const id = this.beginJob(label, total);
    try {
      return await fn({
        tick: () => this.tickJob(id),
        setTotal: (n) => this.setJobTotal(id, n),
        cancelled: () => this.jobCancelled(id),
      });
    } finally {
      this.endJob(id);
    }
  }

  // ── Export job: the generic registry above, plus an `exportJob` mirror.
  // ponytail: the mirror exists only for ExportDialog's "already exporting"
  // guard — drop it once that dialog reads `jobs` instead. ──
  private exportJobId: number | null = null;

  beginExportJob(total: number): void {
    this.exportJobId = this.beginJob("Exporting", total);
    this.set({ exportJob: { done: 0, total } });
  }

  tickExportJob(): void {
    const j = this.state.exportJob;
    if (!j) return;
    if (this.exportJobId != null) this.tickJob(this.exportJobId);
    this.set({ exportJob: { ...j, done: j.done + 1 } });
  }

  endExportJob(): void {
    if (this.exportJobId != null) this.endJob(this.exportJobId);
    this.exportJobId = null;
    this.set({ exportJob: null });
  }

  /** StatusBar Cancel: the export loop stops before its next photo. */
  cancelExportJob(): void {
    if (this.exportJobId != null) this.cancelJob(this.exportJobId);
  }

  exportCancelled(): boolean {
    return this.exportJobId != null && this.jobCancelled(this.exportJobId);
  }

  /** Run a Quick Collection mutation on the serialized chain (see quickChain). */
  private runQuick(fn: () => Promise<void>): Promise<void> {
    const next = this.quickChain.then(fn, fn);
    this.quickChain = next.catch(() => {});
    return next;
  }

  /** Refresh the cached Quick Collection membership (count + toggle state). */
  async refreshQuickMembers(): Promise<void> {
    const quickId = this.quickCollectionId();
    if (quickId == null) {
      this.set({ quickMemberIds: [] });
      return;
    }
    try {
      const photos = await cat.listCollectionPhotos(quickId, 1_000_000);
      this.set({ quickMemberIds: photos.map((p) => p.id) });
    } catch (e) {
      this.set({ error: String(e) });
    }
  }

  /** Open the Quick Collection as the grid source (creating it if needed). */
  async openQuickCollection(): Promise<void> {
    const id = await this.ensureQuickCollection();
    if (id != null) await this.setActiveCollection(id);
  }

  /** Designate (or clear, with null) the Target Collection for the B key. */
  setTargetCollection(id: number | null): void {
    this.set({ targetCollectionId: id === this.state.targetCollectionId ? null : id });
  }

  /** B key / cell marker: toggle photos in the Target/Quick Collection — the
   *  given ids, else the selection (or active photo). Adds the missing ones, or
   *  removes them all if every one is already a member. Serialized so
   *  overlapping presses can't drop or reverse a toggle. */
  toggleQuickMembership(ids?: number[]): Promise<void> {
    return this.runQuick(() => this._toggleQuickMembership(ids));
  }

  private async _toggleQuickMembership(ids?: number[]): Promise<void> {
    if (!this.state.ready) return;
    const s = this.state;
    const selection = ids?.length
      ? ids
      : s.selection.length
        ? s.selection
        : s.activeId != null
          ? [s.activeId]
          : [];
    if (selection.length === 0) return;

    const quickId = await this.ensureQuickCollection();
    const targetId = resolveTargetId(this.state.collections, this.state.targetCollectionId, quickId);
    if (targetId == null) return;

    const members =
      targetId === quickId
        ? this.state.quickMemberIds
        : (await cat.listCollectionPhotos(targetId, 1_000_000)).map((p) => p.id);
    const plan = membershipToggle(members, selection);
    if (plan.ids.length === 0) return;

    try {
      for (const id of plan.ids) {
        if (plan.action === "add") await cat.addToCollection(targetId, id);
        else await cat.removeFromCollection(targetId, id);
      }
    } catch (e) {
      this.set({ error: String(e) });
      return;
    }
    await this.loadCollections();
    await this.refreshQuickMembers();
    if (this.state.activeCollectionId === targetId) await this.reload();
    const name = this.state.collections.find((c) => c.id === targetId)?.name ?? "collection";
    this.notify(`${plan.action === "add" ? "Added to" : "Removed from"} ${name} (${plan.ids.length})`);
    // Invertible: the same ids with the opposite membership action.
    const apply = async (action: "add" | "remove") => {
      for (const id of plan.ids) {
        if (action === "add") await cat.addToCollection(targetId, id);
        else await cat.removeFromCollection(targetId, id);
      }
      await this.refreshQuickMembers();
      if (this.state.activeCollectionId === targetId) await this.reload();
    };
    const inverse = plan.action === "add" ? "remove" : "add";
    this.pushUndo({
      label: plan.action === "add" ? `Add to ${name}` : `Remove from ${name}`,
      undo: () => this.runQuick(() => apply(inverse)),
      redo: () => this.runQuick(() => apply(plan.action)),
    });
  }

  /** Empty the Quick Collection (removes every member). */
  clearQuickCollection(): Promise<void> {
    return this.runQuick(() => this._clearQuickCollection());
  }

  private async _clearQuickCollection(): Promise<void> {
    const quickId = this.quickCollectionId();
    if (quickId == null) return;
    try {
      for (const id of [...this.state.quickMemberIds]) await cat.removeFromCollection(quickId, id);
    } catch (e) {
      this.set({ error: String(e) });
      return;
    }
    await this.refreshQuickMembers();
    if (this.state.activeCollectionId === quickId) await this.reload();
    this.notify("Quick Collection cleared");
  }

  /** Save the Quick Collection under a new name (it becomes a normal collection);
   *  a fresh, empty Quick Collection is created on the next B press. */
  saveQuickCollection(name: string): Promise<void> {
    return this.runQuick(() => this._saveQuickCollection(name));
  }

  private async _saveQuickCollection(name: string): Promise<void> {
    const n = name.trim();
    const quickId = this.quickCollectionId();
    if (quickId == null || !n || n === QUICK_COLLECTION_NAME) return;
    try {
      await cat.renameCollection(quickId, n);
    } catch (e) {
      this.set({ error: String(e) });
      return;
    }
    if (this.state.targetCollectionId === quickId) this.set({ targetCollectionId: null });
    await this.loadCollections();
    await this.refreshQuickMembers();
    this.notify(`Saved Quick Collection as "${n}"`);
  }

  /** Append the next page (no-op if none remain or a fetch is in flight). */
  async loadMore(): Promise<void> {
    await this.loadUntil(this.state.photosStart + this.state.photos.length);
  }

  /** Keyset cursors recorded at every fetch boundary: absolute index → the
   *  cursor a fetch starting at that index resumes from (0 → null = the very
   *  start). Lets the bounded buffer refill BACKWARD after a front trim without
   *  re-walking the whole prefix. Reset per generation; one tiny entry per
   *  fetched chunk, so a 100k walk holds a few hundred entries. */
  private cursorLadder = new Map<number, Cursor | null>();

  /** Extend the buffer through absolute photo `index` — the grid's scroll area
   *  is sized by the catalog total, so a scrollbar jump can land far outside the
   *  loaded window. Forward gaps fetch in BUFFER_CAP-sized keyset chunks (few
   *  large calls, painting progressively, recording the cursor ladder); an index
   *  behind the window refills via `loadBefore`. Past BUFFER_CAP the buffer is
   *  trimmed from the front so a deep scroll cannot grow memory without bound. */
  async loadUntil(index: number): Promise<void> {
    const s = this.state;
    if (!s.ready || s.loading) return;
    if (index < s.photosStart) return this.loadBefore(index);
    if (!s.hasMore || s.next == null) return;
    const need = index + 1 - (s.photosStart + s.photos.length);
    if (need <= 0) return; // already loaded
    const gen = this.epoch; // belongs to the current generation
    const filter = this.filter();
    this.set({ loading: true });
    try {
      let remaining = Math.ceil(need / PAGE_SIZE) * PAGE_SIZE;
      let cursor: Cursor | null = s.next;
      for (;;) {
        const limit = Math.min(remaining, BUFFER_CAP);
        const page = await cat.listPhotos(limit, cursor, filter, this.state.sort);
        if (gen !== this.epoch) return; // a reload/filter change superseded this page
        this.cursorLadder.set(
          this.state.photosStart + this.state.photos.length + page.photos.length,
          page.next,
        );
        let photos = [...this.state.photos, ...page.photos];
        let photosStart = this.state.photosStart;
        if (photos.length > BUFFER_CAP) {
          // Trim from the front — on a forward scroll the window lives near the
          // tail, and BUFFER_CAP dwarfs any physical viewport window.
          const drop = photos.length - BUFFER_CAP;
          photos = photos.slice(drop);
          photosStart += drop;
        }
        cursor = page.next;
        remaining -= page.photos.length;
        // A short page means the keyset is exhausted even if a cursor came back.
        const done = remaining <= 0 || cursor == null || page.photos.length < limit;
        this.set({ photos, photosStart, next: cursor, hasMore: cursor != null, loading: !done });
        if (done) return;
      }
    } catch (e) {
      if (gen === this.epoch) this.set({ loading: false, error: String(e) });
    }
  }

  /** Refill the buffer backward so absolute `index` is loaded again after a
   *  front trim. The keyset cursor only walks forward, so this restarts from the
   *  nearest recorded ladder boundary at or before `index` and walks up in
   *  chunks: rejoining the buffer merges (then trims the TAIL back to a ladder
   *  boundary, whose recorded cursor restores `next`); a jump far above the
   *  window instead replaces the buffer with the freshly fetched run — the
   *  dropped tail re-fetches on demand through the ladder.
   *  ponytail: absolute counts drift if rows are removed behind the window
   *  mid-session (cursors stay row-correct); the next reload squares it. */
  private async loadBefore(index: number): Promise<void> {
    let from = 0;
    for (const k of this.cursorLadder.keys()) if (k <= index && k > from) from = k;
    if (this.state.photosStart - from <= 0) return;
    const gen = this.epoch;
    const filter = this.filter();
    this.set({ loading: true });
    try {
      let cursor = this.cursorLadder.get(from) ?? null;
      let fetched: PhotoRow[] = [];
      let at = from; // absolute end of `fetched`
      // Walk forward until we rejoin the buffer, or the target is covered with a
      // page of read-ahead (then replacing beats hauling the whole gap in).
      while (at < this.state.photosStart && at <= index + PAGE_SIZE) {
        // Fetch no further than the gap, a BUFFER_CAP chunk, or the target plus
        // a page of read-ahead — a far jump must not haul the whole gap in.
        const cover = Math.ceil((index + 1 + PAGE_SIZE - at) / PAGE_SIZE) * PAGE_SIZE;
        const limit = Math.min(this.state.photosStart - at, BUFFER_CAP, cover);
        const page = await cat.listPhotos(limit, cursor, filter, this.state.sort);
        if (gen !== this.epoch) return; // superseded by a reload/filter change
        at += page.photos.length;
        this.cursorLadder.set(at, page.next);
        fetched = fetched.concat(page.photos);
        cursor = page.next;
        if (page.photos.length < limit || cursor == null) break;
      }
      if (at >= this.state.photosStart) {
        // Rejoined the buffer: prepend, then bound it again from the tail.
        let photos = [...fetched, ...this.state.photos];
        let next = this.state.next;
        let hasMore = this.state.hasMore;
        if (photos.length > BUFFER_CAP) {
          let cut = -1;
          for (const k of this.cursorLadder.keys()) {
            if (k - from <= BUFFER_CAP && k > index + PAGE_SIZE && k - from < photos.length && k > cut)
              cut = k;
          }
          if (cut > 0) {
            photos = photos.slice(0, cut - from);
            next = this.cursorLadder.get(cut) ?? null;
            hasMore = next != null;
          }
        }
        this.set({ photos, photosStart: from, next, hasMore, loading: false });
      } else {
        this.set({ photos: fetched, photosStart: from, next: cursor, hasMore: cursor != null, loading: false });
      }
    } catch (e) {
      if (gen === this.epoch) this.set({ loading: false, error: String(e) });
    }
  }

  /** Change the rating filter and reload from page 1. */
  async setFilter(minRating: number): Promise<void> {
    if (minRating === this.state.filterMinRating) return;
    this.set({ filterMinRating: minRating });
    await this.reload();
  }

  /** Set the flag filter (null = any; toggling the active one off passes null). */
  async setFlagFilter(flag: number | null): Promise<void> {
    if (flag === this.state.filterFlag) return;
    this.set({ filterFlag: flag });
    await this.reload();
  }

  /** Set the color-label filter (null = any). */
  async setLabelFilter(label: string | null): Promise<void> {
    if (label === this.state.filterLabel) return;
    this.set({ filterLabel: label });
    await this.reload();
  }

  /** Set the filename (text) filter; "" = any. Debounced by the caller. */
  async setTextFilter(text: string): Promise<void> {
    if (text === this.state.filterText) return;
    this.set({ filterText: text });
    await this.reload();
  }

  /** Text-filter target (LR Text mode) — reloads when a text filter is live. */
  async setTextTarget(target: TextTarget): Promise<void> {
    if (target === this.state.filterTextTarget) return;
    this.set({ filterTextTarget: target });
    if (this.state.filterText.trim()) await this.reload();
  }

  /** Rating comparison mode (≥/=/≤); reloads when a rating floor is set. */
  async setRatingOp(op: RatingOp): Promise<void> {
    if (op === this.state.filterRatingOp) return;
    this.set({ filterRatingOp: op });
    if (this.state.filterMinRating > 0 || op !== ">=") await this.reload();
  }

  /** The current filter as a named-preset snapshot (Filter bar presets). */
  captureFilterSnapshot(): FilterSnapshot {
    const s = this.state;
    return {
      minRating: s.filterMinRating,
      ratingOp: s.filterRatingOp,
      flag: s.filterFlag,
      label: s.filterLabel,
      text: s.filterText,
      textTarget: s.filterTextTarget,
      camera: s.filterCamera,
      lens: s.filterLens,
      year: s.filterYear,
    };
  }

  /** Apply a preset snapshot to every filter dimension and reload page 1. */
  async applyFilterSnapshot(snap: FilterSnapshot): Promise<void> {
    this.set({
      filterMinRating: snap.minRating,
      filterRatingOp: snap.ratingOp,
      filterFlag: snap.flag,
      filterLabel: snap.label,
      filterText: snap.text,
      filterTextTarget: snap.textTarget,
      filterCamera: snap.camera,
      filterLens: snap.lens,
      filterYear: snap.year,
    });
    await this.reload();
  }

  /** LR's filter lock toggle (no reload — it only governs future switches). */
  setFilterLocked(locked: boolean): void {
    if (locked !== this.state.filterLocked) this.set({ filterLocked: locked });
  }

  /** Unlocked source switches clear the Library filter (LR's lock semantics). */
  private filterResetPatch(): Partial<ViewState> {
    if (this.state.filterLocked) return {};
    return {
      filterMinRating: 0,
      filterRatingOp: ">=",
      filterFlag: null,
      filterLabel: null,
      filterText: "",
      filterTextTarget: "path",
      filterCamera: null,
      filterLens: null,
      filterYear: null,
    };
  }

  /** Metadata-mode filters (Filter bar): merge a partial and reload page 1. */
  async setMetadataFilter(patch: {
    camera?: string | null;
    lens?: string | null;
    year?: number | null;
  }): Promise<void> {
    const next = {
      filterCamera: patch.camera !== undefined ? patch.camera : this.state.filterCamera,
      filterLens: patch.lens !== undefined ? patch.lens : this.state.filterLens,
      filterYear: patch.year !== undefined ? patch.year : this.state.filterYear,
    };
    if (
      next.filterCamera === this.state.filterCamera &&
      next.filterLens === this.state.filterLens &&
      next.filterYear === this.state.filterYear
    )
      return;
    this.set(next);
    await this.reload();
  }

  /** Refresh the Filter bar's Metadata option lists. */
  async refreshFilterOptions(): Promise<void> {
    if (!this.state.ready) return;
    try {
      this.set({ filterOptions: await cat.listFilterOptions() });
    } catch (e) {
      this.set({ error: String(e) });
    }
  }

  /** Set the Library grid sort (key + direction) and reload from the first page —
   *  a new order invalidates the keyset cursor, so pagination must restart. */
  async setSort(sort: GridSort): Promise<void> {
    if (sort.key === this.state.sort.key && sort.ascending === this.state.sort.ascending) return;
    if (
      sort.key === "user" &&
      !this.state.collections.some(
        (c) => c.id === this.state.activeCollectionId && c.kind === "collection",
      )
    )
      return;
    this.set({ sort });
    await this.reload();
  }

  /** Set the grid thumbnail box width (px), clamped to the supported range. No
   *  reload — it only changes the client-side layout. */
  setGridCellSize(px: number): void {
    const clamped = Math.round(Math.max(GRID_CELL_MIN, Math.min(GRID_CELL_MAX, px)));
    if (clamped === this.state.gridCellSize) return;
    this.set({ gridCellSize: clamped });
  }

  /** Publish the grid's current column count (client layout, no reload). */
  setGridColumns(cols: number): void {
    const n = Math.max(1, Math.round(cols));
    if (n !== this.state.gridColumns) this.set({ gridColumns: n });
  }

  /** J key: cycle the grid cell style (LR's Grid View Style cycle). */
  cycleGridStyle(): void {
    const order: GridStyle[] = ["clean", "compact", "expanded"];
    const i = order.indexOf(this.state.gridStyle);
    this.set({ gridStyle: order[(i + 1) % order.length] });
  }

  /** Remove photos from the catalog ("Remove from Catalog"; the source files are
   *  kept on disk). Reconciles the buffer in place from the deleted ids the
   *  command returns (which include cascade-deleted virtual copies), so the grid
   *  doesn't reload/reset. */
  async removePhotos(ids: number[]): Promise<void> {
    if (!ids.length) return;
    let deleted: number[];
    try {
      deleted = await cat.removePhotos(ids);
    } catch (e) {
      this.set({ error: String(e) });
      return;
    }
    const gone = new Set(deleted);
    await this.reconcileRemoved(gone, `Removed ${gone.size} photo${gone.size === 1 ? "" : "s"} from the catalog`);
  }

  /** Lightroom "Delete from Disk": remove the catalog rows AND move the source
   *  files (original + managed DNG copy) to the OS Trash. Reconciles the buffer
   *  like `removePhotos`; files the OS refused to trash are surfaced as an
   *  error (their catalog rows are still gone, matching Lightroom). */
  async deleteFromDisk(ids: number[]): Promise<void> {
    if (!ids.length) return;
    let r: cat.DeleteFromDiskResult;
    try {
      r = await cat.deletePhotosFromDisk(ids);
    } catch (e) {
      this.set({ error: String(e) });
      return;
    }
    const gone = new Set(r.deleted);
    await this.reconcileRemoved(gone, `Deleted ${gone.size} photo${gone.size === 1 ? "" : "s"} — files moved to Trash`);
    if (r.failed.length) this.set({ error: `Could not move to Trash: ${r.failed.join("; ")}` });
  }

  /** Drop the `gone` ids from the buffer/selection in place (no grid reload) and
   *  refresh the total — shared by Remove-from-Catalog and Delete-from-Disk. */
  private async reconcileRemoved(gone: Set<number>, notice: string): Promise<void> {
    const photos = this.state.photos.filter((p) => !gone.has(p.id));
    const selection = this.state.selection.filter((id) => !gone.has(id));
    const activeId =
      this.state.activeId != null && gone.has(this.state.activeId)
        ? selection.length
          ? selection[selection.length - 1]
          : photos.length
            ? photos[photos.length - 1].id
            : null
        : this.state.activeId;
    this.set({ photos, selection, activeId });
    // Special grid sources count their loaded set directly; the main grid's total
    // needs a fresh count since cascades can delete more than the buffer holds.
    const special =
      this.state.expandedStackId != null || this.state.duplicatesActive || this.state.activeCollectionId != null || this.state.activeKeywordId != null;
    if (special) {
      this.set({ total: photos.length });
    } else {
      try {
        this.set({ total: await cat.countPhotos(this.filter()) });
      } catch {
        // The removal already succeeded; keep the (slightly stale) total.
      }
    }
    this.notify(notice);
  }

  /** Ids of every reject-flagged photo in the current grid source (for "Delete
   *  Rejected"). Special sources (stack/duplicates/collection) hold their whole
   *  set in the buffer, so read rejects from there; the paginated main library
   *  asks the catalog for all rejects. Feed the result to `removePhotos`. */
  async collectRejectedIds(): Promise<number[]> {
    const special =
      this.state.expandedStackId != null || this.state.duplicatesActive || this.state.activeCollectionId != null || this.state.activeKeywordId != null;
    if (special) return this.state.photos.filter((p) => p.flag === -1).map((p) => p.id);
    try {
      return await cat.listRejectedIds();
    } catch (e) {
      this.set({ error: String(e) });
      return [];
    }
  }

  setModule(module: Module): void {
    // Entering Compare: seed the Candidate (the photo after the Select) unless a
    // still-valid one is already pinned, so ←/→ have something to step from.
    if (module === "compare") {
      const s = this.state;
      const selIdx = s.activeId != null ? s.photos.findIndex((p) => p.id === s.activeId) : -1;
      const pinnedValid =
        s.compareCandidateId != null &&
        s.compareCandidateId !== s.activeId &&
        s.photos.some((p) => p.id === s.compareCandidateId);
      if (!pinnedValid) {
        const candIdx = this.neighborIndex(selIdx);
        this.set({ module, compareCandidateId: candIdx >= 0 ? s.photos[candIdx].id : null });
        return;
      }
    }
    this.set({ module });
  }

  /** Index of the photo next to `idx` (prefers the one after, falls back to the
   *  one before at the end of the set); -1 if there's no other photo. */
  private neighborIndex(idx: number): number {
    const n = this.state.photos.length;
    if (idx < 0) return n > 0 ? 0 : -1;
    if (idx + 1 < n) return idx + 1;
    if (idx - 1 >= 0) return idx - 1;
    return -1;
  }

  /** Compare view: move the Candidate `delta` positions through the loaded set,
   *  keeping the Select (`activeId`) pinned and never landing on it. Clamped. */
  moveCompareCandidate(delta: number): void {
    const s = this.state;
    const n = s.photos.length;
    if (n === 0) return;
    const selIdx = s.activeId != null ? s.photos.findIndex((p) => p.id === s.activeId) : -1;
    let cur = s.compareCandidateId != null ? s.photos.findIndex((p) => p.id === s.compareCandidateId) : -1;
    if (cur < 0) cur = selIdx; // no candidate yet → step off the Select's slot
    let next = Math.max(0, Math.min(n - 1, cur + delta));
    if (next === selIdx) {
      // Don't rest on the Select: hop one more in the travel direction if there's
      // room, else stay put (Select sits against the end of the set).
      const past = next + (delta >= 0 ? 1 : -1);
      if (past < 0 || past >= n) return;
      next = past;
    }
    this.set({ compareCandidateId: s.photos[next].id });
  }

  /** Compare view: swap the Select and the Candidate. */
  swapCompare(): void {
    const s = this.state;
    if (s.activeId == null || s.compareCandidateId == null) return;
    this.set({ activeId: s.compareCandidateId, compareCandidateId: s.activeId, selection: [s.compareCandidateId] });
  }

  /** Compare view: promote a photo to Select; the Candidate becomes its neighbor. */
  makeCompareSelect(id: number): void {
    const idx = this.state.photos.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const candIdx = this.neighborIndex(idx);
    this.set({
      activeId: id,
      selection: [id],
      compareCandidateId: candIdx >= 0 ? this.state.photos[candIdx].id : null,
    });
  }

  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  /** Show a transient status message (auto-clears after a few seconds). */
  notify(msg: string): void {
    this.set({ notice: msg });
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => this.set({ notice: null }), 5000);
  }

  /** Select a photo. `additive` toggles it in/out of the current selection. */
  select(id: number, additive = false): void {
    if (additive) {
      const cur = this.state.selection;
      const removing = cur.includes(id);
      const next = removing ? cur.filter((x) => x !== id) : [...cur, id];
      // Toggling OUT must not leave the removed photo active — advance to a
      // remaining member (or clear), never point activeId at a deselected id.
      const activeId = removing ? (next.length ? next[next.length - 1] : null) : id;
      this.set({ selection: next, activeId });
    } else {
      this.set({ selection: [id], activeId: id });
    }
  }

  /** Select the inclusive range from the active anchor to `id`, in loaded-buffer
   *  order (Shift-click). With no anchor (or one no longer loaded), selects just
   *  `id` — the fallback a shift-click gets with nothing anchored. */
  selectRange(id: number): void {
    const ids = this.state.photos.map((p) => p.id);
    const from = this.state.activeId == null ? -1 : ids.indexOf(this.state.activeId);
    const to = ids.indexOf(id);
    if (from < 0 || to < 0) {
      this.set({ selection: [id], activeId: id });
      return;
    }
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    this.set({ selection: ids.slice(lo, hi + 1), activeId: id });
  }

  /** Select every photo in the loaded buffer (⌘A); keep the active photo if
   *  there is one, else anchor on the last.
   *  ponytail: acts on the loaded keyset page, not the whole catalog — same
   *  scope as every other selection op, which all read `photos`. */
  selectAll(): void {
    const ids = this.state.photos.map((p) => p.id);
    this.set({ selection: ids, activeId: this.state.activeId ?? (ids.length ? ids[ids.length - 1] : null) });
  }

  /** Clear the selection and active photo (⌘D). */
  clearSelection(): void {
    this.set({ selection: [], activeId: null });
  }

  setActive(id: number | null): void {
    this.set({ activeId: id, selection: id == null ? [] : [id] });
  }

  /** Move the active photo `delta` positions within the loaded set (culling nav). */
  moveActive(delta: number): void {
    const s = this.state;
    if (s.photos.length === 0) return;
    const cur = s.activeId != null ? s.photos.findIndex((p) => p.id === s.activeId) : -1;
    const next = Math.max(0, Math.min(s.photos.length - 1, cur + delta));
    this.setActive(s.photos[next].id);
  }

  /** Set a photo's flag state, persist it, and reconcile the loaded buffer.
   *  Records a library-undo entry unless it IS an undo/redo replay. */
  async cull(
    id: number,
    rating: number,
    flag: number,
    colorLabel: string | null = null,
    recordUndo = true,
  ): Promise<void> {
    const priorRow = this.state.photos.find((p) => p.id === id);
    const prior = priorRow
      ? { rating: priorRow.rating, flag: priorRow.flag, colorLabel: priorRow.colorLabel }
      : null;
    try {
      await cat.setFlags(id, rating, flag, colorLabel);
    } catch (e) {
      this.set({ error: String(e) });
      return;
    }
    // Update in place; drop from the buffer if it no longer matches the filter.
    const before = this.state.photos;
    const idx = before.findIndex((p) => p.id === id);
    const wasInBuffer = idx >= 0;
    // Path is unchanged by a flag/rating edit; reuse the buffered photo's for the
    // text filter (empty when it isn't buffered — `keep` only gates buffered rows).
    const keep = this.matchesFilter({ ...before[idx], rating, flag, colorLabel, path: before[idx]?.path ?? "" });
    const dropped = wasInBuffer && !keep;
    const photos = before
      .map((p) => (p.id === id ? { ...p, rating, flag, colorLabel } : p))
      .filter((p) => (p.id === id ? keep : true));
    // Only adjust `total` when a buffered, matching row actually left the filter
    // — a no-op/off-buffer cull must not under-count (a repeated cull is a no-op).
    const patch: Partial<ViewState> = {
      photos,
      total: dropped ? Math.max(0, this.state.total - 1) : this.state.total,
    };
    // If the dropped photo was active, advance to its neighbour (culling flow).
    if (dropped && this.state.activeId === id) {
      const nextPhoto = photos[Math.min(idx, photos.length - 1)];
      patch.activeId = nextPhoto ? nextPhoto.id : null;
      patch.selection = nextPhoto ? [nextPhoto.id] : [];
    }
    this.set(patch);
    // LR auto-write: the sidecar reflects the final state of an edit burst.
    const culled = this.state.photos.find((p) => p.id === id);
    if (culled) queueXmpWrite(culled, () => this.state.photos.find((p) => p.id === id));
    // Undoing restores the exact prior flag state; a no-op cull records nothing.
    const changed =
      prior && (prior.rating !== rating || prior.flag !== flag || prior.colorLabel !== colorLabel);
    if (recordUndo && prior && changed) {
      this.pushUndo({
        label: cullUndoLabel(prior, { rating, flag, colorLabel }),
        undo: () => this.cull(id, prior.rating, prior.flag, prior.colorLabel, false),
        redo: () => this.cull(id, rating, flag, colorLabel, false),
      });
    }
  }

  /** Batch cull: apply ONE flag-field edit to every id (LR selection semantics —
   *  P / X / 1-5 / 6-9 hit the whole selection, as do grid-badge clicks). Each
   *  photo keeps its untouched fields; the batch collapses into one undo entry. */
  async cullMany(
    ids: number[],
    part: { rating?: number; flag?: number; colorLabel?: string | null },
  ): Promise<void> {
    const targets = ids
      .map((id) => this.state.photos.find((p) => p.id === id))
      .filter((p): p is PhotoRow => p != null)
      .map((p) => ({
        id: p.id,
        prior: { rating: p.rating, flag: p.flag, colorLabel: p.colorLabel },
        next: {
          rating: part.rating ?? p.rating,
          flag: part.flag ?? p.flag,
          // `??` would eat an explicit null (Clear Label), so test key presence.
          colorLabel: "colorLabel" in part ? (part.colorLabel ?? null) : p.colorLabel,
        },
      }));
    const changed = targets.filter(
      (t) =>
        t.prior.rating !== t.next.rating ||
        t.prior.flag !== t.next.flag ||
        t.prior.colorLabel !== t.next.colorLabel,
    );
    if (changed.length === 0) return;
    // ponytail: sequential awaits — one sqlite UPDATE each, fine to 4-digit
    // selections; add a batched bridge call if huge selections ever drag.
    for (const t of changed) {
      await this.cull(t.id, t.next.rating, t.next.flag, t.next.colorLabel, false);
    }
    this.pushUndo({
      label:
        cullUndoLabel(changed[0].prior, changed[0].next) +
        (changed.length > 1 ? ` (${changed.length} photos)` : ""),
      undo: async () => {
        for (const t of changed)
          await this.cull(t.id, t.prior.rating, t.prior.flag, t.prior.colorLabel, false);
      },
      redo: async () => {
        for (const t of changed)
          await this.cull(t.id, t.next.rating, t.next.flag, t.next.colorLabel, false);
      },
    });
  }

  /** Arm/disarm the Painter tool (null disarms). */
  setPainter(payload: PainterPayload | null): void {
    this.set({ painter: payload });
  }

  /** Pin (or clear) the Develop Reference photo; pinning shows the view. */
  setReference(id: number | null): void {
    this.set({ referencePhotoId: id, referenceActive: id != null });
  }

  /** Toggle the Reference View (no-op until a reference is pinned). */
  toggleReference(): void {
    if (this.state.referencePhotoId == null) return;
    this.set({ referenceActive: !this.state.referenceActive });
  }

  /** Spray the armed Painter payload onto one photo. LR semantics: painting a
   *  photo that already carries the exact payload value removes it (toggle).
   *  Rating/flag/label route through cull() so filters reconcile; keywords
   *  toggle membership in the shared vocabulary. */
  async paint(id: number): Promise<void> {
    const payload = this.state.painter;
    if (!payload) return;
    const photo = this.state.photos.find((p) => p.id === id);
    if (!photo) return;
    try {
      switch (payload.kind) {
        case "rating": {
          const rating = photo.rating === payload.value ? 0 : payload.value;
          await this.cull(id, rating, photo.flag, photo.colorLabel);
          break;
        }
        case "flag": {
          const flag = photo.flag === payload.value ? 0 : payload.value;
          await this.cull(id, photo.rating, flag, photo.colorLabel);
          break;
        }
        case "label": {
          const label = photo.colorLabel === payload.value ? null : payload.value;
          await this.cull(id, photo.rating, photo.flag, label);
          break;
        }
        case "keyword": {
          const existing = (await cat.listPhotoKeywords(id)).find(
            (k) => k.name === payload.value,
          );
          if (existing) await cat.removeKeyword(id, existing.id);
          else await cat.addKeyword(id, payload.value);
          void this.refreshKeywordList(); // keep the Keyword List counts live
          queueXmpWrite(photo, () => this.state.photos.find((p) => p.id === id));
          break;
        }
        case "quick": {
          // LR's Target Collection spray: membership toggles per clicked photo.
          await this.toggleQuickMembership([id]);
          break;
        }
        case "metadataPreset": {
          await this.applyMetadataPreset(payload.value, [id]);
          break;
        }
        case "preset": {
          // Develop-preset spray: the preset's full canonical recipe replaces
          // the photo's (persist + history via the quick-develop path).
          const recipe = normalizeRecipe(JSON.parse(payload.value.recipeJson));
          await this.applyQuickDevelop([id], () => recipe);
          break;
        }
      }
    } catch (e) {
      this.set({ error: String(e) });
    }
  }

  /** Persist a photo's editable IPTC metadata and reconcile the loaded buffer
   *  (blanks normalize to null, matching what the catalog stores). */
  async setPhotoMetadata(id: number, meta: PhotoMetadata): Promise<void> {
    try {
      await cat.setMetadata(id, meta);
    } catch (e) {
      this.set({ error: String(e) });
      return;
    }
    const norm = (s: string | null) => {
      const t = s?.trim();
      return t ? t : null;
    };
    const patched = {
      title: norm(meta.title),
      caption: norm(meta.caption),
      creator: norm(meta.creator),
      city: norm(meta.city),
      stateProvince: norm(meta.stateProvince),
      country: norm(meta.country),
      jobTitle: norm(meta.jobTitle),
      credit: norm(meta.credit),
      source: norm(meta.source),
      copyright: norm(meta.copyright),
    };
    this.set({ photos: this.state.photos.map((p) => (p.id === id ? { ...p, ...patched } : p)) });
    const metaRow = this.state.photos.find((p) => p.id === id);
    if (metaRow) queueXmpWrite(metaRow, () => this.state.photos.find((p) => p.id === id));
  }

  /** Apply a metadata preset's creator/copyright to each id, preserving each
   *  photo's own title/caption. Only buffered (loaded) photos are affected. */
  async applyMetadataPreset(preset: MetadataPresetRow, ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    const byId = new Map(this.state.photos.map((p) => [p.id, p]));
    let n = 0;
    for (const id of ids) {
      const cur = byId.get(id);
      if (!cur) continue;
      try {
        await cat.setMetadata(id, {
          title: cur.title,
          caption: cur.caption,
          creator: preset.creator,
          copyright: preset.copyright,
          // Preserve the photo's own location/attribution — the preset only
          // owns the creator/copyright pair.
          city: cur.city,
          stateProvince: cur.stateProvince,
          country: cur.country,
          jobTitle: cur.jobTitle,
          credit: cur.credit,
          source: cur.source,
        });
        n++;
        queueXmpWrite(cur, () => this.state.photos.find((p) => p.id === id));
      } catch (e) {
        this.set({ error: String(e) });
      }
    }
    const idset = new Set(ids);
    this.set({
      photos: this.state.photos.map((p) =>
        idset.has(p.id) ? { ...p, creator: preset.creator, copyright: preset.copyright } : p,
      ),
    });
    if (n) this.notify(`Metadata preset applied to ${n} photo${n === 1 ? "" : "s"}.`);
    return n;
  }

  /** The processVersion embedded in a recipe JSON, or null if absent/malformed. */
  private recipeProcessVersion(json: string): number | null {
    try {
      const pv = (JSON.parse(json) as { processVersion?: number }).processVersion;
      return typeof pv === "number" ? pv : null;
    } catch {
      return null; // malformed recipe JSON — treat as unknown process version
    }
  }

  /** Persist one recipe JSON onto every id (Paste/Sync), reflecting the develop
   *  badge in the loaded buffer. Returns how many were written (0 on empty/error). */
  private async writeRecipeToIds(
    json: string,
    processVersion: number | null,
    ids: number[],
  ): Promise<number> {
    if (ids.length === 0) return 0;
    try {
      for (const id of ids) await cat.setRecipe(id, json, processVersion);
    } catch (e) {
      this.set({ error: String(e) });
      return 0;
    }
    const idset = new Set(ids);
    this.set({
      photos: this.state.photos.map((p) =>
        idset.has(p.id) ? { ...p, hasRecipe: true, processVersion } : p,
      ),
    });
    return ids.length;
  }

  /** Copy a photo's develop recipe onto the clipboard (Copy Settings). No-op if
   *  the photo has never been developed (no recipe to copy). */
  async copyDevelop(id: number, scope: string[] | null = null): Promise<void> {
    try {
      const json = await cat.getRecipe(id);
      if (!json) return; // nothing developed yet — leave any prior clip intact
      // scope === null copies the whole recipe; a panel-key list copies only those
      // panels (merged over each target on paste — Copy Settings partial scope).
      this.developClip = { json, processVersion: this.recipeProcessVersion(json), scope };
      this.set({ hasDevelopClip: true });
    } catch (e) {
      this.set({ error: String(e) });
    }
  }

  /** Paste the clipboard recipe onto every id (Paste Settings), persisting each
   *  and reflecting the develop badge in the loaded buffer. */
  async pasteDevelop(ids: number[]): Promise<void> {
    const clip = this.developClip;
    if (!clip) return;
    if (!clip.scope) {
      await this.writeRecipeToIds(clip.json, clip.processVersion, ids);
      return;
    }
    // Scoped paste: overlay only the chosen panels onto each target's own recipe,
    // so its crop/masks/unscoped panels + process version survive.
    const patch = scopedRecipePatch(clip.json, clip.scope);
    if (patch) await this.applyDevelopPatchToIds(patch, ids);
  }

  /** Merge a develop patch onto each target's baseline recipe (scoped paste),
   *  persisting each. Matches pasteDevelop's no-History semantics (cat.setRecipe). */
  private async applyDevelopPatchToIds(patch: DeepPartial<DevelopRecipeV2>, ids: number[]): Promise<number> {
    let n = 0;
    for (const id of ids) {
      try {
        const json = await cat.getRecipe(id);
        const base = normalizeRecipe((json ? JSON.parse(json) : createDefaultRecipe()) as unknown);
        const merged = mergeRecipePatch(base, patch);
        await cat.setRecipe(id, JSON.stringify(merged), merged.processVersion);
        n++;
      } catch (e) {
        this.set({ error: String(e) });
      }
    }
    if (n) {
      const idset = new Set(ids);
      this.set({ photos: this.state.photos.map((p) => (idset.has(p.id) ? { ...p, hasRecipe: true } : p)) });
    }
    return n;
  }

  /** Sync Settings: apply sourceId's develop recipe to the rest of `ids` (the
   *  selection), persisting each — like Paste but sourced from a photo, and
   *  WITHOUT touching the Copy/Paste clipboard. No-op if the source has no recipe
   *  or has no peers to sync to.
   *
   *  `scope` names the panels to push (undefined = reuse the last dialog pick,
   *  null = the whole recipe); `quiet` suppresses the toast, for Auto Sync's
   *  once-per-edit firing. */
  async syncDevelop(
    sourceId: number,
    ids: number[],
    opts: { scope?: string[] | null; quiet?: boolean } = {},
  ): Promise<void> {
    const targets = ids.filter((id) => id !== sourceId);
    if (!targets.length) return; // nothing but the source selected
    let json: string | null;
    try {
      json = await cat.getRecipe(sourceId);
    } catch (e) {
      this.set({ error: String(e) });
      return;
    }
    if (!json) return; // source never developed — nothing to sync
    // An explicit scope both applies now and becomes what Auto Sync mirrors.
    if (opts.scope !== undefined) this.syncScope = opts.scope;
    const scope = opts.scope !== undefined ? opts.scope : this.syncScope;
    let n: number;
    if (scope) {
      const patch = scopedRecipePatch(json, scope);
      if (!patch) return; // malformed source recipe — leave the targets alone
      n = await this.applyDevelopPatchToIds(patch, targets);
    } else {
      n = await this.writeRecipeToIds(json, this.recipeProcessVersion(json), targets);
    }
    if (n && !opts.quiet) this.notify(`Synced settings to ${n} photo${n === 1 ? "" : "s"}.`);
  }

  /** Auto Sync (LR's Develop toggle beside Sync…): while on, every develop edit
   *  the active photo commits is mirrored onto the rest of the selection. */
  setAutoSync(on: boolean): void {
    this.set({ autoSync: on });
  }

  /** Settings ▸ Match Total Exposures: set each target's Exposure so its rendered
   *  brightness matches the source, carrying the capture-EV difference. Rendered
   *  stops ≈ exposure − EV, so matching means exposure = srcExposure + (EV − srcEV).
   *  Photos missing part of the exposure triad are skipped — there is nothing to
   *  match them against. */
  async matchTotalExposures(sourceId: number, ids: number[]): Promise<void> {
    const srcEv = captureEv(this.state.photos.find((p) => p.id === sourceId));
    if (srcEv == null) {
      this.notify("Match Total Exposures needs ISO, aperture and shutter speed on the active photo.");
      return;
    }
    let srcExposure = 0;
    try {
      const json = await cat.getRecipe(sourceId);
      if (json) srcExposure = normalizeRecipe(JSON.parse(json) as unknown).basic.exposure;
    } catch (e) {
      this.set({ error: String(e) });
      return;
    }
    // ponytail: one patch write per photo because each gets its own exposure —
    // batch it in applyDevelopPatchToIds only if huge selections ever drag.
    let n = 0;
    for (const id of ids) {
      if (id === sourceId) continue;
      const ev = captureEv(this.state.photos.find((p) => p.id === id));
      if (ev == null) continue;
      n += await this.applyDevelopPatchToIds({ basic: { exposure: srcExposure + (ev - srcEv) } }, [id]);
    }
    this.notify(
      n
        ? `Matched exposures on ${n} photo${n === 1 ? "" : "s"}.`
        : "No selected photo had the ISO/aperture/shutter needed to match exposures.",
    );
  }

  /** Quick Develop: apply a recipe transform (a relative step or reset) to
   *  every target photo, persisting each through the normal develop path so
   *  the edit lands in History; reflects the develop badge in the buffer. */
  async applyQuickDevelop(
    ids: number[],
    apply: (recipe: DevelopRecipeV2) => DevelopRecipeV2,
  ): Promise<void> {
    if (ids.length === 0) return;
    for (const id of ids) {
      try {
        const baseline = await cat.getRecipe(id);
        const recipe = normalizeRecipe(
          baseline ? (JSON.parse(baseline) as unknown) : createDefaultRecipe(),
        );
        const next = apply(recipe);
        // A normalized-space no-op records no history: for photos persisted
        // before a recipe field existed (e.g. heal) the canonical bytes still
        // differ from the raw baseline — the write migrates the key in — and a
        // spurious step would otherwise be recorded.
        const noop = JSON.stringify(next) === JSON.stringify(recipe);
        await persistDevelopRecipe(id, next, noop ? null : baseline);
        const quickRow = this.state.photos.find((p) => p.id === id);
        if (quickRow) queueXmpWrite(quickRow);
      } catch (e) {
        this.set({ error: String(e) });
        return;
      }
    }
    const idset = new Set(ids);
    this.set({
      photos: this.state.photos.map((p) => (idset.has(p.id) ? { ...p, hasRecipe: true } : p)),
    });
  }

  /** Create a virtual copy of each photo — LR's ⌘' acts on the whole selection,
   *  one copy per photo — then reload and make the last new copy active.
   *  Returns the last new copy id. */
  async createVirtualCopy(ids: number | readonly number[]): Promise<number | null> {
    if (!this.state.ready) return null;
    const targets = typeof ids === "number" ? [ids] : ids;
    if (!targets.length) return null;
    const copies: number[] = [];
    let failure: string | null = null;
    try {
      for (const id of targets) copies.push(await cat.createVirtualCopy(id));
    } catch (e) {
      // Copies made before the failure are real; the reload below surfaces them
      // instead of pretending the whole batch was lost. The error is reported
      // after the reload, which starts a fresh generation and clears it.
      failure = String(e);
    }
    if (!copies.length) {
      if (failure) this.set({ error: failure });
      return null;
    }
    await this.reload();
    if (failure) this.set({ error: failure });
    // Focus the new copy when it's actually in the grid (whole-catalog view); in
    // a collection it isn't a member, so leave the selection where it was.
    const last = copies[copies.length - 1];
    if (this.state.activeCollectionId == null) this.setActive(last);
    if (copies.length > 1) this.notify(`Created ${copies.length} virtual copies.`);
    return last;
  }

  /** Rename a virtual copy (LR's Photo ▸ Set Copy Name…); blank clears the name.
   *  Masters have no copy name, so they are left alone here as in the catalog. */
  async setCopyName(id: number, name: string | null): Promise<void> {
    const next = name?.trim() ? name.trim() : null;
    try {
      await cat.setCopyName(id, next);
    } catch (e) {
      this.set({ error: String(e) });
      return;
    }
    this.set({
      photos: this.state.photos.map((p) => (p.id === id && p.isVirtualCopy ? { ...p, copyName: next } : p)),
    });
  }

  /** Photo ▸ Make Master Photo: promote a virtual copy, demoting its master to a
   *  copy. Every row in the family changes identity, so reload rather than patch. */
  async makeMasterPhoto(photoId: number): Promise<void> {
    try {
      await cat.makeMasterPhoto(photoId);
    } catch (e) {
      this.notify(`Make Master Photo failed: ${String(e)}`);
      return;
    }
    await this.reload();
    this.notify("Made master photo.");
  }

  /** Expand a stack into a focused grid source (null returns to the library). */
  async expandStack(stackId: number | null): Promise<void> {
    if (stackId === this.state.expandedStackId) return;
    this.set({ ...this.filterResetPatch(), expandedStackId: stackId, activeKeywordId: null, selection: [], activeId: null });
    await this.reload();
  }

  /** Stack the current selection (≥2 photos; selection[0] becomes the cover). */
  async stackSelection(): Promise<number | null> {
    const ids = this.state.selection;
    if (ids.length < 2) {
      this.notify("Select two or more photos to stack.");
      return null;
    }
    let stackId: number;
    try {
      stackId = await cat.stackPhotos(ids);
    } catch (e) {
      this.set({ error: String(e) });
      return null;
    }
    await this.reload();
    this.notify(`Stacked ${ids.length} photos.`);
    return stackId;
  }

  /** Unstack the stack the active (or first selected) photo belongs to. */
  async unstackActive(): Promise<void> {
    const id = this.state.activeId ?? this.state.selection[0];
    const photo = id != null ? this.state.photos.find((p) => p.id === id) : undefined;
    if (!photo?.stackId) {
      this.notify("No stack selected.");
      return;
    }
    try {
      await cat.unstack(photo.stackId);
    } catch (e) {
      this.set({ error: String(e) });
      return;
    }
    // Leaving the expanded view (its stack no longer exists) or reload in place.
    if (this.state.expandedStackId === photo.stackId) {
      this.set({ expandedStackId: null });
    }
    await this.reload();
  }

  /** Auto-stack unstacked photos by capture-time proximity; returns stacks made. */
  async autoStackAll(gapSeconds: number): Promise<number> {
    let made: number;
    try {
      made = await cat.autoStack(gapSeconds);
    } catch (e) {
      this.set({ error: String(e) });
      return 0;
    }
    await this.reload();
    this.notify(made > 0 ? `Auto-stacked into ${made} stack${made === 1 ? "" : "s"}.` : "No stacks found.");
    return made;
  }

  /** Expand or collapse every stack in place (LR Expand/Collapse All Stacks). */
  async setStacksExpanded(expanded: boolean): Promise<void> {
    if (expanded === this.state.stacksExpanded) return;
    // Collapsing can hide selected non-cover members — drop the selection.
    this.set({ stacksExpanded: expanded, selection: [], activeId: null });
    await this.reload();
  }

  /** The stack operations' target: the active (or first selected) photo's row. */
  private stackTarget(): PhotoRow | undefined {
    const id = this.state.activeId ?? this.state.selection[0];
    return id != null ? this.state.photos.find((p) => p.id === id) : undefined;
  }

  /** Make the target photo its stack's cover (LR Move to Top of Stack, ⇧S). */
  async setStackCoverActive(): Promise<void> {
    const photo = this.stackTarget();
    if (!photo?.stackId) {
      this.notify("No stack selected.");
      return;
    }
    try {
      await cat.setStackCover(photo.id);
    } catch (e) {
      this.set({ error: String(e) });
      return;
    }
    await this.reload();
    this.notify("Moved to top of stack.");
  }

  /** Move the target photo one slot up (-1) or down (+1) within its stack. */
  async moveInStackActive(delta: number): Promise<void> {
    const photo = this.stackTarget();
    if (!photo?.stackId) {
      this.notify("No stack selected.");
      return;
    }
    try {
      await cat.moveInStack(photo.id, delta);
    } catch (e) {
      this.set({ error: String(e) });
      return;
    }
    await this.reload();
  }

  /** LR Split Stack: the target photo and everything after it form a new stack. */
  async splitStackActive(): Promise<void> {
    const photo = this.stackTarget();
    if (!photo?.stackId) {
      this.notify("No stack selected.");
      return;
    }
    if (photo.stackOrder === 0) {
      this.notify("Select a photo below the stack cover to split.");
      return;
    }
    try {
      await cat.splitStack(photo.id);
    } catch (e) {
      this.set({ error: String(e) });
      return;
    }
    await this.reload();
    // A 2-stack split dissolves both halves; leave a now-empty expanded view.
    if (this.state.expandedStackId != null && this.state.photos.length === 0) {
      await this.expandStack(null);
    }
    this.notify("Split stack.");
  }

  /** Folder sync: stat every catalog source path, flagging gone files missing
   *  and clearing the flag on ones that reappeared; returns the missing count. */
  async syncMissing(): Promise<number> {
    if (!this.state.ready) return 0;
    try {
      const sources = await cat.listSourcePaths();
      for (const s of sources) {
        const present = await exists(s.path);
        // Only write when the on-disk state disagrees with the stored flag.
        if (present === s.missing) await cat.markMissing(s.sourceAssetId, !present);
      }
    } catch (e) {
      this.set({ error: String(e) });
      return 0;
    }
    const missing = await cat.countMissing();
    await this.reload();
    this.notify(
      missing > 0 ? `${missing} photo${missing === 1 ? "" : "s"} missing on disk.` : "All photos found.",
    );
    return missing;
  }

  /** Relink a missing source to a new path; the file's content must still match
   *  (fingerprint verified natively), else the relink is refused. */
  async relinkPhoto(sourceAssetId: number, newPath: string): Promise<boolean> {
    try {
      const bytes = await readFile(newPath);
      const fp = await fingerprint(bytes, bytes.byteLength);
      await cat.relink(sourceAssetId, newPath, fp);
    } catch (e) {
      this.set({ error: String(e) });
      this.notify("Relink failed — the file must be the same photo.");
      return false;
    }
    await this.reload();
    this.notify("Photo relinked.");
    return true;
  }

  /** Import photos (dup-safe) and reload the grid. */
  async importPhotos(records: ImportPhoto[]): Promise<number[]> {
    if (!this.state.ready) return [];
    const ids: number[] = [];
    try {
      for (const r of records) {
        ids.push(r.format === "raw:DNG" ? await cat.importManagedDng(r) : await cat.importPhoto(r));
      }
    } catch (e) {
      this.set({ error: String(e) });
    }
    if (ids.length === 0) {
      await this.reload();
      return ids;
    }
    try {
      let previousId = findPreviousImport(this.state.collections)?.id;
      if (previousId == null) {
        previousId = await cat.createCollection(
          PREVIOUS_IMPORT_NAME,
          "collection",
          null,
          PREVIOUS_IMPORT_MARKER,
        );
      }
      await cat.replaceCollectionMembers(previousId, ids);
      await this.loadCollections();
      this.set({ module: "grid" });
      if (this.state.activeCollectionId === previousId && !this.state.duplicatesActive) {
        await this.reload();
      } else {
        await this.setActiveCollection(previousId);
      }
    } catch (e) {
      this.set({ error: String(e) });
      await this.reload();
    }
    return ids;
  }
}

export const store = new CatalogStore();

export function useCatalog(): ViewState {
  // The third argument serves server/renderToString consumers (render tests).
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

export function useCatalogSelector<T>(selector: (s: ViewState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
