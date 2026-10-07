// catalog — the typed bridge to the native SQLite catalog plugin
// (src-tauri/src/catalog.rs, `plugin:catalog|*`). Every function is a thin,
// typed wrapper over `invoke`; Tauri maps snake_case Rust params to the
// camelCase keys below. The catalog itself is the source of truth — the store
// (state/store.ts) sits on top of these calls, never duplicating the DB.
//
// Outside a Tauri window (browser dev / e2e), `invoke` is unavailable; callers
// guard with `catalogAvailable()` and degrade gracefully.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { recordKeywordUse } from "../lib/keywordSets";
import { DEFAULT_FILTER, DEFAULT_SORT } from "./types";
import type {
  CollectionRow,
  Cursor,
  DevelopExportIdentity,
  FilterOptions,
  FolderRow,
  GridSort,
  HistoryRow,
  ImportPhoto,
  KeywordCountRow,
  KeywordRow,
  MetadataPresetRow,
  PhotoFilter,
  PhotoMetadata,
  PhotoPage,
  PhotoRow,
  PresetRow,
  PreviewRecord,
  PreviewIdentityV2,
  PreviewRequestV2,
  PreviewRow,
  SnapshotRow,
  SourcePathRow,
} from "./types";
import type { RawFrameMetadata } from "../rawDecode";

const recipeChangedListeners = new Set<(photoId: number) => void>();

function dispatchRecipeChanged(photoId: number): void {
  for (const listener of [...recipeChangedListeners]) {
    try {
      listener(photoId);
    } catch (error) {
      console.error("galerie recipe-change listener failed", error);
    }
  }
}

if (isTauri()) {
  void listen<number>("galerie://recipe-changed", (event) => dispatchRecipeChanged(event.payload)).catch(
    (error) => console.error("galerie recipe-change listener registration failed", error),
  );
}

/** True when the native catalog plugin is reachable (running under Tauri). */
export function catalogAvailable(): boolean {
  return isTauri();
}

/** Open (creating if absent) the catalog at `path`; returns its schema version. */
export function openCatalog(path: string): Promise<number> {
  return invoke<number>("plugin:catalog|catalog_open", { path });
}

/** Close the open catalog (flushes WAL). */
export function closeCatalog(): Promise<void> {
  return invoke("plugin:catalog|catalog_close");
}

/** Run `PRAGMA integrity_check`; returns "ok" or the first problem. */
export function integrityCheck(): Promise<string> {
  return invoke<string>("plugin:catalog|catalog_integrity_check");
}

/** Compact + re-analyze the catalog (checkpoint + VACUUM + optimize). */
export function optimizeCatalog(): Promise<void> {
  return invoke("plugin:catalog|catalog_optimize");
}

/** Copy the catalog to `dest` (checkpointed point-in-time snapshot). */
export function backupCatalog(dest: string): Promise<void> {
  return invoke("plugin:catalog|catalog_backup", { dest });
}

/** Import one photo (dup-safe upsert by path); returns its photo id. */
export function importPhoto(photo: ImportPhoto): Promise<number> {
  return invoke<number>("plugin:catalog|catalog_import_photo", { photo });
}

export function importManagedDng(photo: ImportPhoto): Promise<number> {
  return invoke<number>("plugin:catalog|catalog_import_managed_dng", { photo });
}

/** Create a virtual copy of a photo (shares the source, own develop); new id. */
export function createVirtualCopy(photoId: number): Promise<number> {
  return invoke<number>("plugin:catalog|catalog_create_virtual_copy", { photoId });
}

/** Rename a virtual copy (LR "Set Copy Name…"); blank/null clears the name.
 *  Masters have no copy name, so the catalog ignores the write for them. */
export function setCopyName(photoId: number, name: string | null): Promise<void> {
  return invoke("plugin:catalog|catalog_set_copy_name", { photoId, name });
}

/** Promote a virtual copy to master photo, demoting the current master to a copy. */
export function makeMasterPhoto(photoId: number): Promise<void> {
  return invoke("plugin:catalog|catalog_make_master_photo", { photoId });
}

