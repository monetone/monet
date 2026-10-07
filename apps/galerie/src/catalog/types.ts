// catalog/types — the TS mirror of the Rust catalog wire types (src-tauri/
// src/catalog.rs). Field names/casing match what serde emits/accepts across the
// Tauri IPC boundary (camelCase). Keep the two in lockstep.

/** One physical file + the photo to create from it (import pipeline → catalog). */
export interface ImportPhoto {
  /** Absolute path to the source file on disk. */
  path: string;
  /** Content fingerprint (import-computed digest) — duplicate identity. */
  fingerprint: string;
  /** e.g. "raw:CR3", "jpeg", "dng". */
  format: string;
  byteSize: number;
  /** Source file mtime, unix seconds. */
  mtime: number;
  width: number;
  height: number;
  /** EXIF orientation 1–8 (defaults to 1). */
  orientation?: number;
  /** Capture time (unix seconds) from EXIF; null/undefined if unknown. */
  captureTime?: number | null;
  cameraMake?: string | null;
  cameraModel?: string | null;
  lens?: string | null;
  iso?: number | null;
  fNumber?: number | null;
  focalLength?: number | null;
  /** Shutter speed in seconds (UI formats 0.005 → "1/200"). */
  exposureTime?: number | null;
  gpsLat?: number | null;
  gpsLon?: number | null;
}

/** A catalog photo joined with its source asset — the grid/filmstrip row. */
export interface PhotoRow {
  id: number;
  sourceAssetId: number;
  path: string;
  /** Immutable managed object used for all pixel reads. */
  readPath: string;
  format: string;
  isVirtualCopy: boolean;
  orientation: number;
  rating: number;
  /** -1 reject, 0 unflagged, 1 pick. */
  flag: number;
  colorLabel: string | null;
  captureTime: number | null;
  addedTime: number;
  width: number;
  height: number;
  cameraMake: string | null;
  cameraModel: string | null;
  lens: string | null;
  iso: number | null;
  fNumber: number | null;
  focalLength: number | null;
  exposureTime: number | null;
  gpsLat: number | null;
  gpsLon: number | null;
  hasRecipe: boolean;
  processVersion: number | null;
  /** Virtual-copy label ("Copy 1", …); null for masters. */
  copyName: string | null;
  /** Stack id (null = unstacked); stackOrder 0 is the collapsed cover. */
  stackId: number | null;
  stackOrder: number | null;
  /** Members in this photo's stack (1 when unstacked). */
  stackCount: number;
  /** The source file is flagged gone from disk (folder sync). */
  missing: boolean;
  /** Editable IPTC metadata (Phase 4); null until set. */
  title: string | null;
  caption: string | null;
  creator: string | null;
  copyright: string | null;
  city: string | null;
  stateProvince: string | null;
  country: string | null;
  jobTitle: string | null;
  credit: string | null;
  source: string | null;
}

export interface DevelopExportIdentity {
  catalogId: string;
  photo: PhotoRow;
  sourceDigest: string;
  canonicalRecipeJson: string;
}

/** The editable IPTC fields set together by the Metadata panel. */
export interface PhotoMetadata {
  title: string | null;
  caption: string | null;
  creator: string | null;
  copyright: string | null;
  city: string | null;
  stateProvince: string | null;
  country: string | null;
  jobTitle: string | null;
  credit: string | null;
  source: string | null;
}

/** A metadata preset — a saved creator/copyright pair applied to a selection. */
export interface MetadataPresetRow {
  id: number;
  name: string;
  creator: string | null;
  copyright: string | null;
  createdAt: number;
}

/** Keyset-pagination cursor: the last row's (sort value, id). */
export interface Cursor {
  /** Integer sort keys (capture/added/rating/flag/aspect/edit time/edit count). */
  sortTime: number;
  /** Text sort keys (filename/label/file type). */
  sortText?: string | null;
  id: number;
}

/** Every Library-grid sort column, in menu order (mirrors the Rust `SortKey`).
 *  One runtime list so the FilterBar menu can't silently drop a key. */
export const SORT_KEYS = [
  "capture",
  "added",
  "edittime",
  "editcount",
  "rating",
  "flag",
  "label",
  "filename",
  "filetype",
  "aspect",
  "user",
] as const;

/** Which Library-grid column to sort on (mirrors the Rust `SortKey`). */
export type SortKey = (typeof SORT_KEYS)[number];

/** Library grid sort: key + direction. */
export interface GridSort {
  key: SortKey;
  ascending: boolean;
}

/** Default order: capture time, newest first (the historical fixed order). */
export const DEFAULT_SORT: GridSort = { key: "capture", ascending: false };

/** A page of photos + the cursor for the next page (null when exhausted). */
export interface PhotoPage {
  photos: PhotoRow[];
  next: Cursor | null;
}

/** Photo kind (LR's Attribute Kind filter): master photos vs virtual copies. */
export type PhotoKind = "master" | "virtual";

