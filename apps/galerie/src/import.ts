// import — bring files into the catalog. Native file picker → read bytes →
// decode (dims + validity) → fingerprint → EXIF/mtime probe (native ImageIO;
// capture time, camera, lens, exposure, GPS) → catalog. Failures are per-file
// skips surfaced in a transient import summary, never a batch abort.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { copyFile, exists, mkdir, readDir, readFile, readTextFile, remove } from "@tauri-apps/plugin-fs";

import {
  normalizeRecipe,
  tryParseCameraRawXmp,
  xmpSidecarPath,
  type DevelopRecipeV2,
  type XmpPhotoMetadata,
  type XmpSnapshot,
} from "@monet-ui/monet-photo";

import {
  addKeyword,
  addToCollection,
  findDuplicate,
  getPhoto,
  listSourcePaths,
  setFlags,
  setMetadata,
} from "./catalog/catalog";
import { planFolderSync, sourceDirs, type DirListing } from "./lib/folderSync";
import type { ImportPhoto, MetadataPresetRow, PhotoMetadata, PhotoRow, PresetRow } from "./catalog/types";
import { decodeImage } from "./engine";
import { fingerprint } from "./lib/fingerprint";
import { planImport, type ImportPlanOptions } from "./lib/importPlan";
import { mergeRecipePatch } from "./lib/recipePatch";
import { buildPreviews, previewTargetEdge } from "./lib/thumbnailLoader";
import { decodeRawPath, probeImageMetadata } from "./rawDecode";
import { store } from "./state/store";

/** Camera-RAW routes. Actual camera support is queried from the native decoder. */
const RAW_EXT = new Set([
  "cr2", "cr3", "nef", "arw", "raf", "dng", "rw2", "orf", "pef", "srw", "raw", "nrw", "dcr",
]);
/** Regular encoded formats decoded via `Engine.fromImage`. */
const IMG_EXT = new Set([
  "jpg", "jpeg", "png", "tif", "tiff", "webp", "bmp", "gif", "hdr", "exr",
]);

export const IMPORT_EXTENSIONS = [...RAW_EXT, ...IMG_EXT];

function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
}

/** True when `path`'s extension is an importable photo format. */
export function isImportablePath(path: string): boolean {
  const ext = extOf(path);
  return RAW_EXT.has(ext) || IMG_EXT.has(ext);
}

/** True when `path` routes through the camera-RAW decoder. */
export function isRawPath(path: string): boolean {
  return RAW_EXT.has(extOf(path));
}

/** Importable files under `dir`, sorted. `recurse` walks the whole tree (LR's
 *  Include Subfolders); off lists only the folder itself. Unreadable subdirs
 *  are skipped — fewer files, never a failed scan. */
export async function listImportableFiles(dir: string, recurse: boolean): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string, depth: number): Promise<void> => {
    const entries = (await readDir(d).catch(() => null)) ?? [];
    for (const e of entries) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory) {
        // ponytail: depth 32 caps symlink cycles; real cycle detection needs inode identity.
        if (recurse && depth < 32) await walk(p, depth + 1);
      } else if (isImportablePath(p)) {
        out.push(p);
      }
    }
  };
  await walk(dir, 0);
  return out.sort();
}