/** Stack ≥2 photos (ids[0] becomes the cover); returns the new stack id. */
export function stackPhotos(ids: number[]): Promise<number> {
  return invoke<number>("plugin:catalog|catalog_stack_photos", { ids });
}

/** Break a stack, unstacking every member. */
export function unstack(stackId: number): Promise<void> {
  return invoke("plugin:catalog|catalog_unstack", { stackId });
}

/** Remove photos from the catalog ("Remove from Catalog" — source files kept).
 *  Returns every deleted id (the requested ids plus cascade-deleted virtual
 *  copies) so the view can reconcile without a reload. */
export function removePhotos(ids: number[]): Promise<number[]> {
  return invoke<number[]>("plugin:catalog|catalog_remove_photos", { ids });
}

/** Result of "Delete from Disk": deleted photo ids (incl. cascaded virtual
 *  copies), the files moved to the OS Trash, and any the OS refused to move. */
export interface DeleteFromDiskResult {
  deleted: number[];
  trashed: string[];
  failed: string[];
}

/** Lightroom "Delete from Disk" — remove the catalog rows like `removePhotos`,
 *  then move the now-unreferenced source files (original + managed DNG copy)
 *  to the OS Trash. */
export function deletePhotosFromDisk(ids: number[]): Promise<DeleteFromDiskResult> {
  return invoke<DeleteFromDiskResult>("plugin:catalog|catalog_delete_photos_from_disk", { ids });
}

/** Reveal a file in the OS file browser (Lightroom's "Show in Finder"). */
export function revealPath(path: string): Promise<void> {
  return invoke("plugin:catalog|catalog_reveal_path", { path });
}

/** The master photo (if any) with the same content fingerprint at a different
 *  path — the import dialog's "suspected duplicate" probe. */
export function findDuplicate(fingerprint: string, path: string): Promise<number | null> {
  return invoke<number | null>("plugin:catalog|catalog_find_duplicate", { fingerprint, path });
}

/** Ids of every reject-flagged photo in the catalog (the "Delete Rejected" set). */
export function listRejectedIds(): Promise<number[]> {
  return invoke<number[]>("plugin:catalog|catalog_list_rejected_ids");
}

/** Make a photo the cover (order 0) of its stack. */
export function setStackCover(photoId: number): Promise<void> {
  return invoke("plugin:catalog|catalog_set_stack_cover", { photoId });
}

/** LR Split Stack: the photo and every member after it form a new stack.
 *  Either half left with one member is dissolved. */
export function splitStack(photoId: number): Promise<void> {
  return invoke("plugin:catalog|catalog_split_stack", { photoId });
}

/** Move a stacked photo one slot up (delta < 0) or down (> 0) in its stack. */
export function moveInStack(photoId: number, delta: number): Promise<void> {
  return invoke("plugin:catalog|catalog_move_in_stack", { photoId, delta });
}

/** All members of a stack. Without `sort`, preserves stack order for stack
 *  editing; the expanded-grid source supplies the current Library sort. */
export function listStack(stackId: number, sort?: GridSort): Promise<PhotoRow[]> {
  return invoke<PhotoRow[]>("plugin:catalog|catalog_list_stack", { stackId, sort });
}

/** Auto-stack unstacked photos by capture-time proximity; returns stacks made. */
export function autoStack(gapSeconds: number): Promise<number> {
  return invoke<number>("plugin:catalog|catalog_auto_stack", { gapSeconds });
}

/** Every source asset's id + path + missing flag (folder-sync scan input). */
export function listSourcePaths(): Promise<SourcePathRow[]> {
  return invoke<SourcePathRow[]>("plugin:catalog|catalog_list_source_paths");
}

/** Flag (or un-flag) a source asset as missing on disk. */
export function markMissing(sourceAssetId: number, missing: boolean): Promise<void> {
  return invoke("plugin:catalog|catalog_mark_missing", { sourceAssetId, missing });
}