/** The Library filter: rating floor + optional flag + optional color label. */
export interface PhotoFilter {
  minRating: number;
  /** null = any; 1 picks, 0 unflagged, -1 rejects. */
  flag: number | null;
  /** null = any; exact color-label match otherwise. */
  colorLabel: string | null;
  /** null/empty = any; else photos whose flag is ANY of these (LR multi-select
   *  Attribute row, e.g. [1, 0] = picks + unflagged). Non-empty supersedes
   *  `flag`, which stays for the single-select store/preset paths. */
  flags?: number[] | null;
  /** null/empty = any; else ANY-of these color labels. Non-empty supersedes
   *  `colorLabel`. */
  colorLabels?: string[] | null;
  /** null = any; "master" hides virtual copies, "virtual" shows only them
   *  (LR's Kind filter). */
  kind?: PhotoKind | null;
  /** null/blank = any; else a case-insensitive filename (path) substring. */
  text: string | null;
  /** Where the text searches: "path" (default) | "title" | "caption" |
   *  "keywords" | "copyName" | "any". */
  textTarget?: TextTarget | null;
  /** Rating comparison: ">=" (default) | "=" | "<=". */
  ratingOp?: RatingOp | null;
  /** null = any; else only photos under this directory (subfolders included). */
  folder?: string | null;
  /** true = restrict `folder` to direct children only (Folders panel's
   *  "Show Photos in Subfolders" toggle turned off). */
  folderOnly?: boolean;
  /** null = any; else exact camera-model match (Filter bar Metadata mode). */
  camera?: string | null;
  /** null = any; else exact lens match. */
  lens?: string | null;
  /** null = any; else photos captured in this calendar year (UTC). */
  year?: number | null;
  /** The Metadata browser's per-column selections (LR's Filter bar Metadata
   *  tab). Any-of within a column, AND across columns; an empty list or an
   *  unknown column id is ignored server-side. */
  meta?: MetaSelection | null;
  /** true = LR's Expand All Stacks: list every stack member in place instead
   *  of collapsing each stack to its cover. */
  expandStacks?: boolean;
}

/** Text-filter search targets (LR Text mode). */
export type TextTarget = "path" | "title" | "caption" | "keywords" | "copyName" | "any";

/** Rating comparison modes (LR Attribute mode). */
export type RatingOp = ">=" | "=" | "<=";

/** One distinct metadata value with its master-photo count (Filter bar). */
export interface OptionCount {
  value: string;
  count: number;
}

/** A Metadata-browser column id. Mirrors `META_COLUMNS` / `META_KEYWORD` in
 *  src-tauri/src/catalog.rs, which owns the SQL each id resolves to;
 *  `metaColumns.test.ts` fails if the two lists drift. */
export type MetaColumnId =
  | "camera"
  | "make"
  | "lens"
  | "label"
  | "filetype"
  | "creator"
  | "copyright"
  | "iso"
  | "aperture"
  | "shutter"
  | "focal"
  | "aspect"
  | "gps"
  | "folder"
  | "year"
  | "month"
  | "day"
  | "keyword";

/** The columns the Metadata browser offers, in picker order (LR's Filter bar
 *  Metadata tab column menu). */
export const META_COLUMNS: readonly { id: MetaColumnId; label: string }[] = [
  { id: "year", label: "Date — Year" },
  { id: "month", label: "Date — Month" },
  { id: "day", label: "Date — Day" },
  { id: "camera", label: "Camera" },
  { id: "make", label: "Camera Make" },
  { id: "lens", label: "Lens" },
  { id: "label", label: "Label" },
  { id: "keyword", label: "Keyword" },
  { id: "folder", label: "Folder" },
  { id: "filetype", label: "File Type" },
  { id: "aspect", label: "Aspect Ratio" },
  { id: "shutter", label: "Shutter Speed" },
  { id: "aperture", label: "Aperture" },
  { id: "focal", label: "Focal Length" },
  { id: "iso", label: "ISO Speed Rating" },
  { id: "gps", label: "GPS Data" },
  { id: "creator", label: "Creator" },
  { id: "copyright", label: "Copyright Status" },
];

/** The Metadata browser's per-column selections: any-of within a column, AND
 *  across columns. A missing/empty entry means "All" for that column. */
export type MetaSelection = Partial<Record<MetaColumnId, string[]>>;

/** The Filter bar's Metadata-browser option lists, one per requested column. */
export interface FilterOptions {
  columns: Partial<Record<MetaColumnId, OptionCount[]>>;
}

/** The patch `store.setMetadataFilter` merges. Lives here so the Filter bar and
 *  the store agree on the shape of a Metadata-mode change. */
export interface MetadataFilterPatch {
  camera?: string | null;
  lens?: string | null;
  year?: number | null;
  meta?: MetaSelection | null;
}

/** A source folder with its master-photo count (Folders panel). */
export interface FolderRow {
  path: string;
  count: number;
}

export const DEFAULT_FILTER: PhotoFilter = { minRating: 0, flag: null, colorLabel: null, text: null };

/** Client-side reference for the attribute filter's flag / label / kind
 *  semantics — the store's buffer reconciliation (`matchesFilter`) and the SQL
 *  in catalog.rs `filter_where` must agree with this. Sets are any-of; a
 *  non-empty set supersedes its scalar sibling. */