/** Open the native picker and import the chosen files. Returns the count added. */
export async function importPhotosFromDialog(): Promise<number> {
  const selected = await open({
    multiple: true,
    directory: false,
    title: "Import Photos",
    filters: [{ name: "Photos", extensions: IMPORT_EXTENSIONS }],
  });
  if (selected == null) return 0;
  const paths = Array.isArray(selected) ? selected : [selected];
  return importPaths(paths);
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Progress + cancel hooks for a long import — the caller owns the StatusBar
 *  job (see CatalogStore.runJob). All optional: a caller that wants none of it
 *  passes nothing and the import behaves exactly as before. */
export interface ImportProgress {
  /** One file finished (decoded + fingerprinted + probed). */
  onTick?: () => void;
  /** The real file count, once the import knows it (a dropped folder is one
   *  path but N files; a copy phase drops the ones it could not copy). */
  onTotal?: (total: number) => void;
  /** Polled between files — true stops the import where it stands. */
  isCancelled?: () => boolean;
}

type ImportOptions = { skipDuplicates?: boolean } & ImportProgress;

/** IPTC fields probe_image_metadata reports beyond rawDecode.ts's typed EXIF
 *  set (src-tauri/src/raw_decode.rs `ImageMetadataProbe`).
 *  ponytail: typed here because rawDecode.ts belongs to another workstream this
 *  pass — fold these into its `ImageMetadataProbe` when it frees up. */
export interface EmbeddedIptc {
  title?: string | null;
  caption?: string | null;
  creator?: string | null;
  copyright?: string | null;
  city?: string | null;
  stateProvince?: string | null;
  country?: string | null;
  jobTitle?: string | null;
  credit?: string | null;
  source?: string | null;
  keywords?: string[];
  rating?: number | null;
}

/** A full-fidelity `.xmp` sidecar read via the shared Camera Raw parser —
 *  unlike lib/xmpSidecar's `XmpReadFields`, this keeps the location/attribution
 *  cluster the shared dialect already round-trips. */
export interface SidecarDocument {
  metadata: XmpPhotoMetadata;
  recipe: Partial<DevelopRecipeV2> | null;
  /** Named develop snapshots the sidecar carries. */
  snapshots: XmpSnapshot[];
}

/** Read + parse the sidecar beside a source, or null when there is none or it
 *  isn't a usable Camera Raw XMP (absence and garbage are both "nothing"). */
export async function readSidecarDocument(sourcePath: string): Promise<SidecarDocument | null> {
  try {
    const doc = tryParseCameraRawXmp(await readTextFile(xmpSidecarPath(sourcePath)));
    return doc ? { metadata: doc.metadata, recipe: doc.recipe, snapshots: doc.snapshots } : null;
  } catch {
    return null;
  }
}

/** DAM state a file brings along at import: IPTC fields, rating/label,
 *  keywords, and any sidecar develop recipe. */
export interface IngestedMetadata {
  meta: PhotoMetadata;
  /** 0 = unrated. */
  rating: number;
  label: string | null;
  keywords: string[];
  recipe: Partial<DevelopRecipeV2> | null;
}

/** Merge a file's embedded IPTC with its `.xmp` sidecar into the DAM state to
 *  ingest (LR semantics: the sidecar is the newer, LR-authored state, so it
 *  wins per field; keywords union, hierarchical paths contribute their leaf).
 *  Returns null when there is nothing to apply. Exported for tests. */
export function mergeIngestedMetadata(
  embedded: EmbeddedIptc | null,
  sidecar: SidecarDocument | null,
): IngestedMetadata | null {
  const norm = (v?: string | null): string | null => {
    const t = v?.trim();
    return t ? t : null;
  };
  const s = sidecar?.metadata;
  const pick = (fromSidecar?: string | null, fromEmbedded?: string | null): string | null =>
    norm(fromSidecar) ?? norm(fromEmbedded);
  const meta: PhotoMetadata = {
    title: pick(s?.title, embedded?.title),
    caption: pick(s?.caption, embedded?.caption),
    creator: pick(s?.creator, embedded?.creator),
    copyright: pick(s?.copyright, embedded?.copyright),
    city: pick(s?.city, embedded?.city),
    stateProvince: pick(s?.stateProvince, embedded?.stateProvince),
    country: pick(s?.country, embedded?.country),
    jobTitle: pick(s?.jobTitle, embedded?.jobTitle),
    credit: pick(s?.credit, embedded?.credit),
    source: pick(s?.source, embedded?.source),
  };
  const keywords = [
    ...new Set(
      [
        ...(embedded?.keywords ?? []),
        ...(s?.keywords ?? []),
        // A "Parent|Child" path's leaf is the applied keyword (flat vocabulary).
        ...(s?.hierarchical ?? []).map((p) => p.split("|").pop() ?? ""),
      ]
        .map((k) => k.trim())
        .filter(Boolean),
    ),
  ];
  const rawRating = s?.rating ?? embedded?.rating ?? 0;
  const rating = Number.isFinite(rawRating) ? Math.min(5, Math.max(0, Math.round(rawRating as number))) : 0;
  const label = norm(s?.label);
  const recipe = sidecar?.recipe ?? null;
  const empty =
    rating === 0 &&
    label == null &&
    keywords.length === 0 &&
    recipe == null &&
    Object.values(meta).every((v) => v == null);
  return empty ? null : { meta, rating, label, keywords, recipe };
}

/** Persist ingested DAM metadata for freshly imported ids (aligned with the
 *  record order store.importPhotos consumed). Direct catalog writes — an import
 *  lands as initial state, not as per-photo undoable edits — then ONE reload so
 *  the grid shows the fields. Sidecar recipes route through the normal develop
 *  path (History + persistence). Best-effort per photo: the photo itself is
 *  already imported, so a metadata failure never costs the import. */
async function applyIngestedMetadata(
  ids: number[],
  records: ImportPhoto[],
  dam: Map<string, IngestedMetadata>,
): Promise<void> {
  let applied = false;
  for (let i = 0; i < ids.length && i < records.length; i++) {
    const ingest = dam.get(records[i].path);
    if (!ingest) continue;
    const id = ids[i];
    try {
      if (Object.values(ingest.meta).some((v) => v != null)) {
        await setMetadata(id, ingest.meta);
        applied = true;
      }
      if (ingest.rating > 0 || ingest.label != null) {
        await setFlags(id, ingest.rating, 0, ingest.label);
        applied = true;
      }
      for (const kw of ingest.keywords) {
        await addKeyword(id, kw);
        applied = true;
      }
      if (ingest.recipe) {
        await store.applyQuickDevelop([id], (r) => mergeRecipePatch(r, ingest.recipe!));
      }
    } catch (e) {
      console.error("galerie import: metadata ingest failed", records[i].path, e);
    }
  }
  if (applied) await store.reload();
}

/** Decode + fingerprint + EXIF-probe each path into an ImportPhoto record.
 *  Per-file failures are collected in `skipped`, never aborting the batch.
 *  This is the slow phase, so it owns the progress ticks. */
async function buildImportRecords(
  paths: string[],
  progress: ImportProgress = {},
): Promise<{ records: ImportPhoto[]; skipped: string[]; dam: Map<string, IngestedMetadata> }> {
  const records: ImportPhoto[] = [];
  const skipped: string[] = [];
  const dam = new Map<string, IngestedMetadata>();
  for (const path of paths) {
    // Poll before each file: a 20k import must stop on the next file, not at
    // the end of the batch. Whatever was cataloged so far is kept.
    if (progress.isCancelled?.()) break;
    try {
      const bytes = await readFile(path);
      const ext = extOf(path);
      const raw = RAW_EXT.has(ext);
      // Native RAW decode validates support and reports the full oriented source
      // dimensions while rendering only a small proxy. Browser fallback keeps
      // the legacy wasm decoder for fixtures/dev.
      const rawInfo = raw && isTauri() ? await decodeRawPath(path, 512, { mode: "asShot" }) : null;
      const img = rawInfo ? null : await decodeImage(bytes, raw, path);
      // EXIF/mtime probe is best-effort: missing metadata never blocks import.
      const meta = isTauri() ? await probeImageMetadata(path).catch(() => null) : null;
      // DAM ingest (LR parity): the probe's embedded IPTC merged with any .xmp
      // sidecar beside the source — applied after the catalog rows exist.
      const ingest = mergeIngestedMetadata(
        meta as (typeof meta & EmbeddedIptc) | null,
        isTauri() ? await readSidecarDocument(path) : null,
      );
      if (ingest) dam.set(path, ingest);
      records.push({
        path,
        fingerprint: await fingerprint(bytes, bytes.byteLength),
        format: raw ? `raw:${ext.toUpperCase()}` : ext,
        byteSize: bytes.byteLength,
        mtime: meta?.mtime ?? 0,
        width: rawInfo?.nativeWidth ?? img!.width,
        height: rawInfo?.nativeHeight ?? img!.height,
        orientation: rawInfo?.orientation ?? 1,
        captureTime: meta?.captureTime ?? null,
        cameraMake: meta?.cameraMake ?? null,
        cameraModel: meta?.cameraModel ?? null,
        lens: meta?.lens ?? null,
        iso: meta?.iso ?? null,
        fNumber: meta?.fNumber ?? null,
        focalLength: meta?.focalLength ?? null,
        exposureTime: meta?.exposureTime ?? null,
        gpsLat: meta?.gpsLat ?? null,
        gpsLon: meta?.gpsLon ?? null,
      });
    } catch (e) {
      // Skip unreadable/undecodable files; a batch import shouldn't abort.
      console.error("galerie import: skipped", path, e);
      skipped.push(`${baseName(path)} (${e instanceof Error ? e.message : String(e)})`);
    }
    progress.onTick?.();
  }
  return { records, skipped, dam };
}

/** Transient summary toast after an import batch. */
function notifyImport(count: number, skipped: string[]): void {
  if (skipped.length > 0) {
    const first = skipped[0];
    const more = skipped.length > 1 ? ` and ${skipped.length - 1} more` : "";
    store.notify(`Imported ${count} photo${count === 1 ? "" : "s"}, skipped ${skipped.length}: ${first}${more}`);
  } else if (count > 0) {
    store.notify(`Imported ${count} photo${count === 1 ? "" : "s"}`);
  }
}

/** Partition built records into imports vs suspected duplicates — files whose
 *  content fingerprint already exists in the catalog at a different path
 *  (Lightroom's "Don't Import Suspected Duplicates"). Exported for tests. */
export async function partitionDuplicates(
  records: ImportPhoto[],
  skip: boolean,
): Promise<{ keep: ImportPhoto[]; dupes: string[] }> {
  if (!skip) return { keep: records, dupes: [] };
  const keep: ImportPhoto[] = [];
  const dupes: string[] = [];
  for (const r of records) {
    let hit: number | null = null;
    try {
      hit = await findDuplicate(r.fingerprint, r.path);
    } catch {
      // A probe failure never blocks an import — treat as not-a-duplicate.
    }
    if (hit != null) dupes.push(`${baseName(r.path)} (suspected duplicate)`);
    else keep.push(r);
  }
  return { keep, dupes };
}

/** Fingerprint a source file and probe the catalog for the same content at a
 *  different path. Unreadable files fall through to the normal skip path. */
async function sourceIsDuplicate(path: string): Promise<boolean> {
  try {
    const bytes = await readFile(path);
    const fp = await fingerprint(bytes, bytes.byteLength);
    return (await findDuplicate(fp, path)) != null;
  } catch {
    return false;
  }
}

/** Lightroom's "Synchronize Folders": scan every folder the catalog references
 *  for importable files it doesn't know yet. Returns the new paths — the caller
 *  routes them into the Import dialog. Unreadable folders are skipped (the
 *  missing-photos workflow owns those). */
export async function synchronizeFolders(onlyDir?: string): Promise<string[]> {
  const cataloged = (await listSourcePaths()).map((s) => s.path);
  const listings: DirListing[] = [];
  const dirs = onlyDir ? [onlyDir] : sourceDirs(cataloged);
  for (const dir of dirs) {
    try {
      const entries = await readDir(dir);
      listings.push({
        dir,
        files: entries.filter((e) => !e.isDirectory).map((e) => `${dir}/${e.name}`),
      });
    } catch {
      // Vanished/unreadable folder — nothing to synchronize from it.
    }
  }
  return planFolderSync(cataloged, listings, new Set(IMPORT_EXTENSIONS));
}

/** Import a set of file paths into the open catalog (Add, in place). Returns the
 *  new catalog ids, in the order the paths imported. */
export async function importPathsWithIds(
  paths: string[],
  opts: ImportOptions = {},
): Promise<number[]> {
  const { records, skipped, dam } = await buildImportRecords(paths, opts);
  const { keep, dupes } = await partitionDuplicates(records, opts.skipDuplicates ?? true);
  const ids = await store.importPhotos(keep);
  await applyIngestedMetadata(ids, keep, dam);
  notifyImport(ids.length, [...skipped, ...dupes]);
  return ids;
}

/** Import a set of file paths into the open catalog (Add, in place). Returns the
 *  count added. */
export async function importPaths(paths: string[], opts: ImportOptions = {}): Promise<number> {
  return (await importPathsWithIds(paths, opts)).length;
}

/** Expand dropped folders into their importable files (full tree, via
 *  listImportableFiles). A path `readDir` refuses is a plain file (or
 *  unreadable) and passes through untouched. */
async function expandDropDirs(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const path of paths) {
    const isDir = await readDir(path).then(() => true, () => false);
    if (isDir) out.push(...(await listImportableFiles(path, true)));
    else out.push(path);
  }
  return out;
}