/** Relink a missing source to a new path; refused unless the fingerprint matches. */
export function relink(
  sourceAssetId: number,
  newPath: string,
  newFingerprint: string,
): Promise<void> {
  return invoke("plugin:catalog|catalog_relink", { sourceAssetId, newPath, newFingerprint });
}

/** Count source assets flagged missing (status badge). */
export function countMissing(): Promise<number> {
  return invoke<number>("plugin:catalog|catalog_count_missing");
}

/** One keyset-paginated page in the given sort order, passing the Library filter. */
export function listPhotos(
  limit: number,
  after: Cursor | null = null,
  filter: PhotoFilter = DEFAULT_FILTER,
  sort: GridSort = DEFAULT_SORT,
): Promise<PhotoPage> {
  return invoke<PhotoPage>("plugin:catalog|catalog_list_photos", {
    after,
    limit,
    filter,
    sort,
  });
}

/** Total photos matching the filter (for grid sizing). */
export function countPhotos(filter: PhotoFilter = DEFAULT_FILTER): Promise<number> {
  return invoke<number>("plugin:catalog|catalog_count_photos", { filter });
}

/** Master photos whose file content is shared by ≥2 assets (exact duplicates).
 *  Offset-windowed: fetch `limit` rows starting at `offset` and loop until a
 *  short chunk — the result is never silently truncated. */
export function duplicatePhotos(
  limit = 2000,
  offset = 0,
  sort: GridSort = DEFAULT_SORT,
): Promise<PhotoRow[]> {
  return invoke<PhotoRow[]>("plugin:catalog|catalog_duplicate_photos", { limit, offset, sort });
}

export function getPhoto(id: number): Promise<PhotoRow | null> {
  return invoke<PhotoRow | null>("plugin:catalog|catalog_get_photo", { id });
}

export function getDevelopExportIdentity(id: number): Promise<DevelopExportIdentity> {
  return invoke<DevelopExportIdentity>("plugin:catalog|catalog_get_develop_export_identity", { id });
}

/** Set a photo's full flag state (rating 0–5, flag -1/0/1, color label). */
export function setFlags(
  id: number,
  rating: number,
  flag: number,
  colorLabel: string | null = null,
): Promise<void> {
  return invoke("plugin:catalog|catalog_set_flags", { id, rating, flag, colorLabel });
}

/** Set a photo's editable IPTC metadata (blank fields clear to null). */
export function setMetadata(
  id: number,
  meta: PhotoMetadata,
): Promise<void> {
  return invoke("plugin:catalog|catalog_set_metadata", { id, ...meta });
}

/** Persist the canonical develop recipe (DevelopRecipeV2 JSON) + process version. */
export function setRecipe(
  id: number,
  recipeJson: string,
  processVersion: number | null = null,
): Promise<string> {
  return invoke<string>("plugin:catalog|catalog_set_recipe", { id, recipeJson, processVersion }).then(
    (canonicalJson) => {
      dispatchRecipeChanged(id);
      return canonicalJson;
    },
  );
}

export function onRecipeChanged(listener: (photoId: number) => void): () => void {
  recipeChangedListeners.add(listener);
  return () => recipeChangedListeners.delete(listener);
}

export function onPhotoRecipeChanged(photoId: number, listener: () => void): () => void {
  return onRecipeChanged((changedPhotoId) => {
    if (changedPhotoId === photoId) listener();
  });
}

/** Read back a photo's recipe JSON (null if never edited). */
export function getRecipe(id: number): Promise<string | null> {
  return invoke<string | null>("plugin:catalog|catalog_get_recipe", { id });
}

/** Create/replace a named develop snapshot for a photo; returns its id. */
export function addSnapshot(
  photoId: number,
  name: string,
  recipeJson: string,
  processVersion: number | null = null,
): Promise<number> {
  return invoke<number>("plugin:catalog|catalog_add_snapshot", {
    photoId,
    name,
    recipeJson,
    processVersion,
  });
}

/** A photo's snapshots, alphabetical. */
export function listSnapshots(photoId: number): Promise<SnapshotRow[]> {
  return invoke<SnapshotRow[]>("plugin:catalog|catalog_list_snapshots", { photoId });
}