export function matchesAttributeFilter(
  f: Pick<PhotoFilter, "flag" | "flags" | "colorLabel" | "colorLabels" | "kind">,
  p: Pick<PhotoRow, "flag" | "colorLabel" | "isVirtualCopy">,
): boolean {
  if (f.flags?.length) {
    if (!f.flags.includes(p.flag)) return false;
  } else if (f.flag != null && p.flag !== f.flag) {
    return false;
  }
  if (f.colorLabels?.length) {
    if (p.colorLabel == null || !f.colorLabels.includes(p.colorLabel)) return false;
  } else if (f.colorLabel != null && p.colorLabel !== f.colorLabel) {
    return false;
  }
  if (f.kind === "master" && p.isVirtualCopy) return false;
  if (f.kind === "virtual" && !p.isVirtualCopy) return false;
  return true;
}

/** An on-disk preview-cache record (the file lives under the cache dir). */
export interface PreviewRecord {
  photoId: number;
  /** "thumbnail" | "standard" | "one_to_one" | "smart". */
  kind: string;
  /** Digest of source+decoder+recipe+masks+profile+renderer+dims (§3.4). */
  cacheKey: string;
  width: number;
  height: number;
  /** Path to the cached image, relative to the preview-cache root. */
  filePath: string;
  rendererRevision: number;
  byteSize: number;
  identityJson: string;
  provenanceJson: string;
  contentDigest: string;
}

export interface PreviewRow extends PreviewRecord {
  id: number;
  createdAt: number;
}

export interface PreviewIdentityV2 {
  identityVersion: 2;
  sourceDigest: string;
  decoderBackend: string;
  backendRevision: string;
  decoderVersion: string;
  osBuild: string;
  decodeIntentDigest: string;
  nativeWidth: number;
  nativeHeight: number;
  /** `[x, y, width, height]` in un-oriented native source coordinates. */
  activeArea: [number, number, number, number];
  sourceOrientation: number;
  outputOrientation: 1;
  orientationApplied: boolean;
  recipeDigest: string;
  processVersion: 6;
  maskDigest: string;
  modelVersions: Array<[string, string]>;
  workingProfileDigest: string;
  coreRevision: string;
  previewKind: "thumbnail" | "standard" | "develop" | "loupe" | "secondary";
  outputWidth: number;
  outputHeight: number;
  scaleNumerator: number;
  scaleDenominator: number;
}

export interface PreviewRequestV2 {
  identity: PreviewIdentityV2;
  /** Rust-owned digest of the complete canonical preview identity. */
  cacheKey: string;
  /** Exact Rust-canonical `DevelopRecipeV2` JSON represented by `identity.recipeDigest`. */
  recipeJson: string;
}

/** A named develop snapshot (per photo; survives restart). */
export interface SnapshotRow {
  id: number;
  photoId: number;
  name: string;
  recipeJson: string;
  processVersion: number | null;
  createdAt: number;
}

/** A keyword in the catalog vocabulary (flat for now). */
export interface KeywordRow {
  id: number;
  name: string;
}

/** A collection tree node: a manual collection, a set (folder), or a smart
 *  collection whose members are computed from `ruleAst` (§3.3). */
export interface CollectionRow {
  id: number;
  name: string;
  /** "collection" | "set" | "smart". */
  kind: string;
  parentId: number | null;
  /** Smart rule JSON, or a system marker for reserved manual collections. */
  ruleAst: string | null;
  sortOrder: number;
  createdAt: number;
}

/** A smart-collection rule group: match mode + criteria and/or nested groups
 *  (LR's mixed AND/OR nesting). Compiled to SQL server-side (catalog.rs);
 *  fields are whitelisted there. */
export interface SmartRule {
  match: "all" | "any";
  rules: SmartNode[];
}

/** A rule-list entry: a criterion or a nested group. */
export type SmartNode = SmartCriterion | SmartRule;

export interface SmartCriterion {
  /** A field whitelisted by compile_criterion in catalog.rs (rating, flag,
   *  keyword, camera, folder, byteSize, megapixels, hasGps, creator, …). */
  field: string;
  /** eq | ne | gt | lt | gte | lte | contains | notContains | startsWith |
   *  endsWith | empty | notEmpty | before | after | inLast. */
  op: string;
  value: string | number | boolean | null;
}

/** A global develop preset — a saved recipe applied to photos. */
export interface PresetRow {
  id: number;
  name: string;
  recipeJson: string;
  processVersion: number | null;
  createdAt: number;
}

/** One auto-recorded develop history step (per photo, newest first). */
export interface HistoryRow {
  id: number;
  photoId: number;
  label: string;
  recipeJson: string;
  processVersion: number | null;
  createdAt: number;
}

/** A source asset's identity for folder sync (path + on-disk-missing flag). */
export interface SourcePathRow {
  sourceAssetId: number;
  path: string;
  missing: boolean;
}

/** Flag/rating/label state a culling action sets (full desired state). */
export interface FlagState {
  rating: number;
  flag: number;
  colorLabel?: string | null;
}

/** A vocabulary keyword with its photo usage count (Keyword List panel). */
export interface KeywordCountRow {
  id: number;
  name: string;
  count: number;
}