/** Drag-and-drop sink: import the photos out of an OS drop (Add, in place).
 *  Folders are expanded; non-photo files are reported rather than silently
 *  dropped, so a drop that imports nothing still says why. */
export async function importDroppedPaths(
  paths: string[],
  opts: ImportOptions = {},
): Promise<number> {
  const files = await expandDropDirs(paths);
  const photos = files.filter(isImportablePath);
  if (photos.length === 0) {
    store.notify("Nothing to import — drop photos or a folder of photos.");
    return 0;
  }
  opts.onTotal?.(photos.length); // a dropped folder counted as one path
  return importPaths(photos, opts);
}

/** Lightroom's Build Previews ladder: nothing, grid thumbnails ("Minimal"),
 *  screen-sized standard previews, or full-resolution 1:1s. */
export type PreviewTier = "none" | "minimal" | "standard" | "oneToOne";

/** Grid-cell decode edge the Library thumbnails render at. */
const MINIMAL_PREVIEW_EDGE = 256;
/** Standard-preview edge (LR's Standard; what Loupe/Develop read). */
const STANDARD_PREVIEW_EDGE = 2560;

/** Which preview cache a tier warms after import; null = build nothing. */
export function previewBuildPlan(
  tier: PreviewTier | undefined,
): { kind: "thumbnail" | "standard"; maxEdge: number | ((p: PhotoRow) => number) } | null {
  switch (tier) {
    case "minimal":
      return { kind: "thumbnail", maxEdge: MINIMAL_PREVIEW_EDGE };
    case "standard":
      return { kind: "standard", maxEdge: STANDARD_PREVIEW_EDGE };
    case "oneToOne":
      // Same kind + edge the Loupe's 1:1 zoom requests (LoupeView fullEdge).
      return { kind: "standard", maxEdge: previewTargetEdge };
    default:
      return null;
  }
}