/** Delete a snapshot by id. */
export function deleteSnapshot(id: number): Promise<void> {
  return invoke("plugin:catalog|catalog_delete_snapshot", { id });
}

/** Append a develop history step (trims to the newest `cap`, 0 = unbounded). */
export function recordHistory(
  photoId: number,
  label: string,
  recipeJson: string,
  processVersion: number | null = null,
  cap = 200,
): Promise<number> {
  return invoke<number>("plugin:catalog|catalog_record_history", {
    photoId,
    label,
    recipeJson,
    processVersion,
    cap,
  });
}

/** A photo's develop history steps, newest first. */
export function listHistory(photoId: number): Promise<HistoryRow[]> {
  return invoke<HistoryRow[]>("plugin:catalog|catalog_list_history", { photoId });
}

/** Clear a photo's develop history. */
export function clearHistory(photoId: number): Promise<void> {
  return invoke("plugin:catalog|catalog_clear_history", { photoId });
}

/** Tag a photo with a keyword (created if new); null if the name was blank.
 *  This is the single apply chokepoint — recording into the Recent Keywords ring
 *  here covers every caller (Keywording bar, Painter, …), not just one UI. */
export function addKeyword(photoId: number, name: string): Promise<number | null> {
  return invoke<number | null>("plugin:catalog|catalog_add_keyword", { photoId, name }).then((id) => {
    if (id != null) recordKeywordUse(name);
    return id;
  });
}

/** Untag a photo (the keyword stays in the vocabulary). */
export function removeKeyword(photoId: number, keywordId: number): Promise<void> {
  return invoke("plugin:catalog|catalog_remove_keyword", { photoId, keywordId });
}

/** Replace a photo's complete keyword membership atomically. */
export function replacePhotoKeywords(photoId: number, names: string[]): Promise<void> {
  return invoke("plugin:catalog|catalog_replace_photo_keywords", { photoId, names });
}

/** A photo's keywords, alphabetical. */
export function listPhotoKeywords(photoId: number): Promise<KeywordRow[]> {
  return invoke<KeywordRow[]>("plugin:catalog|catalog_list_photo_keywords", { photoId });
}

/** Save a develop preset (upsert by name); null if the name was blank. */
export function addPreset(
  name: string,
  recipeJson: string,
  processVersion: number | null = null,
): Promise<number | null> {
  return invoke<number | null>("plugin:catalog|catalog_add_preset", { name, recipeJson, processVersion });
}

/** All develop presets, alphabetical. */
export function listPresets(): Promise<PresetRow[]> {
  return invoke<PresetRow[]>("plugin:catalog|catalog_list_presets");
}

export function deletePreset(id: number): Promise<void> {
  return invoke("plugin:catalog|catalog_delete_preset", { id });
}

/** Save a metadata preset (creator/copyright, upsert by name); null if blank. */
export function addMetadataPreset(
  name: string,
  creator: string | null,
  copyright: string | null,
): Promise<number | null> {
  return invoke<number | null>("plugin:catalog|catalog_add_metadata_preset", { name, creator, copyright });
}

/** All metadata presets, alphabetical. */
export function listMetadataPresets(): Promise<MetadataPresetRow[]> {
  return invoke<MetadataPresetRow[]>("plugin:catalog|catalog_list_metadata_presets");
}

export function deleteMetadataPreset(id: number): Promise<void> {
  return invoke("plugin:catalog|catalog_delete_metadata_preset", { id });
}

/** Create a collection/set/smart node; returns its id. `ruleAst` is smart-rule
 *  JSON or a stable marker for a reserved manual collection. */
export function createCollection(
  name: string,
  kind: string,
  parentId: number | null = null,
  ruleAst: string | null = null,
): Promise<number> {
  return invoke<number>("plugin:catalog|catalog_create_collection", { name, kind, parentId, ruleAst });
}

/** Every collection node, ordered for the sidebar. */
export function listCollections(): Promise<CollectionRow[]> {
  return invoke<CollectionRow[]>("plugin:catalog|catalog_list_collections");
}

export function renameCollection(id: number, name: string): Promise<void> {
  return invoke("plugin:catalog|catalog_rename_collection", { id, name });
}

/** Replace a smart collection's rule AST (JSON). */
export function setCollectionRule(id: number, ruleAst: string): Promise<void> {
  return invoke("plugin:catalog|catalog_set_collection_rule", { id, ruleAst });
}

/** Atomically update a collection's editable fields. Manual system markers are
 *  retained; `ruleAst` is used only for smart collections. */
export function updateCollection(
  id: number,
  name: string,
  parentId: number | null,
  ruleAst: string | null,
): Promise<void> {
  return invoke("plugin:catalog|catalog_update_collection", { id, name, parentId, ruleAst });
}

/** Delete a collection (cascades membership + child nodes; photos survive). */
export function deleteCollection(id: number): Promise<void> {
  return invoke("plugin:catalog|catalog_delete_collection", { id });
}

/** Add a photo to a manual collection (idempotent). */
export function addToCollection(collectionId: number, photoId: number): Promise<void> {
  return invoke("plugin:catalog|catalog_add_to_collection", { collectionId, photoId });
}

export function removeFromCollection(collectionId: number, photoId: number): Promise<void> {
  return invoke("plugin:catalog|catalog_remove_from_collection", { collectionId, photoId });
}

/** Replace a manual collection's ordered membership atomically. */
export function replaceCollectionMembers(collectionId: number, photoIds: number[]): Promise<void> {
  return invoke("plugin:catalog|catalog_replace_collection_members", { collectionId, photoIds });
}

/** Move selected manual-collection members one User Order slot. The native
 *  transaction retains filtered-out members and rewrites positions atomically. */
export function moveCollectionMembers(
  collectionId: number,
  photoIds: number[],
  delta: number,
): Promise<void> {
  return invoke("plugin:catalog|catalog_move_collection_members", {
    collectionId,
    photoIds,
    delta,
  });
}

/** A collection's photos (manual membership or smart-rule result), in the
 *  requested order. Offset-windowed like `duplicatePhotos`. */
export function listCollectionPhotos(
  collectionId: number,
  limit = 2000,
  offset = 0,
  sort?: GridSort,
): Promise<PhotoRow[]> {
  return invoke<PhotoRow[]>("plugin:catalog|catalog_list_collection_photos", {
    collectionId,
    limit,
    offset,
    sort,
  });
}

/** The Filter bar's Metadata-mode option lists (cameras/lenses/years + counts). */
export function listFilterOptions(): Promise<FilterOptions> {
  return invoke<FilterOptions>("plugin:catalog|catalog_list_filter_options");
}

/** Distinct source folders with master-photo counts (Folders panel). */
export function listFolders(): Promise<FolderRow[]> {
  return invoke<FolderRow[]>("plugin:catalog|catalog_list_folders");
}

/** Rename a folder on disk and repoint every cataloged path under it.
 *  Returns the repointed photo count. */
export function renameFolder(oldDir: string, newDir: string): Promise<number> {
  return invoke<number>("plugin:catalog|catalog_rename_folder", { oldDir, newDir });
}

/** Create a directory on disk (Folders panel Create Folder). */
export function createFolder(dir: string): Promise<void> {
  return invoke("plugin:catalog|catalog_create_folder", { dir });
}

/** Remove every cataloged photo under a folder (files stay on disk). Returns
 *  the deleted photo ids, cascade-deleted virtual copies included. */
export function removeFolder(dir: string): Promise<number[]> {
  return invoke<number[]>("plugin:catalog|catalog_remove_folder", { dir });
}

/** Update Folder Location: repoint every cataloged path under `oldDir` to
 *  `newDir` without touching the disk (the folder already moved). Returns the
 *  repointed photo count. */
export function updateFolderLocation(oldDir: string, newDir: string): Promise<number> {
  return invoke<number>("plugin:catalog|catalog_update_folder_location", { oldDir, newDir });
}