/** Parse extract_embedded_preview's packed payload: `[w u32le, h u32le]` +
 *  tight RGBA8. Exported for tests. */
export function parseEmbeddedPreview(
  packed: Uint8Array,
): { width: number; height: number; rgba: Uint8Array } {
  if (packed.byteLength < 8) throw new Error("embedded preview: short response");
  const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
  const width = view.getUint32(0, true);
  const height = view.getUint32(4, true);
  // 4096 mirrors raw_decode.rs PROXY_MAX_EDGE — the decoder never sends more.
  if (
    width === 0 ||
    height === 0 ||
    width > 4096 ||
    height > 4096 ||
    packed.byteLength !== 8 + width * height * 4
  ) {
    throw new Error("embedded preview: invalid dimensions");
  }
  return { width, height, rgba: packed.subarray(8) };
}

/** Camera-embedded JPEG preview as an object URL (LR's Embedded tier — makes a
 *  card of RAWs reviewable in seconds, no demosaic). Returns null when
 *  unavailable (no embedded preview, browser build, native failure) so callers
 *  fall back to a real decode. Caller owns the URL. */
export async function embeddedPreviewUrl(path: string, maxEdge: number): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const packed = new Uint8Array(
      await invoke<ArrayBuffer>("plugin:raw-decode|extract_embedded_preview", { path, maxEdge }),
    );
    const { width, height, rgba } = parseEmbeddedPreview(packed);
    const canvas = new OffscreenCanvas(width, height);
    canvas
      .getContext("2d")!
      .putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    return URL.createObjectURL(blob);
  } catch {
    return null; // a missing embedded preview is normal, not an error
  }
}