/** Rename a photo's source file on disk and repoint the catalog. Returns the
 *  previous path (for undo). */
export function renamePhotoFile(photoId: number, newPath: string): Promise<string> {
  return invoke<string>("plugin:catalog|catalog_rename_photo_file", { photoId, newPath });
}

/** Edit Capture Time: set (or clear with null) a photo's capture instant. */
export function setCaptureTime(photoId: number, captureTime: number | null): Promise<void> {
  return invoke("plugin:catalog|catalog_set_capture_time", { photoId, captureTime });
}

/** Geotag: set (or clear with a null pair) a photo's GPS coordinate. */
export function setGps(photoId: number, lat: number | null, lon: number | null): Promise<void> {
  return invoke("plugin:catalog|catalog_set_gps", { photoId, lat, lon });
}

/** The keyword vocabulary with per-keyword photo counts (Keyword List panel). */
export function listKeywords(): Promise<KeywordCountRow[]> {
  return invoke<KeywordCountRow[]>("plugin:catalog|catalog_list_keywords");
}

/** Photos tagged with a keyword (a browse source, like a collection).
 *  Offset-windowed like `duplicatePhotos` — loop until a short chunk for all. */
export function listKeywordPhotos(
  keywordId: number,
  limit = 2000,
  offset = 0,
  sort: GridSort = DEFAULT_SORT,
): Promise<PhotoRow[]> {
  return invoke<PhotoRow[]>("plugin:catalog|catalog_list_keyword_photos", {
    keywordId,
    limit,
    offset,
    sort,
  });
}

/** Delete a keyword from the vocabulary (photo links cascade away). */
export function deleteKeyword(keywordId: number): Promise<void> {
  return invoke("plugin:catalog|catalog_delete_keyword", { keywordId });
}

/** Write-through a generated preview blob to the native on-disk cache. */
export function previewPut(
  photoId: number,
  kind: string,
  maxEdge: number,
  expectedIdentity: PreviewIdentityV2,
  rawMetadata: RawFrameMetadata | null,
  bytes: Uint8Array,
): Promise<void> {
  return invoke("plugin:catalog|catalog_preview_put", {
    photoId,
    kind,
    maxEdge,
    expectedIdentity,
    rawMetadata,
    bytes: Array.from(bytes),
  });
}

/** Ask Rust for one canonical recipe/identity snapshot used by get, render, and put. */
export function previewRequest(
  photoId: number,
  kind: PreviewIdentityV2["previewKind"],
  maxEdge: number,
): Promise<PreviewRequestV2> {
  return invoke<PreviewRequestV2>("plugin:catalog|catalog_preview_request", {
    photoId,
    kind,
    maxEdge,
  });
}

export async function previewIdentity(
  photoId: number,
  kind: PreviewIdentityV2["previewKind"],
  maxEdge: number,
): Promise<PreviewIdentityV2> {
  return (await previewRequest(photoId, kind, maxEdge)).identity;
}

/** Read a cached preview blob (null on a miss), reused across restarts. */
export function previewGet(
  photoId: number,
  kind: string,
  identity: PreviewIdentityV2,
): Promise<Uint8Array | null> {
  return invoke<{ bytes: number[] | null; diagnostic: string | null }>(
    "plugin:catalog|catalog_preview_get",
    { photoId, kind, identity },
  ).then(({ bytes, diagnostic }) => {
    if (diagnostic) console.warn(`Galerie preview cache miss: ${diagnostic}`);
    return bytes ? new Uint8Array(bytes) : null;
  });
}

/** Insert/replace a preview-cache record; returns its id. */
export function recordPreview(preview: PreviewRecord): Promise<number> {
  return invoke<number>("plugin:catalog|catalog_record_preview", { preview });
}

/** Look up a cached preview by identity (null = cache miss → render it). */
export function findPreview(
  photoId: number,
  kind: string,
  cacheKey: string,
): Promise<PreviewRow | null> {
  return invoke<PreviewRow | null>("plugin:catalog|catalog_find_preview", {
    photoId,
    kind,
    cacheKey,
  });
}