/** Post-import steps applied to every freshly imported id (LR's Apply During
 *  Import + Build Previews). Everything past the first two is optional so a
 *  caller that wants none of it can keep passing the original shape. */
export interface ImportApply {
  keywords: string[];
  metadataPreset: MetadataPresetRow | null;
  /** Develop preset applied to every imported photo. */
  developPreset?: PresetRow | null;
  /** Collection every imported photo joins. */
  collectionId?: number | null;
  /** Warm the standard preview cache for the batch — legacy switch equal to
   *  previewTier "standard". ponytail: kept because existing suites pin it;
   *  fold into previewTier when they migrate. */
  buildPreviews?: boolean;
  /** LR's Build Previews ladder; wins over the boolean when set. */
  previewTier?: PreviewTier;
}

const dirOf = (p: string): string => p.slice(0, Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")));

/** Capture times for date-organized destinations, probed from the SOURCE files
 *  before anything is copied. Best-effort: file mtime is the fallback (as in
 *  Lightroom) and a file with no date at all lands straight in destDir. */
async function probeCaptureTimes(paths: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (!isTauri()) return out;
  for (const path of paths) {
    const meta = await probeImageMetadata(path).catch(() => null);
    out.set(path, meta?.captureTime ?? meta?.mtime ?? null);
  }
  return out;
}

/** Apply the post-import steps to the freshly imported ids. */
async function applyToImported(
  ids: number[],
  apply: ImportApply,
  progress: ImportProgress = {},
): Promise<void> {
  if (ids.length === 0) return;
  for (const id of ids) {
    for (const kw of apply.keywords) await addKeyword(id, kw);
  }
  if (apply.metadataPreset) await store.applyMetadataPreset(apply.metadataPreset, ids);
  if (apply.developPreset) {
    try {
      // Same route as the develop-preset painter: the preset's canonical recipe
      // replaces each imported photo's (persist + history).
      const recipe = normalizeRecipe(JSON.parse(apply.developPreset.recipeJson) as unknown);
      await store.applyQuickDevelop(ids, () => recipe);
    } catch (e) {
      console.error("galerie import: bad develop preset recipe", e);
    }
  }
  if (apply.collectionId != null) {
    for (const id of ids) await addToCollection(apply.collectionId, id);
  }
  const plan = previewBuildPlan(apply.previewTier ?? (apply.buildPreviews ? "standard" : "none"));
  if (plan && !progress.isCancelled?.()) {
    const rows = await Promise.all(ids.map((id) => getPhoto(id).catch(() => null)));
    // ponytail: this warm-up isn't ticked — the job row still reads N/N from the
    // ingest phase. Pass `progress` through to buildPreviews (it takes the same
    // hooks) when the import job should count preview work too.
    await buildPreviews(rows.filter((r): r is PhotoRow => r != null), plan.kind, plan.maxEdge);
  }
}

/** Import with Add/Copy/Move handling + optional rename (importPlan), then
 *  apply keywords and a metadata preset to the imported photos. A copy failure
 *  skips that one file rather than aborting the batch; Move only deletes a
 *  source after its copy provably landed. */
export async function importWithOptions(
  paths: string[],
  plan: ImportPlanOptions,
  apply: ImportApply,
  opts: ImportOptions = {},
): Promise<number> {
  const skipDuplicates = opts.skipDuplicates ?? true;
  const finalPaths: string[] = [];
  const failed: string[] = [];
  const captureTimes = plan.organizeByDate ? await probeCaptureTimes(paths) : undefined;
  for (const it of planImport(paths, plan, captureTimes)) {
    // Cancelling mid-copy leaves the files copied so far — they still import.
    if (opts.isCancelled?.()) break;
    // The suspected-duplicate probe runs on the SOURCE before any copy, so a
    // duplicate is neither copied to disk nor cataloged (Lightroom behavior).
    if (skipDuplicates && (await sourceIsDuplicate(it.src))) {
      failed.push(`${baseName(it.src)} (suspected duplicate)`);
      continue;
    }
    if (it.dest !== it.src) {
      try {
        // Never clobber an existing file at the destination (planImport only
        // de-dupes within the batch); skip it rather than lose the user's data.
        if (await exists(it.dest)) {
          failed.push(`${baseName(it.src)} (already at destination)`);
          continue;
        }
        await mkdir(dirOf(it.dest), { recursive: true });
        await copyFile(it.src, it.dest);
      } catch (e) {
        console.error("galerie import: copy failed", it.src, e);
        failed.push(`${baseName(it.src)} (copy failed)`);
        continue;
      }
      // LR copies a raw's .xmp sidecar along with it, so the sidecar's
      // metadata/develop settings survive the move. Best-effort: a failed
      // sidecar copy never costs the import itself.
      try {
        const sidecar = xmpSidecarPath(it.src);
        if (await exists(sidecar)) await copyFile(sidecar, xmpSidecarPath(it.dest));
      } catch (e) {
        console.error("galerie import: sidecar copy failed", it.src, e);
      }
    }
    if (it.second) {
      // The backup is best-effort: a failed second copy is reported but never
      // costs the user the import itself.
      try {
        if (await exists(it.second)) throw new Error("already at second-copy destination");
        await mkdir(dirOf(it.second), { recursive: true });
        await copyFile(it.src, it.second);
      } catch (e) {
        console.error("galerie import: second copy failed", it.src, e);
        failed.push(`${baseName(it.src)} (second copy failed)`);
      }
    }
    // LR's Move = copy-then-delete-source. Deliberately last: the destination
    // copy (and any second copy, which also reads the original) has already
    // succeeded, so a delete can never be the step that loses the only file.
    // `dest !== src` guards the degenerate plan where the destination resolves
    // back onto the source — deleting there would delete the import itself.
    if (plan.handling === "move" && it.dest !== it.src) {
      try {
        await remove(it.src);
        // The sidecar was copied alongside the file above; leaving the original
        // behind would orphan settings next to a photo that is no longer there.
        const sidecar = xmpSidecarPath(it.src);
        if (await exists(sidecar)) await remove(sidecar);
      } catch (e) {
        // The photo is safely at the destination and still imports — a stranded
        // original is a cleanup nuisance, not lost data. Report, never abort.
        console.error("galerie import: source removal failed", it.src, e);
        failed.push(`${baseName(it.src)} (moved, original not removed)`);
      }
    }
    finalPaths.push(it.dest);
  }
  opts.onTotal?.(finalPaths.length); // the copy phase may have dropped some
  const { records, skipped, dam } = await buildImportRecords(finalPaths, opts);
  const ids = await store.importPhotos(records);
  // Ingested file metadata first, then Apply During Import — the user's
  // explicit choices win where the two overlap.
  await applyIngestedMetadata(ids, records, dam);
  await applyToImported(ids, apply, opts);
  notifyImport(ids.length, [...failed, ...skipped]);
  return ids.length;
}
