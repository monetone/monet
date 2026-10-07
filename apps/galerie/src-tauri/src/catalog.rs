//! Galerie catalog — the SQLite spine (`.galcat`).
//!
//! A Lightroom-class catalog: a normalized, indexed database that tracks source
//! files, photos (+ virtual copies), their metadata, the non-destructive develop
//! recipe, collections, and on-disk preview-cache records — but never pixels.
//!
//! Two layers:
//!   * `db` — pure functions over a `rusqlite::Connection` (schema + queries).
//!     No Tauri, so they're unit-tested directly against an in-memory database.
//!   * the Tauri commands — thin wrappers that lock the open connection (held in
//!     managed [`CatalogState`]) and call `db`.
//!
//! The generic SQLite plumbing under both — open + pragmas,
//! integrity/optimize/backup, the digest helpers, the state guard — lives in
//! `monet-db`, the shared library every Monet app's database goes through
//! (design doc 11). What is here is photos.
//!
//! Exposed as a gated plugin ("catalog") so it registers its own invoke handler
//! alongside monet_ui's — Tauri allows only one app-level `invoke_handler`, but
//! any number of namespaced plugins (`plugin:catalog|list_photos`), mirroring
//! Vision's `c2pa` plugin.
//!
//! The schema is one CREATE batch stamped `schema_meta.version` =
//! [`SCHEMA_VERSION`]; a catalog carrying any other stamp is refused, not
//! upgraded.
use std::time::{SystemTime, UNIX_EPOCH};
#[cfg(target_os = "macos")]
use std::{
    ffi::CString,
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    os::fd::{AsRawFd, FromRawFd},
    os::unix::{ffi::OsStrExt, fs::MetadataExt},
    path::{Path, PathBuf},
};

use monet_db::{escape_like, sha256_hex};
use monet_photo_core::{
    build_preview_identity, build_render_provenance, preview_identity_digest,
    validate_render_provenance, PreviewIdentityFactsV2, PreviewIdentityV2, RenderProvenanceV2,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
// The managed-DNG import hashes while it stream-copies, so it drives the hasher
// itself rather than going through monet-db's whole-file `digest_file`.
#[cfg(target_os = "macos")]
use sha2::{Digest, Sha256};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Emitter, Manager, Runtime, State, WebviewWindow};

/// The open catalog connection (one per app session). `None` until `open` —
/// the shared `Mutex<Option<Connection>>` guard, named for what Galerie holds.
pub use monet_db::DbState as CatalogState;

const SCHEMA_VERSION: i64 = 16;

/// Unix seconds now (source-asset import time / photo add time).
fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// ─────────────────────────────────────────────────────────────
// Wire types (camelCase across the IPC boundary)
// ─────────────────────────────────────────────────────────────

/// One physical file + the photo to create from it. The import pipeline decodes
/// + fingerprints the file (Phase 1) and hands the catalog the finished record;
/// the catalog itself never touches pixels.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPhoto {
    /// Absolute path to the source file on disk.
    pub path: String,
    /// Content fingerprint (import-computed digest) — duplicate identity.
    pub fingerprint: String,
    /// e.g. `"raw:CR3"`, `"jpeg"`, `"dng"`.
    pub format: String,
    pub byte_size: i64,
    /// Source file mtime, unix seconds.
    pub mtime: i64,
    pub width: i64,
    pub height: i64,
    /// EXIF orientation 1–8.
    #[serde(default = "one")]
    pub orientation: i64,
    /// Capture time (unix seconds) from EXIF; `None` if unknown.
    pub capture_time: Option<i64>,
    // Normalized, indexable metadata (never an opaque EXIF blob).
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub lens: Option<String>,
    pub iso: Option<i64>,
    pub f_number: Option<f64>,
    pub focal_length: Option<f64>,
    /// Shutter speed in seconds (UI formats `0.005` → `"1/200"`).
    pub exposure_time: Option<f64>,
    pub gps_lat: Option<f64>,
    pub gps_lon: Option<f64>,
}

fn one() -> i64 {
    1
}

/// A catalog photo joined with its source asset — the grid/filmstrip row.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PhotoRow {
    pub id: i64,
    pub source_asset_id: i64,
    pub path: String,
    pub read_path: String,
    pub format: String,
    pub is_virtual_copy: bool,
    pub orientation: i64,
    pub rating: i64,
    /// -1 reject, 0 unflagged, 1 pick.
    pub flag: i64,
    pub color_label: Option<String>,
    pub capture_time: Option<i64>,
    pub added_time: i64,
    pub width: i64,
    pub height: i64,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub lens: Option<String>,
    pub iso: Option<i64>,
    pub f_number: Option<f64>,
    pub focal_length: Option<f64>,
    pub exposure_time: Option<f64>,
    pub gps_lat: Option<f64>,
    pub gps_lon: Option<f64>,
    pub has_recipe: bool,
    pub process_version: Option<i64>,
    /// Virtual-copy label ("Copy 1", …); `None` for masters.
    pub copy_name: Option<String>,
    /// LR-style stack group; `None` = unstacked.
    pub stack_id: Option<i64>,
    /// Position within the stack; 0 = cover. `None` = unstacked.
    pub stack_order: Option<i64>,
    /// Number of members in this photo's stack; 1 when unstacked.
    pub stack_count: i64,
    /// The source file is flagged gone from disk (folder sync).
    pub missing: bool,
    /// Editable IPTC metadata; flattened so the row's JSON shape is unchanged.
    #[serde(flatten)]
    pub iptc: PhotoIptc,
}

/// The photo table's editable IPTC columns — LR's Metadata ▸ IPTC view, in
/// panel order. Kept as one struct (not positional arguments) because the set
/// is the thing that grows: the writer, the `SELECT`, the row mapper and the
/// IPC command all read this list, so a new field is a handful of lines rather
/// than a 26th argument threaded through five signatures.
///
/// `None` = absent. Blank input normalizes to `None` on write, so a cleared
/// field reads back as absent rather than "".
// ponytail: flat `TEXT` columns, no IPTC Extension set (Artwork, Model
// Release, Person Shown, …) and no repeated values — LR's Extension view would
// want its own child table; add it there if agency workflows need it.
#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PhotoIptc {
    pub title: Option<String>,
    pub caption: Option<String>,
    pub headline: Option<String>,
    pub instructions: Option<String>,
    pub creator: Option<String>,
    pub job_title: Option<String>,
    pub credit: Option<String>,
    pub source: Option<String>,
    // Creator contact block (IPTC Core `Iptc4xmpCore:CreatorContactInfo`).
    pub creator_address: Option<String>,
    pub creator_city: Option<String>,
    pub creator_state_province: Option<String>,
    pub creator_postal_code: Option<String>,
    pub creator_country: Option<String>,
    pub creator_phone: Option<String>,
    pub creator_email: Option<String>,
    pub creator_website: Option<String>,
    // Location cluster, coarse-to-fine (what a Private saved location strips).
    pub sublocation: Option<String>,
    pub city: Option<String>,
    pub state_province: Option<String>,
    pub country: Option<String>,
    pub iso_country_code: Option<String>,
    // Rights cluster.
    pub copyright: Option<String>,
    /// `None` = Unknown; otherwise `"copyrighted"` or `"publicDomain"`. Any
    /// other value is rejected on write (see [`db::set_photo_metadata`]).
    pub copyright_status: Option<String>,
    pub rights_usage_terms: Option<String>,
    pub copyright_info_url: Option<String>,
}

/// The two non-Unknown IPTC copyright states (`xmpRights:Marked`). Anything
/// else an IPC caller sends normalizes to `None` = Unknown.
const COPYRIGHT_STATUSES: [&str; 2] = ["copyrighted", "publicDomain"];

/// A source asset's identity for folder-sync (the frontend stats these paths to
/// detect on-disk-missing files, without a photo join).
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourcePathRow {
    pub source_asset_id: i64,
    pub path: String,
    pub missing: bool,
}

/// A vocabulary keyword with its photo usage count plus its tree position,
/// synonyms and LR export flags (Keyword List panel + Keyword Tag dialog).
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeywordCountRow {
    pub id: i64,
    pub name: String,
    pub count: i64,
    pub parent_id: Option<i64>,
    /// Comma-separated synonym list (LR's Synonyms field verbatim).
    pub synonyms: String,
    pub include_on_export: bool,
    pub export_containing: bool,
    pub export_synonyms: bool,
}

/// A source folder with its master-photo count (Folders panel).
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FolderRow {
    pub path: String,
    pub count: i64,
}

/// One distinct metadata value with its master-photo count (Filter bar).
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OptionCount {
    pub value: String,
    pub count: i64,
}

/// The Filter bar's Metadata browser: one option list per column, keyed by
/// column id (see [`META_COLUMNS`]). A `BTreeMap` so the wire order is stable.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilterOptions {
    pub columns: std::collections::BTreeMap<String, Vec<OptionCount>>,
}

/// The Metadata browser's columns (LR's Library Filter ▸ Metadata tab): column
/// id → the SQL expression yielding that column's value, over the standard
/// `photo p JOIN source_asset s` relation every grid query uses. The id is the
/// wire contract shared with `src/catalog/types.ts` (`META_COLUMNS`);
/// `metaColumns.test.ts` fails if the two lists drift.
///
/// `keyword` is deliberately absent — keywords live in a join table and need an
/// `EXISTS`, handled separately below.
// ponytail: no Camera Serial / Flash State columns — neither value is stored on
// `photo`; extract them in the EXIF reader first, then add a row here. Date is
// three flat columns (year / month / day) rather than LR's one nested
// drill-down; a real tree wants a hierarchical option payload.
const META_COLUMNS: &[(&str, &str)] = &[
    ("camera", "p.camera_model"),
    ("make", "p.camera_make"),
    ("lens", "p.lens"),
    ("label", "p.color_label"),
    ("filetype", "s.format"),
    ("creator", "p.creator"),
    ("copyright", "p.copyright_status"),
    ("iso", "CAST(p.iso AS TEXT)"),
    ("aperture", "'f/' || printf('%g', p.f_number)"),
    (
        "shutter",
        "CASE WHEN p.exposure_time >= 1 THEN printf('%g s', p.exposure_time) \
         ELSE '1/' || CAST(ROUND(1.0 / p.exposure_time) AS INTEGER) END",
    ),
    ("focal", "printf('%g mm', p.focal_length)"),
    (
        "aspect",
        "CASE WHEN p.width > p.height THEN 'Landscape' \
         WHEN p.width < p.height THEN 'Portrait' ELSE 'Square' END",
    ),
    (
        "gps",
        "CASE WHEN p.gps_lat IS NOT NULL AND p.gps_lon IS NOT NULL \
         THEN 'With GPS' ELSE 'Without GPS' END",
    ),
    // Folder = the source path's directory. `rtrim(path, path-without-slashes)`
    // strips the trailing run of non-separator chars (the basename); the outer
    // rtrim drops the separator. Backslashes normalize first so Windows-style
    // paths bucket with POSIX ones.
    (
        "folder",
        r"RTRIM(RTRIM(REPLACE(s.path, '\', '/'), REPLACE(REPLACE(s.path, '\', '/'), '/', '')), '/')",
    ),
    ("year", "strftime('%Y', p.capture_time, 'unixepoch')"),
    ("month", "strftime('%Y-%m', p.capture_time, 'unixepoch')"),
    ("day", "strftime('%Y-%m-%d', p.capture_time, 'unixepoch')"),
];

/// The one Metadata-browser column backed by a join table, not a `photo`
/// expression.
const META_KEYWORD: &str = "keyword";

/// Date columns list newest-first (LR); every other column sorts by value.
const META_DATE_COLUMNS: [&str; 3] = ["year", "month", "day"];

fn meta_column_expr(id: &str) -> Option<&'static str> {
    META_COLUMNS
        .iter()
        .find(|(k, _)| *k == id)
        .map(|(_, expr)| *expr)
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DevelopExportIdentity {
    pub catalog_id: String,
    pub photo: PhotoRow,
    pub source_digest: String,
    pub canonical_recipe_json: String,
}

/// Keyset-pagination cursor: the `(sortTime, id)` of the last returned row.
/// `sortTime` = capture time when known, else add time (both non-null) so the
/// order is total and the index is usable — see `photo.sort_time`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Cursor {
    /// Sort value for the numeric keys (capture/added/rating/flag).
    pub sort_time: i64,
    /// Sort value for text keys (filename/label/file type); `None` for numeric keys.
    #[serde(default)]
    pub sort_text: Option<String>,
    pub id: i64,
}

/// A page of photos + the cursor to fetch the next page (`None` when exhausted).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoPage {
    pub photos: Vec<PhotoRow>,
    pub next: Option<Cursor>,
}

/// The Library filter (rating floor + optional flag + optional color label). All
/// filters are on `photo` columns, so they compose into the paginated query and
/// its count on the same indexes.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoFilter {
    #[serde(default)]
    pub min_rating: i64,
    /// `None` = any; `Some(1)` picks, `Some(0)` unflagged, `Some(-1)` rejects.
    #[serde(default)]
    pub flag: Option<i64>,
    /// `None` = any; `Some("red"|…)` exact color-label match.
    #[serde(default)]
    pub color_label: Option<String>,
    /// `None`/blank = any; else a case-insensitive substring of the source path
    /// (filename search), matched with `s.path LIKE %text%`.
    #[serde(default)]
    pub text: Option<String>,
    /// `None`/blank = any; else only photos whose source file sits under this
    /// directory (prefix match — subfolders included, Folders panel).
    #[serde(default)]
    pub folder: Option<String>,
    /// Folders panel "Show Photos in Subfolders" OFF: restrict `folder` to
    /// direct children (no further separator after the prefix).
    #[serde(default)]
    pub folder_only: bool,
    /// Where the text filter searches: "path" (default) | "title" | "caption" |
    /// "keywords" | "any" (any searchable field).
    #[serde(default)]
    pub text_target: Option<String>,
    /// Rating comparison: ">=" (default) | "=" | "<=".
    #[serde(default)]
    pub rating_op: Option<String>,
    /// `None` = any; else exact camera-model match (Filter bar Metadata mode).
    #[serde(default)]
    pub camera: Option<String>,
    /// `None` = any; else exact lens match.
    #[serde(default)]
    pub lens: Option<String>,
    /// `None` = any; else photos captured in this calendar year (UTC).
    #[serde(default)]
    pub year: Option<i64>,
    /// The Metadata browser's per-column selections (LR's Filter bar Metadata
    /// tab): column id → the chosen values. Any-of within a column, AND across
    /// columns. An empty list or an unknown column id is ignored, so a stored
    /// preset survives the column set changing under it.
    #[serde(default)]
    pub meta: Option<std::collections::BTreeMap<String, Vec<String>>>,
    /// `true` = LR's "Expand All Stacks": list every stack member in place
    /// instead of collapsing each stack to its cover. Default `false`.
    /// ponytail: members follow the grid sort (burst members sit together by
    /// capture time, id tiebreak), not strict stack_order adjacency — add a
    /// stack-aware ORDER BY if mixed sorts ever need members glued to covers.
    #[serde(default)]
    pub expand_stacks: bool,
}

/// Which column the Library grid sorts on. Each maps to one persisted catalog
/// value carried by the numeric or text half of the keyset cursor.
#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SortKey {
    /// Capture time, falling back to import time — `photo.sort_time`.
    #[default]
    Capture,
    /// Import order — `photo.added_time`.
    Added,
    /// Star rating (0–5) — `photo.rating`.
    Rating,
    /// Pick/reject flag (-1/0/1) — `photo.flag`.
    Flag,
    /// Color-label text — `photo.color_label`.
    Label,
    /// Source path, case-insensitive — `source_asset.path`. (Path order, which
    /// equals filename order for a single-folder import — the common case.)
    Filename,
    /// Source format — `source_asset.format`.
    Filetype,
    /// Frame shape, widest first when descending — `width/height`.
    Aspect,
    /// Newest develop history step, 0 for never-edited — `history_step`.
    EditTime,
    /// Number of develop history steps — `history_step`.
    EditCount,
    /// Manual collection order — `collection_photo.position`. Outside a manual
    /// collection this safely falls back to capture time.
    User,
}

/// A Library grid sort: key + direction. `Default` is capture time newest-first —
/// the historical fixed order, so `list_photos` stays byte-compatible.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GridSort {
    #[serde(default)]
    pub key: SortKey,
    #[serde(default)]
    pub ascending: bool,
}

impl Default for GridSort {
    fn default() -> Self {
        Self {
            key: SortKey::Capture,
            ascending: false,
        }
    }
}

/// An on-disk preview-cache record (the file itself lives under the cache dir).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRecord {
    pub photo_id: i64,
    /// `"thumbnail" | "standard" | "one_to_one" | "smart"`.
    pub kind: String,
    /// Digest of source+decoder+recipe+masks+profile+renderer+dims (§3.4).
    pub cache_key: String,
    pub width: i64,
    pub height: i64,
    /// Path to the cached image, relative to the preview-cache root.
    pub file_path: String,
    pub renderer_revision: i64,
    pub byte_size: i64,
    pub identity_json: String,
    pub provenance_json: String,
    pub content_digest: String,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRow {
    pub id: i64,
    pub photo_id: i64,
    pub kind: String,
    pub cache_key: String,
    pub width: i64,
    pub height: i64,
    pub file_path: String,
    pub renderer_revision: i64,
    pub byte_size: i64,
    pub created_at: i64,
    pub identity_json: Option<String>,
    pub provenance_json: Option<String>,
    pub content_digest: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewRead {
    bytes: Option<Vec<u8>>,
    diagnostic: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewRequestV2 {
    identity: PreviewIdentityV2,
    cache_key: String,
    recipe_json: String,
}

impl PreviewRead {
    fn miss(diagnostic: Option<String>) -> Self {
        Self {
            bytes: None,
            diagnostic,
        }
    }
}

/// A named develop snapshot: the full recipe frozen under a user-given name, per
/// photo (virtual copies are separate photo rows). Survives restart (Phase 2).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRow {
    pub id: i64,
    pub photo_id: i64,
    pub name: String,
    pub recipe_json: String,
    pub process_version: Option<i64>,
    pub created_at: i64,
}

/// A keyword applied to a photo (leaf identity; the tree lives in
/// [`KeywordCountRow`]).
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeywordRow {
    pub id: i64,
    pub name: String,
}

/// A collection tree node: a manual `collection`, a `set` (folder of nodes), or
/// a `smart` collection whose members are computed from `rule_ast` (§3.3).
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CollectionRow {
    pub id: i64,
    pub name: String,
    /// `"collection" | "set" | "smart"`.
    pub kind: String,
    pub parent_id: Option<i64>,
    /// Smart-collection rule AST (JSON); `None` for manual collections/sets.
    pub rule_ast: Option<String>,
    pub sort_order: i64,
    pub created_at: i64,
}

/// One auto-recorded develop history step (per photo, newest = highest id).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRow {
    pub id: i64,
    pub photo_id: i64,
    pub label: String,
    pub recipe_json: String,
    pub process_version: Option<i64>,
    pub created_at: i64,
}

/// A global develop preset: a saved DevelopRecipeV2 applied to photos.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PresetRow {
    pub id: i64,
    pub name: String,
    pub recipe_json: String,
    pub process_version: Option<i64>,
    pub created_at: i64,
}

/// A metadata preset: the IPTC fields it owns, applied to a selection.
///
/// `fields` is LR's per-field checkbox state as one JSON object — a key that is
/// PRESENT is written by the preset (an empty string clears the photo's value),
/// an ABSENT key leaves the photo alone. Keys are the camelCase `PhotoIptc`
/// names plus `keywords` (a string array). The shape is owned by the frontend
/// (`MetadataPresetFields` in ui/MetadataPresets.tsx); SQLite only ever stores
/// and returns it, so there is no field list to keep in sync here.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MetadataPresetRow {
    pub id: i64,
    pub name: String,
    /// ponytail: a projection of `fields` kept so the narrow creator/copyright
    /// apply path in state/store.ts keeps working; drop both once that path
    /// reads `fields`.
    pub creator: Option<String>,
    pub copyright: Option<String>,
    pub fields: serde_json::Value,
    pub created_at: i64,
}

// ─────────────────────────────────────────────────────────────
// db — pure SQLite logic (no Tauri; unit-tested directly)
// ─────────────────────────────────────────────────────────────

pub mod db {
    use super::*;

    /// The catalog schema, as one CREATE batch. Alpha has no older catalogs to
    /// upgrade, so there is no migration runner and no version dispatch — [`open`]
    /// either finds this exact shape or refuses the file.
    const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- A physical file on disk. `path` is unique; `fingerprint` finds duplicates.
CREATE TABLE IF NOT EXISTS source_asset (
  id               INTEGER PRIMARY KEY,
  path             TEXT NOT NULL UNIQUE,
  fingerprint      TEXT NOT NULL,
  format           TEXT NOT NULL,
  byte_size        INTEGER NOT NULL,
  mtime            INTEGER NOT NULL,
  imported_at      INTEGER NOT NULL,
  -- Immutable managed-DNG identity + the retained source-file identity.
  managed_path     TEXT,
  dng_class        TEXT,
  dng_ifd_evidence TEXT,
  source_device    INTEGER,
  source_inode     INTEGER,
  source_mtime_ns  INTEGER,
  source_ctime_ns  INTEGER,
  -- Folder sync: the file is flagged gone from disk.
  missing          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_source_fingerprint ON source_asset(fingerprint);

-- A catalog photo: a master (is_virtual_copy=0) or a virtual copy of one.
-- Normalized metadata columns (indexable) — never an opaque EXIF blob.
-- develop_recipe holds the canonical DevelopRecipeV2 JSON (null until edited);
-- float buffers/LUTs are derived caches, never stored here.
CREATE TABLE IF NOT EXISTS photo (
  id              INTEGER PRIMARY KEY,
  source_asset_id INTEGER NOT NULL REFERENCES source_asset(id) ON DELETE CASCADE,
  is_virtual_copy INTEGER NOT NULL DEFAULT 0,
  master_photo_id INTEGER REFERENCES photo(id) ON DELETE CASCADE,
  copy_name       TEXT,
  orientation     INTEGER NOT NULL DEFAULT 1,
  rating          INTEGER NOT NULL DEFAULT 0,
  flag            INTEGER NOT NULL DEFAULT 0,
  color_label     TEXT,
  capture_time    INTEGER,
  added_time      INTEGER NOT NULL,
  -- capture_time when known, else added_time: non-null total sort key.
  sort_time       INTEGER NOT NULL,
  width           INTEGER NOT NULL,
  height          INTEGER NOT NULL,
  camera_make     TEXT,
  camera_model    TEXT,
  lens            TEXT,
  iso             INTEGER,
  f_number        REAL,
  focal_length    REAL,
  exposure_time   REAL,
  gps_lat         REAL,
  gps_lon         REAL,
  develop_recipe  TEXT,
  process_version INTEGER,
  -- Editable IPTC metadata (LR's Metadata ▸ IPTC view). See PhotoIptc.
  title           TEXT,
  caption         TEXT,
  creator         TEXT,
  copyright       TEXT,
  city            TEXT,
  state_province  TEXT,
  country         TEXT,
  job_title       TEXT,
  credit          TEXT,
  source          TEXT,
  headline        TEXT,
  instructions    TEXT,
  sublocation     TEXT,
  iso_country_code TEXT,
  -- NULL = Unknown; else 'copyrighted' | 'publicDomain'.
  copyright_status TEXT,
  rights_usage_terms TEXT,
  copyright_info_url TEXT,
  creator_address  TEXT,
  creator_city     TEXT,
  creator_state_province TEXT,
  creator_postal_code    TEXT,
  creator_country  TEXT,
  creator_phone    TEXT,
  creator_email    TEXT,
  creator_website  TEXT,
  -- LR-style stacking (cover = stack_order 0); NULL = unstacked.
  stack_id        INTEGER,
  stack_order     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_photo_source   ON photo(source_asset_id);
CREATE INDEX IF NOT EXISTS idx_photo_master   ON photo(master_photo_id);
CREATE INDEX IF NOT EXISTS idx_photo_rating   ON photo(rating);
CREATE INDEX IF NOT EXISTS idx_photo_flag     ON photo(flag);
CREATE INDEX IF NOT EXISTS idx_photo_label    ON photo(color_label);
CREATE INDEX IF NOT EXISTS idx_photo_stack    ON photo(stack_id);
-- Keyset pagination. `grid_order` emits "<expr> <dir>, p.id <dir>" — one
-- direction for both columns — and SQLite implicitly appends the rowid to every
-- index, which for this table IS `id` (INTEGER PRIMARY KEY). So the
-- single-column indexes above already serve their sort's `p.id` tiebreak in
-- BOTH directions; only a key with no index at all needed one adding.
-- Verified by `photo_only_grid_sorts_are_index_served_not_filesorted`.
CREATE INDEX IF NOT EXISTS idx_photo_sort     ON photo(sort_time DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_photo_added    ON photo(added_time);
-- ponytail: the Filename/File Type/Label sorts order by a joined
-- `source_asset` column (`s.path COLLATE NOCASE`) with a `p.id` tiebreak, which
-- no single-table index can cover — they still filesort. Fixing that needs a
-- denormalised sort column on `photo`, not another index.

-- Collections / sets / smart collections. `rule_ast` = smart JSON or a system marker.
CREATE TABLE IF NOT EXISTS collection (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL,            -- 'collection' | 'set' | 'smart'
  parent_id  INTEGER REFERENCES collection(id) ON DELETE CASCADE,
  rule_ast   TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collection_parent ON collection(parent_id);
CREATE INDEX IF NOT EXISTS idx_collection_kind   ON collection(kind);

CREATE TABLE IF NOT EXISTS collection_photo (
  collection_id INTEGER NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
  photo_id      INTEGER NOT NULL REFERENCES photo(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, photo_id)
);
CREATE INDEX IF NOT EXISTS idx_colphoto_photo ON collection_photo(photo_id);

-- On-disk preview/cache records. The keyed cache; one row per (photo, kind, key).
-- identity/provenance/content_digest carry the shared-core identity (§3.4) and
-- the corruption check.
CREATE TABLE IF NOT EXISTS preview (
  id                INTEGER PRIMARY KEY,
  photo_id          INTEGER NOT NULL REFERENCES photo(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL,
  cache_key         TEXT NOT NULL,
  width             INTEGER NOT NULL,
  height            INTEGER NOT NULL,
  file_path         TEXT NOT NULL,
  renderer_revision INTEGER NOT NULL,
  byte_size         INTEGER NOT NULL,
  created_at        INTEGER NOT NULL,
  identity_json     TEXT,
  provenance_json   TEXT,
  content_digest    TEXT,
  UNIQUE (photo_id, kind, cache_key)
);
CREATE INDEX IF NOT EXISTS idx_preview_photo ON preview(photo_id);

-- Named develop snapshots (per photo).
CREATE TABLE IF NOT EXISTS snapshot (
  id              INTEGER PRIMARY KEY,
  photo_id        INTEGER NOT NULL REFERENCES photo(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  recipe_json     TEXT NOT NULL,
  process_version INTEGER,
  created_at      INTEGER NOT NULL,
  UNIQUE (photo_id, name)
);
CREATE INDEX IF NOT EXISTS idx_snapshot_photo ON snapshot(photo_id);

-- Auto-recorded develop history steps (per photo, id-ordered).
CREATE TABLE IF NOT EXISTS history_step (
  id              INTEGER PRIMARY KEY,
  photo_id        INTEGER NOT NULL REFERENCES photo(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  recipe_json     TEXT NOT NULL,
  process_version INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_photo ON history_step(photo_id, id);

-- The keyword vocabulary (a tree via parent_id) + photo↔keyword join. Synonyms
-- are a comma-separated list; the three export flags mirror LR's Keyword Tag
-- dialog (finding 16). Deleting a parent cascades its whole subtree away.
-- ponytail: name stays globally UNIQUE (LR allows the same name under different
-- parents; lifting that needs UNIQUE(parent_id, name) + path-aware upserts).
CREATE TABLE IF NOT EXISTS keyword (
  id                INTEGER PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,
  parent_id         INTEGER REFERENCES keyword(id) ON DELETE CASCADE,
  synonyms          TEXT NOT NULL DEFAULT '',
  include_on_export INTEGER NOT NULL DEFAULT 1,
  export_containing INTEGER NOT NULL DEFAULT 1,
  export_synonyms   INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS photo_keyword (
  photo_id   INTEGER NOT NULL REFERENCES photo(id) ON DELETE CASCADE,
  keyword_id INTEGER NOT NULL REFERENCES keyword(id) ON DELETE CASCADE,
  PRIMARY KEY (photo_id, keyword_id)
);
CREATE INDEX IF NOT EXISTS idx_photo_keyword_kw ON photo_keyword(keyword_id);

-- Global develop presets (a saved DevelopRecipeV2 applied to photos).
CREATE TABLE IF NOT EXISTS preset (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  recipe_json     TEXT NOT NULL,
  process_version INTEGER,
  created_at      INTEGER NOT NULL
);

-- Metadata presets (the IPTC fields a preset writes, applied in bulk).
-- `fields_json` is the whole per-field checkbox map — see `MetadataPresetRow`.
CREATE TABLE IF NOT EXISTS metadata_preset (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  fields_json TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
"#;

    /// Open/create the catalog at `path` (":memory:" in tests) and ensure the
    /// schema. A file stamped with a different [`SCHEMA_VERSION`] is REFUSED, not
    /// upgraded: alpha keeps no backwards compatibility, so the answer to an old
    /// `.galcat` is to delete it and re-import.
    pub fn open(path: &str) -> Result<Connection, String> {
        let conn = monet_db::open(path).map_err(|e| e.to_string())?;
        // Errs (no such table) on a fresh file — that is the `None` case.
        let stamped: Option<i64> = conn
            .query_row(
                "SELECT CAST(value AS INTEGER) FROM schema_meta WHERE key='version'",
                [],
                |r| r.get(0),
            )
            .ok();
        if let Some(found) = stamped.filter(|v| *v != SCHEMA_VERSION) {
            return Err(format!(
                "catalog is schema v{found}, this build writes v{SCHEMA_VERSION} — \
                 there is no upgrade path; delete the catalog and re-import"
            ));
        }
        conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO schema_meta(key, value) VALUES('version', ?1)
             ON CONFLICT(key) DO NOTHING",
            params![SCHEMA_VERSION.to_string()],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn)
    }

    /// The catalog's schema stamp — a plain identity, not a migration cursor.
    pub fn version(conn: &Connection) -> rusqlite::Result<i64> {
        conn.query_row(
            "SELECT CAST(value AS INTEGER) FROM schema_meta WHERE key='version'",
            [],
            |r| r.get(0),
        )
    }

    /// Upsert the source asset (by path) and ensure its master photo exists.
    /// Idempotent: re-importing the same file returns the existing photo id
    /// (duplicate identity) rather than creating a second master.
    pub fn import_photo(conn: &Connection, p: &ImportPhoto) -> rusqlite::Result<i64> {
        let now = now_secs();
        let source_id: i64 = conn.query_row(
            "INSERT INTO source_asset(path, fingerprint, format, byte_size, mtime, imported_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(path) DO UPDATE SET
               fingerprint=excluded.fingerprint,
               format=excluded.format,
               byte_size=excluded.byte_size,
               mtime=excluded.mtime,
               missing=0
             RETURNING id",
            params![p.path, p.fingerprint, p.format, p.byte_size, p.mtime, now],
            |r| r.get(0),
        )?;

        if let Some(existing) = conn
            .query_row(
                "SELECT id FROM photo WHERE source_asset_id=?1 AND is_virtual_copy=0",
                params![source_id],
                |r| r.get::<_, i64>(0),
            )
            .optional()?
        {
            // Master already catalogued. Reconcile file-derived metadata (the source
            // may have changed on disk — mtime/fingerprint were just refreshed above)
            // but never touch user data: rating/flag/color_label/develop_recipe stay.
            // sort_time follows capture_time when known, else keeps its prior value.
            // GPS is COALESCEd: EXIF wins when the file carries a coordinate, but a
            // file with none must not null a manual geotag (LR keeps user-set GPS).
            conn.execute(
                "UPDATE photo SET
                   orientation=?2, capture_time=?3, sort_time=COALESCE(?3, sort_time),
                   width=?4, height=?5, camera_make=?6, camera_model=?7, lens=?8,
                   iso=?9, f_number=?10, focal_length=?11, exposure_time=?12,
                   gps_lat=COALESCE(?13, gps_lat), gps_lon=COALESCE(?14, gps_lon)
                 WHERE id=?1",
                params![
                    existing,
                    p.orientation,
                    p.capture_time,
                    p.width,
                    p.height,
                    p.camera_make,
                    p.camera_model,
                    p.lens,
                    p.iso,
                    p.f_number,
                    p.focal_length,
                    p.exposure_time,
                    p.gps_lat,
                    p.gps_lon,
                ],
            )?;
            return Ok(existing);
        }

        let sort_time = p.capture_time.unwrap_or(now);
        conn.execute(
            "INSERT INTO photo(
               source_asset_id, orientation, added_time, sort_time, capture_time,
               width, height, camera_make, camera_model, lens, iso, f_number,
               focal_length, exposure_time, gps_lat, gps_lon)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
            params![
                source_id,
                p.orientation,
                now,
                sort_time,
                p.capture_time,
                p.width,
                p.height,
                p.camera_make,
                p.camera_model,
                p.lens,
                p.iso,
                p.f_number,
                p.focal_length,
                p.exposure_time,
                p.gps_lat,
                p.gps_lon,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// The `SELECT` column list + row mapper shared by list/get.
    const PHOTO_COLS: &str = "p.id, p.source_asset_id, s.path, COALESCE(s.managed_path, s.path), s.format, p.is_virtual_copy,
        p.orientation, p.rating, p.flag, p.color_label, p.capture_time, p.added_time,
        p.width, p.height, p.camera_make, p.camera_model, p.lens, p.iso, p.f_number,
        p.focal_length, p.exposure_time, p.gps_lat, p.gps_lon,
        (p.develop_recipe IS NOT NULL) AS has_recipe, p.process_version, p.sort_time,
        p.copy_name, p.title, p.caption, p.creator, p.copyright,
        p.stack_id, p.stack_order,
        CASE WHEN p.stack_id IS NULL THEN 1
             ELSE (SELECT COUNT(*) FROM photo m WHERE m.stack_id = p.stack_id) END AS stack_count,
        COALESCE(s.missing, 0) AS missing,
        p.city, p.state_province, p.country, p.job_title, p.credit, p.source,
        p.headline, p.instructions, p.sublocation, p.iso_country_code,
        p.copyright_status, p.rights_usage_terms, p.copyright_info_url,
        p.creator_address, p.creator_city, p.creator_state_province,
        p.creator_postal_code, p.creator_country, p.creator_phone,
        p.creator_email, p.creator_website";

    fn map_photo(row: &rusqlite::Row) -> rusqlite::Result<PhotoRow> {
        Ok(PhotoRow {
            id: row.get(0)?,
            source_asset_id: row.get(1)?,
            path: row.get(2)?,
            read_path: row.get(3)?,
            format: row.get(4)?,
            is_virtual_copy: row.get::<_, i64>(5)? != 0,
            orientation: row.get(6)?,
            rating: row.get(7)?,
            flag: row.get(8)?,
            color_label: row.get(9)?,
            capture_time: row.get(10)?,
            added_time: row.get(11)?,
            width: row.get(12)?,
            height: row.get(13)?,
            camera_make: row.get(14)?,
            camera_model: row.get(15)?,
            lens: row.get(16)?,
            iso: row.get(17)?,
            f_number: row.get(18)?,
            focal_length: row.get(19)?,
            exposure_time: row.get(20)?,
            gps_lat: row.get(21)?,
            gps_lon: row.get(22)?,
            has_recipe: row.get::<_, i64>(23)? != 0,
            process_version: row.get(24)?,
            // index 25 = sort_time.
            copy_name: row.get(26)?,
            stack_id: row.get(31)?,
            stack_order: row.get(32)?,
            stack_count: row.get(33)?,
            missing: row.get::<_, i64>(34)? != 0,
            iptc: PhotoIptc {
                title: row.get(27)?,
                caption: row.get(28)?,
                creator: row.get(29)?,
                copyright: row.get(30)?,
                city: row.get(35)?,
                state_province: row.get(36)?,
                country: row.get(37)?,
                job_title: row.get(38)?,
                credit: row.get(39)?,
                source: row.get(40)?,
                headline: row.get(41)?,
                instructions: row.get(42)?,
                sublocation: row.get(43)?,
                iso_country_code: row.get(44)?,
                copyright_status: row.get(45)?,
                rights_usage_terms: row.get(46)?,
                copyright_info_url: row.get(47)?,
                creator_address: row.get(48)?,
                creator_city: row.get(49)?,
                creator_state_province: row.get(50)?,
                creator_postal_code: row.get(51)?,
                creator_country: row.get(52)?,
                creator_phone: row.get(53)?,
                creator_email: row.get(54)?,
                creator_website: row.get(55)?,
            },
        })
    }

    /// Build the filter's WHERE fragment (over `p`) + its bound values, in order.
    /// Unless `expand_stacks` is set, collapses stacks to their cover (LR
    /// semantics): a non-cover stack member is never listed or counted on its own.
    fn filter_where(f: &PhotoFilter) -> (String, Vec<rusqlite::types::Value>) {
        use rusqlite::types::Value;
        // Rating comparison mode (LR's Attribute filter): ≥ default, = or ≤.
        let rating_frag = match f.rating_op.as_deref() {
            Some("=") => "p.rating = ?",
            Some("<=") => "p.rating <= ?",
            _ => "p.rating >= ?",
        };
        let mut frags = vec![rating_frag.to_string()];
        if !f.expand_stacks {
            frags.push("(p.stack_id IS NULL OR p.stack_order = 0)".to_string());
        }
        let mut binds = vec![Value::Integer(f.min_rating)];
        if let Some(flag) = f.flag {
            frags.push("p.flag = ?".into());
            binds.push(Value::Integer(flag));
        }
        if let Some(label) = &f.color_label {
            frags.push("p.color_label = ?".into());
            binds.push(Value::Text(label.clone()));
        }
        if let Some(text) = f.text.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
            // Where the text searches (LR's Text-mode target). `s.path` is
            // available because both queries join source_asset; keywords go
            // through an EXISTS over the join table.
            let pat = format!("%{}%", escape_like(text));
            const KW: &str = "EXISTS (SELECT 1 FROM photo_keyword pk \
                 JOIN keyword k ON k.id = pk.keyword_id \
                 WHERE pk.photo_id = p.id AND k.name LIKE ? ESCAPE '\\')";
            match f.text_target.as_deref() {
                Some("title") => {
                    frags.push(r"p.title LIKE ? ESCAPE '\'".into());
                    binds.push(Value::Text(pat));
                }
                Some("caption") => {
                    frags.push(r"p.caption LIKE ? ESCAPE '\'".into());
                    binds.push(Value::Text(pat));
                }
                Some("keywords") => {
                    frags.push(KW.into());
                    binds.push(Value::Text(pat));
                }
                Some("copyName") => {
                    frags.push(r"p.copy_name LIKE ? ESCAPE '\'".into());
                    binds.push(Value::Text(pat));
                }
                Some("any") => {
                    frags.push(format!(
                        r"(s.path LIKE ? ESCAPE '\' OR p.title LIKE ? ESCAPE '\' OR p.caption LIKE ? ESCAPE '\' OR p.copy_name LIKE ? ESCAPE '\' OR {KW})"
                    ));
                    for _ in 0..5 {
                        binds.push(Value::Text(pat.clone()));
                    }
                }
                _ => {
                    frags.push(r"s.path LIKE ? ESCAPE '\'".into());
                    binds.push(Value::Text(pat));
                }
            }
        }
        if let Some(folder) = f.folder.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
            // Prefix + separator so "/a" never matches a "/ab" sibling.
            frags.push(r"s.path LIKE ? ESCAPE '\'".into());
            binds.push(Value::Text(format!("{}/%", escape_like(folder))));
            if f.folder_only {
                // Show Photos in Subfolders OFF: nothing after the prefix +
                // separator may contain another separator (either style).
                frags.push(
                    r"(INSTR(SUBSTR(s.path, LENGTH(?) + 2), '/') = 0 AND INSTR(SUBSTR(s.path, LENGTH(?) + 2), '\') = 0)".into(),
                );
                binds.push(Value::Text(folder.to_string()));
                binds.push(Value::Text(folder.to_string()));
            }
        }
        if let Some(camera) = &f.camera {
            frags.push("p.camera_model = ?".into());
            binds.push(Value::Text(camera.clone()));
        }
        if let Some(lens) = &f.lens {
            frags.push("p.lens = ?".into());
            binds.push(Value::Text(lens.clone()));
        }
        if let Some(year) = f.year {
            frags.push("CAST(strftime('%Y', p.capture_time, 'unixepoch') AS INTEGER) = ?".into());
            binds.push(Value::Integer(year));
        }
        // Metadata browser (LR's Filter bar Metadata tab): one IN-list per
        // selected column. BTreeMap iteration keeps the fragment order stable.
        for (col, values) in f.meta.iter().flatten() {
            let values: Vec<&String> = values.iter().filter(|v| !v.is_empty()).collect();
            if values.is_empty() {
                continue;
            }
            let holes = vec!["?"; values.len()].join(",");
            if col == META_KEYWORD {
                frags.push(format!(
                    "EXISTS (SELECT 1 FROM photo_keyword pk JOIN keyword k ON k.id = pk.keyword_id \
                     WHERE pk.photo_id = p.id AND k.name IN ({holes}))"
                ));
            } else if let Some(expr) = meta_column_expr(col) {
                frags.push(format!("{expr} IN ({holes})"));
            } else {
                continue; // unknown column id — ignore rather than fail the query
            }
            binds.extend(values.into_iter().map(|v| Value::Text(v.clone())));
        }
        (frags.join(" AND "), binds)
    }

    /// One keyset-paginated page, newest first (`sort_time DESC, id DESC`), passing
    /// the `filter`. `after` = the previous page's cursor.
    /// One keyset-paginated page in the default order (capture time, newest first).
    pub fn list_photos(
        conn: &Connection,
        after: Option<Cursor>,
        limit: i64,
        filter: &PhotoFilter,
    ) -> rusqlite::Result<PhotoPage> {
        list_photos_sorted(conn, after, limit, filter, GridSort::default())
    }

    /// SQL expression shared by every grid source. `User` only has meaning when
    /// a manual collection supplies `collection_photo.position`; other sources
    /// fall back to capture time instead of silently returning an unstable order.
    fn grid_sort_expr(key: SortKey) -> &'static str {
        match key {
            SortKey::Capture | SortKey::User => "p.sort_time",
            SortKey::Added => "p.added_time",
            SortKey::Rating => "p.rating",
            SortKey::Flag => "p.flag",
            SortKey::Label => "COALESCE(p.color_label, '') COLLATE NOCASE",
            SortKey::Filename => "s.path COLLATE NOCASE",
            SortKey::Filetype => "s.format COLLATE NOCASE",
            // Integer division keeps the value in the cursor's integer half;
            // MAX(h,1) guards a zero height (SQLite would yield NULL, which the
            // cursor comparison would silently swallow — dropped rows).
            // ponytail: raw pixel aspect, not orientation-corrected — same
            // convention as the `aspectRatio` smart-filter field; rotate both
            // together if EXIF-rotated frames ever need to sort as displayed.
            SortKey::Aspect => "p.width * 1000000 / MAX(p.height, 1)",
            // ponytail: correlated subquery per row (idx_history_photo-served,
            // filesorted like the other non-column keys) — denormalize onto
            // `photo` if these sorts get slow on a large catalog.
            SortKey::EditTime => {
                "COALESCE((SELECT MAX(h.created_at) FROM history_step h WHERE h.photo_id = p.id), 0)"
            }
            SortKey::EditCount => "(SELECT COUNT(*) FROM history_step h WHERE h.photo_id = p.id)",
        }
    }

    fn grid_order(sort: GridSort, user_expr: Option<&str>) -> String {
        if sort.key == SortKey::User && user_expr.is_none() {
            return "p.sort_time DESC, p.id DESC".into();
        }
        let expr = user_expr
            .filter(|_| sort.key == SortKey::User)
            .unwrap_or_else(|| grid_sort_expr(sort.key));
        let dir = if sort.ascending { "ASC" } else { "DESC" };
        format!("{expr} {dir}, p.id {dir}")
    }

    /// One keyset-paginated page ordered by `sort`. The cursor's `sort_time` field
    /// carries the active key's value for the last row (capture→sort_time,
    /// added→added_time, rating→rating, flag→flag). A sort change resets
    /// pagination on the client, so a cursor is only ever fed back with the sort
    /// that produced it.
    pub fn list_photos_sorted(
        conn: &Connection,
        after: Option<Cursor>,
        limit: i64,
        filter: &PhotoFilter,
        sort: GridSort,
    ) -> rusqlite::Result<PhotoPage> {
        use rusqlite::types::Value;
        // Clamp once so the truncate + hasMore comparison below can't drop every
        // row (limit<=0 would truncate to 0 and emit no cursor — silent data loss).
        let limit = limit.max(1);
        // Fetch one extra row to know whether a next page exists.
        let fetch = limit + 1;

        let (where_sql, mut binds) = filter_where(filter);
        // Fixed column expression per key — from a closed enum, never user input,
        // so it's safe to interpolate into the SQL. Filename compares/sorts the
        // path case-insensitively, so NOCASE must apply to both the ORDER BY and
        // the cursor comparison (it rides on the `expr`).
        let expr = grid_sort_expr(sort.key);
        // Ascending walks forward with `>`; descending (default) backward with `<`.
        let (dir, cmp) = if sort.ascending {
            ("ASC", ">")
        } else {
            ("DESC", "<")
        };

        let mut cursor_sql = String::new();
        if let Some(c) = after {
            cursor_sql = format!(" AND ({expr} {cmp} ? OR ({expr} = ? AND p.id {cmp} ?))");
            // The cursor value's type follows the key: text for filename, else int.
            let value = match sort.key {
                SortKey::Label | SortKey::Filename | SortKey::Filetype => {
                    Value::Text(c.sort_text.clone().unwrap_or_default())
                }
                _ => Value::Integer(c.sort_time),
            };
            binds.push(value.clone());
            binds.push(value);
            binds.push(Value::Integer(c.id));
        }
        binds.push(Value::Integer(fetch));

        let sql = format!(
            "SELECT {PHOTO_COLS} FROM photo p JOIN source_asset s ON s.id = p.source_asset_id
             WHERE {where_sql}{cursor_sql}
             ORDER BY {expr} {dir}, p.id {dir} LIMIT ?"
        );
        // Bind the collected Vec to a local before the block ends: the
        // `query_map` iterator borrows `stmt`, so the owned result must outlive
        // `stmt`'s drop (else E0597).
        let mut stmt = conn.prepare(&sql)?;
        let mut photos: Vec<PhotoRow> = stmt
            .query_map(rusqlite::params_from_iter(binds), map_photo)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);

        let mut next = None;
        if photos.len() as i64 > limit {
            photos.truncate(limit as usize);
            if let Some(last) = photos.last() {
                // The cursor value is the active key's ordering value. sort_time
                // isn't on PhotoRow; it equals capture_time.unwrap_or(added_time).
                let (sort_time, sort_text) = match sort.key {
                    SortKey::Capture | SortKey::User => {
                        (last.capture_time.unwrap_or(last.added_time), None)
                    }
                    SortKey::Added => (last.added_time, None),
                    SortKey::Rating => (last.rating, None),
                    SortKey::Flag => (last.flag, None),
                    SortKey::Label => (0, Some(last.color_label.clone().unwrap_or_default())),
                    SortKey::Filename => (0, Some(last.path.clone())),
                    SortKey::Filetype => (0, Some(last.format.clone())),
                    // Derived keys aren't carried on PhotoRow. Re-read the exact
                    // ORDER BY expression for the last row (indexed, one row) so
                    // the cursor can never disagree with the order it walks.
                    SortKey::Aspect | SortKey::EditTime | SortKey::EditCount => (
                        conn.query_row(
                            &format!("SELECT {expr} FROM photo p WHERE p.id = ?1"),
                            params![last.id],
                            |row| row.get(0),
                        )?,
                        None,
                    ),
                };
                next = Some(Cursor {
                    sort_time,
                    sort_text,
                    id: last.id,
                });
            }
        }
        Ok(PhotoPage { photos, next })
    }

    pub fn get_photo(conn: &Connection, id: i64) -> rusqlite::Result<Option<PhotoRow>> {
        let sql = format!(
            "SELECT {PHOTO_COLS} FROM photo p JOIN source_asset s ON s.id = p.source_asset_id
             WHERE p.id = ?1"
        );
        conn.query_row(&sql, params![id], map_photo).optional()
    }

    /// Master photos whose source file content (fingerprint) is shared by more
    /// than one imported asset — cross-folder exact duplicates. Offset-windowed:
    /// the client drains the full result in chunks, never truncating the view.
    // ponytail: LIMIT/OFFSET windows over a deterministic order (id tiebreak),
    // not keyset — upgrade to a cursor if re-scanning hurts on huge catalogs.
    pub fn duplicate_photos(
        conn: &Connection,
        limit: i64,
        offset: i64,
    ) -> rusqlite::Result<Vec<PhotoRow>> {
        duplicate_photos_sorted(conn, limit, offset, GridSort::default())
    }

    pub fn duplicate_photos_sorted(
        conn: &Connection,
        limit: i64,
        offset: i64,
        sort: GridSort,
    ) -> rusqlite::Result<Vec<PhotoRow>> {
        let order = grid_order(sort, None);
        let sql = format!(
            "SELECT {PHOTO_COLS} FROM photo p
             JOIN source_asset s ON s.id = p.source_asset_id
             WHERE p.is_virtual_copy = 0
               AND s.fingerprint IN (
                 SELECT fingerprint FROM source_asset GROUP BY fingerprint HAVING COUNT(*) > 1
               )
             ORDER BY {order} LIMIT ?1 OFFSET ?2"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![limit.max(1), offset.max(0)], map_photo)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn count_photos(conn: &Connection, filter: &PhotoFilter) -> rusqlite::Result<i64> {
        let (where_sql, binds) = filter_where(filter);
        // Join source_asset (1:1, count-preserving) so the shared filter_where can
        // reference s.path for the text filter — same relation list_photos uses.
        let sql = format!(
            "SELECT COUNT(*) FROM photo p JOIN source_asset s ON s.id = p.source_asset_id WHERE {where_sql}"
        );
        conn.query_row(&sql, rusqlite::params_from_iter(binds), |r| r.get(0))
    }

    /// Set the full flag state of a photo (rating 0–5, flag -1/0/1, label). The
    /// caller supplies the complete desired state (the properties panel knows it).
    pub fn set_flags(
        conn: &Connection,
        id: i64,
        rating: i64,
        flag: i64,
        color_label: Option<&str>,
    ) -> rusqlite::Result<()> {
        conn.execute(
            "UPDATE photo SET rating=?2, flag=?3, color_label=?4 WHERE id=?1",
            params![id, rating, flag, color_label],
        )?;
        Ok(())
    }

    /// Distinct parent folders of the catalog's source files with master-photo
    /// counts, path-ordered (Folders panel). Each file counts toward its
    /// immediate parent only; the panel rolls subfolders up visually.
    pub fn list_folders(conn: &Connection) -> rusqlite::Result<Vec<FolderRow>> {
        let mut stmt = conn.prepare(
            "SELECT s.path FROM photo p JOIN source_asset s ON s.id = p.source_asset_id
             WHERE p.is_virtual_copy = 0",
        )?;
        let mut counts: std::collections::BTreeMap<String, i64> = Default::default();
        for path in stmt.query_map([], |r| r.get::<_, String>(0))? {
            let path = path?;
            if let Some(i) = path.rfind(['/', '\\']).filter(|&i| i > 0) {
                *counts.entry(path[..i].to_string()).or_insert(0) += 1;
            }
        }
        Ok(counts
            .into_iter()
            .map(|(path, count)| FolderRow { path, count })
            .collect())
    }

    /// One Metadata-browser column's distinct values with master-photo counts.
    ///
    /// Counts reflect every *other* active column plus the rest of the filter,
    /// but not this column's own selection — LR's behaviour: picking a camera
    /// narrows the Lens list while the Camera list keeps showing its siblings.
    fn meta_column_options(
        conn: &Connection,
        column: &str,
        base: &PhotoFilter,
    ) -> rusqlite::Result<Vec<OptionCount>> {
        let mut f = base.clone();
        if let Some(meta) = f.meta.as_mut() {
            meta.remove(column);
        }
        let (where_sql, binds) = filter_where(&f);
        let (value_expr, join) = if column == META_KEYWORD {
            (
                "k.name",
                " JOIN photo_keyword pk ON pk.photo_id = p.id \
                 JOIN keyword k ON k.id = pk.keyword_id",
            )
        } else {
            match meta_column_expr(column) {
                Some(expr) => (expr, ""),
                None => return Ok(Vec::new()),
            }
        };
        // Newest-first for dates, value order otherwise. ponytail: numeric
        // columns (ISO, aperture) therefore sort as text — bind a numeric sort
        // key alongside the label if that ordering ever bites.
        let order = if META_DATE_COLUMNS.contains(&column) {
            "1 DESC"
        } else {
            "1 COLLATE NOCASE"
        };
        let sql = format!(
            "SELECT {value_expr}, COUNT(DISTINCT p.id) \
             FROM photo p JOIN source_asset s ON s.id = p.source_asset_id{join} \
             WHERE {where_sql} AND p.is_virtual_copy = 0 \
               AND {value_expr} IS NOT NULL AND {value_expr} <> '' \
             GROUP BY 1 ORDER BY {order}"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(binds), |r| {
            Ok(OptionCount {
                value: r.get(0)?,
                count: r.get(1)?,
            })
        })?;
        rows.collect()
    }

    /// The Filter bar Metadata browser's option lists. `columns` = the column
    /// ids the browser is currently showing (`None` = every known column, which
    /// is what a caller that has no column picker yet gets). `base` is the rest
    /// of the active filter, so counts track what the grid actually shows.
    pub fn list_filter_options(
        conn: &Connection,
        base: Option<&PhotoFilter>,
        columns: Option<&[String]>,
    ) -> rusqlite::Result<FilterOptions> {
        let default_filter = PhotoFilter::default();
        let base = base.unwrap_or(&default_filter);
        let all: Vec<String>;
        let columns = match columns {
            Some(c) => c,
            None => {
                all = META_COLUMNS
                    .iter()
                    .map(|(id, _)| (*id).to_string())
                    .chain(std::iter::once(META_KEYWORD.to_string()))
                    .collect();
                &all
            }
        };
        let mut out = std::collections::BTreeMap::new();
        for column in columns {
            let options = meta_column_options(conn, column, base)?;
            out.insert(column.clone(), options);
        }
        Ok(FilterOptions { columns: out })
    }

    /// Folder-rename support: repoint every source asset under `old_dir` to the
    /// same relative path under `new_dir`, in one transaction (the directory
    /// itself is renamed by the command). The `path` UNIQUE constraint makes a
    /// collision fail the whole transaction. Returns the repointed row count.
    pub fn repoint_folder(
        conn: &Connection,
        old_dir: &str,
        new_dir: &str,
    ) -> rusqlite::Result<usize> {
        let tx = conn.unchecked_transaction()?;
        // Byte-exact prefix compare (LIKE case-folds ASCII, wrong on
        // case-sensitive volumes) accepting either separator; the separator
        // char after the prefix is preserved by the SUBSTR rewrite.
        let n = tx.execute(
            "UPDATE source_asset SET path = ?2 || SUBSTR(path, LENGTH(?1) + 1)
             WHERE SUBSTR(path, 1, LENGTH(?1) + 1) IN (?1 || '/', ?1 || '\\')",
            params![old_dir, new_dir],
        )?;
        tx.commit()?;
        Ok(n)
    }

    /// Master-photo ids whose source file sits under `dir` (either separator,
    /// subfolders included) — the Folders panel's Remove from Catalog.
    pub fn photo_ids_under_dir(conn: &Connection, dir: &str) -> rusqlite::Result<Vec<i64>> {
        let mut stmt = conn.prepare(
            "SELECT p.id FROM photo p JOIN source_asset s ON s.id = p.source_asset_id
             WHERE p.is_virtual_copy = 0
               AND SUBSTR(s.path, 1, LENGTH(?1) + 1) IN (?1 || '/', ?1 || '\\')",
        )?;
        let ids = stmt.query_map(params![dir], |r| r.get(0))?.collect();
        ids
    }

    /// Source rows whose path sits under `dir` (either separator, byte-exact).
    pub fn count_under_dir(conn: &Connection, dir: &str) -> rusqlite::Result<i64> {
        conn.query_row(
            "SELECT COUNT(*) FROM source_asset
             WHERE SUBSTR(path, 1, LENGTH(?1) + 1) IN (?1 || '/', ?1 || '\\')",
            params![dir],
            |r| r.get(0),
        )
    }

    /// Rename support: repoint a photo's source asset at `new_path` (the file
    /// itself is renamed by the command). Refuses a path another asset owns.
    /// Returns the previous path so the caller can rename the file / undo.
    pub fn update_source_path(
        conn: &Connection,
        photo_id: i64,
        new_path: &str,
    ) -> rusqlite::Result<String> {
        let (asset_id, old): (i64, String) = conn.query_row(
            "SELECT s.id, s.path FROM photo p JOIN source_asset s ON s.id = p.source_asset_id
             WHERE p.id=?1",
            params![photo_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let taken: Option<i64> = conn
            .query_row(
                "SELECT id FROM source_asset WHERE path=?1 AND id!=?2",
                params![new_path, asset_id],
                |r| r.get(0),
            )
            .optional()?;
        if taken.is_some() {
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "path already in catalog: {new_path}"
            )));
        }
        conn.execute(
            "UPDATE source_asset SET path=?2 WHERE id=?1",
            params![asset_id, new_path],
        )?;
        Ok(old)
    }

    /// Edit Capture Time (LR's Metadata dialog): set the capture instant and
    /// keep capture-ordered sorting in step. `None` clears to unknown (the
    /// retained sort_time keeps the photo's place).
    pub fn set_capture_time(
        conn: &Connection,
        id: i64,
        capture_time: Option<i64>,
    ) -> rusqlite::Result<()> {
        conn.execute(
            "UPDATE photo SET capture_time=?2, sort_time=COALESCE(?2, sort_time) WHERE id=?1",
            params![id, capture_time],
        )?;
        Ok(())
    }

    /// Geotag (LR's Map module): set or clear a photo's GPS coordinate. Both
    /// halves move together — `None`/`None` deletes the location.
    pub fn set_gps(
        conn: &Connection,
        id: i64,
        lat: Option<f64>,
        lon: Option<f64>,
    ) -> rusqlite::Result<()> {
        conn.execute(
            "UPDATE photo SET gps_lat=?2, gps_lon=?3 WHERE id=?1",
            params![id, lat, lon],
        )?;
        Ok(())
    }

    /// Trim to `None` when blank/whitespace (a cleared field is absent, not "").
    fn nonblank(s: Option<&str>) -> Option<&str> {
        s.map(str::trim).filter(|v| !v.is_empty())
    }

    /// Every editable IPTC column paired with its value on `m` — the one list
    /// the writer walks. Column names are literals, never caller input.
    fn iptc_columns(m: &PhotoIptc) -> [(&'static str, Option<&str>); 25] {
        [
            ("title", m.title.as_deref()),
            ("caption", m.caption.as_deref()),
            ("headline", m.headline.as_deref()),
            ("instructions", m.instructions.as_deref()),
            ("creator", m.creator.as_deref()),
            ("job_title", m.job_title.as_deref()),
            ("credit", m.credit.as_deref()),
            ("source", m.source.as_deref()),
            ("creator_address", m.creator_address.as_deref()),
            ("creator_city", m.creator_city.as_deref()),
            ("creator_state_province", m.creator_state_province.as_deref()),
            ("creator_postal_code", m.creator_postal_code.as_deref()),
            ("creator_country", m.creator_country.as_deref()),
            ("creator_phone", m.creator_phone.as_deref()),
            ("creator_email", m.creator_email.as_deref()),
            ("creator_website", m.creator_website.as_deref()),
            ("sublocation", m.sublocation.as_deref()),
            ("city", m.city.as_deref()),
            ("state_province", m.state_province.as_deref()),
            ("country", m.country.as_deref()),
            ("iso_country_code", m.iso_country_code.as_deref()),
            ("copyright", m.copyright.as_deref()),
            ("copyright_status", m.copyright_status.as_deref()),
            ("rights_usage_terms", m.rights_usage_terms.as_deref()),
            ("copyright_info_url", m.copyright_info_url.as_deref()),
        ]
    }

    /// Set a photo's editable IPTC metadata — the whole set at once, LR's
    /// "the panel is the record" semantics: a field `m` leaves blank clears.
    /// Blank values store as NULL so a cleared field reads back as absent
    /// (not an empty string), and `copyright_status` is clamped to the IPTC
    /// vocabulary so an out-of-band IPC caller cannot seed a value the panel
    /// can never display or clear.
    pub fn set_photo_metadata(
        conn: &Connection,
        id: i64,
        m: &PhotoIptc,
    ) -> rusqlite::Result<()> {
        let cols = iptc_columns(m);
        let sets = cols
            .iter()
            .enumerate()
            .map(|(i, (c, _))| format!("{c}=?{}", i + 2))
            .collect::<Vec<_>>()
            .join(", ");
        let vals: Vec<Option<&str>> = cols
            .iter()
            .map(|&(c, v)| {
                let v = nonblank(v);
                if c == "copyright_status" {
                    v.filter(|s| COPYRIGHT_STATUSES.contains(s))
                } else {
                    v
                }
            })
            .collect();
        let mut binds: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(vals.len() + 1);
        binds.push(&id);
        binds.extend(vals.iter().map(|v| v as &dyn rusqlite::ToSql));
        conn.execute(
            &format!("UPDATE photo SET {sets} WHERE id=?1"),
            binds.as_slice(),
        )?;
        Ok(())
    }

    /// Persist the canonical develop recipe (DevelopRecipeV2 JSON) + process
    /// version for a photo. This is the source of truth; previews derive from it.
    pub fn set_recipe(
        conn: &Connection,
        id: i64,
        recipe_json: &str,
        process_version: Option<i64>,
    ) -> rusqlite::Result<()> {
        conn.execute(
            "UPDATE photo SET develop_recipe=?2, process_version=?3 WHERE id=?1",
            params![id, recipe_json, process_version],
        )?;
        Ok(())
    }

    /// Read back a photo's recipe JSON (`None` if never edited / photo missing).
    pub fn get_recipe(conn: &Connection, id: i64) -> rusqlite::Result<Option<String>> {
        conn.query_row(
            "SELECT develop_recipe FROM photo WHERE id=?1",
            params![id],
            |r| r.get::<_, Option<String>>(0),
        )
        .optional()
        .map(|o| o.flatten())
    }

    /// The next free "Copy N" name for `master`'s copies. N starts past the copy
    /// count and skips names already in use — copies get deleted and renamed —
    /// so two copies of one master never end up sharing a name (which is what
    /// the catalog-merge dedup keys on).
    fn next_copy_name(conn: &Connection, master: i64) -> rusqlite::Result<String> {
        let mut n: i64 = conn.query_row(
            "SELECT COUNT(*) + 1 FROM photo WHERE master_photo_id=?1",
            params![master],
            |r| r.get(0),
        )?;
        loop {
            let name = format!("Copy {n}");
            let taken: i64 = conn.query_row(
                "SELECT COUNT(*) FROM photo WHERE master_photo_id=?1 AND copy_name=?2",
                params![master, name],
                |r| r.get(0),
            )?;
            if taken == 0 {
                return Ok(name);
            }
            n += 1;
        }
    }

    /// Create a virtual copy of `photo_id`: a new photo row sharing the source
    /// asset + metadata, seeded with a copy of the develop recipe. Copies always
    /// root at the original master (a copy-of-a-copy still points there), and get
    /// the master's `sort_time` so they sit next to it in the grid. Returns the
    /// new photo id.
    pub fn create_virtual_copy(conn: &Connection, photo_id: i64) -> rusqlite::Result<i64> {
        let master: i64 = conn.query_row(
            "SELECT COALESCE(master_photo_id, id) FROM photo WHERE id=?1",
            params![photo_id],
            |r| r.get(0),
        )?;
        let copy_name = next_copy_name(conn, master)?;
        let new_id: i64 = conn.query_row(
            "INSERT INTO photo(source_asset_id, is_virtual_copy, master_photo_id, copy_name,
                 orientation, rating, flag, color_label, capture_time, added_time, sort_time,
                 width, height, camera_make, camera_model, lens, iso, f_number, focal_length,
                 exposure_time, gps_lat, gps_lon, develop_recipe, process_version)
             SELECT source_asset_id, 1, ?2, ?3,
                 orientation, rating, flag, color_label, capture_time, ?4, sort_time,
                 width, height, camera_make, camera_model, lens, iso, f_number, focal_length,
                 exposure_time, gps_lat, gps_lon, develop_recipe, process_version
             FROM photo WHERE id=?1
             RETURNING id",
            params![photo_id, master, copy_name, now_secs()],
            |r| r.get(0),
        )?;
        Ok(new_id)
    }

    /// Rename a virtual copy (LR's Photo ▸ Set Copy Name…). Blank clears the
    /// name back to NULL so it reads as absent, like the metadata writer.
    /// Scoped to copies: a master has no copy name, so an out-of-band IPC
    /// caller cannot stamp one onto it.
    pub fn set_copy_name(conn: &Connection, id: i64, name: Option<&str>) -> rusqlite::Result<()> {
        conn.execute(
            "UPDATE photo SET copy_name=?2 WHERE id=?1 AND is_virtual_copy=1",
            params![id, nonblank(name)],
        )?;
        Ok(())
    }

    /// Promote a virtual copy to master (LR's Photo ▸ Make Master Photo): the
    /// copy becomes the real photo, its old master becomes a virtual copy of it
    /// and inherits the copy's name, and every sibling copy re-roots at the new
    /// master — the family keeps exactly one master. Rejects a photo that is
    /// not a virtual copy rather than orphaning a master.
    pub fn make_master_photo(conn: &Connection, copy_id: i64) -> rusqlite::Result<()> {
        let (is_copy, master, name): (i64, Option<i64>, Option<String>) = conn.query_row(
            "SELECT is_virtual_copy, master_photo_id, copy_name FROM photo WHERE id=?1",
            params![copy_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        let Some(master) = master.filter(|_| is_copy == 1) else {
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "photo {copy_id} is not a virtual copy"
            )));
        };
        let tx = conn.unchecked_transaction()?;
        // Siblings re-root first, while the rows still describe the old family.
        tx.execute(
            "UPDATE photo SET master_photo_id=?2 WHERE master_photo_id=?1 AND id<>?2",
            params![master, copy_id],
        )?;
        tx.execute(
            "UPDATE photo SET is_virtual_copy=0, master_photo_id=NULL, copy_name=NULL WHERE id=?1",
            params![copy_id],
        )?;
        // An unnamed copy leaves the demoted master the next free "Copy N",
        // the same label create_virtual_copy would have handed out.
        let name = match name {
            Some(n) => n,
            None => next_copy_name(&tx, copy_id)?,
        };
        tx.execute(
            "UPDATE photo SET is_virtual_copy=1, master_photo_id=?2, copy_name=?3 WHERE id=?1",
            params![master, copy_id, name],
        )?;
        tx.commit()
    }

    // ── Stacking (LR-style collapsed groups; cover = stack_order 0) ──

    /// Group `ids` into a new stack; `ids[0]` becomes the cover (stack_order 0),
    /// the rest keep the given order. Any photo already in another stack is
    /// moved out of it (LR's regroup-on-restack semantics) — that old stack's
    /// remaining members are untouched, even if only one is left. Transactional:
    /// rejects (and writes nothing) for fewer than 2 ids or an unknown id.
    /// Returns the new stack id.
    pub fn stack_photos(conn: &Connection, ids: &[i64]) -> rusqlite::Result<i64> {
        if ids.len() < 2 {
            return Err(rusqlite::Error::InvalidParameterName(
                "stacking requires at least 2 photos".into(),
            ));
        }
        let tx = conn.unchecked_transaction()?;
        for id in ids {
            let exists: i64 =
                tx.query_row("SELECT COUNT(*) FROM photo WHERE id=?1", params![id], |r| {
                    r.get(0)
                })?;
            if exists == 0 {
                return Err(rusqlite::Error::InvalidParameterName(format!(
                    "photo {id} not found"
                )));
            }
        }
        let stack_id: i64 = tx.query_row(
            "SELECT COALESCE(MAX(stack_id), 0) + 1 FROM photo",
            [],
            |r| r.get(0),
        )?;
        for (order, id) in ids.iter().enumerate() {
            tx.execute(
                "UPDATE photo SET stack_id=?1, stack_order=?2 WHERE id=?3",
                params![stack_id, order as i64, id],
            )?;
        }
        tx.commit()?;
        Ok(stack_id)
    }

    /// Dissolve a stack: every member becomes unstacked.
    pub fn unstack(conn: &Connection, stack_id: i64) -> rusqlite::Result<()> {
        conn.execute(
            "UPDATE photo SET stack_id=NULL, stack_order=NULL WHERE stack_id=?1",
            params![stack_id],
        )?;
        Ok(())
    }

    /// Remove photos from the catalog (Lightroom "Remove from Catalog"): only the
    /// catalog rows go — the source files are kept on disk. SQLite ON DELETE
    /// CASCADE drops collection membership, previews, snapshots, history, keywords
    /// and virtual copies. Returns EVERY deleted id — the requested ids plus their
    /// cascade-deleted virtual copies — so the view reconciles without a reload.
    pub fn remove_photos(conn: &Connection, ids: &[i64]) -> rusqlite::Result<Vec<i64>> {
        let tx = conn.unchecked_transaction()?;
        let mut deleted: Vec<i64> = Vec::new();
        for &id in ids {
            let row: Option<(Option<i64>, Option<i64>)> = tx
                .query_row(
                    "SELECT stack_id, stack_order FROM photo WHERE id = ?1",
                    params![id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            // Already gone (e.g. a virtual copy dropped by an earlier master).
            let Some((stack_id, stack_order)) = row else {
                continue;
            };
            // Removing a stack cover: promote the lowest-order remaining member so
            // the stack keeps a visible cover (the grid only shows stack_order 0).
            if let (Some(sid), Some(0)) = (stack_id, stack_order) {
                let next: Option<i64> = tx
                    .query_row(
                        "SELECT id FROM photo WHERE stack_id = ?1 AND id != ?2 ORDER BY stack_order ASC LIMIT 1",
                        params![sid, id],
                        |r| r.get(0),
                    )
                    .optional()?;
                if let Some(next) = next {
                    tx.execute(
                        "UPDATE photo SET stack_order = 0 WHERE id = ?1",
                        params![next],
                    )?;
                }
            }
            // Virtual copies cascade-delete with their master — transitively, since
            // a copy can itself be copied. Collect the whole descendant subtree so
            // the view drops them all (report them; the DELETE below cascades them).
            let vc_ids: Vec<i64> = {
                let mut stmt = tx.prepare(
                    "WITH RECURSIVE descendants(id) AS (
                         SELECT ?1
                         UNION ALL
                         SELECT p.id FROM photo p JOIN descendants d ON p.master_photo_id = d.id
                     )
                     SELECT id FROM descendants WHERE id != ?1",
                )?;
                let rows = stmt.query_map(params![id], |r| r.get(0))?;
                rows.collect::<rusqlite::Result<_>>()?
            };
            tx.execute("DELETE FROM photo WHERE id = ?1", params![id])?;
            deleted.push(id);
            deleted.extend(vc_ids);
        }
        tx.commit()?;
        Ok(deleted)
    }

    /// Distinct source files referenced by `ids` — (asset id, path, managed DNG
    /// path if any). Collected BEFORE `remove_photos` so "Delete from Disk" still
    /// knows what to trash once the rows are gone. Virtual copies dedupe onto
    /// their master's asset.
    pub fn source_files_for(
        conn: &Connection,
        ids: &[i64],
    ) -> rusqlite::Result<Vec<(i64, String, Option<String>)>> {
        let mut out: Vec<(i64, String, Option<String>)> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut stmt = conn.prepare(
            "SELECT s.id, s.path, s.managed_path
             FROM photo p JOIN source_asset s ON s.id = p.source_asset_id
             WHERE p.id = ?1",
        )?;
        for &id in ids {
            let row = stmt
                .query_row(params![id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .optional()?;
            if let Some((sid, path, managed)) = row {
                if seen.insert(sid) {
                    out.push((sid, path, managed));
                }
            }
        }
        Ok(out)
    }

    /// Delete the `source_asset` rows in `asset_ids` that no photo references any
    /// more ("Delete from Disk" cleanup after `remove_photos`). Returns the pruned
    /// ids; assets still referenced by surviving photos are kept.
    pub fn prune_orphan_assets(conn: &Connection, asset_ids: &[i64]) -> rusqlite::Result<Vec<i64>> {
        let mut pruned = Vec::new();
        for &sid in asset_ids {
            let n = conn.execute(
                "DELETE FROM source_asset WHERE id = ?1
                   AND NOT EXISTS (SELECT 1 FROM photo WHERE source_asset_id = ?1)",
                params![sid],
            )?;
            if n > 0 {
                pruned.push(sid);
            }
        }
        Ok(pruned)
    }

    /// The master photo (if any) whose source asset carries the same content
    /// fingerprint at a DIFFERENT path — Lightroom's "suspected duplicate"
    /// identity for the import dialog's "Don't Import Suspected Duplicates".
    pub fn find_duplicate(
        conn: &Connection,
        fingerprint: &str,
        path: &str,
    ) -> rusqlite::Result<Option<i64>> {
        conn.query_row(
            "SELECT p.id FROM photo p JOIN source_asset s ON s.id = p.source_asset_id
             WHERE s.fingerprint = ?1 AND s.path != ?2 AND p.is_virtual_copy = 0
             LIMIT 1",
            params![fingerprint, path],
            |r| r.get(0),
        )
        .optional()
    }

    /// Ids of every reject-flagged (`flag = -1`) photo in the catalog — the source
    /// set for "Delete Rejected". Includes hidden stack members and virtual copies;
    /// `remove_photos` cascades and promotes covers when they are removed.
    pub fn list_rejected_ids(conn: &Connection) -> rusqlite::Result<Vec<i64>> {
        let mut stmt = conn.prepare("SELECT id FROM photo WHERE flag = -1 ORDER BY id")?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        rows.collect()
    }

    /// Every source asset's id + path + missing flag (for folder-sync scans).
    pub fn list_source_paths(conn: &Connection) -> rusqlite::Result<Vec<SourcePathRow>> {
        let mut stmt =
            conn.prepare("SELECT id, path, COALESCE(missing, 0) FROM source_asset ORDER BY id")?;
        let rows = stmt
            .query_map([], |r| {
                Ok(SourcePathRow {
                    source_asset_id: r.get(0)?,
                    path: r.get(1)?,
                    missing: r.get::<_, i64>(2)? != 0,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Flag (or un-flag) a source asset as missing on disk. Errors on bad id.
    pub fn mark_missing(
        conn: &Connection,
        source_asset_id: i64,
        missing: bool,
    ) -> rusqlite::Result<()> {
        let n = conn.execute(
            "UPDATE source_asset SET missing=?2 WHERE id=?1",
            params![source_asset_id, i64::from(missing)],
        )?;
        if n == 0 {
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "source asset {source_asset_id} not found"
            )));
        }
        Ok(())
    }

    /// Relink a source asset to `new_path`. The caller computes `new_fingerprint`
    /// from the file at `new_path`; we refuse the relink unless it EXACTLY equals
    /// the stored fingerprint (LR won't relink to different content). On success,
    /// path is updated and the missing flag cleared. This never reads the file —
    /// fingerprint enforcement is the integrity boundary.
    pub fn relink(
        conn: &Connection,
        source_asset_id: i64,
        new_path: &str,
        new_fingerprint: &str,
    ) -> rusqlite::Result<()> {
        let tx = conn.unchecked_transaction()?;
        let stored: Option<String> = tx
            .query_row(
                "SELECT fingerprint FROM source_asset WHERE id=?1",
                params![source_asset_id],
                |r| r.get(0),
            )
            .optional()?;
        let Some(stored) = stored else {
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "source asset {source_asset_id} not found"
            )));
        };
        if stored != new_fingerprint {
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "relink refused: {new_path} fingerprint does not match the catalog record"
            )));
        }
        tx.execute(
            "UPDATE source_asset SET path=?2, missing=0 WHERE id=?1",
            params![source_asset_id, new_path],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Count source assets currently flagged missing (for a status badge).
    pub fn count_missing(conn: &Connection) -> rusqlite::Result<i64> {
        conn.query_row(
            "SELECT COUNT(*) FROM source_asset WHERE missing=1",
            [],
            |r| r.get(0),
        )
    }

    /// Make `photo_id` the cover of its stack (stack_order 0), stably renumbering
    /// the other members (their relative order is preserved). Errors if the
    /// photo isn't currently stacked.
    pub fn set_stack_cover(conn: &Connection, photo_id: i64) -> rusqlite::Result<()> {
        let stack_id: Option<i64> = conn.query_row(
            "SELECT stack_id FROM photo WHERE id=?1",
            params![photo_id],
            |r| r.get(0),
        )?;
        let Some(stack_id) = stack_id else {
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "photo {photo_id} is not stacked"
            )));
        };
        let tx = conn.unchecked_transaction()?;
        let mut stmt =
            tx.prepare("SELECT id FROM photo WHERE stack_id=?1 AND id<>?2 ORDER BY stack_order")?;
        let others: Vec<i64> = stmt
            .query_map(params![stack_id, photo_id], |r| r.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);
        tx.execute(
            "UPDATE photo SET stack_order=0 WHERE id=?1",
            params![photo_id],
        )?;
        for (i, id) in others.iter().enumerate() {
            tx.execute(
                "UPDATE photo SET stack_order=?1 WHERE id=?2",
                params![(i + 1) as i64, id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// LR "Split Stack": `photo_id` and every member after it move to a new
    /// stack, renumbered from 0. Errors if the photo is unstacked or is the
    /// cover (nothing above it to split from). Either half left with a single
    /// member is dissolved — a one-photo stack has no purpose.
    pub fn split_stack(conn: &Connection, photo_id: i64) -> rusqlite::Result<()> {
        let row: Option<(Option<i64>, Option<i64>)> = conn
            .query_row(
                "SELECT stack_id, stack_order FROM photo WHERE id=?1",
                params![photo_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let Some((Some(stack_id), Some(order))) = row else {
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "photo {photo_id} is not stacked"
            )));
        };
        if order == 0 {
            return Err(rusqlite::Error::InvalidParameterName(
                "cannot split a stack at its cover".into(),
            ));
        }
        let tx = conn.unchecked_transaction()?;
        let new_id: i64 = tx.query_row(
            "SELECT COALESCE(MAX(stack_id), 0) + 1 FROM photo",
            [],
            |r| r.get(0),
        )?;
        // The split photo and everything after it leave; the remaining half's
        // orders (0..order-1) are already contiguous, so only movers renumber.
        let movers: Vec<i64> = {
            let mut stmt = tx.prepare(
                "SELECT id FROM photo WHERE stack_id=?1 AND stack_order>=?2 ORDER BY stack_order",
            )?;
            let ids = stmt
                .query_map(params![stack_id, order], |r| r.get(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            ids
        };
        for (i, id) in movers.iter().enumerate() {
            tx.execute(
                "UPDATE photo SET stack_id=?1, stack_order=?2 WHERE id=?3",
                params![new_id, i as i64, id],
            )?;
        }
        for sid in [stack_id, new_id] {
            let n: i64 = tx.query_row(
                "SELECT COUNT(*) FROM photo WHERE stack_id=?1",
                params![sid],
                |r| r.get(0),
            )?;
            if n < 2 {
                tx.execute(
                    "UPDATE photo SET stack_id=NULL, stack_order=NULL WHERE stack_id=?1",
                    params![sid],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// LR "Move Up/Down in Stack": swap a stacked photo's `stack_order` with its
    /// neighbor one slot up (`delta` < 0) or down (> 0); no-op at either end.
    /// Errors if the photo isn't stacked.
    pub fn move_in_stack(conn: &Connection, photo_id: i64, delta: i64) -> rusqlite::Result<()> {
        let row: Option<(Option<i64>, Option<i64>)> = conn
            .query_row(
                "SELECT stack_id, stack_order FROM photo WHERE id=?1",
                params![photo_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let Some((Some(stack_id), Some(order))) = row else {
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "photo {photo_id} is not stacked"
            )));
        };
        let target = order + delta.signum(); // one slot per call, whatever delta says
        if target < 0 {
            return Ok(()); // already the cover
        }
        let neighbor: Option<i64> = conn
            .query_row(
                "SELECT id FROM photo WHERE stack_id=?1 AND stack_order=?2",
                params![stack_id, target],
                |r| r.get(0),
            )
            .optional()?;
        let Some(neighbor) = neighbor else {
            return Ok(()); // already at the bottom
        };
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE photo SET stack_order=?1 WHERE id=?2",
            params![order, neighbor],
        )?;
        tx.execute(
            "UPDATE photo SET stack_order=?1 WHERE id=?2",
            params![target, photo_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// All members of a stack, in stack order (no collapse) — the grid's expand
    /// strip.
    pub fn list_stack(conn: &Connection, stack_id: i64) -> rusqlite::Result<Vec<PhotoRow>> {
        let sql = format!(
            "SELECT {PHOTO_COLS} FROM photo p JOIN source_asset s ON s.id = p.source_asset_id
             WHERE p.stack_id = ?1 ORDER BY p.stack_order"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![stack_id], map_photo)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Expanded-stack grid source ordered by the current Library sort. Stack
    /// editing keeps using [`list_stack`] so cover/member order is unchanged.
    pub fn list_stack_sorted(
        conn: &Connection,
        stack_id: i64,
        sort: GridSort,
    ) -> rusqlite::Result<Vec<PhotoRow>> {
        let order = grid_order(sort, None);
        let sql = format!(
            "SELECT {PHOTO_COLS} FROM photo p JOIN source_asset s ON s.id = p.source_asset_id
             WHERE p.stack_id = ?1 ORDER BY {order}"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![stack_id], map_photo)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Auto-stack unstacked, non-virtual-copy photos ordered by `sort_time`:
    /// consecutive runs whose neighbour gap is `<= gap_seconds` become a stack
    /// (only runs of >= 2), cover = earliest. Transactional. Returns the number
    /// of stacks created.
    pub fn auto_stack(conn: &Connection, gap_seconds: i64) -> rusqlite::Result<i64> {
        if gap_seconds <= 0 {
            return Err(rusqlite::Error::InvalidParameterName(
                "gapSeconds must be > 0".into(),
            ));
        }
        let tx = conn.unchecked_transaction()?;
        let mut stmt = tx.prepare(
            "SELECT id, sort_time FROM photo
             WHERE stack_id IS NULL AND is_virtual_copy = 0
             ORDER BY sort_time, id",
        )?;
        let rows: Vec<(i64, i64)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);

        // Consecutive runs where every neighbour gap is <= gap_seconds.
        let mut runs: Vec<Vec<i64>> = Vec::new();
        let mut prev_time: Option<i64> = None;
        for (id, sort_time) in rows {
            let starts_new_run = match prev_time {
                Some(pt) => sort_time - pt > gap_seconds,
                None => true,
            };
            if starts_new_run {
                runs.push(Vec::new());
            }
            runs.last_mut().unwrap().push(id);
            prev_time = Some(sort_time);
        }

        let mut next_stack_id: i64 = tx.query_row(
            "SELECT COALESCE(MAX(stack_id), 0) + 1 FROM photo",
            [],
            |r| r.get(0),
        )?;
        let mut created = 0i64;
        for run in runs.into_iter().filter(|r| r.len() >= 2) {
            for (order, id) in run.iter().enumerate() {
                tx.execute(
                    "UPDATE photo SET stack_id=?1, stack_order=?2 WHERE id=?3",
                    params![next_stack_id, order as i64, id],
                )?;
            }
            next_stack_id += 1;
            created += 1;
        }
        tx.commit()?;
        Ok(created)
    }

    /// Create (or replace, by name) a named develop snapshot for a photo; returns
    /// its id. Re-using a name overwrites that snapshot (LR's rename-is-overwrite).
    pub fn add_snapshot(
        conn: &Connection,
        photo_id: i64,
        name: &str,
        recipe_json: &str,
        process_version: Option<i64>,
    ) -> rusqlite::Result<i64> {
        conn.query_row(
            "INSERT INTO snapshot(photo_id, name, recipe_json, process_version, created_at)
             VALUES(?1,?2,?3,?4,?5)
             ON CONFLICT(photo_id, name) DO UPDATE SET
               recipe_json=excluded.recipe_json,
               process_version=excluded.process_version,
               created_at=excluded.created_at
             RETURNING id",
            params![photo_id, name, recipe_json, process_version, now_secs()],
            |r| r.get(0),
        )
    }

    /// A photo's snapshots, sorted by name like LR's Snapshots panel (a
    /// snapshot is found by its name, not by when it was taken).
    pub fn list_snapshots(conn: &Connection, photo_id: i64) -> rusqlite::Result<Vec<SnapshotRow>> {
        let mut stmt = conn.prepare(
            "SELECT id, photo_id, name, recipe_json, process_version, created_at
             FROM snapshot WHERE photo_id=?1 ORDER BY name COLLATE NOCASE ASC, id ASC",
        )?;
        let rows = stmt
            .query_map(params![photo_id], |r| {
                Ok(SnapshotRow {
                    id: r.get(0)?,
                    photo_id: r.get(1)?,
                    name: r.get(2)?,
                    recipe_json: r.get(3)?,
                    process_version: r.get(4)?,
                    created_at: r.get(5)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Delete a snapshot by id (no-op if it doesn't exist).
    pub fn delete_snapshot(conn: &Connection, id: i64) -> rusqlite::Result<()> {
        conn.execute("DELETE FROM snapshot WHERE id=?1", params![id])?;
        Ok(())
    }

    /// Append a develop history step; returns its id. Trims the photo's history to
    /// the newest `cap` steps (0 = unbounded) so a long edit session can't grow
    /// the catalog without bound.
    pub fn record_history(
        conn: &Connection,
        photo_id: i64,
        label: &str,
        recipe_json: &str,
        process_version: Option<i64>,
        cap: i64,
    ) -> rusqlite::Result<i64> {
        conn.execute(
            "INSERT INTO history_step(photo_id, label, recipe_json, process_version, created_at)
             VALUES(?1,?2,?3,?4,?5)",
            params![photo_id, label, recipe_json, process_version, now_secs()],
        )?;
        let id = conn.last_insert_rowid();
        if cap > 0 {
            conn.execute(
                "DELETE FROM history_step
                 WHERE photo_id=?1 AND id NOT IN (
                   SELECT id FROM history_step WHERE photo_id=?1 ORDER BY id DESC LIMIT ?2
                 )",
                params![photo_id, cap],
            )?;
        }
        Ok(id)
    }

    /// A photo's history steps, newest first.
    pub fn list_history(conn: &Connection, photo_id: i64) -> rusqlite::Result<Vec<HistoryRow>> {
        let mut stmt = conn.prepare(
            "SELECT id, photo_id, label, recipe_json, process_version, created_at
             FROM history_step WHERE photo_id=?1 ORDER BY id DESC",
        )?;
        let rows = stmt
            .query_map(params![photo_id], |r| {
                Ok(HistoryRow {
                    id: r.get(0)?,
                    photo_id: r.get(1)?,
                    label: r.get(2)?,
                    recipe_json: r.get(3)?,
                    process_version: r.get(4)?,
                    created_at: r.get(5)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Clear a photo's entire develop history.
    pub fn clear_history(conn: &Connection, photo_id: i64) -> rusqlite::Result<()> {
        conn.execute(
            "DELETE FROM history_step WHERE photo_id=?1",
            params![photo_id],
        )?;
        Ok(())
    }

    /// Ensure a `|`-separated keyword path exists ("animal|dog" creates/finds
    /// animal, then dog under it) and return the LEAF id. An already-existing
    /// keyword keeps its current parent — tag entry never silently reparents.
    pub fn ensure_keyword_path(conn: &Connection, path: &str) -> rusqlite::Result<i64> {
        let mut parent: Option<i64> = None;
        let mut leaf = None;
        for seg in path.split('|').map(str::trim).filter(|s| !s.is_empty()) {
            let id: i64 = conn.query_row(
                // The DO UPDATE is a no-op upsert to make RETURNING yield the
                // existing row's id (its parent_id is deliberately untouched).
                "INSERT INTO keyword(name, parent_id) VALUES(?1, ?2)
                 ON CONFLICT(name) DO UPDATE SET name=excluded.name
                 RETURNING id",
                params![seg, parent],
                |r| r.get(0),
            )?;
            parent = Some(id);
            leaf = Some(id);
        }
        leaf.ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    /// Tag a photo with a keyword name or `|` path ("animal|dog"), creating any
    /// missing levels; the photo is tagged with the LEAF only (parents are
    /// implied, as in LR). Returns the leaf id. Idempotent per (photo, keyword).
    pub fn add_keyword(conn: &Connection, photo_id: i64, name: &str) -> rusqlite::Result<i64> {
        let kid = ensure_keyword_path(conn, name)?;
        conn.execute(
            "INSERT OR IGNORE INTO photo_keyword(photo_id, keyword_id) VALUES(?1,?2)",
            params![photo_id, kid],
        )?;
        Ok(kid)
    }

    /// Create a vocabulary keyword from the Create Keyword Tag dialog (no photo
    /// tagging — the caller applies it to selected photos separately). Errors on
    /// a duplicate name (the vocabulary is name-unique).
    #[allow(clippy::too_many_arguments)]
    pub fn create_keyword(
        conn: &Connection,
        name: &str,
        parent_id: Option<i64>,
        synonyms: &str,
        include_on_export: bool,
        export_containing: bool,
        export_synonyms: bool,
    ) -> rusqlite::Result<i64> {
        conn.query_row(
            "INSERT INTO keyword(name, parent_id, synonyms, include_on_export,
                                 export_containing, export_synonyms)
             VALUES(?1,?2,?3,?4,?5,?6) RETURNING id",
            params![
                name,
                parent_id,
                synonyms,
                include_on_export,
                export_containing,
                export_synonyms
            ],
            |r| r.get(0),
        )
    }

    /// True when `candidate` is `id` itself or one of `id`'s descendants —
    /// the nesting-cycle guard for [`update_keyword`].
    fn keyword_would_cycle(conn: &Connection, id: i64, candidate: i64) -> rusqlite::Result<bool> {
        let mut cur = Some(candidate);
        // Walk candidate's ancestor chain; hitting `id` means candidate lives
        // inside `id`'s subtree. Bounded by tree depth (no cycles exist yet).
        while let Some(c) = cur {
            if c == id {
                return Ok(true);
            }
            cur = conn.query_row(
                "SELECT parent_id FROM keyword WHERE id=?1",
                params![c],
                |r| r.get(0),
            )?;
        }
        Ok(false)
    }

    /// Edit Keyword Tag: rename, reparent (Put Inside), synonyms and export
    /// flags in one write. Refuses a parent that is the keyword itself or one
    /// of its descendants (which would orphan the subtree into a cycle).
    #[allow(clippy::too_many_arguments)]
    pub fn update_keyword(
        conn: &Connection,
        keyword_id: i64,
        name: &str,
        parent_id: Option<i64>,
        synonyms: &str,
        include_on_export: bool,
        export_containing: bool,
        export_synonyms: bool,
    ) -> Result<(), String> {
        if let Some(p) = parent_id {
            if keyword_would_cycle(conn, keyword_id, p).map_err(|e| e.to_string())? {
                return Err("cannot put a keyword inside itself or its own child".into());
            }
        }
        conn.execute(
            "UPDATE keyword SET name=?2, parent_id=?3, synonyms=?4,
                    include_on_export=?5, export_containing=?6, export_synonyms=?7
             WHERE id=?1",
            params![
                keyword_id,
                name,
                parent_id,
                synonyms,
                include_on_export,
                export_containing,
                export_synonyms
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Untag a photo (the keyword stays in the vocabulary for reuse).
    pub fn remove_keyword(
        conn: &Connection,
        photo_id: i64,
        keyword_id: i64,
    ) -> rusqlite::Result<()> {
        conn.execute(
            "DELETE FROM photo_keyword WHERE photo_id=?1 AND keyword_id=?2",
            params![photo_id, keyword_id],
        )?;
        Ok(())
    }

    /// Replace one photo's keyword membership atomically. Vocabulary rows stay
    /// reusable; only this photo's links are replaced.
    pub fn replace_photo_keywords(
        conn: &Connection,
        photo_id: i64,
        names: &[String],
    ) -> rusqlite::Result<()> {
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM photo_keyword WHERE photo_id=?1",
            params![photo_id],
        )?;
        let mut seen = std::collections::HashSet::new();
        for name in names
            .iter()
            .map(|name| name.trim())
            .filter(|name| !name.is_empty())
        {
            if seen.insert(name) {
                add_keyword(&tx, photo_id, name)?;
            }
        }
        tx.commit()
    }

    /// A photo's keywords, alphabetical.
    pub fn list_photo_keywords(
        conn: &Connection,
        photo_id: i64,
    ) -> rusqlite::Result<Vec<KeywordRow>> {
        let mut stmt = conn.prepare(
            "SELECT k.id, k.name FROM photo_keyword pk JOIN keyword k ON k.id = pk.keyword_id
             WHERE pk.photo_id = ?1 ORDER BY k.name COLLATE NOCASE",
        )?;
        let rows = stmt
            .query_map(params![photo_id], |r| {
                Ok(KeywordRow {
                    id: r.get(0)?,
                    name: r.get(1)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    // ── Develop presets (global; a saved recipe applied to photos) ──

    /// Save a preset (upsert by name — re-saving a name overwrites it, LR-style);
    /// returns its id.
    pub fn add_preset(
        conn: &Connection,
        name: &str,
        recipe_json: &str,
        process_version: Option<i64>,
    ) -> rusqlite::Result<i64> {
        conn.query_row(
            "INSERT INTO preset(name, recipe_json, process_version, created_at)
             VALUES(?1,?2,?3,?4)
             ON CONFLICT(name) DO UPDATE SET
               recipe_json=excluded.recipe_json,
               process_version=excluded.process_version,
               created_at=excluded.created_at
             RETURNING id",
            params![name, recipe_json, process_version, now_secs()],
            |r| r.get(0),
        )
    }

    /// All presets, alphabetical.
    pub fn list_presets(conn: &Connection) -> rusqlite::Result<Vec<PresetRow>> {
        let mut stmt = conn.prepare(
            "SELECT id, name, recipe_json, process_version, created_at
             FROM preset ORDER BY name COLLATE NOCASE",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(PresetRow {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    recipe_json: r.get(2)?,
                    process_version: r.get(3)?,
                    created_at: r.get(4)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn delete_preset(conn: &Connection, id: i64) -> rusqlite::Result<()> {
        conn.execute("DELETE FROM preset WHERE id=?1", params![id])?;
        Ok(())
    }

    /// Save a metadata preset (upsert by name); returns its id. `fields_json`
    /// is the caller's whole per-field map, already validated as a JSON object.
    pub fn add_metadata_preset(
        conn: &Connection,
        name: &str,
        fields_json: &str,
    ) -> rusqlite::Result<i64> {
        conn.query_row(
            "INSERT INTO metadata_preset(name, fields_json, created_at)
             VALUES(?1,?2,?3)
             ON CONFLICT(name) DO UPDATE SET
               fields_json=excluded.fields_json, created_at=excluded.created_at
             RETURNING id",
            params![name, fields_json, now_secs()],
            |r| r.get(0),
        )
    }

    /// The `fields` map's value for `key`, if it is a non-blank string — the
    /// creator/copyright projection on [`MetadataPresetRow`].
    fn field_str(fields: &serde_json::Value, key: &str) -> Option<String> {
        nonblank(fields.get(key).and_then(serde_json::Value::as_str)).map(str::to_owned)
    }

    /// All metadata presets, alphabetical.
    pub fn list_metadata_presets(conn: &Connection) -> rusqlite::Result<Vec<MetadataPresetRow>> {
        let mut stmt = conn.prepare(
            "SELECT id, name, fields_json, created_at
             FROM metadata_preset ORDER BY name COLLATE NOCASE",
        )?;
        let rows = stmt
            .query_map([], |r| {
                let raw: String = r.get(2)?;
                // A row we cannot parse reads back as "writes nothing" rather
                // than failing the whole list — one bad preset is not a catalog.
                let fields = serde_json::from_str(&raw)
                    .ok()
                    .filter(serde_json::Value::is_object)
                    .unwrap_or_else(|| serde_json::json!({}));
                Ok(MetadataPresetRow {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    creator: field_str(&fields, "creator"),
                    copyright: field_str(&fields, "copyright"),
                    fields,
                    created_at: r.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn delete_metadata_preset(conn: &Connection, id: i64) -> rusqlite::Result<()> {
        conn.execute("DELETE FROM metadata_preset WHERE id=?1", params![id])?;
        Ok(())
    }

    // ── Collections + smart-collection rule AST ──────────────────
    //
    // A smart rule is `{ "match": "all"|"any", "rules": [...] }`, where an entry
    // is either a criterion `{field, op, value}` or a nested group with its own
    // `match` — LR's Option-click "any of / all of" nesting, so `A AND (B OR C)`
    // is expressible. Fields are whitelisted → columns; values bind as
    // parameters, so nothing from the AST is ever interpolated into SQL (no
    // injection surface).

    #[derive(serde::Deserialize)]
    struct SmartRule {
        #[serde(default = "match_all")]
        r#match: String,
        // Required: without it a malformed criterion would deserialize as an
        // all-defaults group and silently match every photo.
        rules: Vec<Node>,
    }
    fn match_all() -> String {
        "all".into()
    }

    /// A rule list entry. Criterion first: a group `{match, rules}` has none of
    /// the required criterion keys, so it can only match the `Group` arm.
    #[derive(serde::Deserialize)]
    #[serde(untagged)]
    enum Node {
        Criterion(Criterion),
        Group(SmartRule),
    }

    #[derive(serde::Deserialize)]
    struct Criterion {
        field: String,
        op: String,
        value: serde_json::Value,
    }

    fn text_of(v: &serde_json::Value) -> String {
        match v {
            serde_json::Value::String(s) => s.clone(),
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::Bool(b) => b.to_string(),
            _ => String::new(),
        }
    }

    /// Compile one criterion into a `(fragment_with_?_placeholders, binds)` pair.
    /// "YYYY-MM-DD" → epoch seconds at UTC midnight (Hinnant days_from_civil;
    /// no chrono dependency).
    fn date_to_epoch(s: &str) -> Result<i64, String> {
        let parts: Vec<i64> = s.split('-').map(|p| p.parse().unwrap_or(-1)).collect();
        let [y, m, d] = parts[..] else {
            return Err(format!("bad date '{s}' (want YYYY-MM-DD)"));
        };
        if !(1..=12).contains(&m) || !(1..=31).contains(&d) || y < 1 {
            return Err(format!("bad date '{s}' (want YYYY-MM-DD)"));
        }
        let y = if m <= 2 { y - 1 } else { y };
        let era = if y >= 0 { y } else { y - 399 } / 400;
        let yoe = y - era * 400;
        let mp = (m + 9) % 12;
        let doy = (153 * mp + 2) / 5 + d - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        Ok((era * 146097 + doe - 719468) * 86400)
    }

    /// Test-only re-export of the private date converter.
    #[cfg(test)]
    pub fn date_to_epoch_for_tests(s: &str) -> Result<i64, String> {
        date_to_epoch(s)
    }

    fn compile_criterion(c: &Criterion) -> Result<(String, Vec<rusqlite::types::Value>), String> {
        use rusqlite::types::Value;

        // Capture-date criteria: before/after take YYYY-MM-DD (UTC midnight);
        // inLast takes a rolling N-day window (SQLite supplies "now").
        if c.field == "captureDate" {
            return match c.op.as_str() {
                "before" => Ok((
                    "p.capture_time < ?".into(),
                    vec![Value::Integer(date_to_epoch(&text_of(&c.value))?)],
                )),
                "after" => Ok((
                    "p.capture_time >= ?".into(),
                    vec![Value::Integer(date_to_epoch(&text_of(&c.value))?)],
                )),
                "inLast" => {
                    let days = match &c.value {
                        serde_json::Value::Number(n) => n.as_i64().unwrap_or(0),
                        serde_json::Value::String(s) => s
                            .trim()
                            .parse()
                            .map_err(|_| "inLast expects a day count".to_string())?,
                        _ => return Err("inLast expects a day count".into()),
                    };
                    Ok((
                        "p.capture_time >= CAST(strftime('%s','now') AS INTEGER) - ? * 86400"
                            .into(),
                        vec![Value::Integer(days.max(0))],
                    ))
                }
                _ => Err(format!("op '{}' unsupported for captureDate", c.op)),
            };
        }

        // Yes/no predicates — compared against a boolean value, never a column.
        let bool_pred = match c.field.as_str() {
            "edited" => Some("p.develop_recipe IS NOT NULL"),
            "isVirtualCopy" => Some("p.is_virtual_copy != 0"),
            "hasSnapshot" => Some("EXISTS (SELECT 1 FROM snapshot sn WHERE sn.photo_id=p.id)"),
            "hasGps" => Some("(p.gps_lat IS NOT NULL AND p.gps_lon IS NOT NULL)"),
            _ => None,
        };
        if let Some(pred) = bool_pred {
            let wants = matches!(&c.value, serde_json::Value::Bool(true))
                || text_of(&c.value).eq_ignore_ascii_case("true");
            let frag = match (c.op.as_str(), wants) {
                ("eq", true) | ("ne", false) => pred.to_string(),
                ("eq", false) | ("ne", true) => format!("NOT ({pred})"),
                _ => return Err(format!("op '{}' unsupported for {}", c.op, c.field)),
            };
            return Ok((frag, vec![]));
        }

        // Keyword is a membership test, not a column compare.
        if c.field == "keyword" {
            if c.op == "empty" {
                return Ok((
                    "NOT EXISTS (SELECT 1 FROM photo_keyword pk WHERE pk.photo_id=p.id)".into(),
                    vec![],
                ));
            }
            if c.op == "notEmpty" {
                return Ok((
                    "EXISTS (SELECT 1 FROM photo_keyword pk WHERE pk.photo_id=p.id)".into(),
                    vec![],
                ));
            }
            let sub = "SELECT 1 FROM photo_keyword pk JOIN keyword k ON k.id=pk.keyword_id \
                       WHERE pk.photo_id=p.id AND k.name";
            let (frag, bind) = match c.op.as_str() {
                "eq" => (
                    format!("EXISTS ({sub} = ?)"),
                    Value::Text(text_of(&c.value)),
                ),
                "ne" => (
                    format!("NOT EXISTS ({sub} = ?)"),
                    Value::Text(text_of(&c.value)),
                ),
                "contains" => (
                    format!("EXISTS ({sub} LIKE ?)"),
                    Value::Text(format!("%{}%", text_of(&c.value))),
                ),
                _ => return Err(format!("op '{}' unsupported for keyword", c.op)),
            };
            return Ok((frag, vec![bind]));
        }

        let (col, numeric) = match c.field.as_str() {
            "rating" => ("p.rating", true),
            "flag" => ("p.flag", true),
            "iso" => ("p.iso", true),
            "fNumber" => ("p.f_number", true),
            "focalLength" => ("p.focal_length", true),
            "colorLabel" => ("p.color_label", false),
            "title" => ("p.title", false),
            "caption" => ("p.caption", false),
            "camera" => ("p.camera_model", false),
            "make" => ("p.camera_make", false),
            "lens" => ("p.lens", false),
            "filename" => ("s.path", false),
            // Directory part of the path: rtrim strips every trailing char that
            // is not '/', leaving "dir/…/" (trailing slash included).
            "folder" => ("rtrim(s.path, replace(s.path, '/', ''))", false),
            "format" => ("s.format", false),
            "copyName" => ("p.copy_name", false),
            "creator" => ("p.creator", false),
            "copyright" => ("p.copyright", false),
            "exposureTime" => ("p.exposure_time", true),
            "gpsLat" => ("p.gps_lat", true),
            "gpsLon" => ("p.gps_lon", true),
            "city" => ("p.city", false),
            "state" => ("p.state_province", false),
            "country" => ("p.country", false),
            "width" => ("p.width", true),
            "height" => ("p.height", true),
            "longEdge" => ("MAX(p.width, p.height)", true),
            "megapixels" => ("(p.width * p.height / 1000000.0)", true),
            // Height 0 can't happen (import rejects it) but SQLite would yield
            // NULL anyway, which simply fails every comparison.
            "aspectRatio" => ("(CAST(p.width AS REAL) / p.height)", true),
            "byteSize" => ("s.byte_size", true),
            _ => return Err(format!("unknown field '{}'", c.field)),
        };

        // Emptiness tests bind nothing and read naturally for text columns.
        if c.op == "empty" {
            return Ok((format!("({col} IS NULL OR {col} = '')"), vec![]));
        }
        if c.op == "notEmpty" {
            return Ok((format!("({col} IS NOT NULL AND {col} != '')"), vec![]));
        }

        // "doesn't contain" must keep NULL/empty columns — a bare NOT LIKE
        // evaluates to NULL against NULL and would silently drop them.
        if c.op == "notContains" {
            return Ok((
                format!("({col} IS NULL OR {col} NOT LIKE ?)"),
                vec![Value::Text(format!("%{}%", text_of(&c.value)))],
            ));
        }

        let bind = match c.op.as_str() {
            "contains" => Value::Text(format!("%{}%", text_of(&c.value))),
            "startsWith" => Value::Text(format!("{}%", text_of(&c.value))),
            "endsWith" => Value::Text(format!("%{}", text_of(&c.value))),
            _ if numeric => match &c.value {
                serde_json::Value::Number(n) => n
                    .as_i64()
                    .map(Value::Integer)
                    .unwrap_or_else(|| Value::Real(n.as_f64().unwrap_or(0.0))),
                serde_json::Value::String(s) => s
                    .parse::<f64>()
                    .map(Value::Real)
                    .map_err(|_| format!("field '{}' expects a number", c.field))?,
                _ => return Err(format!("field '{}' expects a number", c.field)),
            },
            _ => Value::Text(text_of(&c.value)),
        };

        let op_sql = match c.op.as_str() {
            "eq" => "=",
            "ne" => "!=",
            "gt" => ">",
            "lt" => "<",
            "gte" => ">=",
            "lte" => "<=",
            "contains" | "startsWith" | "endsWith" => "LIKE",
            _ => return Err(format!("unknown op '{}'", c.op)),
        };
        Ok((format!("{col} {op_sql} ?"), vec![bind]))
    }

    /// Compile one rule group (and, recursively, its nested groups).
    fn compile_group(rule: &SmartRule) -> Result<(String, Vec<rusqlite::types::Value>), String> {
        if rule.rules.is_empty() {
            return Ok(("1=1".into(), vec![]));
        }
        let join = if rule.r#match.eq_ignore_ascii_case("any") {
            " OR "
        } else {
            " AND "
        };
        let mut frags = Vec::with_capacity(rule.rules.len());
        let mut binds = Vec::new();
        for node in &rule.rules {
            let (frag, mut b) = match node {
                Node::Criterion(c) => compile_criterion(c)?,
                Node::Group(g) => compile_group(g)?,
            };
            frags.push(frag);
            binds.append(&mut b);
        }
        Ok((format!("({})", frags.join(join)), binds))
    }

    /// Compile a smart-rule AST (JSON) into a parameterized WHERE fragment over
    /// the `photo p JOIN source_asset s` aliases. Empty rules match all photos.
    // ponytail: recursion depth is bounded only by serde_json's own nesting
    // limit (128) — fine for hand-built rules; add an explicit depth cap if
    // rule ASTs ever arrive from somewhere less trusted than this app's UI.
    fn compile_smart_where(
        ast_json: &str,
    ) -> Result<(String, Vec<rusqlite::types::Value>), String> {
        let rule: SmartRule =
            serde_json::from_str(ast_json).map_err(|e| format!("bad rule ast: {e}"))?;
        compile_group(&rule)
    }

    fn invalid_collection(message: impl Into<String>) -> rusqlite::Error {
        rusqlite::Error::InvalidParameterName(message.into())
    }

    fn validate_collection_kind(kind: &str) -> rusqlite::Result<()> {
        if matches!(kind, "collection" | "set" | "smart") {
            Ok(())
        } else {
            Err(invalid_collection(format!(
                "invalid collection kind {kind:?}"
            )))
        }
    }

    /// A parent must exist and be a set. When editing an existing node, walking
    /// the candidate's ancestors also prevents self/descendant parenting.
    fn validate_collection_parent(
        conn: &Connection,
        id: Option<i64>,
        parent_id: Option<i64>,
    ) -> rusqlite::Result<()> {
        let Some(root) = parent_id else {
            return Ok(());
        };
        let mut current = root;
        let mut seen = std::collections::HashSet::new();
        loop {
            if Some(current) == id {
                return Err(invalid_collection(
                    "cannot put a collection inside itself or its descendant",
                ));
            }
            if !seen.insert(current) {
                return Err(invalid_collection("collection parent cycle"));
            }
            let row: Option<(String, Option<i64>)> = conn
                .query_row(
                    "SELECT kind, parent_id FROM collection WHERE id=?1",
                    params![current],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            let Some((kind, parent)) = row else {
                return Err(invalid_collection(format!(
                    "parent collection {current} does not exist"
                )));
            };
            if current == root && kind != "set" {
                return Err(invalid_collection("collection parent must be a set"));
            }
            let Some(next) = parent else {
                return Ok(());
            };
            current = next;
        }
    }

    /// Create a collection/set/smart node; returns its id. `rule_ast` is smart
    /// JSON or a stable marker for a reserved manual collection.
    pub fn create_collection(
        conn: &Connection,
        name: &str,
        kind: &str,
        parent_id: Option<i64>,
        rule_ast: Option<&str>,
    ) -> rusqlite::Result<i64> {
        let name = name.trim();
        if name.is_empty() {
            return Err(invalid_collection("collection name cannot be blank"));
        }
        validate_collection_kind(kind)?;
        validate_collection_parent(conn, None, parent_id)?;
        if kind == "smart" {
            compile_smart_where(rule_ast.unwrap_or(r#"{"match":"all","rules":[]}"#))
                .map_err(invalid_collection)?;
        }
        conn.query_row(
            "INSERT INTO collection(name, kind, parent_id, rule_ast, sort_order, created_at)
             VALUES(?1,?2,?3,?4,0,?5) RETURNING id",
            params![name, kind, parent_id, rule_ast, now_secs()],
            |r| r.get(0),
        )
    }

    /// Every collection node, ordered for the sidebar (sort_order, then name).
    pub fn list_collections(conn: &Connection) -> rusqlite::Result<Vec<CollectionRow>> {
        let mut stmt = conn.prepare(
            "SELECT id, name, kind, parent_id, rule_ast, sort_order, created_at
             FROM collection ORDER BY sort_order, name COLLATE NOCASE",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(CollectionRow {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    kind: r.get(2)?,
                    parent_id: r.get(3)?,
                    rule_ast: r.get(4)?,
                    sort_order: r.get(5)?,
                    created_at: r.get(6)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn rename_collection(conn: &Connection, id: i64, name: &str) -> rusqlite::Result<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(invalid_collection("collection name cannot be blank"));
        }
        let changed = conn.execute(
            "UPDATE collection SET name=?2 WHERE id=?1",
            params![id, name],
        )?;
        if changed == 1 {
            Ok(())
        } else {
            Err(invalid_collection(format!(
                "collection {id} does not exist"
            )))
        }
    }

    /// Replace a smart collection's rule AST (JSON).
    pub fn set_collection_rule(conn: &Connection, id: i64, rule_ast: &str) -> rusqlite::Result<()> {
        compile_smart_where(rule_ast).map_err(invalid_collection)?;
        let changed = conn.execute(
            "UPDATE collection SET rule_ast=?2 WHERE id=?1 AND kind='smart'",
            params![id, rule_ast],
        )?;
        if changed == 1 {
            Ok(())
        } else {
            Err(invalid_collection(format!(
                "collection {id} is not a smart collection"
            )))
        }
    }

    /// Edit name, parent and (for smart collections) rule in one statement.
    /// Manual collection markers in `rule_ast` remain untouched.
    pub fn update_collection(
        conn: &Connection,
        id: i64,
        name: &str,
        parent_id: Option<i64>,
        rule_ast: Option<&str>,
    ) -> rusqlite::Result<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(invalid_collection("collection name cannot be blank"));
        }
        let meta: Option<(String, Option<String>)> = conn
            .query_row(
                "SELECT kind, rule_ast FROM collection WHERE id=?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let Some((kind, old_rule)) = meta else {
            return Err(invalid_collection(format!(
                "collection {id} does not exist"
            )));
        };
        validate_collection_kind(&kind)?;
        validate_collection_parent(conn, Some(id), parent_id)?;
        let next_rule = if kind == "smart" {
            let rule = rule_ast
                .map(str::to_owned)
                .or(old_rule)
                .unwrap_or_else(|| r#"{"match":"all","rules":[]}"#.into());
            compile_smart_where(&rule).map_err(invalid_collection)?;
            Some(rule)
        } else {
            old_rule
        };
        conn.execute(
            "UPDATE collection SET name=?2, parent_id=?3, rule_ast=?4 WHERE id=?1",
            params![id, name, parent_id, next_rule],
        )?;
        Ok(())
    }

    /// Delete a collection (FK cascade drops its membership rows + child nodes).
    pub fn delete_collection(conn: &Connection, id: i64) -> rusqlite::Result<()> {
        conn.execute("DELETE FROM collection WHERE id=?1", params![id])?;
        Ok(())
    }

    fn require_manual_collection(conn: &Connection, id: i64) -> rusqlite::Result<()> {
        let kind: Option<String> = conn
            .query_row(
                "SELECT kind FROM collection WHERE id=?1",
                params![id],
                |r| r.get(0),
            )
            .optional()?;
        if kind.as_deref() == Some("collection") {
            Ok(())
        } else {
            Err(invalid_collection(format!(
                "collection {id} is not a manual collection"
            )))
        }
    }

    /// Add a photo to a manual collection (idempotent; appended at the end).
    pub fn add_photo_to_collection(
        conn: &Connection,
        collection_id: i64,
        photo_id: i64,
    ) -> rusqlite::Result<()> {
        require_manual_collection(conn, collection_id)?;
        conn.execute(
            "INSERT OR IGNORE INTO collection_photo(collection_id, photo_id, position)
             VALUES(?1, ?2,
               COALESCE((SELECT MAX(position)+1 FROM collection_photo WHERE collection_id=?1), 0))",
            params![collection_id, photo_id],
        )?;
        Ok(())
    }

    pub fn remove_photo_from_collection(
        conn: &Connection,
        collection_id: i64,
        photo_id: i64,
    ) -> rusqlite::Result<()> {
        require_manual_collection(conn, collection_id)?;
        conn.execute(
            "DELETE FROM collection_photo WHERE collection_id=?1 AND photo_id=?2",
            params![collection_id, photo_id],
        )?;
        Ok(())
    }

    /// Replace a manual collection's ordered membership in one transaction.
    pub fn replace_collection_members(
        conn: &Connection,
        collection_id: i64,
        photo_ids: &[i64],
    ) -> rusqlite::Result<()> {
        require_manual_collection(conn, collection_id)?;
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM collection_photo WHERE collection_id=?1",
            params![collection_id],
        )?;
        let mut seen = std::collections::HashSet::new();
        for (position, photo_id) in photo_ids.iter().filter(|id| seen.insert(**id)).enumerate() {
            tx.execute(
                "INSERT INTO collection_photo(collection_id, photo_id, position)
                 VALUES(?1,?2,?3)",
                params![collection_id, photo_id, position as i64],
            )?;
        }
        tx.commit()
    }

    /// Move selected manual-collection members one position in User Order.
    /// The DB owns the complete member list, so filtered-out photos are retained.
    pub fn move_collection_members(
        conn: &Connection,
        collection_id: i64,
        photo_ids: &[i64],
        delta: i64,
    ) -> rusqlite::Result<()> {
        require_manual_collection(conn, collection_id)?;
        if delta == 0 || photo_ids.is_empty() {
            return Ok(());
        }
        let tx = conn.unchecked_transaction()?;
        let mut ordered: Vec<i64> = {
            let mut stmt = tx.prepare(
                "SELECT photo_id FROM collection_photo
                 WHERE collection_id=?1 ORDER BY position, photo_id",
            )?;
            let rows = stmt
                .query_map(params![collection_id], |r| r.get(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        let selected: std::collections::HashSet<i64> = photo_ids.iter().copied().collect();
        if delta < 0 {
            for i in 1..ordered.len() {
                if selected.contains(&ordered[i]) && !selected.contains(&ordered[i - 1]) {
                    ordered.swap(i - 1, i);
                }
            }
        } else {
            for i in (0..ordered.len().saturating_sub(1)).rev() {
                if selected.contains(&ordered[i]) && !selected.contains(&ordered[i + 1]) {
                    ordered.swap(i, i + 1);
                }
            }
        }
        for (position, photo_id) in ordered.into_iter().enumerate() {
            tx.execute(
                "UPDATE collection_photo SET position=?3
                 WHERE collection_id=?1 AND photo_id=?2",
                params![collection_id, photo_id, position as i64],
            )?;
        }
        tx.commit()
    }

    /// Legacy helper: manual collections preserve User Order; smart collections
    /// keep their historical capture-desc order.
    pub fn list_collection_photos(
        conn: &Connection,
        collection_id: i64,
        limit: i64,
        offset: i64,
    ) -> rusqlite::Result<Vec<PhotoRow>> {
        list_collection_photos_sorted(
            conn,
            collection_id,
            limit,
            offset,
            GridSort {
                key: SortKey::User,
                ascending: true,
            },
        )
    }

    /// A collection's photos in the requested order. Manual collections read
    /// membership; smart collections evaluate their rule AST; sets have none.
    /// Offset-windowed so the client can drain a collection of any size.
    // ponytail: LIMIT/OFFSET windows over a deterministic order (id tiebreak),
    // not keyset — upgrade to a cursor if re-scanning hurts on huge catalogs.
    pub fn list_collection_photos_sorted(
        conn: &Connection,
        collection_id: i64,
        limit: i64,
        offset: i64,
        sort: GridSort,
    ) -> rusqlite::Result<Vec<PhotoRow>> {
        let limit = limit.max(1);
        let offset = offset.max(0);
        let meta: Option<(String, Option<String>)> = conn
            .query_row(
                "SELECT kind, rule_ast FROM collection WHERE id=?1",
                params![collection_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let Some((kind, rule_ast)) = meta else {
            return Ok(vec![]);
        };

        if kind == "smart" {
            let (frag, binds) =
                compile_smart_where(rule_ast.as_deref().unwrap_or(r#"{"rules":[]}"#))
                    .map_err(rusqlite::Error::InvalidParameterName)?;
            let order = grid_order(sort, None);
            let sql = format!(
                "SELECT {PHOTO_COLS} FROM photo p JOIN source_asset s ON s.id = p.source_asset_id
                 WHERE {frag} ORDER BY {order} LIMIT ? OFFSET ?"
            );
            let mut all = binds;
            all.push(rusqlite::types::Value::Integer(limit));
            all.push(rusqlite::types::Value::Integer(offset));
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt
                .query_map(rusqlite::params_from_iter(all), map_photo)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        } else {
            if kind == "set" {
                return Ok(vec![]);
            }
            let order = grid_order(sort, Some("cp.position"));
            let sql = format!(
                "SELECT {PHOTO_COLS} FROM photo p
                 JOIN source_asset s ON s.id = p.source_asset_id
                 JOIN collection_photo cp ON cp.photo_id = p.id
                 WHERE cp.collection_id = ?1
                 ORDER BY {order} LIMIT ?2 OFFSET ?3"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt
                .query_map(params![collection_id, limit, offset], map_photo)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        }
    }

    /// Every keyword with its photo usage count, name-ordered — the Keyword
    /// List panel's vocabulary browser.
    pub fn list_keywords(conn: &Connection) -> rusqlite::Result<Vec<KeywordCountRow>> {
        let mut stmt = conn.prepare(
            "SELECT k.id, k.name, COUNT(pk.photo_id), k.parent_id, k.synonyms,
                    k.include_on_export, k.export_containing, k.export_synonyms
             FROM keyword k LEFT JOIN photo_keyword pk ON pk.keyword_id = k.id
             GROUP BY k.id ORDER BY k.name COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(KeywordCountRow {
                id: r.get(0)?,
                name: r.get(1)?,
                count: r.get(2)?,
                parent_id: r.get(3)?,
                synonyms: r.get(4)?,
                include_on_export: r.get(5)?,
                export_containing: r.get(6)?,
                export_synonyms: r.get(7)?,
            })
        })?;
        rows.collect()
    }

    /// Photos tagged with a keyword (a browse source, like a collection).
    /// Offset-windowed so the client drains any tag count in bounded chunks.
    pub fn list_keyword_photos(
        conn: &Connection,
        keyword_id: i64,
        limit: i64,
        offset: i64,
    ) -> rusqlite::Result<Vec<PhotoRow>> {
        list_keyword_photos_sorted(conn, keyword_id, limit, offset, GridSort::default())
    }

    pub fn list_keyword_photos_sorted(
        conn: &Connection,
        keyword_id: i64,
        limit: i64,
        offset: i64,
        sort: GridSort,
    ) -> rusqlite::Result<Vec<PhotoRow>> {
        let limit = limit.max(1);
        let order = grid_order(sort, None);
        let sql = format!(
            "SELECT {PHOTO_COLS} FROM photo p
             JOIN source_asset s ON s.id = p.source_asset_id
             JOIN photo_keyword pk ON pk.photo_id = p.id
             WHERE pk.keyword_id = ?1
             ORDER BY {order} LIMIT ?2 OFFSET ?3"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![keyword_id, limit, offset.max(0)], map_photo)?;
        rows.collect()
    }

    /// Remove a keyword from the vocabulary; its whole subtree and every
    /// photo link cascade away.
    pub fn delete_keyword(conn: &Connection, keyword_id: i64) -> rusqlite::Result<()> {
        conn.execute("DELETE FROM keyword WHERE id=?1", params![keyword_id])?;
        Ok(())
    }

    // ── Catalog maintenance (backup / optimize / integrity) ──────
    // Generic to every database; monet-db owns them. Re-exported under `db::`
    // so the ~100 catalog call sites and the plugin commands read unchanged.
    pub use monet_db::{backup_to, integrity_check, optimize};

    /// Insert or replace a preview-cache record; returns its id.
    pub fn record_preview(conn: &Connection, rec: &PreviewRecord) -> rusqlite::Result<i64> {
        conn.query_row(
            "INSERT INTO preview(photo_id, kind, cache_key, width, height, file_path,
                 renderer_revision, byte_size, created_at, identity_json, provenance_json,
                 content_digest)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
             ON CONFLICT(photo_id, kind, cache_key) DO UPDATE SET
               width=excluded.width, height=excluded.height, file_path=excluded.file_path,
               renderer_revision=excluded.renderer_revision, byte_size=excluded.byte_size,
               created_at=excluded.created_at, identity_json=excluded.identity_json,
               provenance_json=excluded.provenance_json, content_digest=excluded.content_digest
             RETURNING id",
            params![
                rec.photo_id,
                rec.kind,
                rec.cache_key,
                rec.width,
                rec.height,
                rec.file_path,
                rec.renderer_revision,
                rec.byte_size,
                now_secs(),
                rec.identity_json,
                rec.provenance_json,
                rec.content_digest,
            ],
            |r| r.get(0),
        )
    }

    /// Look up a cached preview by identity (`None` = cache miss → render it).
    pub fn find_preview(
        conn: &Connection,
        photo_id: i64,
        kind: &str,
        cache_key: &str,
    ) -> rusqlite::Result<Option<PreviewRow>> {
        conn.query_row(
            "SELECT id, photo_id, kind, cache_key, width, height, file_path,
                    renderer_revision, byte_size, created_at, identity_json,
                    provenance_json, content_digest
             FROM preview WHERE photo_id=?1 AND kind=?2 AND cache_key=?3
            ",
            params![photo_id, kind, cache_key],
            |r| {
                Ok(PreviewRow {
                    id: r.get(0)?,
                    photo_id: r.get(1)?,
                    kind: r.get(2)?,
                    cache_key: r.get(3)?,
                    width: r.get(4)?,
                    height: r.get(5)?,
                    file_path: r.get(6)?,
                    renderer_revision: r.get(7)?,
                    byte_size: r.get(8)?,
                    created_at: r.get(9)?,
                    identity_json: r.get(10)?,
                    provenance_json: r.get(11)?,
                    content_digest: r.get(12)?,
                })
            },
        )
        .optional()
    }

    /// Renderer identity baked into every preview cache key: bump it when the
    /// decode/downscale path changes so stale on-disk previews are ignored.
    // 5: previews switched from PNG to JPEG (PERF-12) — stale PNG blobs miss.
    pub const PREVIEW_RENDERER_REVISION: i64 = 5;

    /// Stable cache key for a source-derived preview. The fingerprint is already a
    /// content digest (import-computed), so equal keys ⇒ identical source pixels;
    /// kind + size + renderer distinguish the derived variants. Filename-safe.
    pub fn preview_cache_key(identity: &PreviewIdentityV2) -> Result<String, String> {
        preview_identity_digest(identity)
            .map(|digest| digest.iter().map(|byte| format!("{byte:02x}")).collect())
            .map_err(|error| error.to_string())
    }

    /// Two-char-sharded relative path for a key (`ab/<key>.jpg`) so one directory
    /// never holds a whole catalog's previews.
    pub fn preview_rel_path(key: &str) -> String {
        let shard = key.get(..2).unwrap_or("__");
        format!("{shard}/{key}.jpg")
    }

    /// Drop every OTHER cached generation of (photo, kind) — the rows a re-edit
    /// supersedes — and return the rel paths whose blobs no row references any
    /// more (virtual copies of the same source can share a blob), so the caller
    /// can reclaim the files. Lightroom's "replaced in place".
    pub fn evict_superseded_previews(
        conn: &Connection,
        photo_id: i64,
        kind: &str,
        keep_key: &str,
    ) -> rusqlite::Result<Vec<String>> {
        let tx = conn.unchecked_transaction()?;
        let paths: Vec<String> = {
            let mut stmt = tx.prepare(
                "SELECT DISTINCT file_path FROM preview
                 WHERE photo_id=?1 AND kind=?2 AND cache_key<>?3",
            )?;
            let rows = stmt.query_map(params![photo_id, kind, keep_key], |r| r.get(0))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        tx.execute(
            "DELETE FROM preview WHERE photo_id=?1 AND kind=?2 AND cache_key<>?3",
            params![photo_id, kind, keep_key],
        )?;
        let mut orphaned = Vec::new();
        for path in paths {
            let referenced: Option<i64> = tx
                .query_row(
                    "SELECT 1 FROM preview WHERE file_path=?1 LIMIT 1",
                    params![path],
                    |r| r.get(0),
                )
                .optional()?;
            if referenced.is_none() {
                orphaned.push(path);
            }
        }
        tx.commit()?;
        Ok(orphaned)
    }

    /// Age/size eviction over the preview index (the SQL half of the GC):
    /// discard `one_to_one` rows older than the age limit (Lightroom's
    /// "Automatically Discard 1:1 Previews"), then the oldest rows of any kind
    /// until the summed byte_size fits the cap. `None` = keep forever / no cap.
    /// Returns rows deleted; the disk sweep reclaims the blobs afterwards.
    // ponytail: the cap sums byte_size per row, so a blob shared by virtual
    // copies double-counts — dedupe on file_path if that ever skews the cap.
    pub fn evict_previews(
        conn: &Connection,
        one_to_one_max_age_secs: Option<i64>,
        max_total_bytes: Option<i64>,
    ) -> rusqlite::Result<usize> {
        let tx = conn.unchecked_transaction()?;
        let mut deleted = 0usize;
        if let Some(max_age) = one_to_one_max_age_secs {
            deleted += tx.execute(
                "DELETE FROM preview WHERE kind='one_to_one' AND created_at < ?1",
                params![now_secs() - max_age.max(0)],
            )?;
        }
        if let Some(cap) = max_total_bytes {
            let cap = cap.max(0);
            let mut total: i64 =
                tx.query_row("SELECT COALESCE(SUM(byte_size), 0) FROM preview", [], |r| {
                    r.get(0)
                })?;
            if total > cap {
                let rows: Vec<(i64, i64)> = {
                    let mut stmt = tx.prepare(
                        "SELECT id, byte_size FROM preview ORDER BY created_at ASC, id ASC",
                    )?;
                    let mapped = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
                    mapped.collect::<rusqlite::Result<_>>()?
                };
                for (id, bytes) in rows {
                    if total <= cap {
                        break;
                    }
                    tx.execute("DELETE FROM preview WHERE id=?1", params![id])?;
                    total -= bytes;
                    deleted += 1;
                }
            }
        }
        tx.commit()?;
        Ok(deleted)
    }

    /// Every rel path the index still references — the keep-set for the disk
    /// sweep that reclaims cascade-orphaned and superseded blobs.
    pub fn preview_file_paths(
        conn: &Connection,
    ) -> rusqlite::Result<std::collections::HashSet<String>> {
        let mut stmt = conn.prepare("SELECT DISTINCT file_path FROM preview")?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        rows.collect()
    }

    /// Summed byte_size of every preview row (the cache's indexed footprint).
    pub fn preview_total_bytes(conn: &Connection) -> rusqlite::Result<i64> {
        conn.query_row("SELECT COALESCE(SUM(byte_size), 0) FROM preview", [], |r| {
            r.get(0)
        })
    }

    /// The master source fingerprint for a photo (None if photo/source is gone).
    pub fn source_fingerprint(
        conn: &Connection,
        photo_id: i64,
    ) -> rusqlite::Result<Option<String>> {
        conn.query_row(
            "SELECT s.fingerprint FROM photo p JOIN source_asset s ON s.id = p.source_asset_id
             WHERE p.id = ?1",
            params![photo_id],
            |r| r.get::<_, String>(0),
        )
        .optional()
    }

    // ── Catalog interchange (export a subset / merge another catalog) ────
    // Lightroom's "Export as Catalog…" and "Import from Another Catalog…" —
    // the laptop→desktop round-trip, and the split/merge workflow. Both are
    // DATABASE-only: source files stay where they are (the exported catalog
    // references the same paths), and previews are a regenerable cache keyed
    // to one catalog's root, so they are never carried across.
    // ponytail: no "Export negatives" / "Include Smart Previews" — that is a
    // file-copy job, and Import Photos' copy mode already owns copying files.
    // Add it here the day a catalog has to travel without its originals.

    /// What a merge did — the post-import summary, and what a dry run reports
    /// instead of writing.
    #[derive(Debug, Default, Serialize, PartialEq)]
    #[serde(rename_all = "camelCase")]
    pub struct MergeReport {
        pub photos_added: i64,
        /// Photos already here whose develop + metadata were taken from the
        /// incoming catalog (only when `replace_existing`).
        pub photos_updated: i64,
        /// Photos already here that were left exactly as they are.
        pub photos_skipped: i64,
        pub collections_added: i64,
        pub keywords_added: i64,
    }

    /// Write `ids` to a NEW catalog at `dest`; returns how many photos landed.
    ///
    /// Copy-then-prune, not create-then-insert: `VACUUM INTO` already yields a
    /// consistent copy with exactly this schema, and every child table is
    /// `ON DELETE CASCADE`, so one DELETE takes collection membership,
    /// snapshots, history and keyword links with it — and the keyword
    /// vocabulary, presets and collection tree come along like they do in LR.
    pub fn export_as_catalog(conn: &Connection, ids: &[i64], dest: &str) -> Result<i64, String> {
        if ids.is_empty() {
            return Err("select at least one photo to export".to_string());
        }
        let path = std::path::Path::new(dest);
        if path.exists() {
            // The save dialog already asked; `VACUUM INTO` refuses an existing file.
            std::fs::remove_file(path).map_err(|e| format!("replace {dest}: {e}"))?;
        }
        monet_db::vacuum_into(conn, path)?;
        let out = open(dest)?;
        // Row ids are i64 all the way from the store — no string ever reaches SQL.
        let list = ids
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join(",");
        // A virtual copy whose master is not selected would be cascaded away by
        // the master's own delete, so masters ride along whether picked or not.
        out.execute_batch(&format!(
            "DELETE FROM photo
              WHERE id NOT IN ({list})
                AND id NOT IN (SELECT master_photo_id FROM photo
                                WHERE id IN ({list}) AND master_photo_id IS NOT NULL);
             DELETE FROM source_asset WHERE id NOT IN (SELECT source_asset_id FROM photo);
             DELETE FROM preview;"
        ))
        .map_err(|e| e.to_string())?;
        let kept: i64 = out
            .query_row("SELECT COUNT(*) FROM photo", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        optimize(&out).map_err(|e| e.to_string())?; // reclaim the deleted pages
        Ok(kept)
    }

    /// Merge the catalog at `src_path` into the open one. `replace_existing`
    /// takes the incoming develop + metadata for photos already here (LR's
    /// "Replace: metadata and develop settings"); otherwise they are left
    /// untouched. `dry_run` reports what would happen and rolls back.
    pub fn import_from_catalog(
        conn: &Connection,
        src_path: &str,
        replace_existing: bool,
        dry_run: bool,
    ) -> Result<MergeReport, String> {
        let incoming = std::fs::canonicalize(src_path).map_err(|e| format!("{src_path}: {e}"))?;
        // Merging a catalog into itself would double every photo in it.
        if conn.path().and_then(|p| std::fs::canonicalize(p).ok()) == Some(incoming) {
            return Err("that catalog is already open — pick a different one".to_string());
        }
        // ATTACH cannot run inside a transaction, so the guard is DETACH-always.
        conn.execute("ATTACH DATABASE ?1 AS src", params![src_path])
            .map_err(|e| format!("open {src_path}: {e}"))?;
        let merged = merge_attached(conn, replace_existing, dry_run);
        let _ = conn.execute_batch("DETACH DATABASE src");
        merged
    }

    /// The merge with `src` attached: validate the stamp, then one transaction
    /// that either commits or (dry run / failure) rolls back.
    fn merge_attached(
        conn: &Connection,
        replace_existing: bool,
        dry_run: bool,
    ) -> Result<MergeReport, String> {
        let stamped: i64 = conn
            .query_row(
                "SELECT CAST(value AS INTEGER) FROM src.schema_meta WHERE key='version'",
                [],
                |r| r.get(0),
            )
            .map_err(|_| "that file is not a Galerie catalog".to_string())?;
        if stamped != SCHEMA_VERSION {
            return Err(format!(
                "that catalog is schema v{stamped}, this build reads v{SCHEMA_VERSION} — \
                 there is no upgrade path"
            ));
        }
        conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
        let report = merge_body(conn, replace_existing);
        // Counts are read inside the transaction (the temp maps roll back with it).
        let close = if dry_run || report.is_err() {
            "ROLLBACK"
        } else {
            "COMMIT"
        };
        let closed = conn.execute_batch(close).map_err(|e| e.to_string());
        let _ = conn.execute_batch(DROP_MERGE_MAPS);
        closed?;
        report
    }

    /// The temp id maps, dropped both before and after a merge — a committed
    /// merge leaves them behind, a rolled-back one does not.
    const DROP_MERGE_MAPS: &str = "DROP TABLE IF EXISTS temp.map_asset;
         DROP TABLE IF EXISTS temp.map_kw;
         DROP TABLE IF EXISTS temp.map_photo;
         DROP TABLE IF EXISTS temp.map_coll;";

    /// Every table, in FK order. Each merge step inserts what is missing, then
    /// records `src id → local id` in a temp map so the next step can re-point
    /// its foreign keys; self-references (keyword/collection parents, virtual
    /// copies' masters) go in NULL and are fixed up once the map is complete.
    fn merge_body(conn: &Connection, replace_existing: bool) -> Result<MergeReport, String> {
        // Incoming stack ids are shifted clear of ours — a stack id is only a
        // grouping token, so an offset keeps both catalogs' stacks intact.
        let stack_offset: i64 = conn
            .query_row("SELECT COALESCE(MAX(stack_id), 0) FROM main.photo", [], |r| {
                r.get(0)
            })
            .map_err(|e| e.to_string())?;
        conn.execute_batch(DROP_MERGE_MAPS)
            .map_err(|e| e.to_string())?;
        conn.execute_batch(&format!(
            r#"
-- 1. Source files, keyed by path: the same path is the same file.
INSERT OR IGNORE INTO main.source_asset(path, fingerprint, format, byte_size, mtime,
    imported_at, managed_path, dng_class, dng_ifd_evidence, source_device, source_inode,
    source_mtime_ns, source_ctime_ns, missing)
  SELECT path, fingerprint, format, byte_size, mtime, imported_at, managed_path, dng_class,
         dng_ifd_evidence, source_device, source_inode, source_mtime_ns, source_ctime_ns, missing
    FROM src.source_asset;
CREATE TEMP TABLE map_asset AS
  SELECT s.id AS src_id, m.id AS dst_id
    FROM src.source_asset s JOIN main.source_asset m ON m.path = s.path;

-- 2. Keywords merge by name (the vocabulary is name-unique).
CREATE TEMP TABLE map_kw(src_id INTEGER PRIMARY KEY, dst_id INTEGER NOT NULL,
                         existed INTEGER NOT NULL);
INSERT INTO map_kw SELECT s.id, m.id, 1
  FROM src.keyword s JOIN main.keyword m ON m.name = s.name;
INSERT OR IGNORE INTO main.keyword(name, parent_id, synonyms, include_on_export,
    export_containing, export_synonyms)
  SELECT name, NULL, synonyms, include_on_export, export_containing, export_synonyms
    FROM src.keyword WHERE id NOT IN (SELECT src_id FROM map_kw);
INSERT INTO map_kw SELECT s.id, m.id, 0
  FROM src.keyword s JOIN main.keyword m ON m.name = s.name
 WHERE s.id NOT IN (SELECT src_id FROM map_kw);
UPDATE main.keyword AS k SET parent_id = pk.dst_id
  FROM map_kw sk JOIN src.keyword s ON s.id = sk.src_id
                 JOIN map_kw pk ON pk.src_id = s.parent_id
 WHERE k.id = sk.dst_id AND sk.existed = 0;

-- 3. Photos. Identity across catalogs is (source file, virtual-copy name):
--    the same file catalogued twice is one photo, and each virtual copy of it
--    is its own.
-- ponytail: two virtual copies of one master that BOTH have no copy_name
--    collapse into one here. create_virtual_copy always names them, so this
--    only bites a hand-edited catalog; give copy_name a NOT NULL default to
--    close it for good.
CREATE TEMP TABLE map_photo(src_id INTEGER PRIMARY KEY, dst_id INTEGER NOT NULL,
                            existed INTEGER NOT NULL);
INSERT INTO map_photo SELECT s.id, MIN(m.id), 1
  FROM src.photo s
  JOIN map_asset ma ON ma.src_id = s.source_asset_id
  JOIN main.photo m ON m.source_asset_id = ma.dst_id
                   AND m.is_virtual_copy = s.is_virtual_copy
                   AND COALESCE(m.copy_name, '') = COALESCE(s.copy_name, '')
 GROUP BY s.id;
INSERT INTO main.photo(source_asset_id, is_virtual_copy, master_photo_id, copy_name, orientation,
    rating, flag, color_label, capture_time, added_time, sort_time, width, height, camera_make,
    camera_model, lens, iso, f_number, focal_length, exposure_time, gps_lat, gps_lon,
    develop_recipe, process_version, title, caption, creator, copyright, city, state_province,
    country, job_title, credit, source, stack_id, stack_order)
  SELECT ma.dst_id, s.is_virtual_copy, NULL, s.copy_name, s.orientation, s.rating, s.flag,
         s.color_label, s.capture_time, s.added_time, s.sort_time, s.width, s.height,
         s.camera_make, s.camera_model, s.lens, s.iso, s.f_number, s.focal_length,
         s.exposure_time, s.gps_lat, s.gps_lon, s.develop_recipe, s.process_version, s.title,
         s.caption, s.creator, s.copyright, s.city, s.state_province, s.country, s.job_title,
         s.credit, s.source, s.stack_id + {stack_offset}, s.stack_order
    FROM src.photo s JOIN map_asset ma ON ma.src_id = s.source_asset_id
   WHERE s.id NOT IN (SELECT src_id FROM map_photo);
INSERT INTO map_photo SELECT s.id, MAX(m.id), 0
  FROM src.photo s
  JOIN map_asset ma ON ma.src_id = s.source_asset_id
  JOIN main.photo m ON m.source_asset_id = ma.dst_id
                   AND m.is_virtual_copy = s.is_virtual_copy
                   AND COALESCE(m.copy_name, '') = COALESCE(s.copy_name, '')
 WHERE s.id NOT IN (SELECT src_id FROM map_photo)
 GROUP BY s.id;
UPDATE main.photo AS p SET master_photo_id = mp.dst_id
  FROM map_photo sp JOIN src.photo s ON s.id = sp.src_id
                    JOIN map_photo mp ON mp.src_id = s.master_photo_id
 WHERE p.id = sp.dst_id AND sp.existed = 0;

-- 4. Keyword links and snapshots follow every mapped photo; history only
--    follows NEW ones — it has no natural key, so re-merging would duplicate
--    the timeline of a photo we already had.
INSERT OR IGNORE INTO main.photo_keyword(photo_id, keyword_id)
  SELECT mp.dst_id, mk.dst_id FROM src.photo_keyword pk
    JOIN map_photo mp ON mp.src_id = pk.photo_id
    JOIN map_kw mk ON mk.src_id = pk.keyword_id;
INSERT OR IGNORE INTO main.snapshot(photo_id, name, recipe_json, process_version, created_at)
  SELECT mp.dst_id, s.name, s.recipe_json, s.process_version, s.created_at
    FROM src.snapshot s JOIN map_photo mp ON mp.src_id = s.photo_id;
INSERT INTO main.history_step(photo_id, label, recipe_json, process_version, created_at)
  SELECT mp.dst_id, h.label, h.recipe_json, h.process_version, h.created_at
    FROM src.history_step h JOIN map_photo mp ON mp.src_id = h.photo_id AND mp.existed = 0;

-- 5. Collections merge by (name, kind) — including the system markers, so
--    Quick Collection and Previous Import stay single.
CREATE TEMP TABLE map_coll(src_id INTEGER PRIMARY KEY, dst_id INTEGER NOT NULL,
                           existed INTEGER NOT NULL);
INSERT INTO map_coll SELECT s.id, MIN(m.id), 1
  FROM src.collection s JOIN main.collection m ON m.name = s.name AND m.kind = s.kind
 GROUP BY s.id;
INSERT INTO main.collection(name, kind, parent_id, rule_ast, sort_order, created_at)
  SELECT name, kind, NULL, rule_ast, sort_order, created_at
    FROM src.collection WHERE id NOT IN (SELECT src_id FROM map_coll);
INSERT INTO map_coll SELECT s.id, MAX(m.id), 0
  FROM src.collection s JOIN main.collection m ON m.name = s.name AND m.kind = s.kind
 WHERE s.id NOT IN (SELECT src_id FROM map_coll)
 GROUP BY s.id;
UPDATE main.collection AS c SET parent_id = pc.dst_id
  FROM map_coll sc JOIN src.collection s ON s.id = sc.src_id
                   JOIN map_coll pc ON pc.src_id = s.parent_id
 WHERE c.id = sc.dst_id AND sc.existed = 0;
INSERT OR IGNORE INTO main.collection_photo(collection_id, photo_id, position)
  SELECT mc.dst_id, mp.dst_id, cp.position FROM src.collection_photo cp
    JOIN map_coll mc ON mc.src_id = cp.collection_id
    JOIN map_photo mp ON mp.src_id = cp.photo_id;

-- 6. Presets are name-unique in both catalogs; ours win.
INSERT OR IGNORE INTO main.preset(name, recipe_json, process_version, created_at)
  SELECT name, recipe_json, process_version, created_at FROM src.preset;
INSERT OR IGNORE INTO main.metadata_preset(name, fields_json, created_at)
  SELECT name, fields_json, created_at FROM src.metadata_preset;
"#
        ))
        .map_err(|e| format!("merge: {e}"))?;

        if replace_existing {
            // Everything the user could have changed on the other machine.
            // Never the source columns (path/fingerprint/size) — those describe
            // the file on THIS disk, and step 1 already reconciled them.
            conn.execute_batch(
                "UPDATE main.photo AS p SET
                    develop_recipe = s.develop_recipe, process_version = s.process_version,
                    rating = s.rating, flag = s.flag, color_label = s.color_label,
                    orientation = s.orientation, capture_time = s.capture_time,
                    title = s.title, caption = s.caption, creator = s.creator,
                    copyright = s.copyright, city = s.city, state_province = s.state_province,
                    country = s.country, job_title = s.job_title, credit = s.credit,
                    source = s.source, gps_lat = s.gps_lat, gps_lon = s.gps_lon
                  FROM map_photo mp JOIN src.photo s ON s.id = mp.src_id
                 WHERE p.id = mp.dst_id AND mp.existed = 1;",
            )
            .map_err(|e| format!("merge replace: {e}"))?;
        }

        let count = |sql: &str| -> Result<i64, String> {
            conn.query_row(sql, [], |r| r.get(0)).map_err(|e| e.to_string())
        };
        let existing = count("SELECT COUNT(*) FROM map_photo WHERE existed = 1")?;
        Ok(MergeReport {
            photos_added: count("SELECT COUNT(*) FROM map_photo WHERE existed = 0")?,
            photos_updated: if replace_existing { existing } else { 0 },
            photos_skipped: if replace_existing { 0 } else { existing },
            collections_added: count("SELECT COUNT(*) FROM map_coll WHERE existed = 0")?,
            keywords_added: count("SELECT COUNT(*) FROM map_kw WHERE existed = 0")?,
        })
    }
}

/// On-disk preview blob store (no SQL): bytes live at `<root>/<shard>/<key>.jpg`,
/// the `preview` table indexes them. Free functions over a passed root so the IO
/// is unit-testable against a temp dir.
mod preview_store {
    use std::io;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

    /// Write `bytes` at `root/rel`, creating parent dirs.
    pub fn write(root: &Path, rel: &str, bytes: &[u8]) -> io::Result<()> {
        let full = root.join(rel);
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut tmp = None;
        for _ in 0..100 {
            let candidate = full.with_extension(format!(
                "tmp-{}-{}",
                std::process::id(),
                TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&candidate)
            {
                Ok(file) => {
                    tmp = Some((candidate, file));
                    break;
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            }
        }
        let (tmp, mut file) = tmp.ok_or_else(|| {
            io::Error::new(io::ErrorKind::AlreadyExists, "no unique preview temp file")
        })?;
        let result = (|| {
            use std::io::Write;
            file.write_all(bytes)?;
            file.sync_all()?;
            drop(file);
            std::fs::rename(&tmp, full)
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&tmp);
        }
        result
    }

    /// Read `root/rel`, or `None` if the file is missing (a stale DB record).
    pub fn read(root: &Path, rel: &str) -> io::Result<Option<Vec<u8>>> {
        match std::fs::read(root.join(rel)) {
            Ok(b) => Ok(Some(b)),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Delete `root/rel`; a missing file is fine (already reclaimed).
    pub fn remove(root: &Path, rel: &str) -> io::Result<()> {
        match std::fs::remove_file(root.join(rel)) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            other => other,
        }
    }

    /// Walk the two-level shard tree and delete every file whose rel path is
    /// not in `keep` — blobs orphaned by photo CASCADE deletes, superseded
    /// generations, and leaked temp files. Emptied shard dirs are pruned.
    /// Returns (files removed, bytes freed). A missing root is an empty cache.
    pub fn sweep_orphans(
        root: &Path,
        keep: &std::collections::HashSet<String>,
    ) -> io::Result<(u64, u64)> {
        let shards = match std::fs::read_dir(root) {
            Ok(shards) => shards,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok((0, 0)),
            Err(e) => return Err(e),
        };
        let (mut files, mut bytes) = (0u64, 0u64);
        for shard in shards {
            let shard = shard?;
            if !shard.file_type()?.is_dir() {
                continue;
            }
            let Some(shard_name) = shard.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            for entry in std::fs::read_dir(shard.path())? {
                let entry = entry?;
                if !entry.file_type()?.is_file() {
                    continue;
                }
                let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                    continue;
                };
                if keep.contains(&format!("{shard_name}/{name}")) {
                    continue;
                }
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                match std::fs::remove_file(entry.path()) {
                    Ok(()) => {
                        files += 1;
                        bytes += size;
                    }
                    Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                    Err(e) => return Err(e),
                }
            }
            // Only succeeds when the sweep emptied it — that's the point.
            let _ = std::fs::remove_dir(shard.path());
        }
        Ok((files, bytes))
    }

    /// Preview-cache root beside the catalog file (`<stem>-previews/`). `None` for
    /// an in-memory / pathless connection (tests) → no on-disk cache.
    pub fn root_for_catalog(db_path: &str) -> Option<PathBuf> {
        if db_path.is_empty() || db_path == ":memory:" {
            return None;
        }
        let p = Path::new(db_path);
        let stem = p.file_stem()?.to_str()?;
        Some(p.parent()?.join(format!("{stem}-previews")))
    }
}

// ─────────────────────────────────────────────────────────────
// Tauri commands (lock the open connection, delegate to `db`)
// ─────────────────────────────────────────────────────────────

/// Run `f` against the open connection, or error if no catalog is open.
fn with_conn<T>(
    state: &State<'_, CatalogState>,
    f: impl FnOnce(&Connection) -> rusqlite::Result<T>,
) -> Result<T, String> {
    state.with_conn(f)
}

fn canonical_recipe(recipe_json: &str, process_version: Option<i64>) -> Result<String, String> {
    let recipe = monet_photo_core::parse_recipe_json(recipe_json).map_err(|e| e.to_string())?;
    if process_version.is_some_and(|version| version != monet_photo_core::PROCESS_VERSION as i64) {
        return Err("process version does not match canonical recipe".into());
    }
    String::from_utf8(monet_photo_core::canonical_recipe_json(&recipe).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

fn raw_intent(recipe_json: Option<&str>) -> Result<crate::raw_decode::RawDecodeIntent, String> {
    let recipe = match recipe_json {
        Some(json) => monet_photo_core::parse_recipe_json(json).map_err(|e| e.to_string())?,
        None => monet_photo_core::legacy_params_v1_to_recipe(&[]).map_err(|e| e.to_string())?,
    };
    serde_json::from_value(recipe.value()["rawDecode"].clone()).map_err(|e| e.to_string())
}

fn preview_recipe(conn: &Connection, photo_id: i64) -> Result<String, String> {
    match db::get_recipe(conn, photo_id).map_err(|e| e.to_string())? {
        Some(recipe) => canonical_recipe(&recipe, None),
        None => {
            let recipe =
                monet_photo_core::legacy_params_v1_to_recipe(&[]).map_err(|e| e.to_string())?;
            String::from_utf8(
                monet_photo_core::canonical_recipe_json(&recipe).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())
        }
    }
}

fn reduced_scale(numerator: u32, denominator: u32) -> (u32, u32) {
    let (mut a, mut b) = (numerator, denominator);
    while b != 0 {
        (a, b) = (b, a % b);
    }
    (numerator / a, denominator / a)
}

fn portable_preview_facts(
    photo: &PhotoRow,
    max_edge: u32,
) -> Result<PreviewIdentityFactsV2, String> {
    if max_edge == 0 {
        return Err("preview edge must be positive".into());
    }
    let source_width = u32::try_from(photo.width).map_err(|_| "invalid catalog source width")?;
    let source_height = u32::try_from(photo.height).map_err(|_| "invalid catalog source height")?;
    let source_orientation =
        u8::try_from(photo.orientation).map_err(|_| "invalid catalog orientation")?;
    if source_width == 0 || source_height == 0 || !(1..=8).contains(&source_orientation) {
        return Err("invalid catalog source geometry".into());
    }
    let (oriented_width, oriented_height) = if (5..=8).contains(&source_orientation) {
        (source_height, source_width)
    } else {
        (source_width, source_height)
    };
    let source_long = oriented_width.max(oriented_height);
    let scale = (f64::from(max_edge) / f64::from(source_long)).min(1.0);
    let output_width = (f64::from(oriented_width) * scale).round() as u32;
    let output_height = (f64::from(oriented_height) * scale).round() as u32;
    let (scale_numerator, scale_denominator) =
        reduced_scale(output_width.max(output_height), source_long);
    Ok(PreviewIdentityFactsV2 {
        decoder_backend: "shared-wasm-codec".into(),
        backend_revision: "1".into(),
        decoder_version: "monet-render-engine".into(),
        os_build: "portable".into(),
        native_width: source_width,
        native_height: source_height,
        active_area: [0, 0, source_width, source_height],
        source_orientation,
        output_orientation: 1,
        orientation_applied: source_orientation != 1,
        working_profile_digest: sha256_hex(b"srgb"),
        output_width,
        output_height,
        scale_numerator,
        scale_denominator,
    })
}

fn raw_probe_facts(probe: crate::raw_decode::RawProbe) -> PreviewIdentityFactsV2 {
    PreviewIdentityFactsV2 {
        decoder_backend: probe.decoder_backend.into(),
        backend_revision: probe.backend_revision.into(),
        decoder_version: probe.decoder_version,
        os_build: probe.os_build,
        native_width: probe.native_width,
        native_height: probe.native_height,
        active_area: probe.active_area,
        source_orientation: probe.source_orientation,
        output_orientation: probe.output_orientation,
        orientation_applied: probe.orientation_applied,
        working_profile_digest: probe.working_profile_digest,
        output_width: probe.output_width,
        output_height: probe.output_height,
        scale_numerator: probe.scale_numerator,
        scale_denominator: probe.scale_denominator,
    }
}

fn raw_actual_facts(
    metadata: &crate::raw_decode::RawFrameMetadata,
) -> Result<PreviewIdentityFactsV2, String> {
    for (actual, expected, field) in [
        (
            metadata.color_space.as_str(),
            "extended-linear-srgb",
            "colorSpace",
        ),
        (metadata.sample_format.as_str(), "uint16", "sampleFormat"),
        (metadata.channel_order.as_str(), "rgba", "channelOrder"),
        (
            metadata.color_model.as_str(),
            "profiled-scene-linear-reference-rgb",
            "colorModel",
        ),
        (metadata.transfer.as_str(), "linear", "transfer"),
        (metadata.range.as_str(), "full", "range"),
        (metadata.alpha.as_str(), "opaque", "alpha"),
        (
            metadata.base_rendering.as_str(),
            "core-image-camera-profile",
            "baseRendering",
        ),
    ] {
        if actual != expected {
            return Err(format!("render provenance mismatch at {field}"));
        }
    }
    if metadata.output_orientation != 1
        || metadata.orientation_applied != (metadata.source_orientation != 1)
    {
        return Err("render provenance orientation mismatch".into());
    }
    crate::raw_decode::validate_native_pixel_count(metadata.native_width, metadata.native_height)?;
    let active_right = metadata.active_area[0]
        .checked_add(metadata.active_area[2])
        .ok_or("render provenance active area overflows")?;
    let active_bottom = metadata.active_area[1]
        .checked_add(metadata.active_area[3])
        .ok_or("render provenance active area overflows")?;
    if metadata.active_area[2] == 0
        || metadata.active_area[3] == 0
        || active_right > metadata.native_width
        || active_bottom > metadata.native_height
    {
        return Err("render provenance active area exceeds native source".into());
    }
    crate::raw_decode::validate_raw_metadata_provenance(metadata)?;
    let expected_scale = crate::raw_decode::reduced_scale(
        metadata.output_width,
        metadata.output_height,
        metadata.native_width,
        metadata.native_height,
    );
    if expected_scale != (metadata.scale_numerator, metadata.scale_denominator) {
        return Err("render provenance scale/native geometry mismatch".into());
    }
    Ok(PreviewIdentityFactsV2 {
        decoder_backend: metadata.decoder_backend.clone(),
        backend_revision: metadata.backend_revision.clone(),
        decoder_version: metadata.decoder_version.clone(),
        os_build: metadata.os_build.clone(),
        native_width: metadata.native_width,
        native_height: metadata.native_height,
        active_area: metadata.active_area,
        source_orientation: metadata.source_orientation,
        output_orientation: metadata.output_orientation,
        orientation_applied: metadata.orientation_applied,
        working_profile_digest: metadata.working_profile_digest.clone(),
        output_width: metadata.output_width,
        output_height: metadata.output_height,
        scale_numerator: metadata.scale_numerator,
        scale_denominator: metadata.scale_denominator,
    })
}

fn preview_identity_for(
    conn: &Connection,
    photo_id: i64,
    kind: &str,
    max_edge: u32,
    actual_raw: Option<&crate::raw_decode::RawFrameMetadata>,
) -> Result<PreviewIdentityV2, String> {
    let recipe = preview_recipe(conn, photo_id)?;
    preview_identity_for_recipe(conn, photo_id, kind, max_edge, actual_raw, &recipe)
}

fn preview_identity_for_recipe(
    conn: &Connection,
    photo_id: i64,
    kind: &str,
    max_edge: u32,
    actual_raw: Option<&crate::raw_decode::RawFrameMetadata>,
    recipe: &str,
) -> Result<PreviewIdentityV2, String> {
    let photo = db::get_photo(conn, photo_id)
        .map_err(|e| e.to_string())?
        .ok_or("preview photo is missing")?;
    let source_digest = db::source_fingerprint(conn, photo_id)
        .map_err(|e| e.to_string())?
        .ok_or("preview source is missing")?;
    let facts = if photo.format.starts_with("raw:") {
        if max_edge == 0 || max_edge > crate::raw_decode::PROXY_MAX_EDGE {
            return Err("RAW preview edge is outside the bounded proxy policy".into());
        }
        match actual_raw {
            Some(metadata) => {
                let intent = raw_intent(Some(recipe))?;
                if metadata.white_balance_mode != intent.mode
                    || !metadata.neutral_temperature.is_finite()
                    || !metadata.neutral_tint.is_finite()
                {
                    return Err("render provenance white-balance metadata mismatch".into());
                }
                raw_actual_facts(metadata)?
            }
            None => {
                let intent = raw_intent(Some(recipe))?;
                raw_probe_facts(crate::raw_decode::probe_for_preview(
                    &photo.path,
                    max_edge,
                    &intent,
                )?)
            }
        }
    } else if actual_raw.is_some() {
        return Err("portable preview cannot carry RAW provenance".into());
    } else {
        portable_preview_facts(&photo, max_edge)?
    };
    if facts.output_width > max_edge || facts.output_height > max_edge {
        return Err("render provenance exceeds the requested preview edge".into());
    }
    let identity = build_preview_identity(&source_digest, Some(recipe), facts, kind)
        .map_err(|e| e.to_string())?;
    if let Some(metadata) = actual_raw {
        if metadata.source_digest != identity.source_digest {
            return Err("render provenance source digest mismatch".into());
        }
        if metadata.decode_intent_digest != identity.decode_intent_digest {
            return Err("render provenance decode-intent digest mismatch".into());
        }
    }
    Ok(identity)
}

fn preview_request_for(
    conn: &Connection,
    photo_id: i64,
    kind: &str,
    max_edge: u32,
) -> Result<PreviewRequestV2, String> {
    let recipe_json = preview_recipe(conn, photo_id)?;
    let identity = preview_identity_for_recipe(conn, photo_id, kind, max_edge, None, &recipe_json)?;
    let cache_key = db::preview_cache_key(&identity)?;
    Ok(PreviewRequestV2 {
        identity,
        cache_key,
        recipe_json,
    })
}

fn render_provenance_for(
    identity: PreviewIdentityV2,
    actual_raw: Option<&crate::raw_decode::RawFrameMetadata>,
) -> Result<RenderProvenanceV2, String> {
    let provenance = match actual_raw {
        Some(metadata) => build_render_provenance(
            identity,
            metadata.base_rendering.clone(),
            "linearSrgbU16Full".into(),
            metadata.transfer.clone(),
            metadata.range.clone(),
            metadata.alpha.clone(),
        ),
        None => build_render_provenance(
            identity,
            "shared-wasm-codec".into(),
            "srgbEncodedU8".into(),
            "srgb".into(),
            "full".into(),
            "straight".into(),
        ),
    }
    .map_err(|e| e.to_string())?;
    validate_catalog_render_provenance(&provenance.identity, &provenance)?;
    Ok(provenance)
}

fn validate_catalog_render_provenance(
    expected: &PreviewIdentityV2,
    provenance: &RenderProvenanceV2,
) -> Result<(), String> {
    validate_render_provenance(expected, provenance).map_err(|e| e.to_string())?;
    let expected_contract = match expected.decoder_backend.as_str() {
        crate::raw_decode::BACKEND => (
            "core-image-camera-profile",
            "linearSrgbU16Full",
            "linear",
            "full",
            "opaque",
        ),
        "shared-wasm-codec" => (
            "shared-wasm-codec",
            "srgbEncodedU8",
            "srgb",
            "full",
            "straight",
        ),
        _ => return Err("unsupported render provenance backend".into()),
    };
    let actual_contract = (
        provenance.base_rendering.as_str(),
        provenance.pixel_encoding.as_str(),
        provenance.transfer.as_str(),
        provenance.range.as_str(),
        provenance.alpha_mode.as_str(),
    );
    if actual_contract != expected_contract {
        return Err("render provenance output contract mismatch".into());
    }
    Ok(())
}

fn read_preview_hit(
    root: &std::path::Path,
    identity: &PreviewIdentityV2,
    hit: &PreviewRow,
) -> PreviewRead {
    if hit.renderer_revision != db::PREVIEW_RENDERER_REVISION {
        return PreviewRead::miss(Some("legacy preview renderer revision".into()));
    }
    let expected_key = match db::preview_cache_key(identity) {
        Ok(key) => key,
        Err(error) => return PreviewRead::miss(Some(format!("invalid preview identity: {error}"))),
    };
    if hit.kind != identity.preview_kind
        || hit.cache_key != expected_key
        || hit.width != i64::from(identity.output_width)
        || hit.height != i64::from(identity.output_height)
        || hit.file_path != db::preview_rel_path(&expected_key)
    {
        return PreviewRead::miss(Some("stored preview index metadata mismatch".into()));
    }
    let Some(identity_json) = hit.identity_json.as_deref() else {
        return PreviewRead::miss(Some("legacy preview identity is missing".into()));
    };
    let stored_identity: PreviewIdentityV2 = match serde_json::from_str(identity_json) {
        Ok(value) => value,
        Err(error) => {
            return PreviewRead::miss(Some(format!("preview identity is corrupt: {error}")))
        }
    };
    if preview_identity_digest(&stored_identity).is_err() || stored_identity != *identity {
        return PreviewRead::miss(Some("stored preview identity mismatch".into()));
    }
    let Some(provenance_json) = hit.provenance_json.as_deref() else {
        return PreviewRead::miss(Some("legacy render provenance is missing".into()));
    };
    let provenance: RenderProvenanceV2 = match serde_json::from_str(provenance_json) {
        Ok(value) => value,
        Err(error) => {
            return PreviewRead::miss(Some(format!("render provenance is corrupt: {error}")))
        }
    };
    if let Err(error) = validate_catalog_render_provenance(identity, &provenance) {
        return PreviewRead::miss(Some(format!("render provenance mismatch: {error}")));
    }
    let Some(content_digest) = hit.content_digest.as_deref() else {
        return PreviewRead::miss(Some("legacy preview content digest is missing".into()));
    };
    match preview_store::read(root, &hit.file_path) {
        Ok(Some(bytes)) => {
            if i64::try_from(bytes.len()) != Ok(hit.byte_size) {
                return PreviewRead::miss(Some("preview cache byte-size mismatch".into()));
            }
            if sha256_hex(&bytes) != content_digest {
                return PreviewRead::miss(Some("preview cache content digest mismatch".into()));
            }
            PreviewRead {
                bytes: Some(bytes),
                diagnostic: None,
            }
        }
        Ok(None) => PreviewRead::miss(Some("preview cache file is missing".into())),
        Err(error) => PreviewRead::miss(Some(format!("preview cache read failed: {error}"))),
    }
}

#[cfg(target_os = "macos")]
fn open_source_nofollow(path: &Path) -> Result<(File, File, std::ffi::OsString), String> {
    extern "C" {
        fn openat(fd: i32, path: *const i8, flags: i32, ...) -> i32;
    }
    let parent_path = path.parent().ok_or("DNG source has no parent")?;
    let name = path
        .file_name()
        .ok_or("DNG source has no file name")?
        .to_os_string();
    let parent = File::open(parent_path).map_err(|e| format!("open DNG source parent: {e}"))?;
    let c = CString::new(name.as_bytes()).map_err(|_| "DNG source name contains NUL")?;
    let fd = unsafe { openat(parent.as_raw_fd(), c.as_ptr(), 0x0100 | 0x0100_0000) };
    if fd < 0 {
        return Err(format!(
            "open DNG source without following links: {}",
            std::io::Error::last_os_error()
        ));
    }
    let file = unsafe { File::from_raw_fd(fd) };
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("DNG source is not a regular file".into());
    }
    Ok((file, parent, name))
}

/// The full descriptor-identity tuple used throughout the managed-DNG
/// transaction to detect any change to a retained/reopened file: not just
/// `(device, inode)` (which misses an in-place same-inode byte mutation)
/// but also size and both mtime/ctime at nanosecond resolution.
#[cfg(target_os = "macos")]
type FullIdentity = monet_db::FileIdentity;

#[cfg(target_os = "macos")]
fn full_identity(meta: &std::fs::Metadata) -> FullIdentity {
    monet_db::file_identity(meta)
}

/// Stream a DNG source and return `(size, sha256)`. The chunk size is Galerie's
/// (`dng::STREAM_BUFFER`); the streaming digest itself is monet-db's.
#[cfg(target_os = "macos")]
fn digest_file(file: &File) -> Result<(u64, String), String> {
    monet_db::digest_file(file, crate::dng::STREAM_BUFFER)
}

#[cfg(target_os = "macos")]
fn managed_path(catalog: &Path, digest: &str) -> Result<PathBuf, String> {
    let parent = catalog.parent().ok_or("catalog has no parent")?;
    let stem = catalog
        .file_stem()
        .ok_or("catalog has no stem")?
        .to_string_lossy();
    Ok(parent
        .join(format!("{stem}-assets/managed-originals/sha256"))
        .join(&digest[..2])
        .join(format!("{digest}.dng")))
}

/// Deterministic fault-injection seams for `import_managed_dng`'s
/// transaction, so tests can exercise real interruption/failure boundaries
/// without sleeps. Production code always uses `ManagedDngImportHooks::default()`
/// (both hooks are no-ops).
#[cfg(target_os = "macos")]
pub struct ManagedDngImportHooks {
    /// Invoked after each successful read/write iteration of the bounded
    /// copy loop, with the cumulative byte count copied so far. Lets a test
    /// truncate or mutate the source file on disk mid-copy — the loop's own
    /// subsequent reads then observe the shortened/changed file, and the
    /// existing size/digest check catches the divergence deterministically.
    pub after_copy_chunk: Box<dyn FnMut(u64)>,
    /// Invoked once, immediately after publication succeeds (the managed
    /// original is durably visible on disk, permissioned `0400`) but
    /// before the pre-commit revalidation block re-checks source/parent
    /// identity. Lets a test replace the source's parent directory in this
    /// distinct window — separate from the publication `final_guard`,
    /// which already ran (successfully) before this point — to prove the
    /// pre-commit block's *own* parent-identity check independently
    /// catches a same-device parent replacement here too.
    pub after_publish: Box<dyn FnMut()>,
    /// Invoked once, immediately before the SQLite transaction is opened —
    /// after every pre-commit revalidation has already passed and the
    /// managed original is durably published on disk. Returning `Err`
    /// simulates a DB-layer failure at exactly that point: the function
    /// returns without ever opening the transaction, leaving the just-
    /// published object as a verified, unreferenced orphan for
    /// `cleanup_stale_managed_objects` to reclaim later.
    pub before_commit: Box<dyn FnMut() -> Result<(), String>>,
    /// Invoked once, immediately before the published managed original's
    /// permission-change (`fchmod` to `0400`) is followed by its own
    /// `sync_all`. Returning `Err` simulates that final `fsync` failing —
    /// after the file is already durably published and made read-only, but
    /// before the transaction that would give it a catalog row.
    pub before_permission_sync: Box<dyn FnMut() -> Result<(), String>>,
    /// Forwarded verbatim as the underlying `AtomicStagedFile::publish`
    /// call's own `PublishHooks::before_step` — lets a test inject a
    /// failure at any of *that* primitive's named checkpoints (staged
    /// sync/reopen, the rename itself, post-publication reopen/digest/
    /// sync, parent sync) through the managed-import transaction's own
    /// public entry point, proving the catalog layer's own handling of a
    /// real post-visibility `durability_warning` (refuses to add a row,
    /// preserves the verified orphan) — not only the DB-layer
    /// `before_commit` failure, a structurally different injection point.
    pub before_publish_step:
        Box<dyn FnMut(crate::atomic_publish::PublishStep) -> Result<(), String>>,
}

#[cfg(target_os = "macos")]
impl Default for ManagedDngImportHooks {
    fn default() -> Self {
        Self {
            after_copy_chunk: Box::new(|_| {}),
            after_publish: Box::new(|| {}),
            before_commit: Box::new(|| Ok(())),
            before_publish_step: Box::new(|_| Ok(())),
            before_permission_sync: Box::new(|| Ok(())),
        }
    }
}

#[cfg(target_os = "macos")]
pub fn import_managed_dng(conn: &mut Connection, photo: ImportPhoto) -> Result<i64, String> {
    import_managed_dng_with_hooks(conn, photo, ManagedDngImportHooks::default())
}

#[cfg(target_os = "macos")]
fn import_managed_dng_with_hooks(
    conn: &mut Connection,
    photo: ImportPhoto,
    mut hooks: ManagedDngImportHooks,
) -> Result<i64, String> {
    if photo.fingerprint.len() != 64 || !photo.fingerprint.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("managed DNG import requires SHA-256 fingerprint".into());
    }
    let source_path = Path::new(&photo.path);
    let (source, parent, name) = open_source_nofollow(source_path)?;
    let parent_meta = parent.metadata().map_err(|e| e.to_string())?;
    // (device, inode), not device alone — a same-device replacement of the
    // parent directory (remove-then-recreate, or a bind/union-mount trick)
    // must be detectable even when it happens to preserve the file's own
    // name-to-inode binding.
    let parent_identity = (parent_meta.dev(), parent_meta.ino());
    let initial = source.metadata().map_err(|e| e.to_string())?;
    let source_identity = full_identity(&initial);
    let (size, digest) = digest_file(&source)?;
    if digest != photo.fingerprint || size != photo.byte_size as u64 {
        return Err("native DNG identity differs from import preflight".into());
    }
    let evidence = crate::dng::classify(&mut source.try_clone().map_err(|e| e.to_string())?)?;
    let catalog = PathBuf::from(
        conn.path()
            .filter(|p| !p.is_empty())
            .ok_or("managed import requires a file catalog")?,
    );
    let destination = managed_path(&catalog, &digest)?;
    let shard_path = destination
        .parent()
        .ok_or("managed path has no parent")?
        .to_path_buf();
    let shard_name = shard_path
        .file_name()
        .ok_or("managed path has no shard component")?
        .to_os_string();
    let file_name = destination
        .file_name()
        .ok_or("managed path has no file name")?
        .to_os_string();

    // Descriptor-relative, no-follow traversal/creation of the managed
    // root: `<stem>-assets/managed-originals/sha256/<shard>`, each level
    // opened by descriptor (never a pathname-based `create_dir_all`/
    // `set_permissions`, which would follow a symlink planted at any
    // ancestor component).
    let catalog_dir_path = catalog
        .parent()
        .ok_or("catalog has no parent")?
        .to_path_buf();
    let catalog_dir =
        File::open(&catalog_dir_path).map_err(|e| format!("open catalog directory: {e}"))?;
    let stem = catalog
        .file_stem()
        .ok_or("catalog has no stem")?
        .to_string_lossy()
        .into_owned();
    let assets_dir = crate::atomic_publish::ensure_dir_nofollow(
        &catalog_dir,
        std::ffi::OsStr::new(&format!("{stem}-assets")),
    )?;
    let managed_originals_dir = crate::atomic_publish::ensure_dir_nofollow(
        &assets_dir,
        std::ffi::OsStr::new("managed-originals"),
    )?;
    let sha256_dir = crate::atomic_publish::ensure_dir_nofollow(
        &managed_originals_dir,
        std::ffi::OsStr::new("sha256"),
    )?;
    let shard_dir = crate::atomic_publish::ensure_dir_nofollow(&sha256_dir, &shard_name)?;

    let mut staged =
        crate::atomic_publish::AtomicStagedFile::create_in(shard_dir, shard_path, &file_name)?;
    let mut writer = staged.writer()?;
    let mut input = source.try_clone().map_err(|e| e.to_string())?;
    input.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    // Stream-copy with a bounded 1 MiB buffer while hashing, so a hostile
    // or merely huge source never forces unbounded buffering, and a
    // digest mismatch is caught immediately rather than only after a
    // second full read during publication.
    let mut copy_hash = Sha256::new();
    let mut copy_buffer = vec![0u8; crate::dng::STREAM_BUFFER];
    let mut copied = 0u64;
    loop {
        let n = input
            .read(&mut copy_buffer)
            .map_err(|e| format!("read DNG source: {e}"))?;
        if n == 0 {
            break;
        }
        writer
            .write_all(&copy_buffer[..n])
            .map_err(|e| format!("copy managed DNG: {e}"))?;
        copy_hash.update(&copy_buffer[..n]);
        copied = copied
            .checked_add(n as u64)
            .ok_or("managed DNG copy size overflow")?;
        (hooks.after_copy_chunk)(copied);
    }
    drop(writer);
    if copied != size || format!("{:x}", copy_hash.finalize()) != digest {
        return Err("managed DNG copy size or digest mismatch".into());
    }
    let expected = evidence.clone();
    let guard_source = source.try_clone().map_err(|e| e.to_string())?;
    let guard_identity = source_identity;
    let guard_expected_size = size;
    let guard_expected_digest = digest.clone();
    let guard_source_path = source_path.to_path_buf();
    let guard_parent_path = source_path
        .parent()
        .ok_or("DNG source has no parent")?
        .to_path_buf();
    let guard_parent_identity = parent_identity;
    let publish_hooks = crate::atomic_publish::PublishHooks {
        // Revalidate the *complete* source-evidence chain as late as
        // possible, immediately at the publication boundary, right before
        // the rename that makes the managed original visible — mirroring
        // `atomic_publish`'s own `assert_parent_identity` for the
        // *staging* directory. Every check here catches a distinct attack
        // the others cannot: (1) the retained descriptor's own full
        // identity (device, inode, size, mtime/ctime at nanosecond
        // resolution) — not `(device, inode)` alone, which misses an
        // in-place same-inode byte mutation; (2) a full re-digest of the
        // retained descriptor's bytes via the bounded stream helper —
        // defense-in-depth beyond (1) for any environment where
        // mtime/ctime resolution or propagation cannot be trusted to
        // reflect every byte-level write; (3) a *fresh*, no-follow,
        // pathname-based reopen of the named final component and its own
        // full identity — a retained descriptor can never observe the name
        // now resolving to a different file or a symlink; (4) a fresh
        // pathname reopen of the source parent directory's identity — the
        // same reasoning, for a parent replacement that happens to
        // preserve the original file's own inode via a hard link. This
        // transaction has no cancellation token to recheck (unlike the
        // Linear DNG export job, `import_managed_dng` is not
        // cancellable — see `ManagedDngImportHooks`'s docs).
        final_guard: Box::new(move || {
            let meta = guard_source.metadata().map_err(|e| e.to_string())?;
            if full_identity(&meta) != guard_identity {
                return Err("DNG source identity changed immediately before publication".into());
            }
            let (fresh_size, fresh_digest) = digest_file(&guard_source)?;
            if fresh_size != guard_expected_size || fresh_digest != guard_expected_digest {
                return Err("DNG source bytes changed immediately before publication".into());
            }
            let (named, _named_parent, _named_name) = open_source_nofollow(&guard_source_path)
                .map_err(|e| {
                    format!(
                        "DNG source named component changed immediately before publication: {e}"
                    )
                })?;
            let named_meta = named.metadata().map_err(|e| e.to_string())?;
            if full_identity(&named_meta) != guard_identity {
                return Err(
                    "DNG source named component changed immediately before publication".into(),
                );
            }
            let fresh_parent = File::open(&guard_parent_path)
                .map_err(|e| format!("reopen DNG source parent for identity check: {e}"))?;
            let parent_meta = fresh_parent.metadata().map_err(|e| e.to_string())?;
            if (parent_meta.dev(), parent_meta.ino()) != guard_parent_identity {
                return Err(
                    "DNG source parent directory changed immediately before publication".into(),
                );
            }
            Ok(())
        }),
        before_step: hooks.before_publish_step,
        ..Default::default()
    };
    let outcome = staged.publish(
        size,
        &digest,
        |f| {
            let actual = crate::dng::classify(f)?;
            if actual != expected {
                return Err("managed DNG classification changed during copy".into());
            }
            Ok(())
        },
        publish_hooks,
    )?;
    let crate::atomic_publish::PublishOutcome::Committed {
        file: published,
        durability_warning,
    } = outcome;
    // A managed original must never produce a catalog row unless its
    // publication was fully confirmed durable — an unconfirmed object may
    // remain on disk as a verified orphan for later cleanup, but the
    // transaction stops here rather than commit against uncertain state.
    if let Some(warning) = durability_warning {
        return Err(format!(
            "managed DNG publication durability warning: {warning}"
        ));
    }
    let published = published.ok_or("managed DNG publication produced no reopened handle")?;
    extern "C" {
        fn fchmod(fd: i32, mode: u32) -> i32;
    }
    if unsafe { fchmod(published.as_raw_fd(), 0o400) } < 0 {
        return Err(format!(
            "make managed DNG immutable: {}",
            std::io::Error::last_os_error()
        ));
    }
    (hooks.before_permission_sync)().map_err(|e| format!("sync managed DNG permissions: {e}"))?;
    published
        .sync_all()
        .map_err(|e| format!("sync managed DNG permissions: {e}"))?;
    (hooks.after_publish)();
    let existing: Option<String> = conn
        .query_row(
            "SELECT fingerprint FROM source_asset WHERE path=?1",
            params![photo.path],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if existing.as_deref().is_some_and(|v| v != digest) {
        return Err("same DNG path was already imported with different bytes".into());
    }
    let current = source.metadata().map_err(|e| e.to_string())?;
    let named = open_source_nofollow(source_path)?;
    let named_meta = named.0.metadata().map_err(|e| e.to_string())?;
    let named_parent_meta = named.1.metadata().map_err(|e| e.to_string())?;
    let observed = full_identity(&current);
    // Parent identity is (device, inode), not device alone — see
    // `parent_identity` above.
    if observed != source_identity
        || named_meta.dev() != source_identity.0
        || named_meta.ino() != source_identity.1
        || parent_identity != (named_parent_meta.dev(), named_parent_meta.ino())
        || digest_file(&source)?.1 != digest
    {
        return Err("DNG source changed before catalog commit".into());
    }
    drop(name);
    // Deterministic DB-failure injection point: after every pre-commit
    // revalidation has passed and the managed original is durably
    // published, but before the transaction that would give it a catalog
    // row. A hook failure here leaves a verified, unreferenced orphan for
    // `cleanup_stale_managed_objects` to reclaim.
    (hooks.before_commit)()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let id = db::import_photo(&tx, &photo).map_err(|e| e.to_string())?;
    tx.execute("UPDATE source_asset SET managed_path=?1,dng_class=?2,dng_ifd_evidence=?3,source_device=?4,source_inode=?5,source_mtime_ns=?6,source_ctime_ns=?7 WHERE id=(SELECT source_asset_id FROM photo WHERE id=?8)",params![destination.to_string_lossy(),match evidence.class{crate::dng::DngClass::Cfa=>"cfa",crate::dng::DngClass::LinearRaw=>"linearRaw"},serde_json::to_string(&evidence).map_err(|e|e.to_string())?,source_identity.0 as i64,source_identity.1 as i64,source_identity.3.saturating_mul(1_000_000_000)+source_identity.4,source_identity.5.saturating_mul(1_000_000_000)+source_identity.6,id]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(id)
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn catalog_import_managed_dng(
    state: State<'_, CatalogState>,
    photo: ImportPhoto,
) -> Result<i64, String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|e| format!("catalog lock poisoned: {e}"))?;
    import_managed_dng(guard.as_mut().ok_or("no catalog open")?, photo)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn catalog_import_managed_dng(
    _state: State<'_, CatalogState>,
    _photo: ImportPhoto,
) -> Result<i64, String> {
    Err("managed DNG import currently requires macOS".into())
}

/// Remove stale, unreferenced managed-original artifacts under
/// `<catalog-stem>-assets/managed-originals/sha256/`: owned temp files
/// (`.monet-stage-*`, left behind by a crashed/interrupted import) and
/// content-addressed `.dng` objects no `source_asset.managed_path` row
/// references, when older than 24 hours. A referenced object is never
/// removed regardless of age. Traversal is no-follow at every directory
/// level and rejects a symlink standing in for a shard or an object.
/// `now` is caller-injected so tests never depend on real time or sleeps.
/// Best-effort: a missing managed root, or any single I/O error, is not
/// fatal to opening the catalog.
#[cfg(target_os = "macos")]
fn cleanup_stale_managed_objects(conn: &Connection, now: SystemTime) -> Result<(), String> {
    const CUTOFF_SECS: u64 = 24 * 60 * 60;
    const O_RDONLY: i32 = 0;
    const O_NOFOLLOW: i32 = 0x0100;
    const O_CLOEXEC: i32 = 0x0100_0000;

    let Some(catalog_path) = conn.path().filter(|p| !p.is_empty()) else {
        return Ok(()); // in-memory catalog: nothing on disk to clean
    };
    let catalog = PathBuf::from(catalog_path);
    let Some(parent) = catalog.parent() else {
        return Ok(());
    };
    let Some(stem) = catalog.file_stem() else {
        return Ok(());
    };
    let stem = stem.to_string_lossy().into_owned();

    let open_dir_nofollow = |parent: &File, name: &str| -> Option<File> {
        crate::atomic_publish::openat_file(
            parent,
            std::ffi::OsStr::new(name),
            O_RDONLY | O_NOFOLLOW | O_CLOEXEC,
            0,
        )
        .ok()
        .filter(|f| f.metadata().map(|m| m.is_dir()).unwrap_or(false))
    };
    let Ok(catalog_dir) = File::open(parent) else {
        return Ok(());
    };
    let Some(assets_dir) = open_dir_nofollow(&catalog_dir, &format!("{stem}-assets")) else {
        return Ok(());
    };
    let Some(managed_dir) = open_dir_nofollow(&assets_dir, "managed-originals") else {
        return Ok(());
    };
    let Some(sha256_dir) = open_dir_nofollow(&managed_dir, "sha256") else {
        return Ok(());
    };

    let referenced: std::collections::HashSet<String> = conn
        .prepare("SELECT managed_path FROM source_asset WHERE managed_path IS NOT NULL")
        .and_then(|mut stmt| {
            stmt.query_map([], |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<std::collections::HashSet<_>>>()
        })
        .map_err(|e| e.to_string())?;

    let sha256_path = parent.join(format!("{stem}-assets/managed-originals/sha256"));
    let Ok(shard_entries) = std::fs::read_dir(&sha256_path) else {
        return Ok(());
    };
    for shard in shard_entries.flatten() {
        // lstat, never following: a symlinked shard is skipped entirely.
        let Ok(shard_meta) = std::fs::symlink_metadata(shard.path()) else {
            continue;
        };
        if shard_meta.file_type().is_symlink() || !shard_meta.is_dir() {
            continue;
        }
        let shard_name = shard.file_name().to_string_lossy().into_owned();
        if open_dir_nofollow(&sha256_dir, &shard_name).is_none() {
            continue; // no-follow confirmation failed; do not descend
        }
        let shard_path = sha256_path.join(&shard_name);
        let Ok(objects) = std::fs::read_dir(&shard_path) else {
            continue;
        };
        for object in objects.flatten() {
            let object_path = object.path();
            let Ok(meta) = std::fs::symlink_metadata(&object_path) else {
                continue;
            };
            if meta.file_type().is_symlink() || !meta.is_file() {
                continue;
            }
            let name = object.file_name().to_string_lossy().into_owned();
            let is_owned_temp = name.starts_with(".monet-stage-");
            let is_digest_object = !is_owned_temp && name.ends_with(".dng");
            if !is_owned_temp && !is_digest_object {
                continue;
            }
            if is_digest_object && referenced.contains(&object_path.to_string_lossy().into_owned())
            {
                continue;
            }
            let Ok(modified) = meta.modified() else {
                continue;
            };
            let age = now.duration_since(modified).unwrap_or_default();
            if age.as_secs() < CUTOFF_SECS {
                continue;
            }
            let _ = std::fs::remove_file(&object_path);
        }
    }
    Ok(())
}

/// Open (creating if absent) the catalog at `path` and return its schema version.
///
/// A bare `.galcat` is a LIVE database with no container around it — so this
/// also ends any `.mgal` session, or the next "Save As" would snapshot this
/// catalog back into the container the previous one came out of.
#[tauri::command]
fn catalog_open(
    state: State<'_, CatalogState>,
    container: State<'_, ContainerState>,
    path: String,
) -> Result<i64, String> {
    let conn = db::open(&path).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    {
        // Best-effort: never block opening the catalog on cleanup.
        let _ = cleanup_stale_managed_objects(&conn, SystemTime::now());
    }
    let version = db::version(&conn).map_err(|e| e.to_string())?;
    // The old connection drops HERE, before the session guard below removes the
    // working copy it was reading.
    *state
        .0
        .lock()
        .map_err(|e| format!("catalog lock poisoned: {e}"))? = Some(conn);
    *container.lock()? = None;
    Ok(version)
}

/// Close the open catalog (drops the connection; flushes WAL).
#[tauri::command]
fn catalog_close(
    state: State<'_, CatalogState>,
    container: State<'_, ContainerState>,
) -> Result<(), String> {
    *state
        .0
        .lock()
        .map_err(|e| format!("catalog lock poisoned: {e}"))? = None;
    // After the connection, never before: dropping the session removes the
    // extracted working copy.
    *container.lock()? = None;
    Ok(())
}

#[tauri::command]
fn catalog_integrity_check(state: State<'_, CatalogState>) -> Result<String, String> {
    with_conn(&state, db::integrity_check)
}

/// Optimize also runs the preview-cache GC with the default policy, so the
/// cache stays bounded without a separate maintenance chore.
#[tauri::command]
fn catalog_optimize(state: State<'_, CatalogState>) -> Result<(), String> {
    let guard = state
        .0
        .lock()
        .map_err(|e| format!("catalog lock poisoned: {e}"))?;
    let conn = guard.as_ref().ok_or("no catalog open")?;
    db::optimize(conn).map_err(|e| e.to_string())?;
    if let Some(root) = conn.path().and_then(preview_store::root_for_catalog) {
        preview_gc(
            conn,
            &root,
            Some(PREVIEW_ONE_TO_ONE_MAX_AGE_SECS),
            Some(PREVIEW_MAX_TOTAL_BYTES),
        )?;
    }
    Ok(())
}

#[tauri::command]
fn catalog_backup(state: State<'_, CatalogState>, dest: String) -> Result<(), String> {
    let guard = state
        .0
        .lock()
        .map_err(|e| format!("catalog lock poisoned: {e}"))?;
    let conn = guard.as_ref().ok_or("no catalog open")?;
    db::backup_to(conn, &dest)
}

/// "Export as Catalog…" — write `ids` to a new `.galcat`; returns the count.
#[tauri::command]
fn catalog_export_as_catalog(
    state: State<'_, CatalogState>,
    ids: Vec<i64>,
    dest: String,
) -> Result<i64, String> {
    let guard = state
        .0
        .lock()
        .map_err(|e| format!("catalog lock poisoned: {e}"))?;
    let conn = guard.as_ref().ok_or("no catalog open")?;
    db::export_as_catalog(conn, &ids, &dest)
}

/// "Import from Another Catalog…" — merge `source` into the open catalog.
/// `dryRun` is the preview the dialog shows before committing.
#[tauri::command]
fn catalog_import_from_catalog(
    state: State<'_, CatalogState>,
    source: String,
    replace_existing: bool,
    dry_run: bool,
) -> Result<db::MergeReport, String> {
    let guard = state
        .0
        .lock()
        .map_err(|e| format!("catalog lock poisoned: {e}"))?;
    let conn = guard.as_ref().ok_or("no catalog open")?;
    db::import_from_catalog(conn, &source, replace_existing, dry_run)
}

// ─────────────────────────────────────────────────────────────
// The universal container — `.mgal` (design doc 11)
// ─────────────────────────────────────────────────────────────

/// Where Galerie puts its own catalog inside a container. A READER never looks
/// at this: it dispatches on the `database` role, so another app's container
/// may name the entry anything it likes.
// ponytail: the catalog entry only. `previews/*` is a regenerable render cache,
// not user work, and packing it multiplies the container size — add it when a
// `.mgal` has to open fast on a machine that cannot re-render. Someone else's
// `previews/*` is still couriered untouched (rule 2), because nothing here
// removes an entry it did not write.
const DB_ENTRY: &str = "db/catalog.sqlite";

/// The `.mgal` the live catalog came out of, or `None` for a bare `.galcat`.
///
/// The [`ContainerDb`] is held as an RAII **guard**, not as the working
/// connection: its `Drop` is what removes the extracted working copy, while
/// every catalog command reads its connection out of [`CatalogState`]. Its own
/// connection sits idle — an extra open handle on a WAL database holds no locks.
///
/// [`ContainerDb`]: monet_db::container::ContainerDb
#[derive(Default)]
pub struct ContainerState(std::sync::Mutex<Option<monet_db::container::ContainerDb>>);

impl ContainerState {
    fn lock(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, Option<monet_db::container::ContainerDb>>, String> {
        self.0
            .lock()
            .map_err(|e| format!("container lock poisoned: {e}"))
    }
}

/// What [`catalog_open_container`] found — rule 1 in one struct: what was
/// opened, and what was left alone.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedContainer {
    /// Schema version of the catalog that was opened, or `None` when the
    /// container carries no database entry. That is NOT an error: a Rythme file
    /// opened in Galerie is a document with no catalog in it.
    pub schema_version: Option<i64>,
    /// The extracted working copy now open, or `None` when nothing was opened.
    pub working: Option<String>,
    /// Every entry Galerie did not consume, as `path (role)` — what the UI has
    /// to say out loud. These are couriered untouched on save (rule 2).
    pub ignored: Vec<String>,
    /// Who wrote the container last, and what they called it.
    pub app: String,
    pub kind: String,
}

/// Where extracted working copies live. The per-open subdirectory under it is
/// created and removed by `ContainerDb` itself.
// ponytail: the OS temp dir — a working copy is transient, and an unsaved
// session dies with the process either way. Move to the app cache dir if a
// session ever has to survive a reboot.
fn container_working_root() -> std::path::PathBuf {
    std::env::temp_dir().join("monet-galerie-containers")
}

/// Read a container's manifest and answer rule 1's two questions: is there a
/// catalog in here, and what am I about to ignore?
///
/// `working` is left `None` — [`catalog_open_container`] fills it in if it goes
/// on to extract. Split out from the command so the dispatch is testable
/// without a Tauri `State`.
fn inspect_container(bytes: &[u8]) -> Result<(OpenedContainer, bool), String> {
    use monet_db::container::DB_ROLE;

    if !monet_format::container::is_container(bytes) {
        return Err("not a Monet container".to_string());
    }
    let parsed = monet_format::container::Container::parse(bytes)?;
    let ignored = parsed
        .manifest
        .entries
        .iter()
        .filter(|entry| entry.role != DB_ROLE)
        .map(|entry| format!("{} ({})", entry.path, entry.role))
        .collect();
    // Same predicate `open_from_container` uses: a manifest row whose payload is
    // missing must not pass for a database.
    let has_db = parsed
        .paths_for_role(DB_ROLE)
        .into_iter()
        .any(|entry| parsed.get(entry).is_some());
    Ok((
        OpenedContainer {
            schema_version: None,
            working: None,
            ignored,
            app: parsed.manifest.app.name.clone(),
            kind: parsed.manifest.kind.clone(),
        },
        has_db,
    ))
}

/// Snapshot `conn` into the container at `target`.
///
/// `source` is the container the live catalog came out of, if any: saving it to
/// a NEW path copies the whole archive there first, so every entry and manifest
/// field Galerie never read follows the document instead of being dropped by a
/// fresh one (rule 2). `snapshot_to_container` then replaces exactly the
/// database entry, couriering the rest.
fn write_container_snapshot(
    conn: &Connection,
    target: &std::path::Path,
    source: Option<&std::path::Path>,
    entry: &str,
    kind: &str,
) -> Result<(), String> {
    if let Some(source) = source.filter(|source| *source != target && !target.exists()) {
        if let Some(parent) = target.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("create container dir: {e}"))?;
            }
        }
        std::fs::copy(source, target).map_err(|e| format!("copy container: {e}"))?;
    }
    monet_db::container::snapshot_to_container(
        conn,
        target,
        entry,
        &monet_format::container::ContainerApp::new("monet-galerie", env!("CARGO_PKG_VERSION")),
        kind,
    )
}

/// Open ANY Monet container: extract the catalog it carries and report what was
/// left alone.
///
/// Dispatch is on the MANIFEST, never the extension — a `.mcin` renamed `.mgal`
/// opens correctly, and so does a `.mryt` that has no catalog in it at all.
#[tauri::command]
fn catalog_open_container(
    state: State<'_, CatalogState>,
    container: State<'_, ContainerState>,
    path: String,
) -> Result<OpenedContainer, String> {
    let file = std::path::Path::new(&path);
    let bytes = std::fs::read(file).map_err(|e| format!("read container: {e}"))?;
    let (mut report, has_db) = inspect_container(&bytes).map_err(|e| format!("{path}: {e}"))?;
    drop(bytes);
    if !has_db {
        return Ok(report);
    }

    // ponytail: `open_from_container` reads the file a second time — one extra
    // read at document scale. Give it a `from_bytes` if a catalog ever gets big
    // enough for that to show up.
    let opened = monet_db::container::open_from_container(file, &container_working_root())?;
    let working = opened
        .working
        .to_str()
        .ok_or("working path is not UTF-8")?
        .to_string();
    // The extracted file is now an ordinary catalog: same open, same schema
    // stamp check, same refusal of a version this build does not write.
    let conn = db::open(&working)?;
    let version = db::version(&conn).map_err(|e| e.to_string())?;
    *state
        .0
        .lock()
        .map_err(|e| format!("catalog lock poisoned: {e}"))? = Some(conn);
    *container.lock()? = Some(opened);
    report.schema_version = Some(version);
    report.working = Some(working);
    Ok(report)
}

/// Snapshot the open catalog into a Monet container at `path` — the `.mgal`
/// write, and what "Save As" means for a live database.
///
/// Rule 2 is `snapshot_to_container`'s job: every entry already in the target
/// that is not the database is couriered byte-for-byte, as are the manifest
/// fields Galerie never read. Saving a container session to a NEW path copies
/// the source archive there first, so those entries follow the document instead
/// of being dropped by a fresh one.
#[tauri::command]
fn catalog_save_container(
    state: State<'_, CatalogState>,
    container: State<'_, ContainerState>,
    path: String,
) -> Result<(), String> {
    let target = std::path::Path::new(&path);
    // The session's own entry path and kind, so re-saving someone else's
    // container neither moves their database nor relabels their document.
    let session = container.lock()?;
    let (source, entry, kind) = match session.as_ref() {
        Some(open) => (
            Some(open.container.as_path()),
            open.entry.as_str(),
            open.kind.as_str(),
        ),
        // A live `.galcat` has no container around it — this is a new one.
        None => (None, DB_ENTRY, monet_format::container::KIND_CATALOG),
    };
    let guard = state
        .0
        .lock()
        .map_err(|e| format!("catalog lock poisoned: {e}"))?;
    let conn = guard.as_ref().ok_or("no catalog open")?;
    write_container_snapshot(conn, target, source, entry, kind)
}

/// Reveal a file in the OS file browser (Lightroom's "Show in Finder").
#[tauri::command]
fn catalog_reveal_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open")
        .arg("-R")
        .arg(&path)
        .status();
    #[cfg(not(target_os = "macos"))]
    let status = {
        // ponytail: non-mac fallback opens the parent folder (no selection API).
        let parent = std::path::Path::new(&path)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_default();
        std::process::Command::new(if cfg!(target_os = "windows") {
            "explorer"
        } else {
            "xdg-open"
        })
        .arg(parent)
        .status()
    };
    status.map(|_| ()).map_err(|e| e.to_string())
}

/// The sibling Monet apps a file may be handed to. This is the trust boundary
/// for `catalog_open_in_app`: `app` arrives from the webview, so an allow-list
/// keeps the command from becoming a launch-anything primitive.
const MONET_APPS: &[&str] = &[
    "Monet Vision",
    "Monet Artisan",
    "Monet Cinema",
    "Monet Jouer",
    "Monet Rythme",
    "Monet Anime",
];

/// Hand a file to a sibling Monet app ("Edit in Monet Vision"). On macOS `open
/// -a` reuses an already-running instance; every Monet app takes file paths on
/// argv and via the OS open-file event, so the app opens the document either way.
///
/// ponytail: non-mac guesses the binary name on PATH (`monet-vision`) — the
/// installed-app lookup an OS-native launcher would do lands with packaging.
#[tauri::command]
fn catalog_open_in_app(app: String, path: String) -> Result<(), String> {
    if !MONET_APPS.contains(&app.as_str()) {
        return Err(format!("{app} is not a Monet app"));
    }
    // An absolute path can't be mistaken for a flag by `open`/the target binary.
    if !std::path::Path::new(&path).is_absolute() {
        return Err("open_in_app requires an absolute path".into());
    }
    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open")
        .arg("-a")
        .arg(&app)
        .arg(&path)
        .status();
    #[cfg(not(target_os = "macos"))]
    let status = std::process::Command::new(app.to_lowercase().replace(' ', "-"))
        .arg(&path)
        .status();
    match status {
        Ok(s) if s.success() => Ok(()),
        Ok(s) => Err(format!("{app} could not be launched (exit {s})")),
        Err(e) => Err(format!("{app} could not be launched: {e}")),
    }
}

#[tauri::command]
fn catalog_find_duplicate(
    state: State<'_, CatalogState>,
    fingerprint: String,
    path: String,
) -> Result<Option<i64>, String> {
    with_conn(&state, |c| db::find_duplicate(c, &fingerprint, &path))
}

#[tauri::command]
fn catalog_import_photo(state: State<'_, CatalogState>, photo: ImportPhoto) -> Result<i64, String> {
    with_conn(&state, |c| db::import_photo(c, &photo))
}

#[tauri::command]
fn catalog_create_virtual_copy(
    state: State<'_, CatalogState>,
    photo_id: i64,
) -> Result<i64, String> {
    with_conn(&state, |c| db::create_virtual_copy(c, photo_id))
}

#[tauri::command]
fn catalog_set_copy_name(
    state: State<'_, CatalogState>,
    photo_id: i64,
    name: Option<String>,
) -> Result<(), String> {
    with_conn(&state, |c| db::set_copy_name(c, photo_id, name.as_deref()))
}

#[tauri::command]
fn catalog_make_master_photo(state: State<'_, CatalogState>, photo_id: i64) -> Result<(), String> {
    with_conn(&state, |c| db::make_master_photo(c, photo_id))
}

#[tauri::command]
fn catalog_stack_photos(state: State<'_, CatalogState>, ids: Vec<i64>) -> Result<i64, String> {
    with_conn(&state, |c| db::stack_photos(c, &ids))
}

#[tauri::command]
fn catalog_unstack(state: State<'_, CatalogState>, stack_id: i64) -> Result<(), String> {
    with_conn(&state, |c| db::unstack(c, stack_id))
}

#[tauri::command]
fn catalog_remove_photos(
    state: State<'_, CatalogState>,
    ids: Vec<i64>,
) -> Result<Vec<i64>, String> {
    with_conn(&state, |c| db::remove_photos(c, &ids))
}

/// Result of "Delete from Disk": every deleted photo id (incl. cascaded virtual
/// copies), the files moved to the OS Trash, and any files that couldn't be.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteFromDiskResult {
    pub deleted: Vec<i64>,
    pub trashed: Vec<String>,
    pub failed: Vec<String>,
}

/// Lightroom "Delete from Disk": remove the catalog rows exactly like
/// `catalog_remove_photos`, then move the now-unreferenced source files
/// (original + managed DNG copy) to the OS Trash.
#[tauri::command]
fn catalog_delete_photos_from_disk(
    state: State<'_, CatalogState>,
    ids: Vec<i64>,
) -> Result<DeleteFromDiskResult, String> {
    // Collect the files first — the rows (and then their assets) are gone after.
    let files = with_conn(&state, |c| db::source_files_for(c, &ids))?;
    let deleted = with_conn(&state, |c| db::remove_photos(c, &ids))?;
    let asset_ids: Vec<i64> = files.iter().map(|f| f.0).collect();
    let pruned: std::collections::HashSet<i64> =
        with_conn(&state, |c| db::prune_orphan_assets(c, &asset_ids))?
            .into_iter()
            .collect();
    let mut trashed = Vec::new();
    let mut failed = Vec::new();
    for (sid, path, managed) in files {
        if !pruned.contains(&sid) {
            continue; // asset still referenced by a surviving photo — keep its files
        }
        let mut targets = vec![path];
        if let Some(m) = managed {
            if !targets.contains(&m) {
                targets.push(m);
            }
        }
        for t in targets {
            if !std::path::Path::new(&t).exists() {
                continue; // already missing on disk — nothing to trash
            }
            // ponytail: the catalog rows are already removed — a file the OS won't
            // trash stays on disk untracked and is reported, like Lightroom does.
            match trash::delete(&t) {
                Ok(()) => trashed.push(t),
                Err(e) => failed.push(format!("{t}: {e}")),
            }
        }
    }
    Ok(DeleteFromDiskResult {
        deleted,
        trashed,
        failed,
    })
}

#[tauri::command]
fn catalog_list_rejected_ids(state: State<'_, CatalogState>) -> Result<Vec<i64>, String> {
    with_conn(&state, |c| db::list_rejected_ids(c))
}

#[tauri::command]
fn catalog_set_stack_cover(state: State<'_, CatalogState>, photo_id: i64) -> Result<(), String> {
    with_conn(&state, |c| db::set_stack_cover(c, photo_id))
}

#[tauri::command]
fn catalog_split_stack(state: State<'_, CatalogState>, photo_id: i64) -> Result<(), String> {
    with_conn(&state, |c| db::split_stack(c, photo_id))
}

#[tauri::command]
fn catalog_move_in_stack(
    state: State<'_, CatalogState>,
    photo_id: i64,
    delta: i64,
) -> Result<(), String> {
    with_conn(&state, |c| db::move_in_stack(c, photo_id, delta))
}

#[tauri::command]
fn catalog_list_stack(
    state: State<'_, CatalogState>,
    stack_id: i64,
    sort: Option<GridSort>,
) -> Result<Vec<PhotoRow>, String> {
    with_conn(&state, |c| match sort {
        Some(sort) => db::list_stack_sorted(c, stack_id, sort),
        None => db::list_stack(c, stack_id),
    })
}

#[tauri::command]
fn catalog_auto_stack(state: State<'_, CatalogState>, gap_seconds: i64) -> Result<i64, String> {
    with_conn(&state, |c| db::auto_stack(c, gap_seconds))
}

#[tauri::command]
fn catalog_list_source_paths(state: State<'_, CatalogState>) -> Result<Vec<SourcePathRow>, String> {
    with_conn(&state, db::list_source_paths)
}

#[tauri::command]
fn catalog_mark_missing(
    state: State<'_, CatalogState>,
    source_asset_id: i64,
    missing: bool,
) -> Result<(), String> {
    with_conn(&state, |c| db::mark_missing(c, source_asset_id, missing))
}

#[tauri::command]
fn catalog_relink(
    state: State<'_, CatalogState>,
    source_asset_id: i64,
    new_path: String,
    new_fingerprint: String,
) -> Result<(), String> {
    with_conn(&state, |c| {
        db::relink(c, source_asset_id, &new_path, &new_fingerprint)
    })
}

#[tauri::command]
fn catalog_count_missing(state: State<'_, CatalogState>) -> Result<i64, String> {
    with_conn(&state, db::count_missing)
}

#[tauri::command]
fn catalog_list_photos(
    state: State<'_, CatalogState>,
    after: Option<Cursor>,
    limit: i64,
    filter: Option<PhotoFilter>,
    sort: Option<GridSort>,
) -> Result<PhotoPage, String> {
    let filter = filter.unwrap_or_default();
    let sort = sort.unwrap_or_default();
    with_conn(&state, |c| {
        db::list_photos_sorted(c, after, limit, &filter, sort)
    })
}

#[tauri::command]
fn catalog_count_photos(
    state: State<'_, CatalogState>,
    filter: Option<PhotoFilter>,
) -> Result<i64, String> {
    let filter = filter.unwrap_or_default();
    with_conn(&state, |c| db::count_photos(c, &filter))
}

#[tauri::command]
fn catalog_duplicate_photos(
    state: State<'_, CatalogState>,
    limit: i64,
    offset: Option<i64>,
    sort: Option<GridSort>,
) -> Result<Vec<PhotoRow>, String> {
    with_conn(&state, |c| {
        db::duplicate_photos_sorted(c, limit, offset.unwrap_or(0), sort.unwrap_or_default())
    })
}

#[tauri::command]
fn catalog_get_photo(state: State<'_, CatalogState>, id: i64) -> Result<Option<PhotoRow>, String> {
    with_conn(&state, |c| db::get_photo(c, id))
}

#[tauri::command]
fn catalog_get_develop_export_identity(
    state: State<'_, CatalogState>,
    id: i64,
) -> Result<DevelopExportIdentity, String> {
    current_develop_export_identity(&state, id)
}

pub fn current_develop_export_identity(
    state: &CatalogState,
    id: i64,
) -> Result<DevelopExportIdentity, String> {
    let guard = state
        .0
        .lock()
        .map_err(|e| format!("catalog lock poisoned: {e}"))?;
    let conn = guard.as_ref().ok_or("no catalog open")?;
    develop_export_identity(conn, id)
}

fn develop_export_identity(conn: &Connection, id: i64) -> Result<DevelopExportIdentity, String> {
    let photo = db::get_photo(conn, id)
        .map_err(|e| e.to_string())?
        .ok_or("catalog photo does not exist")?;
    let source_digest = db::source_fingerprint(conn, id)
        .map_err(|e| e.to_string())?
        .ok_or("catalog source identity does not exist")?;
    let catalog_id = conn
        .path()
        .ok_or("open catalog has no stable path")?
        .to_owned();
    Ok(DevelopExportIdentity {
        catalog_id,
        photo,
        source_digest,
        canonical_recipe_json: preview_recipe(conn, id)?,
    })
}

// ─────────────────────────────────────────────────────────────
// Content Credentials (C2PA)
// ─────────────────────────────────────────────────────────────
//
// What an export claims about itself: who produced it (the catalog's IPTC
// rights block) and what was done to it (the develop history), with model use
// disclosed. Assembled here because the catalog is where those two facts live —
// Vision derives the same list from its raster edit history.
//
// Signing (the `c2pa` crate, an X.509 signer) lives in `c2pa_sign.rs`, which
// feeds this module's `manifest_json` to `c2pa::Builder::with_definition` and
// chains `parent_path` in as `parentOf`, exactly as Vision's `c2pa` plugin
// does for its own exports. `content_credentials` and `PARENT_LABEL` are `pub`
// so that module can call back into this trusted, database-built claim rather
// than accept one over IPC from the renderer.

/// Label the signer gives the source file it chains as the `parentOf`
/// ingredient. `c2pa.opened` must name the ingredient it opened or the whole
/// manifest validates as Invalid — same contract as Vision's `c2pa` plugin.
pub const PARENT_LABEL: &str = "parent";

/// IPTC digital source type disclosed when the recipe leans on a model. Galerie's
/// AI mask components (`aiSubject`, `aiSky`, …) *select* regions rather than
/// synthesize pixels, so this is `algorithmicallyEnhanced` and not Vision's
/// `trainedAlgorithmicMedia` — over-claiming AI provenance is as wrong as hiding it.
const AI_SOURCE_TYPE: &str =
    "http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicallyEnhanced";

/// Develop-history panel label → the C2PA action a step on it amounts to. These
/// are the labels `historyLabel.ts` writes through `catalog_record_history`, so
/// the manifest states what the user actually did instead of one blanket claim
/// per export. Anything unrecognised (mask work's "Edit", "Process Version", a
/// label a future panel adds) falls through to `c2pa.edited`, the spec's own
/// generic bucket.
const HISTORY_ACTIONS: &[(&str, &str)] = &[
    ("Basic", "c2pa.color_adjustments"),
    ("Tone Curve", "c2pa.color_adjustments"),
    ("Color Mixer", "c2pa.color_adjustments"),
    ("Color Grading", "c2pa.color_adjustments"),
    ("Calibration", "c2pa.color_adjustments"),
    ("Profile", "c2pa.color_adjustments"),
    ("Detail", "c2pa.filtered"),
    ("Optics", "c2pa.filtered"),
    ("Effects", "c2pa.filtered"),
    ("Crop", "c2pa.cropped"),
    ("Transform", "c2pa.orientation"),
    ("Heal", "c2pa.edited"),
];

/// The Content Credentials one export carries.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContentCredentials {
    /// C2PA manifest definition JSON, ready for `c2pa::Builder::with_definition`.
    pub manifest_json: String,
    /// Source file whose own credentials chain in as the `parentOf` ingredient,
    /// labelled [`PARENT_LABEL`].
    pub parent_path: String,
}

/// True when the recipe leans on a model: an AI mask component (`aiSubject`,
/// `aiSky`, …) or a recorded `metadata.modelVersions` entry. A recipe we cannot
/// parse discloses nothing rather than guessing.
fn recipe_uses_ai(recipe_json: &str) -> bool {
    let Ok(recipe) = serde_json::from_str::<serde_json::Value>(recipe_json) else {
        return false;
    };
    if recipe["metadata"]["modelVersions"]
        .as_object()
        .is_some_and(|models| !models.is_empty())
    {
        return true;
    }
    recipe["masks"]["masks"].as_array().is_some_and(|masks| {
        masks.iter().any(|mask| {
            mask["components"].as_array().is_some_and(|components| {
                components
                    .iter()
                    .any(|c| c["kind"].as_str().is_some_and(|k| k.starts_with("ai")))
            })
        })
    })
}

/// The `c2pa.actions` list for one export, oldest step first. Galerie never
/// originates pixels — every export renders a catalogued source file — so the
/// asset is *opened* and *edited*, never `c2pa.created`; claiming creation over
/// someone else's photo is a false provenance claim.
fn c2pa_actions(history: &[HistoryRow], uses_ai: bool) -> Vec<serde_json::Value> {
    let mut out = vec![
        serde_json::json!({
            "action": "c2pa.opened",
            "parameters": { "ingredientIds": [PARENT_LABEL] }
        }),
        serde_json::json!({ "action": "c2pa.edited" }),
    ];
    let mut seen = vec!["c2pa.edited"];
    // `list_history` is newest-first; a manifest reads oldest-first.
    for step in history.iter().rev() {
        let action = HISTORY_ACTIONS
            .iter()
            .find(|(label, _)| *label == step.label)
            .map_or("c2pa.edited", |(_, action)| *action);
        if seen.contains(&action) {
            continue;
        }
        seen.push(action);
        out.push(serde_json::json!({ "action": action }));
    }
    if uses_ai {
        // The disclosure *is* the assertion — listed even next to a plain
        // c2pa.edited, because the source type is what carries the meaning.
        out.push(serde_json::json!({
            "action": "c2pa.edited",
            "digitalSourceType": AI_SOURCE_TYPE
        }));
    }
    out
}

/// The `stds.schema-org.CreativeWork` assertion: who made this photo and under
/// what rights, straight from the catalog's IPTC columns. Built through
/// `serde_json` rather than string-templated, so a creator name carrying quotes
/// can never reshape the claim.
fn creative_work(iptc: &PhotoIptc) -> serde_json::Value {
    let mut work = serde_json::json!({
        "@context": "https://schema.org",
        "@type": "CreativeWork"
    });
    if let Some(creator) = iptc.creator.as_deref() {
        work["author"] = serde_json::json!([{ "@type": "Person", "name": creator }]);
    }
    for (key, value) in [
        ("copyrightNotice", &iptc.copyright),
        ("creditText", &iptc.credit),
        ("license", &iptc.rights_usage_terms),
        ("acquireLicensePage", &iptc.copyright_info_url),
    ] {
        if let Some(value) = value.as_deref() {
            work[key] = serde_json::json!(value);
        }
    }
    work
}

/// `pub`: `c2pa_sign::sign_content_credentials` calls this directly (by photo
/// id, over the same trusted catalog connection) rather than accept a
/// manifest string from the renderer — nothing IPC-supplied ever reaches
/// `c2pa::Builder::with_definition` as claim content.
pub fn content_credentials(conn: &Connection, id: i64) -> Result<ContentCredentials, String> {
    let identity = develop_export_identity(conn, id)?;
    let history = db::list_history(conn, id).map_err(|e| e.to_string())?;
    let actions = c2pa_actions(&history, recipe_uses_ai(&identity.canonical_recipe_json));
    // `Path` is only imported on macOS here, so qualify rather than widen the
    // import block for one call.
    let title = identity.photo.iptc.title.clone().or_else(|| {
        std::path::Path::new(&identity.photo.path)
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::to_owned)
    });
    let manifest = serde_json::json!({
        "claim_generator_info": [
            { "name": "Monet Galerie", "version": env!("CARGO_PKG_VERSION") }
        ],
        "title": title.unwrap_or_else(|| "Monet Galerie Export".into()),
        "assertions": [
            { "label": "c2pa.actions", "data": { "actions": actions } },
            {
                "label": "stds.schema-org.CreativeWork",
                "data": creative_work(&identity.photo.iptc)
            }
        ]
    });
    Ok(ContentCredentials {
        manifest_json: serde_json::to_string(&manifest).map_err(|e| e.to_string())?,
        // The file actually on disk (a managed DNG lives beside the original),
        // because that is what the signer has to read the parent store from.
        parent_path: identity.photo.read_path,
    })
}

/// `invoke("plugin:catalog|catalog_content_credentials", { id })` → the C2PA
/// manifest an export of this photo should carry, plus the source file to chain
/// as its `parentOf` ingredient. Unsigned: signing needs an X.509 signer and
/// belongs to the export path, exactly as it does in Vision.
#[tauri::command]
fn catalog_content_credentials(
    state: State<'_, CatalogState>,
    id: i64,
) -> Result<ContentCredentials, String> {
    let guard = state
        .0
        .lock()
        .map_err(|e| format!("catalog lock poisoned: {e}"))?;
    let conn = guard.as_ref().ok_or("no catalog open")?;
    content_credentials(conn, id)
}

#[tauri::command]
fn catalog_set_flags(
    state: State<'_, CatalogState>,
    id: i64,
    rating: i64,
    flag: i64,
    color_label: Option<String>,
) -> Result<(), String> {
    with_conn(&state, |c| {
        db::set_flags(c, id, rating, flag, color_label.as_deref())
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // flat IPC params mirror the TS meta object
fn catalog_set_metadata(
    state: State<'_, CatalogState>,
    id: i64,
    title: Option<String>,
    caption: Option<String>,
    headline: Option<String>,
    instructions: Option<String>,
    creator: Option<String>,
    job_title: Option<String>,
    credit: Option<String>,
    source: Option<String>,
    creator_address: Option<String>,
    creator_city: Option<String>,
    creator_state_province: Option<String>,
    creator_postal_code: Option<String>,
    creator_country: Option<String>,
    creator_phone: Option<String>,
    creator_email: Option<String>,
    creator_website: Option<String>,
    sublocation: Option<String>,
    city: Option<String>,
    state_province: Option<String>,
    country: Option<String>,
    iso_country_code: Option<String>,
    copyright: Option<String>,
    copyright_status: Option<String>,
    rights_usage_terms: Option<String>,
    copyright_info_url: Option<String>,
) -> Result<(), String> {
    // The TS side spreads a flat PhotoMetadata object, so the params stay flat
    // and regroup here into the one struct the writer takes.
    let meta = PhotoIptc {
        title,
        caption,
        headline,
        instructions,
        creator,
        job_title,
        credit,
        source,
        creator_address,
        creator_city,
        creator_state_province,
        creator_postal_code,
        creator_country,
        creator_phone,
        creator_email,
        creator_website,
        sublocation,
        city,
        state_province,
        country,
        iso_country_code,
        copyright,
        copyright_status,
        rights_usage_terms,
        copyright_info_url,
    };
    with_conn(&state, |c| db::set_photo_metadata(c, id, &meta))
}

#[tauri::command]
fn catalog_set_recipe<R: Runtime>(
    app: tauri::AppHandle<R>,
    window: WebviewWindow<R>,
    state: State<'_, CatalogState>,
    id: i64,
    recipe_json: String,
    process_version: Option<i64>,
) -> Result<String, String> {
    let recipe_json = canonical_recipe(&recipe_json, process_version)?;
    with_conn(&state, |c| {
        db::set_recipe(
            c,
            id,
            &recipe_json,
            Some(monet_photo_core::PROCESS_VERSION as i64),
        )
    })?;
    for (label, webview) in app.webview_windows() {
        if label != window.label() {
            if let Err(error) = webview.emit("galerie://recipe-changed", id) {
                eprintln!("failed to emit recipe change to {label}: {error}");
            }
        }
    }
    Ok(recipe_json)
}

#[tauri::command]
fn catalog_get_recipe(state: State<'_, CatalogState>, id: i64) -> Result<Option<String>, String> {
    with_conn(&state, |c| db::get_recipe(c, id))?
        .map(|json| canonical_recipe(&json, None))
        .transpose()
}

#[tauri::command]
fn catalog_add_snapshot(
    state: State<'_, CatalogState>,
    photo_id: i64,
    name: String,
    recipe_json: String,
    process_version: Option<i64>,
) -> Result<i64, String> {
    let recipe_json = canonical_recipe(&recipe_json, process_version)?;
    with_conn(&state, |c| {
        db::add_snapshot(
            c,
            photo_id,
            &name,
            &recipe_json,
            Some(monet_photo_core::PROCESS_VERSION as i64),
        )
    })
}

#[tauri::command]
fn catalog_list_snapshots(
    state: State<'_, CatalogState>,
    photo_id: i64,
) -> Result<Vec<SnapshotRow>, String> {
    let mut rows = with_conn(&state, |c| db::list_snapshots(c, photo_id))?;
    for row in &mut rows {
        row.recipe_json = canonical_recipe(&row.recipe_json, row.process_version)?;
    }
    Ok(rows)
}

#[tauri::command]
fn catalog_delete_snapshot(state: State<'_, CatalogState>, id: i64) -> Result<(), String> {
    with_conn(&state, |c| db::delete_snapshot(c, id))
}

#[tauri::command]
fn catalog_record_history(
    state: State<'_, CatalogState>,
    photo_id: i64,
    label: String,
    recipe_json: String,
    process_version: Option<i64>,
    cap: Option<i64>,
) -> Result<i64, String> {
    let recipe_json = canonical_recipe(&recipe_json, process_version)?;
    with_conn(&state, |c| {
        db::record_history(
            c,
            photo_id,
            &label,
            &recipe_json,
            Some(monet_photo_core::PROCESS_VERSION as i64),
            cap.unwrap_or(0),
        )
    })
}

#[tauri::command]
fn catalog_list_history(
    state: State<'_, CatalogState>,
    photo_id: i64,
) -> Result<Vec<HistoryRow>, String> {
    let mut rows = with_conn(&state, |c| db::list_history(c, photo_id))?;
    for row in &mut rows {
        row.recipe_json = canonical_recipe(&row.recipe_json, row.process_version)?;
    }
    Ok(rows)
}

#[tauri::command]
fn catalog_clear_history(state: State<'_, CatalogState>, photo_id: i64) -> Result<(), String> {
    with_conn(&state, |c| db::clear_history(c, photo_id))
}

#[tauri::command]
fn catalog_add_keyword(
    state: State<'_, CatalogState>,
    photo_id: i64,
    name: String,
) -> Result<Option<i64>, String> {
    let name = name.trim();
    if name.is_empty() {
        return Ok(None);
    }
    with_conn(&state, |c| db::add_keyword(c, photo_id, name)).map(Some)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn catalog_create_keyword(
    state: State<'_, CatalogState>,
    name: String,
    parent_id: Option<i64>,
    synonyms: String,
    include_on_export: bool,
    export_containing: bool,
    export_synonyms: bool,
) -> Result<i64, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("keyword name cannot be empty".into());
    }
    // The delimiters the entry parser owns can never appear inside one name.
    if name.contains(['|', '<', '>', ',', ';']) {
        return Err("keyword names cannot contain , ; | < >".into());
    }
    with_conn(&state, |c| {
        db::create_keyword(
            c,
            name,
            parent_id,
            synonyms.trim(),
            include_on_export,
            export_containing,
            export_synonyms,
        )
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn catalog_update_keyword(
    state: State<'_, CatalogState>,
    keyword_id: i64,
    name: String,
    parent_id: Option<i64>,
    synonyms: String,
    include_on_export: bool,
    export_containing: bool,
    export_synonyms: bool,
) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("keyword name cannot be empty".into());
    }
    if name.contains(['|', '<', '>', ',', ';']) {
        return Err("keyword names cannot contain , ; | < >".into());
    }
    let guard = state
        .0
        .lock()
        .map_err(|e| format!("catalog lock poisoned: {e}"))?;
    db::update_keyword(
        guard.as_ref().ok_or("no catalog open")?,
        keyword_id,
        name,
        parent_id,
        synonyms.trim(),
        include_on_export,
        export_containing,
        export_synonyms,
    )
}

#[tauri::command]
fn catalog_remove_keyword(
    state: State<'_, CatalogState>,
    photo_id: i64,
    keyword_id: i64,
) -> Result<(), String> {
    with_conn(&state, |c| db::remove_keyword(c, photo_id, keyword_id))
}

#[tauri::command]
fn catalog_replace_photo_keywords(
    state: State<'_, CatalogState>,
    photo_id: i64,
    names: Vec<String>,
) -> Result<(), String> {
    with_conn(&state, |c| db::replace_photo_keywords(c, photo_id, &names))
}

#[tauri::command]
fn catalog_list_photo_keywords(
    state: State<'_, CatalogState>,
    photo_id: i64,
) -> Result<Vec<KeywordRow>, String> {
    with_conn(&state, |c| db::list_photo_keywords(c, photo_id))
}

/// Lightroom's Rename Folder: rename the directory on disk and repoint every
/// cataloged path under it. Catalog first (the path UNIQUE constraint fails
/// the transaction on any collision), then the disk rename; a failed disk
/// rename rolls the catalog back. Returns the repointed photo count.
/// True when both paths already name the SAME directory on disk — a case-only
/// rename on a case-insensitive filesystem stats the source through the
/// destination name, so the dest-exists guard must not fire.
fn same_dir(a: &str, b: &str) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        match (std::fs::metadata(a), std::fs::metadata(b)) {
            (Ok(ma), Ok(mb)) => ma.dev() == mb.dev() && ma.ino() == mb.ino(),
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        a.eq_ignore_ascii_case(b)
    }
}

#[tauri::command]
fn catalog_rename_folder(
    state: State<'_, CatalogState>,
    old_dir: String,
    new_dir: String,
) -> Result<usize, String> {
    let case_only = same_dir(&old_dir, &new_dir);
    if !case_only {
        if std::path::Path::new(&new_dir).exists() {
            return Err(format!("a folder already exists at {new_dir}"));
        }
        // Cataloged strangers under the destination would be dragged back to
        // old_dir by a rollback repoint — refuse up front.
        let occupied = with_conn(&state, |c| db::count_under_dir(c, &new_dir))?;
        if occupied > 0 {
            return Err(format!(
                "{occupied} cataloged photos already live under {new_dir}"
            ));
        }
    }
    let n = with_conn(&state, |c| db::repoint_folder(c, &old_dir, &new_dir))?;
    if let Err(e) = std::fs::rename(&old_dir, &new_dir) {
        return match with_conn(&state, |c| db::repoint_folder(c, &new_dir, &old_dir)) {
            Ok(_) => Err(format!("folder rename failed: {e}")),
            Err(e2) => Err(format!(
                "folder rename failed: {e} — and the catalog rollback also failed: {e2}. \
                 Catalog paths under {new_dir} still point at files in {old_dir}."
            )),
        };
    }
    Ok(n)
}

/// Folders panel "Create Folder": make the directory on disk. Folders are
/// derived from photo paths, so an empty one lives only in the panel's
/// session list until photos land in it.
#[tauri::command]
fn catalog_create_folder(dir: String) -> Result<(), String> {
    if dir.trim().is_empty() {
        return Err("folder path is empty".into());
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {dir}: {e}"))
}

/// Folders panel "Remove from Catalog": drop every cataloged photo under the
/// folder; the files stay on disk. Returns the deleted ids (cascade-deleted
/// virtual copies included) so the frontend can reconcile its buffer.
#[tauri::command]
fn catalog_remove_folder(state: State<'_, CatalogState>, dir: String) -> Result<Vec<i64>, String> {
    let ids = with_conn(&state, |c| db::photo_ids_under_dir(c, &dir))?;
    with_conn(&state, |c| db::remove_photos(c, &ids))
}

/// Lightroom's "Update Folder Location…": the folder was moved outside the
/// app — repoint every cataloged path under `old_dir` to `new_dir` WITHOUT
/// touching the disk. `new_dir` must already exist and hold no cataloged
/// strangers. Returns the repointed photo count.
#[tauri::command]
fn catalog_update_folder_location(
    state: State<'_, CatalogState>,
    old_dir: String,
    new_dir: String,
) -> Result<usize, String> {
    if !std::path::Path::new(&new_dir).is_dir() {
        return Err(format!("no folder exists at {new_dir}"));
    }
    let occupied = with_conn(&state, |c| db::count_under_dir(c, &new_dir))?;
    if occupied > 0 {
        return Err(format!(
            "{occupied} cataloged photos already live under {new_dir}"
        ));
    }
    with_conn(&state, |c| db::repoint_folder(c, &old_dir, &new_dir))
}

/// Lightroom's Rename Photo: rename the source file on disk and repoint the
/// catalog. Catalog first (it validates collisions), then the disk rename; a
/// failed disk rename rolls the catalog back. Returns the previous path.
#[tauri::command]
fn catalog_list_folders(state: State<'_, CatalogState>) -> Result<Vec<FolderRow>, String> {
    with_conn(&state, |c| db::list_folders(c))
}

#[tauri::command]
fn catalog_list_filter_options(
    state: State<'_, CatalogState>,
    filter: Option<PhotoFilter>,
    columns: Option<Vec<String>>,
) -> Result<FilterOptions, String> {
    with_conn(&state, |c| {
        db::list_filter_options(c, filter.as_ref(), columns.as_deref())
    })
}

#[tauri::command]
fn catalog_rename_photo_file(
    state: State<'_, CatalogState>,
    photo_id: i64,
    new_path: String,
) -> Result<String, String> {
    if std::path::Path::new(&new_path).exists() {
        return Err(format!("a file already exists at {new_path}"));
    }
    let old = with_conn(&state, |c| db::update_source_path(c, photo_id, &new_path))?;
    if let Err(e) = std::fs::rename(&old, &new_path) {
        let _ = with_conn(&state, |c| db::update_source_path(c, photo_id, &old));
        return Err(format!("rename failed: {e}"));
    }
    Ok(old)
}

#[tauri::command]
fn catalog_set_capture_time(
    state: State<'_, CatalogState>,
    photo_id: i64,
    capture_time: Option<i64>,
) -> Result<(), String> {
    with_conn(&state, |c| db::set_capture_time(c, photo_id, capture_time))
}

#[tauri::command]
fn catalog_set_gps(
    state: State<'_, CatalogState>,
    photo_id: i64,
    lat: Option<f64>,
    lon: Option<f64>,
) -> Result<(), String> {
    // Trust boundary (MCP reaches this): a coordinate is both halves or neither,
    // finite and in range. `contains` is false for NaN, so NaN lands here too.
    let (lat, lon) = match (lat, lon) {
        (Some(a), Some(o)) => {
            if !(-90.0..=90.0).contains(&a) || !(-180.0..=180.0).contains(&o) {
                return Err(format!("GPS coordinate out of range: {a}, {o}"));
            }
            (Some(a), Some(o))
        }
        (None, None) => (None, None),
        _ => return Err("GPS needs both latitude and longitude".into()),
    };
    with_conn(&state, |c| db::set_gps(c, photo_id, lat, lon))
}

#[tauri::command]
fn catalog_list_keywords(state: State<'_, CatalogState>) -> Result<Vec<KeywordCountRow>, String> {
    with_conn(&state, |c| db::list_keywords(c))
}

#[tauri::command]
fn catalog_list_keyword_photos(
    state: State<'_, CatalogState>,
    keyword_id: i64,
    limit: i64,
    offset: Option<i64>,
    sort: Option<GridSort>,
) -> Result<Vec<PhotoRow>, String> {
    with_conn(&state, |c| {
        db::list_keyword_photos_sorted(
            c,
            keyword_id,
            limit,
            offset.unwrap_or(0),
            sort.unwrap_or_default(),
        )
    })
}

#[tauri::command]
fn catalog_delete_keyword(state: State<'_, CatalogState>, keyword_id: i64) -> Result<(), String> {
    with_conn(&state, |c| db::delete_keyword(c, keyword_id))
}

#[tauri::command]
fn catalog_add_preset(
    state: State<'_, CatalogState>,
    name: String,
    recipe_json: String,
    process_version: Option<i64>,
) -> Result<Option<i64>, String> {
    let name = name.trim();
    if name.is_empty() {
        return Ok(None);
    }
    let recipe_json = canonical_recipe(&recipe_json, process_version)?;
    with_conn(&state, |c| {
        db::add_preset(
            c,
            name,
            &recipe_json,
            Some(monet_photo_core::PROCESS_VERSION as i64),
        )
    })
    .map(Some)
}

#[tauri::command]
fn catalog_list_presets(state: State<'_, CatalogState>) -> Result<Vec<PresetRow>, String> {
    let mut rows = with_conn(&state, db::list_presets)?;
    for row in &mut rows {
        row.recipe_json = canonical_recipe(&row.recipe_json, row.process_version)?;
    }
    Ok(rows)
}

#[tauri::command]
fn catalog_delete_preset(state: State<'_, CatalogState>, id: i64) -> Result<(), String> {
    with_conn(&state, |c| db::delete_preset(c, id))
}

#[tauri::command]
fn catalog_add_metadata_preset(
    state: State<'_, CatalogState>,
    name: String,
    fields: serde_json::Value,
) -> Result<Option<i64>, String> {
    let name = name.trim();
    if name.is_empty() {
        return Ok(None);
    }
    // The map is stored verbatim and handed straight back to the UI, so the one
    // thing to enforce is that it IS a map — never a scalar or an array.
    if !fields.is_object() {
        return Err("metadata preset fields must be a JSON object".into());
    }
    with_conn(&state, |c| {
        db::add_metadata_preset(c, name, &fields.to_string())
    })
    .map(Some)
}

#[tauri::command]
fn catalog_list_metadata_presets(
    state: State<'_, CatalogState>,
) -> Result<Vec<MetadataPresetRow>, String> {
    with_conn(&state, db::list_metadata_presets)
}

#[tauri::command]
fn catalog_delete_metadata_preset(state: State<'_, CatalogState>, id: i64) -> Result<(), String> {
    with_conn(&state, |c| db::delete_metadata_preset(c, id))
}

#[tauri::command]
fn catalog_create_collection(
    state: State<'_, CatalogState>,
    name: String,
    kind: String,
    parent_id: Option<i64>,
    rule_ast: Option<String>,
) -> Result<i64, String> {
    with_conn(&state, |c| {
        db::create_collection(c, &name, &kind, parent_id, rule_ast.as_deref())
    })
}

#[tauri::command]
fn catalog_list_collections(state: State<'_, CatalogState>) -> Result<Vec<CollectionRow>, String> {
    with_conn(&state, db::list_collections)
}

#[tauri::command]
fn catalog_rename_collection(
    state: State<'_, CatalogState>,
    id: i64,
    name: String,
) -> Result<(), String> {
    with_conn(&state, |c| db::rename_collection(c, id, &name))
}

#[tauri::command]
fn catalog_set_collection_rule(
    state: State<'_, CatalogState>,
    id: i64,
    rule_ast: String,
) -> Result<(), String> {
    with_conn(&state, |c| db::set_collection_rule(c, id, &rule_ast))
}

#[tauri::command]
fn catalog_update_collection(
    state: State<'_, CatalogState>,
    id: i64,
    name: String,
    parent_id: Option<i64>,
    rule_ast: Option<String>,
) -> Result<(), String> {
    with_conn(&state, |c| {
        db::update_collection(c, id, &name, parent_id, rule_ast.as_deref())
    })
}

#[tauri::command]
fn catalog_delete_collection(state: State<'_, CatalogState>, id: i64) -> Result<(), String> {
    with_conn(&state, |c| db::delete_collection(c, id))
}

#[tauri::command]
fn catalog_add_to_collection(
    state: State<'_, CatalogState>,
    collection_id: i64,
    photo_id: i64,
) -> Result<(), String> {
    with_conn(&state, |c| {
        db::add_photo_to_collection(c, collection_id, photo_id)
    })
}

#[tauri::command]
fn catalog_remove_from_collection(
    state: State<'_, CatalogState>,
    collection_id: i64,
    photo_id: i64,
) -> Result<(), String> {
    with_conn(&state, |c| {
        db::remove_photo_from_collection(c, collection_id, photo_id)
    })
}

#[tauri::command]
fn catalog_replace_collection_members(
    state: State<'_, CatalogState>,
    collection_id: i64,
    photo_ids: Vec<i64>,
) -> Result<(), String> {
    with_conn(&state, |c| {
        db::replace_collection_members(c, collection_id, &photo_ids)
    })
}

#[tauri::command]
fn catalog_move_collection_members(
    state: State<'_, CatalogState>,
    collection_id: i64,
    photo_ids: Vec<i64>,
    delta: i64,
) -> Result<(), String> {
    with_conn(&state, |c| {
        db::move_collection_members(c, collection_id, &photo_ids, delta)
    })
}

#[tauri::command]
fn catalog_list_collection_photos(
    state: State<'_, CatalogState>,
    collection_id: i64,
    limit: i64,
    offset: Option<i64>,
    sort: Option<GridSort>,
) -> Result<Vec<PhotoRow>, String> {
    with_conn(&state, |c| match sort {
        Some(sort) => {
            db::list_collection_photos_sorted(c, collection_id, limit, offset.unwrap_or(0), sort)
        }
        None => db::list_collection_photos(c, collection_id, limit, offset.unwrap_or(0)),
    })
}

#[tauri::command]
fn catalog_record_preview(
    state: State<'_, CatalogState>,
    preview: PreviewRecord,
) -> Result<i64, String> {
    with_conn(&state, |c| db::record_preview(c, &preview))
}

#[tauri::command]
fn catalog_find_preview(
    state: State<'_, CatalogState>,
    photo_id: i64,
    kind: String,
    cache_key: String,
) -> Result<Option<PreviewRow>, String> {
    with_conn(&state, |c| db::find_preview(c, photo_id, &kind, &cache_key))
}

#[tauri::command]
fn catalog_preview_request(
    state: State<'_, CatalogState>,
    photo_id: i64,
    kind: String,
    max_edge: u32,
) -> Result<PreviewRequestV2, String> {
    let guard = state
        .0
        .lock()
        .map_err(|e| format!("catalog lock poisoned: {e}"))?;
    let conn = guard.as_ref().ok_or("no catalog open")?;
    preview_request_for(conn, photo_id, &kind, max_edge)
}

/// Lightroom's "Automatically Discard 1:1 Previews" default: After 30 Days.
const PREVIEW_ONE_TO_ONE_MAX_AGE_SECS: i64 = 30 * 24 * 60 * 60;
/// Hard ceiling on the whole preview cache (Lightroom has none; we bound it).
// ponytail: fixed defaults — surface both as Catalog Settings ▸ File Handling
// once the settings UI grows a pane for them.
const PREVIEW_MAX_TOTAL_BYTES: i64 = 16 * 1024 * 1024 * 1024;

/// What one preview-cache GC pass reclaimed (and what's left indexed).
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewGcStats {
    pub deleted_rows: u64,
    pub deleted_files: u64,
    pub freed_bytes: u64,
    pub remaining_bytes: i64,
}

/// One preview-cache GC pass: age/size eviction over the index, then a disk
/// sweep deleting every blob the index no longer references (cascade-orphaned,
/// superseded, leaked temp files). The sweep always runs.
fn preview_gc(
    conn: &Connection,
    root: &std::path::Path,
    one_to_one_max_age_secs: Option<i64>,
    max_total_bytes: Option<i64>,
) -> Result<PreviewGcStats, String> {
    let deleted_rows = db::evict_previews(conn, one_to_one_max_age_secs, max_total_bytes)
        .map_err(|e| e.to_string())?;
    let keep = db::preview_file_paths(conn).map_err(|e| e.to_string())?;
    let (deleted_files, freed_bytes) =
        preview_store::sweep_orphans(root, &keep).map_err(|e| e.to_string())?;
    Ok(PreviewGcStats {
        deleted_rows: deleted_rows as u64,
        deleted_files,
        freed_bytes,
        remaining_bytes: db::preview_total_bytes(conn).map_err(|e| e.to_string())?,
    })
}

/// Preview-cache GC (Lightroom Catalog Settings ▸ File Handling): discard old
/// 1:1 previews, cap the cache, reclaim orphaned blobs. `None` = keep forever /
/// no cap; the orphan sweep always runs. No-op for an in-memory catalog.
#[tauri::command]
fn catalog_preview_gc(
    state: State<'_, CatalogState>,
    one_to_one_max_age_days: Option<i64>,
    max_total_bytes: Option<i64>,
) -> Result<PreviewGcStats, String> {
    let guard = state
        .0
        .lock()
        .map_err(|e| format!("catalog lock poisoned: {e}"))?;
    let conn = guard.as_ref().ok_or("no catalog open")?;
    let Some(root) = conn.path().and_then(preview_store::root_for_catalog) else {
        return Ok(PreviewGcStats::default());
    };
    preview_gc(
        conn,
        &root,
        one_to_one_max_age_days.map(|days| days.max(0).saturating_mul(24 * 60 * 60)),
        max_total_bytes,
    )
}

/// Persist a generated preview blob (write-through): write the bytes to the
/// on-disk cache and index them. No-op for an in-memory catalog (no cache root).
#[tauri::command]
fn catalog_preview_put(
    state: State<'_, CatalogState>,
    photo_id: i64,
    kind: String,
    max_edge: u32,
    expected_identity: PreviewIdentityV2,
    raw_metadata: Option<crate::raw_decode::RawFrameMetadata>,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let guard = state
        .0
        .lock()
        .map_err(|e| format!("catalog lock poisoned: {e}"))?;
    let conn = guard.as_ref().ok_or("no catalog open")?;
    let Some(root) = conn.path().and_then(preview_store::root_for_catalog) else {
        return Ok(());
    };
    if expected_identity.preview_kind != kind {
        return Err("preview identity does not match preview kind".into());
    }
    let actual_identity =
        preview_identity_for(conn, photo_id, &kind, max_edge, raw_metadata.as_ref())?;
    if actual_identity != expected_identity {
        return Err("actual render provenance does not match expected preview identity".into());
    }
    let provenance = render_provenance_for(actual_identity.clone(), raw_metadata.as_ref())?;
    validate_catalog_render_provenance(&expected_identity, &provenance)?;
    let key = db::preview_cache_key(&expected_identity)?;
    let identity_json =
        serde_json::to_string(&expected_identity).map_err(|error| error.to_string())?;
    let provenance_json = serde_json::to_string(&provenance).map_err(|error| error.to_string())?;
    let content_digest = sha256_hex(&bytes);
    let rel = db::preview_rel_path(&key);
    preview_store::write(&root, &rel, &bytes).map_err(|e| e.to_string())?;
    db::record_preview(
        conn,
        &PreviewRecord {
            photo_id,
            kind: kind.clone(),
            cache_key: key.clone(),
            width: i64::from(expected_identity.output_width),
            height: i64::from(expected_identity.output_height),
            file_path: rel,
            renderer_revision: db::PREVIEW_RENDERER_REVISION,
            byte_size: bytes.len() as i64,
            identity_json,
            provenance_json,
            content_digest,
        },
    )
    .map_err(|e| e.to_string())?;
    // Replaced in place, like Lightroom: the new generation evicts the old rows
    // for this (photo, kind) and reclaims their blobs (unless a virtual copy
    // still shares one). A failed remove is left for the GC sweep.
    for stale in
        db::evict_superseded_previews(conn, photo_id, &kind, &key).map_err(|e| e.to_string())?
    {
        let _ = preview_store::remove(&root, &stale);
    }
    Ok(())
}

/// Read a cached preview blob for a photo at `max_edge`, or `None` on a miss
/// (never cached, in-memory catalog, or the file went missing under a DB record).
#[tauri::command]
fn catalog_preview_get(
    state: State<'_, CatalogState>,
    photo_id: i64,
    kind: String,
    identity: PreviewIdentityV2,
) -> Result<PreviewRead, String> {
    let guard = state
        .0
        .lock()
        .map_err(|e| format!("catalog lock poisoned: {e}"))?;
    let conn = guard.as_ref().ok_or("no catalog open")?;
    let Some(root) = conn.path().and_then(preview_store::root_for_catalog) else {
        return Ok(PreviewRead::miss(None));
    };
    let Some(fp) = db::source_fingerprint(conn, photo_id).map_err(|e| e.to_string())? else {
        return Ok(PreviewRead::miss(None));
    };
    if identity.preview_kind != kind {
        return Ok(PreviewRead::miss(Some(
            "preview identity kind mismatch".into(),
        )));
    }
    if identity.source_digest != fp {
        return Ok(PreviewRead::miss(Some(
            "preview identity source mismatch".into(),
        )));
    }
    let key = db::preview_cache_key(&identity)?;
    match db::find_preview(conn, photo_id, &kind, &key).map_err(|e| e.to_string())? {
        Some(hit) => Ok(read_preview_hit(&root, &identity, &hit)),
        None => Ok(PreviewRead::miss(None)),
    }
}

/// The "catalog" plugin: registers the catalog state + its invoke handler.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("catalog")
        .setup(|app, _api| {
            app.manage(CatalogState::new());
            app.manage(ContainerState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            catalog_open,
            catalog_close,
            catalog_integrity_check,
            catalog_optimize,
            catalog_backup,
            catalog_export_as_catalog,
            catalog_import_from_catalog,
            catalog_open_container,
            catalog_save_container,
            catalog_import_photo,
            catalog_import_managed_dng,
            catalog_create_virtual_copy,
            catalog_set_copy_name,
            catalog_make_master_photo,
            catalog_stack_photos,
            catalog_unstack,
            catalog_remove_photos,
            catalog_delete_photos_from_disk,
            catalog_find_duplicate,
            catalog_reveal_path,
            catalog_open_in_app,
            catalog_list_rejected_ids,
            catalog_set_stack_cover,
            catalog_split_stack,
            catalog_move_in_stack,
            catalog_list_stack,
            catalog_auto_stack,
            catalog_list_source_paths,
            catalog_mark_missing,
            catalog_relink,
            catalog_count_missing,
            catalog_list_photos,
            catalog_count_photos,
            catalog_duplicate_photos,
            catalog_get_photo,
            catalog_get_develop_export_identity,
            catalog_content_credentials,
            catalog_set_flags,
            catalog_set_metadata,
            catalog_set_recipe,
            catalog_get_recipe,
            catalog_add_snapshot,
            catalog_list_snapshots,
            catalog_delete_snapshot,
            catalog_record_history,
            catalog_list_history,
            catalog_clear_history,
            catalog_add_keyword,
            catalog_create_keyword,
            catalog_update_keyword,
            catalog_remove_keyword,
            catalog_replace_photo_keywords,
            catalog_list_photo_keywords,
            catalog_list_folders,
            catalog_list_filter_options,
            catalog_rename_photo_file,
            catalog_rename_folder,
            catalog_create_folder,
            catalog_remove_folder,
            catalog_update_folder_location,
            catalog_set_capture_time,
            catalog_set_gps,
            catalog_list_keywords,
            catalog_list_keyword_photos,
            catalog_delete_keyword,
            catalog_add_preset,
            catalog_list_presets,
            catalog_delete_preset,
            catalog_add_metadata_preset,
            catalog_list_metadata_presets,
            catalog_delete_metadata_preset,
            catalog_create_collection,
            catalog_list_collections,
            catalog_rename_collection,
            catalog_set_collection_rule,
            catalog_update_collection,
            catalog_delete_collection,
            catalog_add_to_collection,
            catalog_remove_from_collection,
            catalog_replace_collection_members,
            catalog_move_collection_members,
            catalog_list_collection_photos,
            catalog_record_preview,
            catalog_find_preview,
            catalog_preview_request,
            catalog_preview_put,
            catalog_preview_get,
            catalog_preview_gc,
        ])
        .build()
}

#[cfg(test)]
mod tests {
    use super::db;
    use super::*;
    use rusqlite::Connection;

    fn mem() -> Connection {
        db::open(":memory:").unwrap()
    }

    /// `PhotoIptc`'s fields are all `Option<String>`; fixtures read better without
    /// `.to_string()` on every line.
    fn some(s: &str) -> Option<String> {
        Some(s.to_string())
    }

    /// A rating-only filter (most tests only vary the rating floor).
    fn r(min_rating: i64) -> PhotoFilter {
        PhotoFilter {
            min_rating,
            ..Default::default()
        }
    }

    fn sample(path: &str, capture_time: Option<i64>) -> ImportPhoto {
        ImportPhoto {
            path: path.into(),
            fingerprint: format!("fp-{path}"),
            format: "raw:CR3".into(),
            byte_size: 1024,
            mtime: 100,
            width: 6000,
            height: 4000,
            orientation: 1,
            capture_time,
            camera_make: Some("Canon".into()),
            camera_model: Some("EOS R5".into()),
            lens: Some("RF 50mm".into()),
            iso: Some(400),
            f_number: Some(1.8),
            focal_length: Some(50.0),
            exposure_time: Some(0.005),
            gps_lat: None,
            gps_lon: None,
        }
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn managed_dng_survives_catalog_reopen_byte_for_byte() {
        let fixture = Path::new("target/raw-fixtures/dng-mosaic-canon-5d3.DNG")
            .canonicalize()
            .unwrap();
        let (size, digest) = digest_file(&File::open(&fixture).unwrap()).unwrap();
        let root = std::env::temp_dir().join(format!("managed-dng-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir(&root).unwrap();
        let catalog = root.join("test.galcat");
        let mut conn = db::open(catalog.to_str().unwrap()).unwrap();
        let mut photo = sample(fixture.to_str().unwrap(), None);
        photo.format = "raw:DNG".into();
        photo.fingerprint = digest.clone();
        photo.byte_size = size as i64;
        photo.width = 5920;
        photo.height = 3950;
        let id = import_managed_dng(&mut conn, photo).unwrap();
        drop(conn);
        let conn = db::open(catalog.to_str().unwrap()).unwrap();
        let row = db::get_photo(&conn, id).unwrap().unwrap();
        assert_ne!(row.path, row.read_path);
        assert_eq!(
            digest_file(&File::open(row.read_path).unwrap()).unwrap(),
            (size, digest)
        );
        drop(conn);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn cleanup_removes_only_stale_unreferenced_objects_and_owned_temps() {
        let path = std::env::temp_dir().join(format!(
            "galerie-cleanup-{}-{}.galcat",
            std::process::id(),
            line!()
        ));
        let _ = std::fs::remove_file(&path);
        let conn = db::open(path.to_str().unwrap()).unwrap();
        // Derive paths the same way the production code does (from
        // `conn.path()`, which may not be byte-identical to `path` — e.g.
        // macOS resolves `/var` to `/private/var`) so a `managed_path`
        // stored in the DB matches what cleanup itself would compute.
        let conn_path = PathBuf::from(conn.path().unwrap());
        let stem = conn_path
            .file_stem()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let assets = conn_path.parent().unwrap().join(format!("{stem}-assets"));
        let shard = assets.join("managed-originals/sha256/ab");
        std::fs::create_dir_all(&shard).unwrap();
        let unreferenced = shard.join("ab1111.dng");
        let referenced = shard.join("ab2222.dng");
        let temp = shard.join(".monet-stage-1-1");
        for f in [&unreferenced, &referenced, &temp] {
            std::fs::write(f, b"x").unwrap();
        }
        conn.execute(
            "INSERT INTO source_asset(path, fingerprint, format, byte_size, mtime, imported_at, managed_path) \
             VALUES ('/orig.dng','fp','raw:DNG',1,0,0,?1)",
            params![referenced.to_string_lossy()],
        )
        .unwrap();

        // Nothing is stale yet: everything survives.
        cleanup_stale_managed_objects(&conn, SystemTime::now()).unwrap();
        assert!(unreferenced.exists());
        assert!(referenced.exists());
        assert!(temp.exists());

        // Stale relative to an injected future "now": the unreferenced
        // object and the owned temp are removed; the referenced object
        // survives regardless of age.
        let future = SystemTime::now() + std::time::Duration::from_secs(25 * 3600);
        cleanup_stale_managed_objects(&conn, future).unwrap();
        assert!(
            !unreferenced.exists(),
            "stale unreferenced object must be removed"
        );
        assert!(!temp.exists(), "stale owned temp must be removed");
        assert!(
            referenced.exists(),
            "a referenced object must never be removed"
        );

        drop(conn);
        let _ = std::fs::remove_file(path.with_extension("galcat-shm"));
        let _ = std::fs::remove_file(path.with_extension("galcat-wal"));
        let _ = std::fs::remove_file(&path);
        std::fs::remove_dir_all(assets).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn cleanup_never_follows_a_symlinked_shard() {
        let path = std::env::temp_dir().join(format!(
            "galerie-cleanup-symlink-{}-{}.galcat",
            std::process::id(),
            line!()
        ));
        let _ = std::fs::remove_file(&path);
        let conn = db::open(path.to_str().unwrap()).unwrap();
        let stem = path.file_stem().unwrap().to_string_lossy().into_owned();
        let assets = path.parent().unwrap().join(format!("{stem}-assets"));
        let sha256_dir = assets.join("managed-originals/sha256");
        std::fs::create_dir_all(&sha256_dir).unwrap();
        let elsewhere = path.parent().unwrap().join(format!("{stem}-elsewhere"));
        std::fs::create_dir_all(&elsewhere).unwrap();
        let victim = elsewhere.join("victim.dng");
        std::fs::write(&victim, b"do not touch").unwrap();
        std::os::unix::fs::symlink(&elsewhere, sha256_dir.join("ab")).unwrap();

        let future = SystemTime::now() + std::time::Duration::from_secs(25 * 3600);
        cleanup_stale_managed_objects(&conn, future).unwrap();

        assert!(
            victim.exists(),
            "cleanup must never follow a symlinked shard"
        );
        assert_eq!(std::fs::read(&victim).unwrap(), b"do not touch");

        drop(conn);
        let _ = std::fs::remove_file(path.with_extension("galcat-shm"));
        let _ = std::fs::remove_file(path.with_extension("galcat-wal"));
        let _ = std::fs::remove_file(&path);
        std::fs::remove_dir_all(&elsewhere).unwrap();
        std::fs::remove_dir_all(assets).unwrap();
    }

    /// Copy pinned fixture 1022 to `dest` and return its (size, digest,
    /// width, height) — the exact values a real `ImportPhoto` preflight
    /// would carry — so fault-injection tests can mutate their own private
    /// copy of the source without ever touching the shared pinned fixture.
    #[cfg(target_os = "macos")]
    fn copy_fixture_to(dest: &Path) -> (u64, String, i64, i64) {
        let fixture = Path::new("target/raw-fixtures/dng-mosaic-canon-5d3.DNG")
            .canonicalize()
            .expect("fixture 1022 must be acquired before tests");
        std::fs::copy(&fixture, dest).unwrap();
        let (size, digest) = digest_file(&File::open(dest).unwrap()).unwrap();
        (size, digest, 5920, 3950)
    }

    #[cfg(target_os = "macos")]
    fn dng_photo(path: &Path, size: u64, digest: String, width: i64, height: i64) -> ImportPhoto {
        let mut photo = sample(path.to_str().unwrap(), None);
        photo.format = "raw:DNG".into();
        photo.fingerprint = digest;
        photo.byte_size = size as i64;
        photo.width = width;
        photo.height = height;
        photo
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn final_guard_rejects_a_source_parent_replaced_immediately_before_publication() {
        let root = std::env::temp_dir().join(format!(
            "managed-dng-parent-swap-{}-{}",
            std::process::id(),
            line!()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let source_parent = root.join("source-parent");
        std::fs::create_dir_all(&source_parent).unwrap();
        let source_path = source_parent.join("photo.dng");
        let (size, digest, width, height) = copy_fixture_to(&source_path);

        let catalog = root.join("test.galcat");
        let mut conn = db::open(catalog.to_str().unwrap()).unwrap();
        let photo = dng_photo(&source_path, size, digest.clone(), width, height);

        let hooks = ManagedDngImportHooks {
            // Swap the source's parent directory for a brand-new, empty one
            // at the same path while the copy is in flight — this must not
            // disturb the already-open copy (Unix descriptors are
            // decoupled from pathname changes), but the publication
            // `final_guard` must observe the replacement and reject before
            // any rename. The replacement parent is empty (no file of the
            // original name at all), so the guard's fresh no-follow reopen
            // of the *named component* fails first (ENOENT) — a strictly
            // earlier, independently sufficient rejection than the guard's
            // later parent-identity check (see
            // `final_guard_rejects_a_same_device_parent_replacement_that_preserves_the_original_inode`
            // for a scenario that isolates that later check specifically,
            // by hard-linking the original file into the replacement
            // parent so the named component's own identity is unchanged).
            after_copy_chunk: Box::new({
                let source_parent = source_parent.clone();
                let root = root.clone();
                let mut swapped = false;
                move |_copied| {
                    if !swapped {
                        swapped = true;
                        let moved_aside = root.join("source-parent-moved-aside");
                        std::fs::rename(&source_parent, &moved_aside).unwrap();
                        std::fs::create_dir(&source_parent).unwrap();
                    }
                }
            }),
            ..Default::default()
        };
        let err = import_managed_dng_with_hooks(&mut conn, photo, hooks).unwrap_err();
        assert!(
            err.contains("named component changed")
                || err.contains("source parent directory changed"),
            "{err}"
        );

        // No catalog row was created.
        let existing: Option<String> = conn
            .query_row(
                "SELECT fingerprint FROM source_asset WHERE path=?1",
                params![source_path.to_str().unwrap()],
                |r| r.get(0),
            )
            .optional()
            .unwrap();
        assert!(existing.is_none());

        // The final rename never happened: no digest-named object exists
        // anywhere under the managed root.
        let managed = managed_path(&catalog, &digest).unwrap();
        assert!(!managed.exists(), "publication must not have occurred");
        // The staged temp was self-cleaned by `AtomicStagedFile::Drop`.
        let shard = managed.parent().unwrap();
        if shard.exists() {
            let leftovers: Vec<_> = std::fs::read_dir(shard).unwrap().collect();
            assert!(leftovers.is_empty(), "{leftovers:?}");
        }
        // The original source file itself, now under the moved-aside
        // parent, is byte-for-byte untouched.
        let moved_aside = root.join("source-parent-moved-aside").join("photo.dng");
        assert_eq!(
            digest_file(&File::open(&moved_aside).unwrap()).unwrap().1,
            digest
        );

        drop(conn);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn final_guard_rejects_a_parent_swap_that_preserves_the_named_components_own_identity() {
        // Isolates the publication `final_guard`'s *last* check (fresh
        // parent-directory identity) specifically, as distinct from every
        // other check: the file at `source_parent/photo.dng` after the
        // swap has the *exact same* (device, inode, size, mtime, ctime) as
        // before — because the second hard link was created *before* the
        // transaction ever captured identity, so no link-count/metadata
        // change to that inode happens *during* the transaction (an
        // in-transaction `hard_link`/`rename`-over-existing-name would
        // itself bump the inode's ctime via the implicit link-count
        // change, which is exactly what makes every *other* swap test in
        // this file get caught by the earlier identity/digest checks
        // instead). Only a check of the *parent directory's own* identity
        // can catch this one.
        let root = std::env::temp_dir().join(format!(
            "managed-dng-parent-swap-preserve-inode-{}-{}",
            std::process::id(),
            line!()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let source_parent = root.join("source-parent");
        let alt_parent = root.join("alt-parent");
        std::fs::create_dir_all(&source_parent).unwrap();
        std::fs::create_dir_all(&alt_parent).unwrap();
        let source_path = source_parent.join("photo.dng");
        let (size, digest, width, height) = copy_fixture_to(&source_path);
        // Pre-establish the second hard link *before* the transaction
        // starts (and therefore before it captures the source's identity)
        // so the file's own (device, inode, size, mtime, ctime) is already
        // at its final, stable value — swapping which directory occupies
        // `source_parent`'s path later touches only the two *directories'*
        // own metadata, never the child file's.
        std::fs::hard_link(&source_path, alt_parent.join("photo.dng")).unwrap();

        let catalog = root.join("test.galcat");
        let mut conn = db::open(catalog.to_str().unwrap()).unwrap();
        let photo = dng_photo(&source_path, size, digest.clone(), width, height);

        let hooks = ManagedDngImportHooks {
            after_copy_chunk: Box::new({
                let source_parent = source_parent.clone();
                let alt_parent = alt_parent.clone();
                let root = root.clone();
                let mut swapped = false;
                move |_copied| {
                    if !swapped {
                        swapped = true;
                        let moved_aside = root.join("source-parent-moved-aside");
                        std::fs::rename(&source_parent, &moved_aside).unwrap();
                        std::fs::rename(&alt_parent, &source_parent).unwrap();
                    }
                }
            }),
            ..Default::default()
        };
        let err = import_managed_dng_with_hooks(&mut conn, photo, hooks).unwrap_err();
        assert!(err.contains("source parent directory changed"), "{err}");

        let existing: Option<String> = conn
            .query_row(
                "SELECT fingerprint FROM source_asset WHERE path=?1",
                params![source_path.to_str().unwrap()],
                |r| r.get(0),
            )
            .optional()
            .unwrap();
        assert!(existing.is_none());
        let managed = managed_path(&catalog, &digest).unwrap();
        assert!(!managed.exists(), "publication must not have occurred");
        let shard = managed.parent().unwrap();
        if shard.exists() {
            let leftovers: Vec<_> = std::fs::read_dir(shard).unwrap().collect();
            assert!(leftovers.is_empty(), "{leftovers:?}");
        }
        assert_eq!(
            digest_file(&File::open(source_parent.join("photo.dng")).unwrap())
                .unwrap()
                .1,
            digest,
            "the hard-linked original bytes are untouched"
        );

        drop(conn);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn final_guard_rejects_a_same_inode_same_size_byte_mutation_before_rename() {
        // Same device, same inode, same byte length — only the content (and
        // therefore the digest) changed. On this platform any in-place
        // write also advances mtime/ctime, so the guard's full-identity
        // check (checked first) is what actually trips here in practice;
        // the subsequent full re-digest is real, reachable, defense-in-
        // depth for any environment where a write did not (or could not be
        // trusted to) advance mtime/ctime — this test proves the combined
        // guard rejects the mutation and publishes nothing, regardless of
        // which specific sub-check fires.
        let root = std::env::temp_dir().join(format!(
            "managed-dng-byte-mutation-{}-{}",
            std::process::id(),
            line!()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let source_path = root.join("photo.dng");
        let (size, digest, width, height) = copy_fixture_to(&source_path);

        let catalog = root.join("test.galcat");
        let mut conn = db::open(catalog.to_str().unwrap()).unwrap();
        let photo = dng_photo(&source_path, size, digest.clone(), width, height);

        let hooks = ManagedDngImportHooks {
            after_copy_chunk: Box::new({
                let source_path = source_path.clone();
                let mut mutated = false;
                move |_copied| {
                    if !mutated {
                        mutated = true;
                        // Flip one byte via a fresh, independent handle —
                        // never through the retained descriptor the copy
                        // loop itself is reading from — same offset, same
                        // length, so `(device, inode, size)` alone cannot
                        // observe the change.
                        let mut f = std::fs::OpenOptions::new()
                            .write(true)
                            .open(&source_path)
                            .unwrap();
                        f.seek(SeekFrom::Start(0)).unwrap();
                        f.write_all(&[0xAAu8]).unwrap();
                    }
                }
            }),
            ..Default::default()
        };
        let err = import_managed_dng_with_hooks(&mut conn, photo, hooks).unwrap_err();
        assert!(
            err.contains("DNG source identity changed") || err.contains("DNG source bytes changed"),
            "{err}"
        );

        let existing: Option<String> = conn
            .query_row(
                "SELECT fingerprint FROM source_asset WHERE path=?1",
                params![source_path.to_str().unwrap()],
                |r| r.get(0),
            )
            .optional()
            .unwrap();
        assert!(existing.is_none());
        let managed = managed_path(&catalog, &digest).unwrap();
        assert!(!managed.exists(), "publication must not have occurred");
        let shard = managed.parent().unwrap();
        if shard.exists() {
            let leftovers: Vec<_> = std::fs::read_dir(shard).unwrap().collect();
            assert!(leftovers.is_empty(), "{leftovers:?}");
        }

        drop(conn);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn final_guard_rejects_a_named_source_file_replaced_before_rename() {
        // The retained descriptor still points at the original inode
        // (untouched, still readable, still byte-identical) — only the
        // *name* now resolves to a different file. In practice, replacing
        // what a name resolves to via `rename` implicitly unlinks the
        // previous target, which itself bumps *that* inode's own ctime —
        // so the guard's very first check (the retained descriptor's own
        // full identity) already catches this on this platform, before
        // ever reaching the fresh named-component reopen that would also
        // independently catch it (see the ENOENT case exercised by
        // `final_guard_rejects_a_source_parent_replaced_immediately_before_publication`,
        // where the original file is *moved*, not unlinked, so its own
        // ctime is untouched and only the named-component reopen fires).
        let root = std::env::temp_dir().join(format!(
            "managed-dng-named-replace-{}-{}",
            std::process::id(),
            line!()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let source_path = root.join("photo.dng");
        let (size, digest, width, height) = copy_fixture_to(&source_path);

        let catalog = root.join("test.galcat");
        let mut conn = db::open(catalog.to_str().unwrap()).unwrap();
        let photo = dng_photo(&source_path, size, digest.clone(), width, height);

        let hooks = ManagedDngImportHooks {
            after_copy_chunk: Box::new({
                let source_path = source_path.clone();
                let root = root.clone();
                let mut replaced = false;
                move |_copied| {
                    if !replaced {
                        replaced = true;
                        let replacement = root.join("replacement.dng");
                        std::fs::write(&replacement, b"a completely different file").unwrap();
                        std::fs::rename(&replacement, &source_path).unwrap();
                    }
                }
            }),
            ..Default::default()
        };
        let err = import_managed_dng_with_hooks(&mut conn, photo, hooks).unwrap_err();
        assert!(
            err.contains("named component changed") || err.contains("DNG source identity changed"),
            "{err}"
        );

        let existing: Option<String> = conn
            .query_row(
                "SELECT fingerprint FROM source_asset WHERE path=?1",
                params![source_path.to_str().unwrap()],
                |r| r.get(0),
            )
            .optional()
            .unwrap();
        assert!(existing.is_none());
        let managed = managed_path(&catalog, &digest).unwrap();
        assert!(!managed.exists(), "publication must not have occurred");
        let shard = managed.parent().unwrap();
        if shard.exists() {
            let leftovers: Vec<_> = std::fs::read_dir(shard).unwrap().collect();
            assert!(leftovers.is_empty(), "{leftovers:?}");
        }
        assert_eq!(
            std::fs::read(&source_path).unwrap(),
            b"a completely different file",
            "the replacement file itself is untouched by the rejected import"
        );

        drop(conn);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn final_guard_rejects_the_final_component_replaced_by_a_symlink_before_rename() {
        // `remove_file` unlinks the original inode (bumping its own ctime,
        // caught by the guard's first check) before the symlink is
        // created at the same name; if that first check somehow passed,
        // the fresh no-follow named-component reopen would independently
        // reject the symlink itself (`O_NOFOLLOW` -> `ELOOP`/`ENOENT`).
        // Either way, nothing is ever published and the symlink target is
        // never touched.
        let root = std::env::temp_dir().join(format!(
            "managed-dng-symlink-swap-{}-{}",
            std::process::id(),
            line!()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let source_path = root.join("photo.dng");
        let (size, digest, width, height) = copy_fixture_to(&source_path);
        let elsewhere = root.join("elsewhere.dng");
        std::fs::write(&elsewhere, b"symlink target, must never be touched").unwrap();

        let catalog = root.join("test.galcat");
        let mut conn = db::open(catalog.to_str().unwrap()).unwrap();
        let photo = dng_photo(&source_path, size, digest.clone(), width, height);

        let hooks = ManagedDngImportHooks {
            after_copy_chunk: Box::new({
                let source_path = source_path.clone();
                let elsewhere = elsewhere.clone();
                let mut swapped = false;
                move |_copied| {
                    if !swapped {
                        swapped = true;
                        std::fs::remove_file(&source_path).unwrap();
                        std::os::unix::fs::symlink(&elsewhere, &source_path).unwrap();
                    }
                }
            }),
            ..Default::default()
        };
        let err = import_managed_dng_with_hooks(&mut conn, photo, hooks).unwrap_err();
        assert!(
            err.contains("named component changed") || err.contains("DNG source identity changed"),
            "{err}"
        );

        let existing: Option<String> = conn
            .query_row(
                "SELECT fingerprint FROM source_asset WHERE path=?1",
                params![source_path.to_str().unwrap()],
                |r| r.get(0),
            )
            .optional()
            .unwrap();
        assert!(existing.is_none());
        let managed = managed_path(&catalog, &digest).unwrap();
        assert!(!managed.exists(), "publication must not have occurred");
        let shard = managed.parent().unwrap();
        if shard.exists() {
            let leftovers: Vec<_> = std::fs::read_dir(shard).unwrap().collect();
            assert!(leftovers.is_empty(), "{leftovers:?}");
        }
        assert_eq!(
            std::fs::read(&elsewhere).unwrap(),
            b"symlink target, must never be touched"
        );

        drop(conn);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn pre_commit_revalidation_rejects_a_source_parent_replaced_after_publication() {
        // Distinct from `final_guard_rejects_a_source_parent_replaced_...`
        // above: there, the swap happens *before* publication, so the
        // publication `final_guard` catches it and nothing is ever
        // published. Here the swap happens *after* a successful,
        // already-durable publication — proving the pre-commit
        // revalidation block's *own* independent parent-identity check
        // (not `final_guard`, which already ran and passed) also rejects
        // it, exercising that second, distinct boundary named by the
        // architecture ("at each relevant boundary").
        let root = std::env::temp_dir().join(format!(
            "managed-dng-parent-swap-post-publish-{}-{}",
            std::process::id(),
            line!()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let source_parent = root.join("source-parent");
        std::fs::create_dir_all(&source_parent).unwrap();
        let source_path = source_parent.join("photo.dng");
        let (size, digest, width, height) = copy_fixture_to(&source_path);

        let catalog = root.join("test.galcat");
        let mut conn = db::open(catalog.to_str().unwrap()).unwrap();
        let photo = dng_photo(&source_path, size, digest.clone(), width, height);

        let hooks = ManagedDngImportHooks {
            after_publish: Box::new({
                let source_parent = source_parent.clone();
                let root = root.clone();
                move || {
                    // Replace the parent directory, but hard-link the
                    // original file (same device, same inode) into the
                    // replacement under the same name — this is the
                    // scenario named by the architecture explicitly: the
                    // *file's own* identity is unchanged (so a check that
                    // only compares the source file's own (dev, ino)
                    // cannot detect this), but the *parent* is a genuinely
                    // different directory.
                    let moved_aside = root.join("source-parent-moved-aside");
                    std::fs::rename(&source_parent, &moved_aside).unwrap();
                    std::fs::create_dir(&source_parent).unwrap();
                    std::fs::hard_link(
                        moved_aside.join("photo.dng"),
                        source_parent.join("photo.dng"),
                    )
                    .unwrap();
                }
            }),
            ..Default::default()
        };
        let err = import_managed_dng_with_hooks(&mut conn, photo, hooks).unwrap_err();
        assert!(
            err.contains("DNG source changed before catalog commit"),
            "{err}"
        );

        // No catalog row was created despite the managed original having
        // already been durably published — it is a verified orphan.
        let existing: Option<String> = conn
            .query_row(
                "SELECT fingerprint FROM source_asset WHERE path=?1",
                params![source_path.to_str().unwrap()],
                |r| r.get(0),
            )
            .optional()
            .unwrap();
        assert!(existing.is_none());
        let managed = managed_path(&catalog, &digest).unwrap();
        assert!(
            managed.exists(),
            "publication itself already succeeded before the parent was swapped"
        );
        assert_eq!(
            digest_file(&File::open(&managed).unwrap()).unwrap().1,
            digest
        );

        drop(conn);
        // The moved-aside directory is nested inside `root`
        // (`root/source-parent-moved-aside`), so this alone cleans it up.
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn pre_commit_revalidation_rejects_a_source_byte_mutation_after_publication() {
        // The publication `final_guard` already ran and passed (the source
        // was untouched at that moment); the mutation happens strictly
        // *after* durable publication but *before* the SQLite transaction
        // that would give it a catalog row — the pre-commit block's own
        // full re-digest (independent of, and later than, the guard) must
        // still catch it. The managed original was already durably
        // published and is therefore a verified orphan, not a dangling
        // partial write.
        let root = std::env::temp_dir().join(format!(
            "managed-dng-post-publish-byte-mutation-{}-{}",
            std::process::id(),
            line!()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let source_path = root.join("photo.dng");
        let (size, digest, width, height) = copy_fixture_to(&source_path);

        let catalog = root.join("test.galcat");
        let mut conn = db::open(catalog.to_str().unwrap()).unwrap();
        let photo = dng_photo(&source_path, size, digest.clone(), width, height);

        let hooks = ManagedDngImportHooks {
            after_publish: Box::new({
                let source_path = source_path.clone();
                move || {
                    let mut f = std::fs::OpenOptions::new()
                        .write(true)
                        .open(&source_path)
                        .unwrap();
                    f.seek(SeekFrom::Start(0)).unwrap();
                    f.write_all(&[0xAAu8]).unwrap();
                }
            }),
            ..Default::default()
        };
        let err = import_managed_dng_with_hooks(&mut conn, photo, hooks).unwrap_err();
        assert!(
            err.contains("DNG source changed before catalog commit"),
            "{err}"
        );

        let existing: Option<String> = conn
            .query_row(
                "SELECT fingerprint FROM source_asset WHERE path=?1",
                params![source_path.to_str().unwrap()],
                |r| r.get(0),
            )
            .optional()
            .unwrap();
        assert!(
            existing.is_none(),
            "no catalog row after a post-publication mutation"
        );
        let managed = managed_path(&catalog, &digest).unwrap();
        assert!(
            managed.exists(),
            "publication itself already succeeded before the mutation"
        );
        assert_eq!(
            digest_file(&File::open(&managed).unwrap()).unwrap().1,
            digest,
            "the already-published managed original is unaffected by the source mutation"
        );

        drop(conn);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn pre_commit_revalidation_rejects_a_named_source_file_replaced_after_publication() {
        // Same distinction as the byte-mutation test above, for a full
        // named-file replacement (different inode) instead of an in-place
        // mutation: happens after durable publication, before commit.
        let root = std::env::temp_dir().join(format!(
            "managed-dng-post-publish-named-replace-{}-{}",
            std::process::id(),
            line!()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let source_path = root.join("photo.dng");
        let (size, digest, width, height) = copy_fixture_to(&source_path);

        let catalog = root.join("test.galcat");
        let mut conn = db::open(catalog.to_str().unwrap()).unwrap();
        let photo = dng_photo(&source_path, size, digest.clone(), width, height);

        let hooks = ManagedDngImportHooks {
            after_publish: Box::new({
                let source_path = source_path.clone();
                let root = root.clone();
                move || {
                    let replacement = root.join("replacement.dng");
                    std::fs::write(&replacement, b"a completely different file").unwrap();
                    std::fs::rename(&replacement, &source_path).unwrap();
                }
            }),
            ..Default::default()
        };
        let err = import_managed_dng_with_hooks(&mut conn, photo, hooks).unwrap_err();
        assert!(
            err.contains("DNG source changed before catalog commit"),
            "{err}"
        );

        let existing: Option<String> = conn
            .query_row(
                "SELECT fingerprint FROM source_asset WHERE path=?1",
                params![source_path.to_str().unwrap()],
                |r| r.get(0),
            )
            .optional()
            .unwrap();
        assert!(existing.is_none());
        let managed = managed_path(&catalog, &digest).unwrap();
        assert!(managed.exists(), "publication itself already succeeded");
        assert_eq!(
            digest_file(&File::open(&managed).unwrap()).unwrap().1,
            digest
        );
        assert_eq!(
            std::fs::read(&source_path).unwrap(),
            b"a completely different file",
            "the replacement file itself is untouched by the rejected import"
        );

        drop(conn);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn db_commit_failure_after_durable_publish_leaves_a_reclaimable_orphan() {
        let root = std::env::temp_dir().join(format!(
            "managed-dng-db-failure-{}-{}",
            std::process::id(),
            line!()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let source_path = root.join("photo.dng");
        let (size, digest, width, height) = copy_fixture_to(&source_path);

        let catalog = root.join("test.galcat");
        let mut conn = db::open(catalog.to_str().unwrap()).unwrap();
        let photo = dng_photo(&source_path, size, digest.clone(), width, height);

        let hooks = ManagedDngImportHooks {
            // Simulate a SQLite-layer failure at the exact point the
            // architecture calls out: after the managed original is
            // durably published, before the transaction that would give
            // it a catalog row.
            before_commit: Box::new(|| Err("simulated DB failure".into())),
            ..Default::default()
        };
        let err = import_managed_dng_with_hooks(&mut conn, photo, hooks).unwrap_err();
        assert!(err.contains("simulated DB failure"), "{err}");

        let existing: Option<String> = conn
            .query_row(
                "SELECT fingerprint FROM source_asset WHERE path=?1",
                params![source_path.to_str().unwrap()],
                |r| r.get(0),
            )
            .optional()
            .unwrap();
        assert!(
            existing.is_none(),
            "no catalog row must exist after a DB failure"
        );

        // The managed original is durably published on disk — a verified
        // orphan — even though no row references it.
        let managed = managed_path(&catalog, &digest).unwrap();
        assert!(managed.exists(), "the durable publish must have succeeded");
        assert_eq!(
            digest_file(&File::open(&managed).unwrap()).unwrap().1,
            digest
        );

        // Not yet stale: survives cleanup at real "now".
        cleanup_stale_managed_objects(&conn, SystemTime::now()).unwrap();
        assert!(managed.exists());

        // Past the 24-hour cutoff: the unreferenced orphan is reclaimed.
        let future = SystemTime::now() + std::time::Duration::from_secs(25 * 3600);
        cleanup_stale_managed_objects(&conn, future).unwrap();
        assert!(
            !managed.exists(),
            "the orphan must be reclaimed after the cutoff"
        );

        drop(conn);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn permission_sync_failure_leaves_no_catalog_row_and_a_reclaimable_orphan() {
        // The managed original is already durably published and made
        // `0400` at this point — only the trailing `fsync` of that
        // permission change fails. Distinct from every `PublishHooks`
        // fault point (all of which live inside `AtomicStagedFile::publish`
        // itself): this one is specific to the DNG-managed-import layer's
        // *own* post-publish step, run after `publish` has already
        // returned successfully.
        let root = std::env::temp_dir().join(format!(
            "managed-dng-permission-sync-fail-{}-{}",
            std::process::id(),
            line!()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let source_path = root.join("photo.dng");
        let (size, digest, width, height) = copy_fixture_to(&source_path);

        let catalog = root.join("test.galcat");
        let mut conn = db::open(catalog.to_str().unwrap()).unwrap();
        let photo = dng_photo(&source_path, size, digest.clone(), width, height);

        let hooks = ManagedDngImportHooks {
            before_permission_sync: Box::new(|| Err("simulated permission-sync failure".into())),
            ..Default::default()
        };
        let err = import_managed_dng_with_hooks(&mut conn, photo, hooks).unwrap_err();
        assert!(err.contains("simulated permission-sync failure"), "{err}");

        let existing: Option<String> = conn
            .query_row(
                "SELECT fingerprint FROM source_asset WHERE path=?1",
                params![source_path.to_str().unwrap()],
                |r| r.get(0),
            )
            .optional()
            .unwrap();
        assert!(
            existing.is_none(),
            "no catalog row after a permission-sync failure"
        );

        // The managed original is durably published (and already `0400`)
        // — a verified orphan, reclaimable exactly like a DB-commit
        // failure's orphan.
        let managed = managed_path(&catalog, &digest).unwrap();
        assert!(managed.exists());
        assert_eq!(
            digest_file(&File::open(&managed).unwrap()).unwrap().1,
            digest
        );
        let future = SystemTime::now() + std::time::Duration::from_secs(25 * 3600);
        cleanup_stale_managed_objects(&conn, future).unwrap();
        assert!(
            !managed.exists(),
            "the orphan must be reclaimed after the cutoff"
        );

        drop(conn);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn a_real_post_visibility_publish_warning_refuses_a_row_and_leaves_a_reclaimable_orphan() {
        // Distinct from the DB-layer `before_commit` failure and the
        // catalog-specific `before_permission_sync` failure above: this
        // injects a failure at the underlying `AtomicStagedFile::publish`
        // primitive's own post-rename checkpoint (`before_publish_step`,
        // forwarded verbatim as that primitive's `PublishHooks::before_step`)
        // — a genuine `durability_warning` from the shared publisher
        // itself, proving the catalog layer's own
        // `if let Some(warning) = durability_warning { return Err(...) }`
        // branch, which no other test in this file reaches.
        let root = std::env::temp_dir().join(format!(
            "managed-dng-real-durability-warning-{}-{}",
            std::process::id(),
            line!()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let source_path = root.join("photo.dng");
        let (size, digest, width, height) = copy_fixture_to(&source_path);

        let catalog = root.join("test.galcat");
        let mut conn = db::open(catalog.to_str().unwrap()).unwrap();
        let photo = dng_photo(&source_path, size, digest.clone(), width, height);

        let hooks = ManagedDngImportHooks {
            before_publish_step: Box::new(|step| {
                if step == crate::atomic_publish::PublishStep::ParentSync {
                    Err("simulated real publisher parent-sync failure".into())
                } else {
                    Ok(())
                }
            }),
            ..Default::default()
        };
        let err = import_managed_dng_with_hooks(&mut conn, photo, hooks).unwrap_err();
        assert!(err.contains("durability warning"), "{err}");
        assert!(
            err.contains("simulated real publisher parent-sync failure"),
            "{err}"
        );

        let existing: Option<String> = conn
            .query_row(
                "SELECT fingerprint FROM source_asset WHERE path=?1",
                params![source_path.to_str().unwrap()],
                |r| r.get(0),
            )
            .optional()
            .unwrap();
        assert!(
            existing.is_none(),
            "the catalog layer refuses a row when the publisher itself only committed with a warning"
        );

        let managed = managed_path(&catalog, &digest).unwrap();
        assert!(managed.exists(), "the rename itself already committed");
        assert_eq!(
            digest_file(&File::open(&managed).unwrap()).unwrap().1,
            digest
        );
        let future = SystemTime::now() + std::time::Duration::from_secs(25 * 3600);
        cleanup_stale_managed_objects(&conn, future).unwrap();
        assert!(
            !managed.exists(),
            "the orphan must be reclaimed after the cutoff"
        );

        drop(conn);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn cleanup_respects_the_exact_24_hour_cutoff_boundary() {
        // Not "comfortably before/after" — the exact second on either side
        // of `CUTOFF_SECS`, derived from each orphan's own real on-disk
        // mtime (never a sleep). `cleanup_stale_managed_objects`'s
        // comparator is `age.as_secs() < CUTOFF_SECS` (survives only if
        // strictly younger): `CUTOFF_SECS - 1` must survive, `CUTOFF_SECS`
        // exactly must already be reclaimed. `CUTOFF_SECS + 1` exercises
        // the same single `else` branch as `CUTOFF_SECS` exactly — there is
        // no third branch in the comparator to isolate — so it is proven
        // here too, on a second, independently-created orphan (the first
        // was already reclaimed by the `CUTOFF_SECS`-exact step, freeing
        // its digest-addressed path for reuse), rather than asserted only
        // by inference from monotonicity.
        let root = std::env::temp_dir().join(format!(
            "managed-dng-cutoff-exact-{}-{}",
            std::process::id(),
            line!()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let source_path = root.join("photo.dng");
        let (size, digest, width, height) = copy_fixture_to(&source_path);

        let catalog = root.join("test.galcat");
        let mut conn = db::open(catalog.to_str().unwrap()).unwrap();
        const CUTOFF_SECS: u64 = 24 * 60 * 60;
        let make_orphan = || ManagedDngImportHooks {
            before_commit: Box::new(|| Err("simulated DB failure".into())),
            ..Default::default()
        };

        let photo = dng_photo(&source_path, size, digest.clone(), width, height);
        import_managed_dng_with_hooks(&mut conn, photo, make_orphan()).unwrap_err();
        let managed = managed_path(&catalog, &digest).unwrap();
        let mtime = std::fs::metadata(&managed).unwrap().modified().unwrap();

        cleanup_stale_managed_objects(
            &conn,
            mtime + std::time::Duration::from_secs(CUTOFF_SECS - 1),
        )
        .unwrap();
        assert!(
            managed.exists(),
            "one second under the 24-hour cutoff must survive"
        );

        cleanup_stale_managed_objects(&conn, mtime + std::time::Duration::from_secs(CUTOFF_SECS))
            .unwrap();
        assert!(
            !managed.exists(),
            "exactly the 24-hour cutoff must already be reclaimed"
        );

        // A fresh second orphan at the same digest-addressed path (free
        // again now that the first was reclaimed), tested one second past
        // the cutoff.
        let photo = dng_photo(&source_path, size, digest.clone(), width, height);
        import_managed_dng_with_hooks(&mut conn, photo, make_orphan()).unwrap_err();
        let mtime = std::fs::metadata(&managed).unwrap().modified().unwrap();
        cleanup_stale_managed_objects(
            &conn,
            mtime + std::time::Duration::from_secs(CUTOFF_SECS + 1),
        )
        .unwrap();
        assert!(
            !managed.exists(),
            "one second past the 24-hour cutoff must already be reclaimed"
        );

        drop(conn);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn interrupted_copy_source_truncated_mid_copy_is_rejected() {
        let root = std::env::temp_dir().join(format!(
            "managed-dng-truncate-{}-{}",
            std::process::id(),
            line!()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let source_path = root.join("photo.dng");
        // Fixture 1022 is ~48 MB, well over the 1 MiB copy-loop buffer, so
        // truncating after the first chunk is guaranteed to interrupt a
        // copy still in progress rather than one that already finished.
        let (size, digest, width, height) = copy_fixture_to(&source_path);

        let catalog = root.join("test.galcat");
        let mut conn = db::open(catalog.to_str().unwrap()).unwrap();
        let photo = dng_photo(&source_path, size, digest.clone(), width, height);

        let hooks = ManagedDngImportHooks {
            after_copy_chunk: Box::new({
                let source_path = source_path.clone();
                let mut truncated = false;
                move |copied| {
                    assert!(
                        copied < size,
                        "must truncate before the copy loop would finish normally"
                    );
                    if !truncated {
                        truncated = true;
                        std::fs::OpenOptions::new()
                            .write(true)
                            .open(&source_path)
                            .unwrap()
                            .set_len(1_500_000)
                            .unwrap();
                    }
                }
            }),
            ..Default::default()
        };
        let err = import_managed_dng_with_hooks(&mut conn, photo, hooks).unwrap_err();
        assert!(err.contains("copy size or digest mismatch"), "{err}");

        let existing: Option<String> = conn
            .query_row(
                "SELECT fingerprint FROM source_asset WHERE path=?1",
                params![source_path.to_str().unwrap()],
                |r| r.get(0),
            )
            .optional()
            .unwrap();
        assert!(existing.is_none());
        let managed = managed_path(&catalog, &digest).unwrap();
        assert!(
            !managed.exists(),
            "a truncated copy must never be published"
        );

        drop(conn);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn same_digest_reimport_is_idempotent_and_reuses_the_managed_object() {
        let root = std::env::temp_dir().join(format!(
            "managed-dng-idempotent-{}-{}",
            std::process::id(),
            line!()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let source_path = root.join("photo.dng");
        let (size, digest, width, height) = copy_fixture_to(&source_path);
        let catalog = root.join("test.galcat");
        let mut conn = db::open(catalog.to_str().unwrap()).unwrap();

        let id1 = import_managed_dng(
            &mut conn,
            dng_photo(&source_path, size, digest.clone(), width, height),
        )
        .unwrap();
        let managed = managed_path(&catalog, &digest).unwrap();
        let ino_before = managed.metadata().unwrap().ino();

        // Re-import the exact same source: same path, same digest. The
        // managed object must be reused (EEXIST-identical-bytes, at the
        // `atomic_publish` layer) and the same catalog row must be
        // returned, not a duplicate.
        let id2 = import_managed_dng(
            &mut conn,
            dng_photo(&source_path, size, digest.clone(), width, height),
        )
        .unwrap();
        assert_eq!(
            id1, id2,
            "re-importing the same source must not create a second photo row"
        );
        let ino_after = managed.metadata().unwrap().ino();
        assert_eq!(
            ino_before, ino_after,
            "the managed object must be reused, not replaced"
        );
        assert_eq!(
            digest_file(&File::open(&managed).unwrap()).unwrap().1,
            digest
        );

        drop(conn);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn same_path_different_digest_is_rejected_without_mutating_the_existing_row() {
        let root = std::env::temp_dir().join(format!(
            "managed-dng-collision-{}-{}",
            std::process::id(),
            line!()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let source_path = root.join("photo.dng");
        let (size, digest, width, height) = copy_fixture_to(&source_path);
        let catalog = root.join("test.galcat");
        let mut conn = db::open(catalog.to_str().unwrap()).unwrap();
        import_managed_dng(
            &mut conn,
            dng_photo(&source_path, size, digest.clone(), width, height),
        )
        .unwrap();

        // Simulate the catalog already recording a *different* digest for
        // this exact display path (e.g. a stale/tampered row) by mutating
        // it directly, then re-import the source's real, unchanged,
        // correctly self-consistent bytes. Native validation of the
        // preflight-vs-actual identity passes (the file itself didn't
        // change), so this exercises the later same-path/different-digest
        // collision check specifically, not the earlier preflight check.
        conn.execute(
            "UPDATE source_asset SET fingerprint=?1 WHERE path=?2",
            params!["11".repeat(32), source_path.to_str().unwrap()],
        )
        .unwrap();
        let err = import_managed_dng(
            &mut conn,
            dng_photo(&source_path, size, digest.clone(), width, height),
        )
        .unwrap_err();
        assert!(err.contains("different bytes"), "{err}");

        // The row is left exactly as it was immediately before this failed
        // call (still the deliberately mutated value) — the collision
        // check fails *without mutating* the row any further either way.
        let row_digest: String = conn
            .query_row(
                "SELECT fingerprint FROM source_asset WHERE path=?1",
                params![source_path.to_str().unwrap()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            row_digest,
            "11".repeat(32),
            "the collision check must not itself further mutate the row"
        );
        // The managed original from the first, successful import is
        // untouched — both existing objects (row and managed bytes) are
        // preserved through the rejected collision.
        let managed = managed_path(&catalog, &digest).unwrap();
        assert_eq!(
            digest_file(&File::open(&managed).unwrap()).unwrap().1,
            digest
        );

        drop(conn);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn rejects_a_symlink_at_the_final_source_component() {
        let root = std::env::temp_dir().join(format!(
            "managed-dng-symlink-{}-{}",
            std::process::id(),
            line!()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let real = root.join("real.dng");
        let (size, digest, width, height) = copy_fixture_to(&real);
        let link = root.join("photo.dng");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        let catalog = root.join("test.galcat");
        let mut conn = db::open(catalog.to_str().unwrap()).unwrap();
        let photo = dng_photo(&link, size, digest, width, height);
        let err = import_managed_dng(&mut conn, photo).unwrap_err();
        assert!(
            err.contains("without following links") || err.contains("regular file"),
            "{err}"
        );
        let existing: Option<String> = conn
            .query_row(
                "SELECT fingerprint FROM source_asset WHERE path=?1",
                params![link.to_str().unwrap()],
                |r| r.get(0),
            )
            .optional()
            .unwrap();
        assert!(existing.is_none());

        drop(conn);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn rejects_a_preflight_digest_mismatch_before_any_copy() {
        let root = std::env::temp_dir().join(format!(
            "managed-dng-preflight-mismatch-{}-{}",
            std::process::id(),
            line!()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let source_path = root.join("photo.dng");
        let (size, _digest, width, height) = copy_fixture_to(&source_path);
        let catalog = root.join("test.galcat");
        let mut conn = db::open(catalog.to_str().unwrap()).unwrap();

        // Simulate a JS-side preflight computed against different bytes
        // than what native now observes for this path (mutation between
        // JS preflight and native descriptor open).
        let wrong_digest = "22".repeat(32);
        let photo = dng_photo(&source_path, size, wrong_digest, width, height);
        let err = import_managed_dng(&mut conn, photo).unwrap_err();
        assert!(err.contains("preflight"), "{err}");
        let managed_root = catalog.parent().unwrap().join(format!(
            "{}-assets",
            catalog.file_stem().unwrap().to_string_lossy()
        ));
        assert!(
            !managed_root.exists(),
            "no managed object must be created before the preflight digest is even reconciled"
        );

        drop(conn);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn rejects_a_classification_failure_with_a_valid_preflight_digest() {
        // Distinct from `rejects_a_preflight_digest_mismatch_before_any_copy`
        // above: here the preflight digest is genuinely *valid* — it
        // matches the actual on-disk bytes exactly — but those bytes are
        // not a classifiable DNG at all. `dng::classify` runs (and fails)
        // strictly *before* any managed-storage directory is created or
        // any byte is copied, so no object/row can exist afterward. No
        // hash-collision fixture is required: this only needs the
        // preflight digest to be correct for whatever (invalid) bytes are
        // actually on disk.
        let root = std::env::temp_dir().join(format!(
            "managed-dng-classification-failure-{}-{}",
            std::process::id(),
            line!()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let source_path = root.join("photo.dng");
        let garbage = b"this is not a TIFF/DNG file at all, just plain bytes";
        std::fs::write(&source_path, garbage).unwrap();
        let (size, digest) = digest_file(&File::open(&source_path).unwrap()).unwrap();

        let catalog = root.join("test.galcat");
        let mut conn = db::open(catalog.to_str().unwrap()).unwrap();
        let photo = dng_photo(&source_path, size, digest, 1, 1);
        let err = import_managed_dng(&mut conn, photo).unwrap_err();
        assert!(
            !err.contains("preflight"),
            "the preflight digest was valid; the rejection must come from classification: {err}"
        );

        let existing: Option<String> = conn
            .query_row(
                "SELECT fingerprint FROM source_asset WHERE path=?1",
                params![source_path.to_str().unwrap()],
                |r| r.get(0),
            )
            .optional()
            .unwrap();
        assert!(
            existing.is_none(),
            "no catalog row for an unclassifiable source"
        );
        let managed_root = catalog.parent().unwrap().join(format!(
            "{}-assets",
            catalog.file_stem().unwrap().to_string_lossy()
        ));
        assert!(
            !managed_root.exists(),
            "classification runs before any managed-storage directory is ever created"
        );

        drop(conn);
        std::fs::remove_dir_all(&root).unwrap();
    }

    fn preview_identity() -> PreviewIdentityV2 {
        build_preview_identity(
            &"00".repeat(32),
            None,
            PreviewIdentityFactsV2 {
                decoder_backend: crate::raw_decode::BACKEND.into(),
                backend_revision: "2".into(),
                decoder_version: "8.0".into(),
                os_build: "25E246".into(),
                native_width: 6000,
                native_height: 4000,
                active_area: [0, 0, 6000, 4000],
                source_orientation: 6,
                output_orientation: 1,
                orientation_applied: true,
                working_profile_digest: "44".repeat(32),
                output_width: 256,
                output_height: 171,
                scale_numerator: 16,
                scale_denominator: 375,
            },
            "thumbnail",
        )
        .unwrap()
    }

    fn raw_metadata(identity: &PreviewIdentityV2) -> crate::raw_decode::RawFrameMetadata {
        let mut metadata = crate::raw_decode::RawFrameMetadata {
            native_width: 6000,
            native_height: 4000,
            source_orientation: 6,
            output_width: 171,
            output_height: 256,
            active_area: [0, 0, 6000, 4000],
            output_orientation: 1,
            orientation_applied: true,
            decoder_backend: crate::raw_decode::BACKEND.into(),
            backend_revision: crate::raw_decode::BACKEND_REVISION.into(),
            decoder_version: "8.0".into(),
            os_build: "25E246".into(),
            color_space: crate::raw_decode::WORKING_PROFILE.into(),
            sample_format: "uint16".into(),
            channel_order: "rgba".into(),
            color_model: "profiled-scene-linear-reference-rgb".into(),
            transfer: "linear".into(),
            range: "full".into(),
            alpha: "opaque".into(),
            base_rendering: "core-image-camera-profile".into(),
            white_balance_mode: "asShot".into(),
            neutral_temperature: 5200.0,
            neutral_tint: 0.0,
            scale_numerator: 16,
            scale_denominator: 375,
            provenance_digest: String::new(),
            source_digest: identity.source_digest.clone(),
            working_profile_digest: identity.working_profile_digest.clone(),
            decode_intent_digest: identity.decode_intent_digest.clone(),
        };
        metadata.provenance_digest =
            crate::raw_decode::raw_metadata_provenance_digest(&metadata).unwrap();
        metadata
    }

    fn every_identity_mutation() -> Vec<(&'static str, fn(&mut PreviewIdentityV2))> {
        vec![
            ("identityVersion", |v| v.identity_version = 3),
            ("sourceDigest", |v| v.source_digest = "11".repeat(32)),
            ("decoderBackend", |v| v.decoder_backend.push('x')),
            ("backendRevision", |v| v.backend_revision.push('x')),
            ("decoderVersion", |v| v.decoder_version.push('x')),
            ("osBuild", |v| v.os_build.push('x')),
            ("decodeIntentDigest", |v| {
                v.decode_intent_digest = "22".repeat(32)
            }),
            ("nativeWidth", |v| v.native_width += 1),
            ("nativeHeight", |v| v.native_height += 1),
            ("activeArea", |v| v.active_area[0] += 1),
            ("sourceOrientation", |v| v.source_orientation = 8),
            ("outputOrientation", |v| v.output_orientation = 2),
            ("orientationApplied", |v| v.orientation_applied = false),
            ("recipeDigest", |v| v.recipe_digest = "33".repeat(32)),
            ("processVersion", |v| v.process_version = 7),
            ("maskDigest", |v| v.mask_digest = "55".repeat(32)),
            ("modelVersions", |v| {
                v.model_versions.push(("subject".into(), "1".into()))
            }),
            ("workingProfileDigest", |v| {
                v.working_profile_digest = "66".repeat(32)
            }),
            ("coreRevision", |v| v.core_revision.push('x')),
            ("previewKind", |v| v.preview_kind = "standard".into()),
            ("outputWidth", |v| v.output_width -= 1),
            ("outputHeight", |v| v.output_height -= 1),
            ("scaleNumerator", |v| v.scale_numerator += 1),
            ("scaleDenominator", |v| v.scale_denominator += 1),
        ]
    }

    #[test]
    fn a_fresh_catalog_is_stamped_and_reopens_unchanged() {
        let dir = std::env::temp_dir().join(format!("galerie-schema-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.galcat");
        let _ = std::fs::remove_file(&path);

        let photo_id = {
            let conn = db::open(path.to_str().unwrap()).unwrap();
            assert_eq!(db::version(&conn).unwrap(), SCHEMA_VERSION);
            db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap()
        };

        // Reopening runs the CREATE batch again: a no-op that keeps the data.
        let conn = db::open(path.to_str().unwrap()).unwrap();
        assert_eq!(db::version(&conn).unwrap(), SCHEMA_VERSION);
        assert_eq!(db::integrity_check(&conn).unwrap(), "ok");
        assert_eq!(
            db::get_photo(&conn, photo_id).unwrap().unwrap().path,
            "/a.cr3"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_catalog_from_another_schema_version_is_refused() {
        let dir = std::env::temp_dir().join(format!("galerie-oldstamp-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("old.galcat");
        let _ = std::fs::remove_file(&file);
        {
            let old = db::open(file.to_str().unwrap()).unwrap();
            old.execute("UPDATE schema_meta SET value='7' WHERE key='version'", [])
                .unwrap();
        }
        let err = db::open(file.to_str().unwrap()).unwrap_err();
        assert!(err.contains("schema v7"), "got {err}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_is_idempotent_per_source() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let again = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        assert_eq!(a, again, "re-import of same path returns same master photo");
        assert_eq!(db::count_photos(&conn, &r(0)).unwrap(), 1);
    }

    #[test]
    fn keyset_pagination_is_ordered_and_complete() {
        let conn = mem();
        // Capture times 30,20,10 → expected newest-first order.
        db::import_photo(&conn, &sample("/c.cr3", Some(10))).unwrap();
        db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();
        db::import_photo(&conn, &sample("/a.cr3", Some(30))).unwrap();

        let p1 = db::list_photos(&conn, None, 2, &r(0)).unwrap();
        assert_eq!(p1.photos.len(), 2);
        assert_eq!(p1.photos[0].path, "/a.cr3");
        assert_eq!(p1.photos[1].path, "/b.cr3");
        let cur = p1.next.expect("more pages");

        let p2 = db::list_photos(&conn, Some(cur), 2, &r(0)).unwrap();
        assert_eq!(p2.photos.len(), 1);
        assert_eq!(p2.photos[0].path, "/c.cr3");
        assert!(p2.next.is_none(), "last page has no cursor");
    }

    #[test]
    fn pagination_handles_null_capture_time() {
        let conn = mem();
        // No capture time → sort_time falls back to added_time (non-null); the
        // keyset walk must still visit every row exactly once.
        for i in 0..5 {
            db::import_photo(&conn, &sample(&format!("/n{i}.cr3"), None)).unwrap();
        }
        let mut seen = std::collections::HashSet::new();
        let mut cursor = None;
        loop {
            let page = db::list_photos(&conn, cursor, 2, &r(0)).unwrap();
            for row in &page.photos {
                assert!(seen.insert(row.id), "row {} returned twice", row.id);
            }
            match page.next {
                Some(c) => cursor = Some(c),
                None => break,
            }
        }
        assert_eq!(seen.len(), 5);
    }

    #[test]
    fn min_rating_filters() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();
        db::set_flags(&conn, a, 5, 1, Some("red")).unwrap();
        db::set_flags(&conn, b, 2, 0, None).unwrap();

        let page = db::list_photos(&conn, None, 10, &r(3)).unwrap();
        assert_eq!(page.photos.len(), 1);
        assert_eq!(page.photos[0].id, a);
        assert_eq!(page.photos[0].rating, 5);
        assert_eq!(page.photos[0].color_label.as_deref(), Some("red"));
        assert_eq!(db::count_photos(&conn, &r(3)).unwrap(), 1);
    }

    #[test]
    fn recipe_round_trips() {
        let conn = mem();
        let id = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        assert!(!db::get_photo(&conn, id).unwrap().unwrap().has_recipe);
        assert_eq!(db::get_recipe(&conn, id).unwrap(), None);

        db::set_recipe(&conn, id, r#"{"v":2,"exposure":0.5}"#, Some(6)).unwrap();
        let got = db::get_photo(&conn, id).unwrap().unwrap();
        assert!(got.has_recipe);
        assert_eq!(got.process_version, Some(6));
        assert_eq!(
            db::get_recipe(&conn, id).unwrap().as_deref(),
            Some(r#"{"v":2,"exposure":0.5}"#)
        );
    }

    #[test]
    fn preview_cache_record_and_lookup() {
        let conn = mem();
        let id = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        assert!(db::find_preview(&conn, id, "thumbnail", "k1")
            .unwrap()
            .is_none());

        let rec = PreviewRecord {
            photo_id: id,
            kind: "thumbnail".into(),
            cache_key: "k1".into(),
            width: 256,
            height: 171,
            file_path: "th/k1.jpg".into(),
            renderer_revision: 1,
            byte_size: 4096,
            identity_json: "{}".into(),
            provenance_json: "{}".into(),
            content_digest: "11".repeat(32),
        };
        let pid = db::record_preview(&conn, &rec).unwrap();
        let hit = db::find_preview(&conn, id, "thumbnail", "k1")
            .unwrap()
            .unwrap();
        assert_eq!(hit.id, pid);
        assert_eq!(hit.file_path, "th/k1.jpg");

        // Same identity re-records (upsert) rather than duplicating.
        let rec2 = PreviewRecord {
            file_path: "th/k1-v2.jpg".into(),
            ..rec
        };
        let pid2 = db::record_preview(&conn, &rec2).unwrap();
        assert_eq!(pid, pid2);
        assert_eq!(
            db::find_preview(&conn, id, "thumbnail", "k1")
                .unwrap()
                .unwrap()
                .file_path,
            "th/k1-v2.jpg"
        );
    }

    #[test]
    fn reimport_reconciles_file_metadata_but_keeps_user_data() {
        let conn = mem();
        let id = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        db::set_flags(&conn, id, 4, 1, Some("blue")).unwrap();
        db::set_recipe(&conn, id, r#"{"v":2}"#, Some(6)).unwrap();

        // Re-import the same path with changed file-derived metadata.
        let mut changed = sample("/a.cr3", Some(999));
        changed.width = 8000;
        changed.height = 5000;
        changed.iso = Some(1600);
        changed.camera_model = Some("EOS R6".into());
        let again = db::import_photo(&conn, &changed).unwrap();
        assert_eq!(again, id, "still the same master");
        assert_eq!(
            db::count_photos(&conn, &r(0)).unwrap(),
            1,
            "no duplicate master"
        );

        let got = db::get_photo(&conn, id).unwrap().unwrap();
        // File-derived metadata refreshed…
        assert_eq!(got.width, 8000);
        assert_eq!(got.height, 5000);
        assert_eq!(got.iso, Some(1600));
        assert_eq!(got.camera_model.as_deref(), Some("EOS R6"));
        assert_eq!(got.capture_time, Some(999));
        // …but user data untouched.
        assert_eq!(got.rating, 4);
        assert_eq!(got.flag, 1);
        assert_eq!(got.color_label.as_deref(), Some("blue"));
        assert!(got.has_recipe);
        assert_eq!(got.process_version, Some(6));
        assert_eq!(
            db::get_recipe(&conn, id).unwrap().as_deref(),
            Some(r#"{"v":2}"#)
        );

        // New capture_time also moved sort_time (it now sorts by 999).
        let page = db::list_photos(&conn, None, 10, &r(0)).unwrap();
        assert_eq!(page.photos[0].id, id);
    }

    #[test]
    fn reimport_with_null_capture_keeps_prior_sort_time() {
        let conn = mem();
        // First import at capture 500, then two others so ordering is observable.
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(500))).unwrap();
        db::import_photo(&conn, &sample("/b.cr3", Some(700))).unwrap();
        // Re-import /a with NO capture_time: sort_time must stay 500 (COALESCE keeps it),
        // not collapse to `now`.
        db::import_photo(&conn, &sample("/a.cr3", None)).unwrap();
        let cur = db::get_photo(&conn, a).unwrap().unwrap();
        assert_eq!(
            cur.capture_time, None,
            "capture_time cleared to reflect the file"
        );
        let page = db::list_photos(&conn, None, 10, &r(0)).unwrap();
        // b (700) before a (still sorts at 500), proving sort_time didn't jump to now.
        assert_eq!(page.photos[0].path, "/b.cr3");
        assert_eq!(page.photos[1].path, "/a.cr3");
    }

    #[test]
    fn snapshots_are_per_photo_named_and_upsert_by_name() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();
        assert!(db::list_snapshots(&conn, a).unwrap().is_empty());

        let punchy = db::add_snapshot(&conn, a, "Punchy", r#"{"v":2}"#, Some(6)).unwrap();
        db::add_snapshot(&conn, a, "Flat", r#"{"v":2,"contrast":-1}"#, Some(6)).unwrap();
        assert!(
            db::list_snapshots(&conn, b).unwrap().is_empty(),
            "snapshots are per photo"
        );

        let list = db::list_snapshots(&conn, a).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "Flat", "alphabetical, not insertion order");
        assert_eq!(list[1].name, "Punchy");
        assert_eq!(list[1].recipe_json, r#"{"v":2}"#);
        assert_eq!(list[1].process_version, Some(6));

        // Re-using a name overwrites the same row (no duplicate).
        let punchy2 =
            db::add_snapshot(&conn, a, "Punchy", r#"{"v":2,"exposure":1}"#, Some(6)).unwrap();
        assert_eq!(punchy2, punchy, "same (photo,name) upserts");
        let list2 = db::list_snapshots(&conn, a).unwrap();
        assert_eq!(list2.len(), 2, "no duplicate 'Punchy'");
        assert_eq!(
            list2
                .iter()
                .find(|s| s.name == "Punchy")
                .unwrap()
                .recipe_json,
            r#"{"v":2,"exposure":1}"#,
        );

        db::delete_snapshot(&conn, punchy).unwrap();
        let list3 = db::list_snapshots(&conn, a).unwrap();
        assert_eq!(list3.len(), 1);
        assert_eq!(list3[0].name, "Flat");
    }

    /// LR's Snapshots panel sorts by name, and "Zebra" sorting before "alpha"
    /// (ASCII order) is exactly the wrong answer.
    #[test]
    fn snapshots_sort_alphabetically_ignoring_case() {
        let conn = mem();
        let p = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        for name in ["Zebra", "alpha", "Moody B&W"] {
            db::add_snapshot(&conn, p, name, "{}", None).unwrap();
        }
        let names: Vec<String> = db::list_snapshots(&conn, p)
            .unwrap()
            .into_iter()
            .map(|s| s.name)
            .collect();
        assert_eq!(names, ["alpha", "Moody B&W", "Zebra"]);
    }

    #[test]
    fn preview_cache_key_covers_complete_canonical_identity() {
        let identity = preview_identity();
        let k = db::preview_cache_key(&identity).unwrap();
        assert_eq!(
            k,
            db::preview_cache_key(&identity).unwrap(),
            "deterministic"
        );
        for mutate in [
            |value: &mut PreviewIdentityV2| value.source_digest = "55".repeat(32),
            |value: &mut PreviewIdentityV2| value.decoder_version = "9.0".into(),
            |value: &mut PreviewIdentityV2| value.os_build = "next".into(),
            |value: &mut PreviewIdentityV2| value.recipe_digest = "66".repeat(32),
            |value: &mut PreviewIdentityV2| value.mask_digest = "77".repeat(32),
            |value: &mut PreviewIdentityV2| value.working_profile_digest = "88".repeat(32),
            |value: &mut PreviewIdentityV2| value.core_revision = "next".into(),
            |value: &mut PreviewIdentityV2| value.output_width = 128,
        ] {
            let mut changed = identity.clone();
            mutate(&mut changed);
            match db::preview_cache_key(&changed) {
                Ok(changed_key) => assert_ne!(k, changed_key),
                Err(_) => {}
            }
        }
        assert_eq!(db::preview_rel_path(&k), format!("{}/{k}.jpg", &k[..2]));
    }

    #[test]
    fn preview_request_returns_one_canonical_recipe_identity_snapshot() {
        let conn = mem();
        let id = db::import_photo(&conn, &sample("/portable.jpg", Some(10))).unwrap();
        conn.execute(
            "UPDATE source_asset SET format = 'jpg', fingerprint = ?1 WHERE id = (SELECT source_asset_id FROM photo WHERE id = ?2)",
            rusqlite::params!["00".repeat(32), id],
        )
        .unwrap();
        conn.execute(
            "UPDATE photo SET width = 4000, height = 3000 WHERE id = ?1",
            [id],
        )
        .unwrap();
        let request = preview_request_for(&conn, id, "standard", 1000).unwrap();
        let recipe = monet_photo_core::parse_recipe_json(&request.recipe_json).unwrap();
        let digest = monet_photo_core::recipe_digest(&recipe).unwrap();
        assert_eq!(
            request.identity.recipe_digest,
            digest
                .0
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        );
        assert_eq!(request.identity.native_width, 4000);
        assert_eq!(request.identity.active_area, [0, 0, 4000, 3000]);
        assert_eq!(request.identity.output_width, 1000);
        assert_eq!(
            request.cache_key,
            db::preview_cache_key(&request.identity).unwrap()
        );
    }

    #[test]
    fn recipe_change_after_preview_request_rebuilds_a_different_insertion_identity() {
        let conn = mem();
        let id = db::import_photo(&conn, &sample("/portable.jpg", Some(10))).unwrap();
        conn.execute(
            "UPDATE source_asset SET format = 'jpg', fingerprint = ?1 WHERE id = (SELECT source_asset_id FROM photo WHERE id = ?2)",
            rusqlite::params!["00".repeat(32), id],
        )
        .unwrap();
        let requested = preview_request_for(&conn, id, "standard", 1000).unwrap();
        let mut changed: serde_json::Value = serde_json::from_str(&requested.recipe_json).unwrap();
        changed["basic"]["exposure"] = serde_json::json!(1.0);
        let changed = canonical_recipe(&changed.to_string(), Some(6)).unwrap();
        db::set_recipe(&conn, id, &changed, Some(6)).unwrap();

        let insertion = preview_identity_for(&conn, id, "standard", 1000, None).unwrap();
        assert_ne!(insertion, requested.identity);
        assert_ne!(insertion.recipe_digest, requested.identity.recipe_digest);
    }

    #[test]
    fn raw_probe_and_actual_render_build_the_exact_same_identity() {
        let expected = build_preview_identity(
            &"00".repeat(32),
            None,
            raw_probe_facts(crate::raw_decode::RawProbe {
                decoder_backend: crate::raw_decode::BACKEND,
                backend_revision: crate::raw_decode::BACKEND_REVISION,
                decoder_version: "8.0".into(),
                os_build: "25E246".into(),
                native_width: 6000,
                native_height: 4000,
                active_area: [0, 0, 6000, 4000],
                source_orientation: 6,
                output_orientation: 1,
                orientation_applied: true,
                working_profile_digest: "44".repeat(32),
                output_width: 171,
                output_height: 256,
                scale_numerator: 16,
                scale_denominator: 375,
            }),
            "thumbnail",
        )
        .unwrap();
        let metadata = raw_metadata(&expected);
        let actual = build_preview_identity(
            &metadata.source_digest,
            None,
            raw_actual_facts(&metadata).unwrap(),
            "thumbnail",
        )
        .unwrap();
        assert_eq!(actual, expected);
        assert_eq!(
            db::preview_cache_key(&actual).unwrap(),
            db::preview_cache_key(&expected).unwrap()
        );
    }

    #[test]
    fn every_provenance_category_is_validated() {
        let identity = preview_identity();
        let valid = build_render_provenance(
            identity.clone(),
            "core-image-camera-profile".into(),
            "linearSrgbU16Full".into(),
            "linear".into(),
            "full".into(),
            "opaque".into(),
        )
        .unwrap();
        validate_catalog_render_provenance(&identity, &valid).unwrap();

        for (field, mutate) in every_identity_mutation() {
            let mut stale = valid.clone();
            mutate(&mut stale.identity);
            assert!(
                validate_catalog_render_provenance(&identity, &stale).is_err(),
                "{field}"
            );
        }

        for mutate in [
            |v: &mut RenderProvenanceV2| v.base_rendering.push('x'),
            |v: &mut RenderProvenanceV2| v.pixel_encoding.push('x'),
            |v: &mut RenderProvenanceV2| v.transfer.push('x'),
            |v: &mut RenderProvenanceV2| v.range.push('x'),
            |v: &mut RenderProvenanceV2| v.alpha_mode.push('x'),
            |v: &mut RenderProvenanceV2| v.provenance_digest = "99".repeat(32),
        ] {
            let mut stale = valid.clone();
            mutate(&mut stale);
            assert!(validate_catalog_render_provenance(&identity, &stale).is_err());
        }
    }

    #[test]
    fn raw_actual_facts_reject_invalid_output_contract_and_geometry() {
        let identity = preview_identity();
        for mutate in [
            |v: &mut crate::raw_decode::RawFrameMetadata| v.native_width = 6001,
            |v: &mut crate::raw_decode::RawFrameMetadata| v.active_area[0] = 1,
            |v: &mut crate::raw_decode::RawFrameMetadata| v.output_orientation = 2,
            |v: &mut crate::raw_decode::RawFrameMetadata| v.orientation_applied = false,
            |v: &mut crate::raw_decode::RawFrameMetadata| v.scale_numerator += 1,
            |v: &mut crate::raw_decode::RawFrameMetadata| v.color_space.push('x'),
            |v: &mut crate::raw_decode::RawFrameMetadata| v.sample_format.push('x'),
            |v: &mut crate::raw_decode::RawFrameMetadata| v.channel_order.push('x'),
            |v: &mut crate::raw_decode::RawFrameMetadata| v.color_model.push('x'),
            |v: &mut crate::raw_decode::RawFrameMetadata| v.transfer.push('x'),
            |v: &mut crate::raw_decode::RawFrameMetadata| v.range.push('x'),
            |v: &mut crate::raw_decode::RawFrameMetadata| v.alpha.push('x'),
            |v: &mut crate::raw_decode::RawFrameMetadata| v.base_rendering.push('x'),
        ] {
            let mut metadata = raw_metadata(&identity);
            mutate(&mut metadata);
            assert!(raw_actual_facts(&metadata).is_err());
        }
    }

    fn preview_row(identity: &PreviewIdentityV2, bytes: &[u8]) -> PreviewRow {
        let cache_key = db::preview_cache_key(identity).unwrap();
        let provenance = build_render_provenance(
            identity.clone(),
            "core-image-camera-profile".into(),
            "linearSrgbU16Full".into(),
            "linear".into(),
            "full".into(),
            "opaque".into(),
        )
        .unwrap();
        PreviewRow {
            id: 1,
            photo_id: 1,
            kind: "thumbnail".into(),
            cache_key: cache_key.clone(),
            width: i64::from(identity.output_width),
            height: i64::from(identity.output_height),
            file_path: db::preview_rel_path(&cache_key),
            renderer_revision: db::PREVIEW_RENDERER_REVISION,
            byte_size: bytes.len() as i64,
            created_at: 0,
            identity_json: Some(serde_json::to_string(identity).unwrap()),
            provenance_json: Some(serde_json::to_string(&provenance).unwrap()),
            content_digest: Some(sha256_hex(bytes)),
        }
    }

    #[test]
    fn every_changed_identity_field_is_a_cache_miss() {
        let root = std::env::temp_dir().join(format!(
            "monet-galerie-identity-miss-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let identity = preview_identity();
        let hit = preview_row(&identity, b"valid");
        preview_store::write(&root, &hit.file_path, b"valid").unwrap();
        for (field, mutate) in every_identity_mutation() {
            let mut changed = identity.clone();
            mutate(&mut changed);
            assert!(
                read_preview_hit(&root, &changed, &hit).bytes.is_none(),
                "{field}"
            );
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preview_hits_revalidate_all_metadata_and_bytes() {
        let root = std::env::temp_dir().join(format!(
            "monet-galerie-hit-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let identity = preview_identity();
        let bytes = b"valid";
        let hit = preview_row(&identity, bytes);
        preview_store::write(&root, &hit.file_path, bytes).unwrap();
        assert_eq!(
            read_preview_hit(&root, &identity, &hit).bytes,
            Some(bytes.to_vec())
        );

        let mut changed = hit.clone();
        changed.identity_json = None;
        assert!(read_preview_hit(&root, &identity, &changed)
            .diagnostic
            .unwrap()
            .contains("legacy"));
        changed = hit.clone();
        changed.identity_json = Some("{".into());
        assert!(read_preview_hit(&root, &identity, &changed)
            .diagnostic
            .unwrap()
            .contains("corrupt"));
        changed = hit.clone();
        let mut stale_identity = identity.clone();
        stale_identity.source_digest = "55".repeat(32);
        changed.identity_json = Some(serde_json::to_string(&stale_identity).unwrap());
        assert!(read_preview_hit(&root, &identity, &changed)
            .diagnostic
            .unwrap()
            .contains("identity mismatch"));
        changed = hit.clone();
        changed.provenance_json = Some("{".into());
        assert!(read_preview_hit(&root, &identity, &changed)
            .diagnostic
            .unwrap()
            .contains("corrupt"));
        changed = hit.clone();
        let mut stale_provenance: RenderProvenanceV2 =
            serde_json::from_str(changed.provenance_json.as_deref().unwrap()).unwrap();
        stale_provenance.identity.os_build.push('x');
        changed.provenance_json = Some(serde_json::to_string(&stale_provenance).unwrap());
        assert!(read_preview_hit(&root, &identity, &changed)
            .diagnostic
            .unwrap()
            .contains("provenance mismatch"));
        changed = hit.clone();
        changed.width -= 1;
        assert!(read_preview_hit(&root, &identity, &changed)
            .diagnostic
            .unwrap()
            .contains("index metadata"));
        changed = hit.clone();
        changed.byte_size += 1;
        assert!(read_preview_hit(&root, &identity, &changed)
            .diagnostic
            .unwrap()
            .contains("byte-size"));
        changed = hit.clone();
        changed.content_digest = Some("00".repeat(32));
        assert!(read_preview_hit(&root, &identity, &changed)
            .diagnostic
            .unwrap()
            .contains("content digest"));
        std::fs::remove_file(root.join(&hit.file_path)).unwrap();
        assert!(read_preview_hit(&root, &identity, &hit)
            .diagnostic
            .unwrap()
            .contains("missing"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preview_store_writes_atomically_and_corruption_is_detectable() {
        let root = std::env::temp_dir().join(format!(
            "monet-galerie-preview-{}-{}",
            std::process::id(),
            now_secs()
        ));
        let rel = "ab/cache.png";
        preview_store::write(&root, rel, b"valid").unwrap();
        let bytes = preview_store::read(&root, rel).unwrap().unwrap();
        let expected = sha256_hex(&bytes);
        std::fs::write(root.join(rel), b"corrupt").unwrap();
        let corrupt = preview_store::read(&root, rel).unwrap().unwrap();
        assert_ne!(sha256_hex(&corrupt), expected);
        assert!(root.join("ab").read_dir().unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".tmp-")
        }));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preview_store_cleans_a_temp_file_when_atomic_rename_fails() {
        let root = std::env::temp_dir().join(format!(
            "monet-galerie-failed-write-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(root.join("ab/cache.png")).unwrap();
        assert!(preview_store::write(&root, "ab/cache.png", b"bytes").is_err());
        assert!(root.join("ab").read_dir().unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".tmp-")
        }));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preview_store_replaces_atomically_under_same_process_concurrency() {
        use std::sync::{Arc, Barrier};

        let root = std::env::temp_dir().join(format!(
            "monet-galerie-writers-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let barrier = Arc::new(Barrier::new(8));
        let writers = (0_u8..8)
            .map(|value| {
                let root = root.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    preview_store::write(&root, "ab/cache.png", &vec![value; 4096]).unwrap();
                })
            })
            .collect::<Vec<_>>();
        for writer in writers {
            writer.join().unwrap();
        }
        let bytes = preview_store::read(&root, "ab/cache.png").unwrap().unwrap();
        assert_eq!(bytes.len(), 4096);
        assert!(bytes.iter().all(|byte| *byte == bytes[0]));
        assert!(root.join("ab").read_dir().unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".tmp-")
        }));
        preview_store::write(&root, "ab/cache.png", b"replacement").unwrap();
        assert_eq!(
            preview_store::read(&root, "ab/cache.png").unwrap(),
            Some(b"replacement".to_vec())
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn source_fingerprint_reads_the_master() {
        let conn = mem();
        let id = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        assert_eq!(
            db::source_fingerprint(&conn, id).unwrap().as_deref(),
            Some("fp-/a.cr3")
        );
        assert_eq!(db::source_fingerprint(&conn, 9999).unwrap(), None);
    }

    #[test]
    fn develop_export_identity_is_one_catalog_owned_snapshot() {
        let path = std::env::temp_dir().join(format!(
            "galerie-export-identity-{}.galcat",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        let conn = db::open(path.to_str().unwrap()).unwrap();
        let id = db::import_photo(&conn, &sample("/selected.cr3", Some(10))).unwrap();
        let identity = develop_export_identity(&conn, id).unwrap();
        assert_eq!(
            std::fs::canonicalize(&identity.catalog_id).unwrap(),
            std::fs::canonicalize(&path).unwrap()
        );
        assert_eq!(identity.photo.id, id);
        assert_eq!(identity.photo.path, "/selected.cr3");
        assert_eq!(identity.source_digest, "fp-/selected.cr3");
        assert_eq!(
            monet_photo_core::parse_recipe_json(identity.canonical_recipe_json.as_bytes())
                .unwrap()
                .value()["processVersion"],
            monet_photo_core::PROCESS_VERSION
        );
        drop(conn);
        let _ = std::fs::remove_file(path.with_extension("galcat-shm"));
        let _ = std::fs::remove_file(path.with_extension("galcat-wal"));
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn content_credentials_state_the_producer_and_the_edit_history() {
        let path = std::env::temp_dir().join(format!(
            "galerie-content-credentials-{}.galcat",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        let conn = db::open(path.to_str().unwrap()).unwrap();
        let id = db::import_photo(&conn, &sample("/shoot/DSC_0001.cr3", Some(10))).unwrap();
        db::set_photo_metadata(
            &conn,
            id,
            &PhotoIptc {
                // Quotes in a name must not be able to reshape the claim.
                creator: some(r#"Ansel "A" Adams"#),
                credit: some("Monet Studio"),
                copyright: some("© 2026 Monet"),
                ..Default::default()
            },
        )
        .unwrap();
        for label in ["Basic", "Crop", "Detail", "Basic"] {
            db::record_history(&conn, id, label, "{}", None, 0).unwrap();
        }

        let creds = content_credentials(&conn, id).unwrap();
        assert_eq!(creds.parent_path, "/shoot/DSC_0001.cr3");
        let manifest: serde_json::Value = serde_json::from_str(&creds.manifest_json).unwrap();
        assert_eq!(manifest["claim_generator_info"][0]["name"], "Monet Galerie");
        // No IPTC title → the source filename names the manifest.
        assert_eq!(manifest["title"], "DSC_0001.cr3");

        let actions = manifest["assertions"][0]["data"]["actions"]
            .as_array()
            .unwrap();
        // Galerie renders someone else's capture: opened + edited, never created.
        assert_eq!(actions[0]["action"], "c2pa.opened");
        assert_eq!(actions[0]["parameters"]["ingredientIds"][0], PARENT_LABEL);
        let ids: Vec<&str> = actions
            .iter()
            .map(|a| a["action"].as_str().unwrap())
            .collect();
        assert!(!ids.contains(&"c2pa.created"), "must not claim creation");
        assert_eq!(
            ids,
            [
                "c2pa.opened",
                "c2pa.edited",
                "c2pa.color_adjustments",
                "c2pa.cropped",
                "c2pa.filtered"
            ],
            "history order, deduped"
        );
        assert!(
            !creds.manifest_json.contains(AI_SOURCE_TYPE),
            "no AI claim without AI"
        );

        let work = &manifest["assertions"][1]["data"];
        assert_eq!(work["author"][0]["name"], r#"Ansel "A" Adams"#);
        assert_eq!(work["copyrightNotice"], "© 2026 Monet");
        assert_eq!(work["creditText"], "Monet Studio");
        assert_eq!(work["license"], serde_json::Value::Null, "absent stays absent");

        // A photo the user never touched still carries provenance, just no recipe.
        let untouched = db::import_photo(&conn, &sample("/shoot/DSC_0002.cr3", Some(11))).unwrap();
        let bare: serde_json::Value =
            serde_json::from_str(&content_credentials(&conn, untouched).unwrap().manifest_json)
                .unwrap();
        assert_eq!(
            bare["assertions"][0]["data"]["actions"]
                .as_array()
                .unwrap()
                .len(),
            2
        );

        drop(conn);
        let _ = std::fs::remove_file(path.with_extension("galcat-shm"));
        let _ = std::fs::remove_file(path.with_extension("galcat-wal"));
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn content_credentials_disclose_model_assisted_edits() {
        // An AI mask component, whatever else the recipe holds.
        assert!(recipe_uses_ai(
            r#"{"masks":{"masks":[{"components":[{"kind":"aiSky"}]}]}}"#
        ));
        // A recorded model version is the same disclosure by another route.
        assert!(recipe_uses_ai(r#"{"metadata":{"modelVersions":{"sky":"1"}}}"#));
        // Hand-drawn masks and an empty model map are not AI.
        assert!(!recipe_uses_ai(
            r#"{"masks":{"masks":[{"components":[{"kind":"linearGradient"}]}]},"metadata":{"modelVersions":{}}}"#
        ));
        assert!(!recipe_uses_ai("not json"));

        let disclosed = c2pa_actions(&[], true);
        let last = disclosed.last().unwrap();
        assert_eq!(last["action"], "c2pa.edited");
        assert_eq!(last["digitalSourceType"], AI_SOURCE_TYPE);
    }

    #[test]
    fn preview_store_roundtrips_and_reports_misses() {
        let root = std::env::temp_dir().join(format!("galerie_pv_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let rel = "ab/abc_thumbnail_256_r1.png";
        assert_eq!(
            preview_store::read(&root, rel).unwrap(),
            None,
            "miss before write"
        );
        preview_store::write(&root, rel, &[1, 2, 3, 4]).unwrap();
        assert_eq!(
            preview_store::read(&root, rel).unwrap(),
            Some(vec![1, 2, 3, 4])
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn preview_root_skips_in_memory_catalogs() {
        assert_eq!(preview_store::root_for_catalog(":memory:"), None);
        assert_eq!(preview_store::root_for_catalog(""), None);
        let root = preview_store::root_for_catalog("/photos/My Catalog.galcat").unwrap();
        assert_eq!(root, std::path::Path::new("/photos/My Catalog-previews"));
    }

    #[test]
    fn history_records_newest_first_caps_and_clears() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();

        // Record 5 steps for `a` with cap 3 → only the newest 3 survive.
        for i in 0..5 {
            db::record_history(
                &conn,
                a,
                &format!("Edit {i}"),
                &format!(r#"{{"n":{i}}}"#),
                Some(6),
                3,
            )
            .unwrap();
        }
        // `b` is independent.
        db::record_history(&conn, b, "Basic", r#"{"n":9}"#, Some(6), 3).unwrap();

        let hist = db::list_history(&conn, a).unwrap();
        assert_eq!(hist.len(), 3, "capped to 3");
        assert_eq!(hist[0].label, "Edit 4", "newest first");
        assert_eq!(hist[1].label, "Edit 3");
        assert_eq!(hist[2].label, "Edit 2");
        assert_eq!(hist[0].recipe_json, r#"{"n":4}"#);
        assert_eq!(db::list_history(&conn, b).unwrap().len(), 1, "per photo");

        db::clear_history(&conn, a).unwrap();
        assert!(db::list_history(&conn, a).unwrap().is_empty());
        assert_eq!(
            db::list_history(&conn, b).unwrap().len(),
            1,
            "clear is per photo"
        );
    }

    #[test]
    fn keywords_tag_dedup_share_vocabulary_and_untag() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();
        assert!(db::list_photo_keywords(&conn, a).unwrap().is_empty());

        let beach = db::add_keyword(&conn, a, "Beach").unwrap();
        db::add_keyword(&conn, a, "Sunset").unwrap();
        // Re-tagging the same (photo, keyword) is a no-op, same keyword id.
        assert_eq!(db::add_keyword(&conn, a, "Beach").unwrap(), beach);

        // The vocabulary is shared: tagging b with "Beach" reuses the keyword id.
        assert_eq!(db::add_keyword(&conn, b, "Beach").unwrap(), beach);

        let ka = db::list_photo_keywords(&conn, a).unwrap();
        assert_eq!(
            ka.iter().map(|k| k.name.as_str()).collect::<Vec<_>>(),
            vec!["Beach", "Sunset"]
        );
        assert_eq!(db::list_photo_keywords(&conn, b).unwrap().len(), 1);

        // Untag a's Beach — keeps b's, and the keyword stays in the vocabulary
        // (re-addable → same id).
        db::remove_keyword(&conn, a, beach).unwrap();
        assert_eq!(
            db::list_photo_keywords(&conn, a)
                .unwrap()
                .iter()
                .map(|k| k.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Sunset"],
        );
        assert_eq!(db::list_photo_keywords(&conn, b).unwrap().len(), 1);
        assert_eq!(
            db::add_keyword(&conn, a, "Beach").unwrap(),
            beach,
            "vocabulary survived untag"
        );
    }

    #[test]
    fn keyword_replacement_is_atomic() {
        let conn = mem();
        let photo = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        db::add_keyword(&conn, photo, "Keep").unwrap();
        db::replace_photo_keywords(&conn, photo, &["New".into(), "New".into(), " ".into()])
            .unwrap();
        assert_eq!(
            db::list_photo_keywords(&conn, photo)
                .unwrap()
                .into_iter()
                .map(|keyword| keyword.name)
                .collect::<Vec<_>>(),
            vec!["New"],
        );

        conn.execute_batch(
            "CREATE TRIGGER fail_blocked_keyword BEFORE INSERT ON photo_keyword
             WHEN (SELECT name FROM keyword WHERE id=NEW.keyword_id)='Blocked'
             BEGIN SELECT RAISE(ABORT, 'blocked'); END;",
        )
        .unwrap();
        assert!(
            db::replace_photo_keywords(&conn, photo, &["First".into(), "Blocked".into()],).is_err()
        );
        assert_eq!(
            db::list_photo_keywords(&conn, photo).unwrap()[0].name,
            "New",
            "failed replacement rolls the deleted membership back",
        );
    }

    #[test]
    fn history_cap_zero_is_unbounded() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        for i in 0..10 {
            db::record_history(&conn, a, "Edit", &format!(r#"{{"n":{i}}}"#), None, 0).unwrap();
        }
        assert_eq!(db::list_history(&conn, a).unwrap().len(), 10);
    }

    #[test]
    fn recipe_boundary_stores_only_rust_canonical_bytes_and_rejects_without_mutation() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../packages/monet-ui/packages/monet-photo/fixtures/canonical-recipe-v2.json"
        ))
        .unwrap();
        let source = serde_json::to_string_pretty(&fixture["recipe"]).unwrap();
        let expected = fixture["canonicalJson"].as_str().unwrap();
        let canonical = canonical_recipe(&source, Some(6)).unwrap();
        assert_eq!(canonical, expected);

        let conn = mem();
        let photo = db::import_photo(&conn, &sample("/canonical.cr3", Some(10))).unwrap();
        db::set_recipe(&conn, photo, &canonical, Some(6)).unwrap();
        assert!(canonical_recipe(r#"{"version":2}"#, Some(6)).is_err());
        assert_eq!(
            db::get_recipe(&conn, photo).unwrap().as_deref(),
            Some(expected)
        );
    }

    #[test]
    fn list_photos_filters_by_flag_and_label() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();
        let c = db::import_photo(&conn, &sample("/c.cr3", Some(30))).unwrap();
        db::set_flags(&conn, a, 0, 1, Some("red")).unwrap(); // pick, red
        db::set_flags(&conn, b, 0, -1, None).unwrap(); // reject
        db::set_flags(&conn, c, 0, 1, Some("green")).unwrap(); // pick, green

        let picks = PhotoFilter {
            flag: Some(1),
            ..Default::default()
        };
        let ids: Vec<i64> = db::list_photos(&conn, None, 10, &picks)
            .unwrap()
            .photos
            .iter()
            .map(|p| p.id)
            .collect();
        assert_eq!(ids, vec![c, a], "picks only, newest first");
        assert_eq!(db::count_photos(&conn, &picks).unwrap(), 2);

        let red = PhotoFilter {
            color_label: Some("red".into()),
            ..Default::default()
        };
        assert_eq!(
            db::list_photos(&conn, None, 10, &red)
                .unwrap()
                .photos
                .iter()
                .map(|p| p.id)
                .collect::<Vec<_>>(),
            vec![a],
        );

        // Combined: picks AND green.
        let pick_green = PhotoFilter {
            flag: Some(1),
            color_label: Some("green".into()),
            ..Default::default()
        };
        assert_eq!(db::count_photos(&conn, &pick_green).unwrap(), 1);

        // Filters compose with keyset pagination (page through picks).
        let pg = db::list_photos(&conn, None, 1, &picks).unwrap();
        assert_eq!(pg.photos.len(), 1);
        let cur = pg.next.expect("more picks");
        let pg2 = db::list_photos(&conn, Some(cur), 1, &picks).unwrap();
        assert_eq!(pg2.photos.iter().map(|p| p.id).collect::<Vec<_>>(), vec![a]);
    }

    #[test]
    fn list_photos_filters_by_text() {
        let conn = mem();
        let beach = db::import_photo(&conn, &sample("/trip/Beach_01.cr3", Some(10))).unwrap();
        let city = db::import_photo(&conn, &sample("/trip/city.cr3", Some(20))).unwrap();
        db::import_photo(&conn, &sample("/work/report.cr3", Some(30))).unwrap();

        // Case-insensitive substring of the path (filename search).
        let f = PhotoFilter {
            text: Some("beach".into()),
            ..Default::default()
        };
        let ids: Vec<i64> = db::list_photos(&conn, None, 10, &f)
            .unwrap()
            .photos
            .iter()
            .map(|p| p.id)
            .collect();
        assert_eq!(ids, vec![beach]);
        assert_eq!(db::count_photos(&conn, &f).unwrap(), 1);

        // A shared directory fragment matches both trip photos, newest first.
        let trip = PhotoFilter {
            text: Some("trip".into()),
            ..Default::default()
        };
        assert_eq!(db::count_photos(&conn, &trip).unwrap(), 2);
        assert_eq!(
            db::list_photos(&conn, None, 10, &trip)
                .unwrap()
                .photos
                .iter()
                .map(|p| p.id)
                .collect::<Vec<_>>(),
            vec![city, beach],
        );

        // Blank text = no filter (all 3); LIKE wildcards in user text match
        // literally (no path holds a literal '%'), proving the escaping.
        assert_eq!(
            db::count_photos(
                &conn,
                &PhotoFilter {
                    text: Some("   ".into()),
                    ..Default::default()
                }
            )
            .unwrap(),
            3
        );
        assert_eq!(
            db::count_photos(
                &conn,
                &PhotoFilter {
                    text: Some("%".into()),
                    ..Default::default()
                }
            )
            .unwrap(),
            0
        );

        // Composes with the flag filter.
        db::set_flags(&conn, beach, 0, 1, None).unwrap();
        let pick_trip = PhotoFilter {
            text: Some("trip".into()),
            flag: Some(1),
            ..Default::default()
        };
        assert_eq!(db::count_photos(&conn, &pick_trip).unwrap(), 1);
    }

    #[test]
    fn remove_photos_cascades_promotes_cover_and_reports_virtual_copies() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();
        db::import_photo(&conn, &sample("/c.cr3", Some(30))).unwrap();

        // `a` covers a stack over `b`, is in a collection + keyworded, and has a
        // chain of virtual copies a → v1 → v2.
        db::stack_photos(&conn, &[a, b]).unwrap();
        let col = db::create_collection(&conn, "Trip", "collection", None, None).unwrap();
        db::add_photo_to_collection(&conn, col, a).unwrap();
        db::add_keyword(&conn, a, "beach").unwrap();
        let v1 = db::create_virtual_copy(&conn, a).unwrap();
        let v2 = db::create_virtual_copy(&conn, v1).unwrap();

        // Remove the cover `a`: it reports a + its whole transitive VC subtree.
        let mut deleted = db::remove_photos(&conn, &[a]).unwrap();
        deleted.sort();
        let mut want = vec![a, v1, v2];
        want.sort();
        assert_eq!(
            deleted, want,
            "reports the master + its transitive virtual copies"
        );

        // a/v1/v2 gone; the grid now shows b (promoted cover) + c.
        assert_eq!(db::count_photos(&conn, &Default::default()).unwrap(), 2);
        let b_order: Option<i64> = conn
            .query_row(
                "SELECT stack_order FROM photo WHERE id = ?1",
                params![b],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(b_order, Some(0), "b was promoted to stack cover");

        // ON DELETE CASCADE dropped a's collection membership + keyword link.
        assert!(db::list_collection_photos(&conn, col, 100, 0)
            .unwrap()
            .is_empty());
        let kw: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM photo_keyword WHERE photo_id = ?1",
                params![a],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(kw, 0);

        // Idempotent: removing an already-gone id returns nothing and doesn't error.
        assert_eq!(db::remove_photos(&conn, &[a]).unwrap(), Vec::<i64>::new());
    }

    #[test]
    fn preview_gc_evicts_superseded_aged_and_over_cap_previews_and_sweeps_orphans() {
        let conn = mem();
        let root = std::env::temp_dir().join(format!(
            "monet-galerie-preview-gc-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();

        // Row + blob in one go (identity/provenance content is irrelevant to GC).
        let put = |photo_id: i64, kind: &str, key: &str, bytes: &[u8]| -> String {
            let rel = db::preview_rel_path(key);
            preview_store::write(&root, &rel, bytes).unwrap();
            db::record_preview(
                &conn,
                &PreviewRecord {
                    photo_id,
                    kind: kind.into(),
                    cache_key: key.into(),
                    width: 1,
                    height: 1,
                    file_path: rel.clone(),
                    renderer_revision: db::PREVIEW_RENDERER_REVISION,
                    byte_size: bytes.len() as i64,
                    identity_json: "{}".into(),
                    provenance_json: "{}".into(),
                    content_digest: "d".into(),
                },
            )
            .unwrap();
            rel
        };

        // A re-edit supersedes a's older standard generations; the blob b still
        // shares (virtual-copy case) must survive, the a-only one must not.
        let old = put(a, "standard", &"aa".repeat(32), b"old");
        let shared = put(a, "standard", &"bb".repeat(32), b"shared");
        put(b, "standard", &"bb".repeat(32), b"shared");
        let new_key = "cc".repeat(32);
        let kept = put(a, "standard", &new_key, b"new");
        for rel in db::evict_superseded_previews(&conn, a, "standard", &new_key).unwrap() {
            preview_store::remove(&root, &rel).unwrap();
        }
        assert!(
            preview_store::read(&root, &old).unwrap().is_none(),
            "superseded blob reclaimed"
        );
        assert!(
            preview_store::read(&root, &shared).unwrap().is_some(),
            "shared blob survives"
        );
        assert!(preview_store::read(&root, &kept).unwrap().is_some());

        // Deleting b CASCADE-drops its row but leaves the blob; a leaked temp
        // file sits beside it. The sweep (no age, no cap) reclaims both.
        db::remove_photos(&conn, &[b]).unwrap();
        preview_store::write(&root, "zz/leak.tmp-0-0", b"leak").unwrap();
        let stats = preview_gc(&conn, &root, None, None).unwrap();
        assert_eq!(stats.deleted_rows, 0);
        assert_eq!(stats.deleted_files, 2, "orphaned blob + leaked temp file");
        assert!(preview_store::read(&root, &shared).unwrap().is_none());
        assert!(preview_store::read(&root, &kept).unwrap().is_some());

        // 1:1 previews older than the age limit are discarded, fresh ones kept.
        let stale_11 = put(a, "one_to_one", &"dd".repeat(32), b"stale");
        let fresh_11 = put(a, "one_to_one", &"ee".repeat(32), b"11-fresh");
        conn.execute(
            "UPDATE preview SET created_at = created_at - 31*24*60*60 WHERE file_path=?1",
            params![stale_11],
        )
        .unwrap();
        let stats = preview_gc(
            &conn,
            &root,
            Some(super::PREVIEW_ONE_TO_ONE_MAX_AGE_SECS),
            None,
        )
        .unwrap();
        assert_eq!((stats.deleted_rows, stats.deleted_files), (1, 1));
        assert!(preview_store::read(&root, &stale_11).unwrap().is_none());
        assert!(preview_store::read(&root, &fresh_11).unwrap().is_some());

        // Over the byte cap the oldest rows go first: kept("new"=3) predates
        // fresh_11("11-fresh"=8), cap 8 evicts kept and stops at exactly 8.
        let stats = preview_gc(&conn, &root, None, Some(8)).unwrap();
        assert_eq!((stats.deleted_rows, stats.deleted_files), (1, 1));
        assert_eq!(stats.remaining_bytes, 8);
        assert!(preview_store::read(&root, &kept).unwrap().is_none());
        assert!(preview_store::read(&root, &fresh_11).unwrap().is_some());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn iptc_location_and_attribution_round_trip() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        db::set_photo_metadata(
            &conn,
            a,
            &PhotoIptc {
                title: some("Title"),
                creator: some("Ada"),
                city: some("Ljubljana"),
                state_province: some("Osrednjeslovenska"),
                country: some("Slovenia"),
                job_title: some("Photographer"),
                credit: some("Monet Wire"),
                source: some("Assignment"),
                ..Default::default()
            },
        )
        .unwrap();
        let page = db::list_photos(&conn, None, 10, &PhotoFilter::default()).unwrap();
        let p = &page.photos[0].iptc;
        assert_eq!(p.city.as_deref(), Some("Ljubljana"));
        assert_eq!(p.state_province.as_deref(), Some("Osrednjeslovenska"));
        assert_eq!(p.country.as_deref(), Some("Slovenia"));
        assert_eq!(p.job_title.as_deref(), Some("Photographer"));
        assert_eq!(p.credit.as_deref(), Some("Monet Wire"));
        assert_eq!(p.source.as_deref(), Some("Assignment"));
        assert_eq!(p.creator.as_deref(), Some("Ada")); // legacy quartet intact
    }

    /// GAL-META-06: the fields LR's IPTC view carries beyond the panel-default
    /// ten — headline, the location cluster's ends, the rights block, the
    /// creator contact block, instructions — survive a write/read round trip,
    /// and Copyright Status only ever stores a value the panel can show.
    #[test]
    fn iptc_extended_fields_round_trip_and_clamp_copyright_status() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let full = PhotoIptc {
            headline: some("Dawn over Triglav"),
            instructions: some("Embargo until Monday"),
            sublocation: some("Vodnikov dom"),
            iso_country_code: some("SVN"),
            copyright_status: some("copyrighted"),
            rights_usage_terms: some("Editorial use only, one-time rights"),
            copyright_info_url: some("https://example.test/rights"),
            creator_address: some("Trg 1"),
            creator_city: some("Ljubljana"),
            creator_state_province: some("Osrednjeslovenska"),
            creator_postal_code: some("1000"),
            creator_country: some("Slovenia"),
            creator_phone: some("+386 1 234 5678"),
            creator_email: some("ada@example.test"),
            creator_website: some("https://example.test"),
            ..Default::default()
        };
        db::set_photo_metadata(&conn, a, &full).unwrap();
        assert_eq!(
            db::get_photo(&conn, a).unwrap().unwrap().iptc,
            full,
            "every extended field reads back exactly as written"
        );

        // Blanks clear, and an out-of-vocabulary status falls back to Unknown
        // rather than persisting something the panel cannot display or clear.
        db::set_photo_metadata(
            &conn,
            a,
            &PhotoIptc {
                headline: some("  "),
                sublocation: some("Kredarica"),
                copyright_status: some("Copyrighted"), // wrong case = not the vocabulary
                ..Default::default()
            },
        )
        .unwrap();
        let p = db::get_photo(&conn, a).unwrap().unwrap().iptc;
        assert_eq!(p.headline, None, "blank clears");
        assert_eq!(p.sublocation.as_deref(), Some("Kredarica"));
        assert_eq!(p.copyright_status, None, "unknown status clamps to Unknown");
        assert_eq!(p.creator_email, None, "an omitted field clears, LR-style");

        db::set_photo_metadata(
            &conn,
            a,
            &PhotoIptc { copyright_status: some("publicDomain"), ..Default::default() },
        )
        .unwrap();
        assert_eq!(
            db::get_photo(&conn, a).unwrap().unwrap().iptc.copyright_status.as_deref(),
            Some("publicDomain")
        );

        // The frontend reads a flat camelCase row; `iptc` is flattened, not nested.
        let json = serde_json::to_value(db::get_photo(&conn, a).unwrap().unwrap()).unwrap();
        for key in ["jobTitle", "isoCountryCode", "creatorPostalCode", "rightsUsageTerms"] {
            assert!(json.get(key).is_some(), "PhotoRow JSON lost `{key}`");
        }
        assert!(json.get("iptc").is_none(), "the IPTC block must stay flattened");
    }

    #[test]
    fn smart_rules_support_dates_edit_status_and_emptiness() {
        let conn = mem();
        // a: captured 2026-01-15, edited, keyworded, titled. b: old, untouched.
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(100))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(200))).unwrap();
        conn.execute(
            "UPDATE photo SET capture_time=?2, develop_recipe='{}' WHERE id=?1",
            params![a, tests_epoch_2026_01_15()],
        )
        .unwrap();
        db::add_keyword(&conn, a, "beach").unwrap();
        db::set_photo_metadata(
            &conn,
            a,
            &PhotoIptc { title: some("Sunset"), ..Default::default() },
        )
        .unwrap();

        let smart = |rules: &str| -> Vec<i64> {
            let ast = format!("{{\"match\":\"all\",\"rules\":{rules}}}");
            let id = db::create_collection(&conn, "S", "smart", None, Some(&ast)).unwrap();
            let ids = db::list_collection_photos(&conn, id, 100, 0)
                .unwrap()
                .iter()
                .map(|p| p.id)
                .collect();
            conn.execute("DELETE FROM collection WHERE id=?1", params![id])
                .unwrap();
            ids
        };

        // Dates: after includes 2026 capture; before excludes it (b's epoch-200
        // capture predates everything).
        assert_eq!(
            smart(r#"[{"field":"captureDate","op":"after","value":"2026-01-01"}]"#),
            vec![a]
        );
        assert_eq!(
            smart(r#"[{"field":"captureDate","op":"before","value":"1971-01-01"}]"#),
            vec![b]
        );
        // inLast: an enormous window includes both; a zero window includes none.
        assert_eq!(
            smart(r#"[{"field":"captureDate","op":"inLast","value":999999}]"#).len(),
            2
        );
        assert_eq!(
            smart(r#"[{"field":"captureDate","op":"inLast","value":0}]"#).len(),
            0
        );

        // Edit status via develop_recipe nullness.
        assert_eq!(
            smart(r#"[{"field":"edited","op":"eq","value":true}]"#),
            vec![a]
        );
        assert_eq!(
            smart(r#"[{"field":"edited","op":"eq","value":false}]"#),
            vec![b]
        );

        // Emptiness: keywords + title.
        assert_eq!(
            smart(r#"[{"field":"keyword","op":"empty","value":null}]"#),
            vec![b]
        );
        assert_eq!(
            smart(r#"[{"field":"keyword","op":"notEmpty","value":null}]"#),
            vec![a]
        );
        assert_eq!(
            smart(r#"[{"field":"title","op":"empty","value":null}]"#),
            vec![b]
        );
        assert_eq!(
            smart(r#"[{"field":"title","op":"contains","value":"sun"}]"#),
            vec![a]
        );
    }

    /// 2026-01-15T00:00:00Z, via the same converter the compiler uses — the
    /// converter itself is pinned against a known epoch below.
    fn tests_epoch_2026_01_15() -> i64 {
        1768435200
    }

    #[test]
    fn date_to_epoch_matches_known_instants() {
        assert_eq!(db::date_to_epoch_for_tests("1970-01-01").unwrap(), 0);
        assert_eq!(
            db::date_to_epoch_for_tests("2026-01-01").unwrap(),
            1_767_225_600
        );
        assert_eq!(
            db::date_to_epoch_for_tests("2026-01-15").unwrap(),
            1_768_435_200
        );
        assert!(db::date_to_epoch_for_tests("2026-13-01").is_err());
        assert!(db::date_to_epoch_for_tests("nope").is_err());
    }

    #[test]
    fn text_targets_and_rating_ops_filter_correctly() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(100))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(200))).unwrap();
        db::set_photo_metadata(
            &conn,
            a,
            &PhotoIptc {
                title: some("Sunset Beach"),
                caption: some("Golden hour"),
                ..Default::default()
            },
        )
        .unwrap();
        db::add_keyword(&conn, b, "beach").unwrap();

        let text = |target: &str| PhotoFilter {
            text: Some("beach".into()),
            text_target: Some(target.into()),
            ..Default::default()
        };
        // Default/path target: no path contains "beach".
        assert_eq!(
            db::count_photos(
                &conn,
                &PhotoFilter {
                    text: Some("beach".into()),
                    ..Default::default()
                }
            )
            .unwrap(),
            0
        );
        assert_eq!(db::count_photos(&conn, &text("title")).unwrap(), 1); // a ("Sunset Beach")
        assert_eq!(db::count_photos(&conn, &text("caption")).unwrap(), 0);
        assert_eq!(db::count_photos(&conn, &text("keywords")).unwrap(), 1); // b
        assert_eq!(db::count_photos(&conn, &text("any")).unwrap(), 2); // title OR keyword

        // Rating comparison modes.
        db::set_flags(&conn, a, 2, 0, None).unwrap();
        db::set_flags(&conn, b, 4, 0, None).unwrap();
        let rate = |op: &str, min: i64| PhotoFilter {
            min_rating: min,
            rating_op: Some(op.into()),
            ..Default::default()
        };
        assert_eq!(db::count_photos(&conn, &rate("=", 4)).unwrap(), 1);
        assert_eq!(db::count_photos(&conn, &rate("<=", 2)).unwrap(), 1);
        assert_eq!(db::count_photos(&conn, &rate(">=", 2)).unwrap(), 2);
    }

    #[test]
    fn metadata_filter_options_and_predicates_compose() {
        let conn = mem();
        // sample() sets camera_model "EOS R5" + lens "RF 50mm"; capture times land
        // in 1970 via small epochs. Vary one field per photo through direct SQL.
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(100))).unwrap();
        let _b = db::import_photo(&conn, &sample("/b.cr3", Some(200))).unwrap();
        conn.execute(
            "UPDATE photo SET camera_model='X100V', lens='23mm', capture_time=1767225600 WHERE id=?1",
            params![a], // 2026-01-01 UTC
        )
        .unwrap();

        let opts = db::list_filter_options(&conn, None, None).unwrap();
        let col = |id: &str| {
            opts.columns[id]
                .iter()
                .map(|o| (o.value.clone(), o.count))
                .collect::<Vec<_>>()
        };
        assert_eq!(
            col("camera"),
            vec![("EOS R5".to_string(), 1), ("X100V".to_string(), 1)]
        );
        assert_eq!(opts.columns["lens"].len(), 2);
        assert_eq!(opts.columns["year"][0].value, "2026"); // DESC

        // Predicates compose with the rest of the filter machinery.
        let by_camera = PhotoFilter {
            camera: Some("X100V".into()),
            ..Default::default()
        };
        assert_eq!(db::count_photos(&conn, &by_camera).unwrap(), 1);
        let by_year = PhotoFilter {
            year: Some(2026),
            ..Default::default()
        };
        let page = db::list_photos(&conn, None, 10, &by_year).unwrap();
        assert_eq!(page.photos.len(), 1);
        assert_eq!(page.photos[0].id, a);
        let none = PhotoFilter {
            camera: Some("X100V".into()),
            year: Some(1970),
            ..Default::default()
        };
        assert_eq!(db::count_photos(&conn, &none).unwrap(), 0);
    }

    /// The Filter bar's Metadata browser (GAL-LIB-08): arbitrary columns,
    /// multi-select within a column, AND across columns, and counts that track
    /// the other columns.
    #[test]
    fn metadata_browser_columns_multi_select_and_live_counts() {
        let conn = mem();
        // sample(): EOS R5 / RF 50mm / 6000x4000 (landscape) / raw:CR3.
        let a = db::import_photo(&conn, &sample("/shoot/a.cr3", Some(1767225600))).unwrap(); // 2026-01-01
        let b = db::import_photo(&conn, &sample("/shoot/b.cr3", Some(1769904000))).unwrap(); // 2026-02-01
        let c = db::import_photo(&conn, &sample("/other/c.cr3", Some(1735689600))).unwrap(); // 2025-01-01
        conn.execute(
            "UPDATE photo SET camera_model='X100V', lens='23mm', width=4000, height=6000 WHERE id=?1",
            params![b],
        )
        .unwrap();
        conn.execute("UPDATE photo SET camera_model='Z9' WHERE id=?1", params![c]).unwrap();
        db::add_keyword(&conn, a, "Sunset").unwrap();
        db::add_keyword(&conn, c, "Sunset").unwrap();

        let meta = |pairs: &[(&str, &[&str])]| PhotoFilter {
            meta: Some(
                pairs
                    .iter()
                    .map(|(k, v)| {
                        ((*k).to_string(), v.iter().map(|s| (*s).to_string()).collect())
                    })
                    .collect(),
            ),
            ..Default::default()
        };

        // Multi-select within a column is any-of.
        assert_eq!(
            db::count_photos(&conn, &meta(&[("camera", &["EOS R5", "Z9"])])).unwrap(),
            2
        );
        // Columns AND together: EOS R5 or Z9, captured in 2026 → only `a`.
        let page = db::list_photos(
            &conn,
            None,
            10,
            &meta(&[("camera", &["EOS R5", "Z9"]), ("year", &["2026"])]),
        )
        .unwrap();
        assert_eq!(page.photos.iter().map(|p| p.id).collect::<Vec<_>>(), vec![a]);
        // Date drill-down granularities and the derived columns.
        assert_eq!(db::count_photos(&conn, &meta(&[("month", &["2026-02"])])).unwrap(), 1);
        assert_eq!(db::count_photos(&conn, &meta(&[("day", &["2025-01-01"])])).unwrap(), 1);
        assert_eq!(db::count_photos(&conn, &meta(&[("aspect", &["Portrait"])])).unwrap(), 1);
        assert_eq!(db::count_photos(&conn, &meta(&[("folder", &["/shoot"])])).unwrap(), 2);
        assert_eq!(db::count_photos(&conn, &meta(&[("filetype", &["raw:CR3"])])).unwrap(), 3);
        assert_eq!(db::count_photos(&conn, &meta(&[("keyword", &["Sunset"])])).unwrap(), 2);
        // An empty list is "any"; an unknown column id is ignored, not fatal.
        assert_eq!(db::count_photos(&conn, &meta(&[("camera", &[])])).unwrap(), 3);
        assert_eq!(db::count_photos(&conn, &meta(&[("serial", &["123"])])).unwrap(), 3);

        // Counts reflect the OTHER columns but not the column's own selection.
        let active = meta(&[("camera", &["EOS R5"])]);
        let cols = ["camera".to_string(), "lens".to_string(), "keyword".to_string()];
        let opts = db::list_filter_options(&conn, Some(&active), Some(&cols)).unwrap();
        assert_eq!(opts.columns.keys().collect::<Vec<_>>(), vec!["camera", "keyword", "lens"]);
        // Camera keeps all three siblings...
        assert_eq!(opts.columns["camera"].len(), 3);
        // ...while Lens narrows to the EOS R5's lens only.
        assert_eq!(
            opts.columns["lens"]
                .iter()
                .map(|o| (o.value.as_str(), o.count))
                .collect::<Vec<_>>(),
            vec![("RF 50mm", 1)]
        );
        assert_eq!(opts.columns["keyword"], vec![OptionCount { value: "Sunset".into(), count: 1 }]);
    }

    #[test]
    fn folder_only_filter_and_remove_folder_ids() {
        let conn = mem();
        db::import_photo(&conn, &sample("/shoot/a.cr3", Some(10))).unwrap();
        db::import_photo(&conn, &sample("/shoot/sub/b.cr3", Some(20))).unwrap();
        db::import_photo(&conn, &sample("/shootout/c.cr3", Some(30))).unwrap();

        // folder_only drops subfolder photos but keeps direct children.
        let only = PhotoFilter {
            folder: Some("/shoot".into()),
            folder_only: true,
            ..Default::default()
        };
        assert_eq!(db::count_photos(&conn, &only).unwrap(), 1);
        let page = db::list_photos(&conn, None, 10, &only).unwrap();
        assert_eq!(page.photos.len(), 1);
        assert!(page.photos[0].path.ends_with("/shoot/a.cr3"));

        // Remove-from-catalog collects the subtree, never the /shootout sibling.
        let ids = db::photo_ids_under_dir(&conn, "/shoot").unwrap();
        assert_eq!(ids.len(), 2);
        let deleted = db::remove_photos(&conn, &ids).unwrap();
        assert_eq!(deleted.len(), 2);
        assert_eq!(
            db::list_folders(&conn)
                .unwrap()
                .iter()
                .map(|f| f.path.clone())
                .collect::<Vec<_>>(),
            vec!["/shootout".to_string()]
        );
    }

    #[test]
    fn folders_list_counts_and_folder_filter_is_prefix_safe() {
        let conn = mem();
        db::import_photo(&conn, &sample("/shoot/a.cr3", Some(10))).unwrap();
        db::import_photo(&conn, &sample("/shoot/sub/b.cr3", Some(20))).unwrap();
        db::import_photo(&conn, &sample("/shootout/c.cr3", Some(30))).unwrap();

        // Immediate-parent counts, path-ordered.
        let folders = db::list_folders(&conn).unwrap();
        assert_eq!(
            folders
                .iter()
                .map(|f| (f.path.as_str(), f.count))
                .collect::<Vec<_>>(),
            vec![("/shoot", 1), ("/shoot/sub", 1), ("/shootout", 1)]
        );

        // The folder filter includes subfolders but never a same-prefix sibling.
        let filter = PhotoFilter {
            folder: Some("/shoot".into()),
            ..Default::default()
        };
        assert_eq!(db::count_photos(&conn, &filter).unwrap(), 2);
        let page = db::list_photos(&conn, None, 10, &filter).unwrap();
        let mut paths: Vec<String> = page.photos.iter().map(|p| p.path.clone()).collect();
        paths.sort();
        assert_eq!(paths, vec!["/shoot/a.cr3", "/shoot/sub/b.cr3"]);
    }

    #[test]
    fn repoint_folder_rewrites_subtree_prefix_safely_and_atomically() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/shoot/a.cr3", Some(10))).unwrap();
        let b = db::import_photo(&conn, &sample("/shoot/sub/b.cr3", Some(20))).unwrap();
        let c = db::import_photo(&conn, &sample("/shootout/c.cr3", Some(30))).unwrap();

        // The whole subtree repoints; the same-prefix sibling does not.
        assert_eq!(db::repoint_folder(&conn, "/shoot", "/trip").unwrap(), 2);
        let path_of = |id: i64| -> String {
            conn.query_row(
                "SELECT s.path FROM photo p JOIN source_asset s ON s.id=p.source_asset_id WHERE p.id=?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(path_of(a), "/trip/a.cr3");
        assert_eq!(path_of(b), "/trip/sub/b.cr3");
        assert_eq!(path_of(c), "/shootout/c.cr3");

        // A collision (target path already cataloged) fails atomically: import a
        // file at the destination, then try to repoint onto it.
        db::import_photo(&conn, &sample("/dest/a.cr3", Some(40))).unwrap();
        assert!(db::repoint_folder(&conn, "/trip", "/dest").is_err());
        assert_eq!(
            path_of(a),
            "/trip/a.cr3",
            "failed repoint leaves every row untouched"
        );
        assert_eq!(path_of(b), "/trip/sub/b.cr3");
    }

    #[test]
    fn repoint_folder_is_case_sensitive_and_separator_symmetric() {
        let conn = mem();
        let lower = db::import_photo(&conn, &sample("/pics/shoot/a.cr3", Some(10))).unwrap();
        let upper = db::import_photo(&conn, &sample("/pics/Shoot/b.cr3", Some(20))).unwrap();
        let win = db::import_photo(&conn, &sample("C:\\pics\\shoot\\c.cr3", Some(30))).unwrap();
        let path_of = |id: i64| -> String {
            conn.query_row(
                "SELECT s.path FROM photo p JOIN source_asset s ON s.id=p.source_asset_id WHERE p.id=?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap()
        };

        // Default LIKE would case-fold /pics/Shoot into this repoint.
        assert_eq!(
            db::repoint_folder(&conn, "/pics/shoot", "/pics/trip").unwrap(),
            1
        );
        assert_eq!(path_of(lower), "/pics/trip/a.cr3");
        assert_eq!(
            path_of(upper),
            "/pics/Shoot/b.cr3",
            "differently-cased sibling untouched"
        );

        // Backslash-separated rows repoint too, keeping their separator.
        assert_eq!(
            db::repoint_folder(&conn, "C:\\pics\\shoot", "C:\\pics\\trip").unwrap(),
            1
        );
        assert_eq!(path_of(win), "C:\\pics\\trip\\c.cr3");

        assert_eq!(db::count_under_dir(&conn, "/pics/trip").unwrap(), 1);
        assert_eq!(db::count_under_dir(&conn, "/pics/shoot").unwrap(), 0);
        assert_eq!(db::count_under_dir(&conn, "C:\\pics\\trip").unwrap(), 1);
    }

    #[test]
    fn update_source_path_repoints_returns_old_and_refuses_collisions() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let _b = db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();

        let old = db::update_source_path(&conn, a, "/renamed.cr3").unwrap();
        assert_eq!(old, "/a.cr3");
        let path: String = conn
            .query_row(
                "SELECT s.path FROM photo p JOIN source_asset s ON s.id=p.source_asset_id WHERE p.id=?1",
                params![a],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(path, "/renamed.cr3");

        // A path another asset owns is refused, leaving the catalog untouched.
        assert!(db::update_source_path(&conn, a, "/b.cr3").is_err());
        // Repointing to the CURRENT path is a no-op success (idempotent undo).
        assert_eq!(
            db::update_source_path(&conn, a, "/renamed.cr3").unwrap(),
            "/renamed.cr3"
        );
    }

    #[test]
    fn set_capture_time_updates_sort_and_clearing_retains_order() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(100))).unwrap();

        db::set_capture_time(&conn, a, Some(500)).unwrap();
        let (cap, sort): (Option<i64>, i64) = conn
            .query_row(
                "SELECT capture_time, sort_time FROM photo WHERE id=?1",
                params![a],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(cap, Some(500));
        assert_eq!(sort, 500, "capture-ordered sorting follows the edit");

        // Clearing to unknown keeps the photo's sort place.
        db::set_capture_time(&conn, a, None).unwrap();
        let (cap, sort): (Option<i64>, i64) = conn
            .query_row(
                "SELECT capture_time, sort_time FROM photo WHERE id=?1",
                params![a],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(cap, None);
        assert_eq!(sort, 500);
    }

    #[test]
    fn set_gps_writes_clears_and_survives_a_rescan_of_an_exif_less_file() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(100))).unwrap();

        db::set_gps(&conn, a, Some(46.05), Some(14.51)).unwrap();
        let got = db::get_photo(&conn, a).unwrap().unwrap();
        assert_eq!((got.gps_lat, got.gps_lon), (Some(46.05), Some(14.51)));
        // The list path reads the same columns as get.
        let listed = db::list_photos(&conn, None, 10, &r(0)).unwrap();
        assert_eq!(listed.photos[0].gps_lat, Some(46.05));

        // Re-scan of a file with no EXIF GPS keeps the manual geotag.
        db::import_photo(&conn, &sample("/a.cr3", Some(100))).unwrap();
        assert_eq!(
            db::get_photo(&conn, a).unwrap().unwrap().gps_lat,
            Some(46.05)
        );

        // ...but a file that DOES carry EXIF GPS still wins on re-scan.
        let mut geotagged = sample("/a.cr3", Some(100));
        geotagged.gps_lat = Some(1.5);
        geotagged.gps_lon = Some(2.5);
        db::import_photo(&conn, &geotagged).unwrap();
        let got = db::get_photo(&conn, a).unwrap().unwrap();
        assert_eq!((got.gps_lat, got.gps_lon), (Some(1.5), Some(2.5)));

        // Delete GPS Location clears both halves.
        db::set_gps(&conn, a, None, None).unwrap();
        let got = db::get_photo(&conn, a).unwrap().unwrap();
        assert_eq!((got.gps_lat, got.gps_lon), (None, None));
    }

    #[test]
    fn keyword_vocabulary_lists_counts_browses_and_deletes_with_cascade() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();
        db::add_keyword(&conn, a, "beach").unwrap();
        db::add_keyword(&conn, b, "beach").unwrap();
        db::add_keyword(&conn, a, "sunset").unwrap();

        // Name-ordered vocabulary with usage counts.
        let kws = db::list_keywords(&conn).unwrap();
        assert_eq!(
            kws.iter()
                .map(|k| (k.name.as_str(), k.count))
                .collect::<Vec<_>>(),
            vec![("beach", 2), ("sunset", 1)]
        );

        // Browsing a keyword returns exactly its tagged photos.
        let beach_id = kws[0].id;
        let mut ids: Vec<i64> = db::list_keyword_photos(&conn, beach_id, 100, 0)
            .unwrap()
            .iter()
            .map(|p| p.id)
            .collect();
        ids.sort();
        assert_eq!(ids, vec![a, b]);

        // Deleting a keyword cascades its photo links; photos stay.
        db::delete_keyword(&conn, beach_id).unwrap();
        assert!(db::list_keyword_photos(&conn, beach_id, 100, 0)
            .unwrap()
            .is_empty());
        assert_eq!(db::list_keywords(&conn).unwrap().len(), 1);
        assert_eq!(db::list_photo_keywords(&conn, a).unwrap().len(), 1); // sunset only
        assert_eq!(db::count_photos(&conn, &Default::default()).unwrap(), 2);
    }

    #[test]
    fn keyword_hierarchy_paths_nesting_flags_and_cascade() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();

        // "animal|dog" creates the chain and tags the LEAF only.
        let dog = db::add_keyword(&conn, a, "animal|dog").unwrap();
        let kws = db::list_keywords(&conn).unwrap();
        let animal = kws.iter().find(|k| k.name == "animal").unwrap().clone();
        let dog_row = kws.iter().find(|k| k.name == "dog").unwrap();
        assert_eq!(dog_row.id, dog);
        assert_eq!(dog_row.parent_id, Some(animal.id));
        assert_eq!(animal.parent_id, None);
        assert_eq!((animal.count, dog_row.count), (0, 1));
        assert!(animal.include_on_export && animal.export_containing && animal.export_synonyms);

        // Re-entering a path reuses the chain; an existing keyword keeps its
        // current parent (tag entry never silently reparents).
        assert_eq!(db::add_keyword(&conn, a, "animal|dog").unwrap(), dog);
        db::add_keyword(&conn, a, "pets|dog").unwrap();
        let kws = db::list_keywords(&conn).unwrap();
        assert_eq!(
            kws.iter().find(|k| k.name == "dog").unwrap().parent_id,
            Some(animal.id)
        );

        // Edit Keyword Tag: rename + Put Inside + synonyms + export flags.
        let pets = kws.iter().find(|k| k.name == "pets").unwrap().id;
        db::update_keyword(
            &conn,
            dog,
            "hound",
            Some(pets),
            "puppy, doggo",
            false,
            true,
            false,
        )
        .unwrap();
        let kws = db::list_keywords(&conn).unwrap();
        let hound = kws.iter().find(|k| k.name == "hound").unwrap();
        assert_eq!(hound.parent_id, Some(pets));
        assert_eq!(hound.synonyms, "puppy, doggo");
        assert!(!hound.include_on_export && !hound.export_synonyms);

        // Cycle guard: a keyword cannot be put inside itself or its own child.
        assert!(db::update_keyword(&conn, pets, "pets", Some(dog), "", true, true, true).is_err());
        assert!(db::update_keyword(&conn, pets, "pets", Some(pets), "", true, true, true).is_err());

        // Dialog create: vocabulary-only (no tagging); duplicate names refused.
        let cat = db::create_keyword(&conn, "cat", Some(pets), "kitty", true, false, true).unwrap();
        assert!(db::create_keyword(&conn, "cat", None, "", true, true, true).is_err());
        let kws = db::list_keywords(&conn).unwrap();
        let cat_row = kws.iter().find(|k| k.name == "cat").unwrap();
        assert_eq!(
            (cat_row.id, cat_row.parent_id, cat_row.count),
            (cat, Some(pets), 0)
        );
        assert!(!cat_row.export_containing);

        // Deleting a parent cascades the whole subtree and its photo links.
        db::delete_keyword(&conn, pets).unwrap();
        let names: Vec<String> = db::list_keywords(&conn)
            .unwrap()
            .into_iter()
            .map(|k| k.name)
            .collect();
        assert_eq!(names, vec!["animal"]);
        assert!(db::list_photo_keywords(&conn, a).unwrap().is_empty());
    }

    #[test]
    fn find_duplicate_matches_content_at_other_paths_only() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        // Same content fingerprint arriving from a different path (re-imported
        // card / copied tree) — the "suspected duplicate" case.
        let dupe = ImportPhoto {
            path: "/copy/a.cr3".into(),
            ..sample("/a.cr3", Some(10))
        };

        assert_eq!(
            db::find_duplicate(&conn, &dupe.fingerprint, &dupe.path).unwrap(),
            Some(a)
        );
        // The SAME path is not a duplicate — import_photo reconciles it in place.
        assert_eq!(
            db::find_duplicate(&conn, "fp-/a.cr3", "/a.cr3").unwrap(),
            None
        );
        // Unknown content matches nothing.
        assert_eq!(
            db::find_duplicate(&conn, "fp-elsewhere", "/b.cr3").unwrap(),
            None
        );
        // Virtual copies share the master's asset but never count as the match's
        // source of truth twice: the hit is still the master row.
        let _vc = db::create_virtual_copy(&conn, a).unwrap();
        assert_eq!(
            db::find_duplicate(&conn, "fp-/a.cr3", "/copy/a.cr3").unwrap(),
            Some(a)
        );
    }

    #[test]
    fn delete_from_disk_helpers_collect_files_and_prune_only_orphans() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();
        // `a` gets a managed DNG copy and a virtual copy (shares a's asset).
        conn.execute(
            "UPDATE source_asset SET managed_path='/m/a.dng'
             WHERE id=(SELECT source_asset_id FROM photo WHERE id=?1)",
            params![a],
        )
        .unwrap();
        let v1 = db::create_virtual_copy(&conn, a).unwrap();

        // Master + its VC dedupe onto one asset row; managed path rides along.
        let files = db::source_files_for(&conn, &[a, v1, b]).unwrap();
        assert_eq!(files.len(), 2);
        let fa = files.iter().find(|f| f.1 == "/a.cr3").unwrap().clone();
        assert_eq!(fa.2.as_deref(), Some("/m/a.dng"));

        // Removing only the virtual copy leaves the master → the asset survives.
        db::remove_photos(&conn, &[v1]).unwrap();
        assert!(db::prune_orphan_assets(&conn, &[fa.0]).unwrap().is_empty());

        // Removing the master too orphans the asset → pruned; `b` is untouched.
        db::remove_photos(&conn, &[a]).unwrap();
        assert_eq!(db::prune_orphan_assets(&conn, &[fa.0]).unwrap(), vec![fa.0]);
        assert_eq!(db::count_photos(&conn, &Default::default()).unwrap(), 1);
        let assets: i64 = conn
            .query_row("SELECT COUNT(*) FROM source_asset", [], |r| r.get(0))
            .unwrap();
        assert_eq!(assets, 1, "only b's asset row remains");
    }

    #[test]
    fn list_rejected_ids_returns_only_reject_flagged_photos() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();
        let c = db::import_photo(&conn, &sample("/c.cr3", Some(30))).unwrap();

        assert_eq!(
            db::list_rejected_ids(&conn).unwrap(),
            Vec::<i64>::new(),
            "no rejects yet"
        );

        db::set_flags(&conn, a, 0, -1, None).unwrap(); // reject
        db::set_flags(&conn, b, 5, 1, None).unwrap(); // pick
        db::set_flags(&conn, c, 0, -1, None).unwrap(); // reject

        // Only the reject-flagged ids, in id order (picks/unflagged excluded).
        assert_eq!(db::list_rejected_ids(&conn).unwrap(), vec![a, c]);

        // The "Delete Rejected" round-trip purges exactly those; the pick survives.
        let deleted = db::remove_photos(&conn, &db::list_rejected_ids(&conn).unwrap()).unwrap();
        assert_eq!(deleted, vec![a, c]);
        assert_eq!(db::count_photos(&conn, &Default::default()).unwrap(), 1);
        assert!(db::list_rejected_ids(&conn).unwrap().is_empty());
    }

    #[test]
    fn list_photos_clamps_nonpositive_limit() {
        let conn = mem();
        db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();
        // limit<=0 must not silently drop every row (was: truncate(0) → empty, no cursor).
        for limit in [0, -5] {
            let page = db::list_photos(&conn, None, limit, &r(0)).unwrap();
            assert_eq!(page.photos.len(), 1, "clamped to 1 row for limit {limit}");
            assert!(
                page.next.is_some(),
                "a cursor is still emitted for limit {limit}"
            );
        }
    }

    /// The keyset sorts must be served by an index, not a filesort — that is the
    /// whole point of the per-sort-mode indexes. SQLite reports a filesort as
    /// "USE TEMP B-TREE FOR ORDER BY" in the query plan.
    #[test]
    fn photo_only_grid_sorts_are_index_served_not_filesorted() {
        let conn = mem();
        db::import_photo(&conn, &sample("/a.cr3", Some(30))).unwrap();

        let plan_of = |sql: &str| -> String {
            let mut st = conn
                .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
                .expect("plan prepares");
            let rows = st
                .query_map([], |r| r.get::<_, String>(3))
                .unwrap()
                .map(|r| r.unwrap())
                .collect::<Vec<_>>();
            rows.join(" | ")
        };

        // The sort keys that live on `photo` itself, in both directions.
        for (expr, idx) in [
            ("p.sort_time", "idx_photo_sort"),
            ("p.added_time", "idx_photo_added"),
            ("p.rating", "idx_photo_rating"),
            ("p.flag", "idx_photo_flag"),
        ] {
            for dir in ["ASC", "DESC"] {
                let plan = plan_of(&format!(
                    "SELECT p.id FROM photo p ORDER BY {expr} {dir}, p.id {dir} LIMIT 50"
                ));
                assert!(
                    !plan.contains("TEMP B-TREE"),
                    "{expr} {dir} filesorts the whole table (wanted {idx}): {plan}"
                );
            }
        }
    }

    #[test]
    fn list_photos_sorted_orders_by_key_and_direction() {
        let conn = mem();
        // Capture times a=30, b=10, c=20; ratings a=2, b=5, c=5.
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(30))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(10))).unwrap();
        let c = db::import_photo(&conn, &sample("/c.cr3", Some(20))).unwrap();
        db::set_flags(&conn, a, 2, 0, None).unwrap();
        db::set_flags(&conn, b, 5, 0, None).unwrap();
        db::set_flags(&conn, c, 5, 0, None).unwrap();

        let ids = |s: GridSort| {
            db::list_photos_sorted(&conn, None, 10, &Default::default(), s)
                .unwrap()
                .photos
                .iter()
                .map(|p| p.id)
                .collect::<Vec<_>>()
        };

        // Capture desc (the default) = newest first: 30,20,10.
        assert_eq!(
            ids(GridSort {
                key: SortKey::Capture,
                ascending: false
            }),
            vec![a, c, b]
        );
        assert_eq!(
            ids(GridSort::default()),
            vec![a, c, b],
            "default == capture desc"
        );
        // Capture asc = oldest first.
        assert_eq!(
            ids(GridSort {
                key: SortKey::Capture,
                ascending: true
            }),
            vec![b, c, a]
        );
        // Rating desc, ties broken by id desc: c(5),b(5),a(2).
        assert_eq!(
            ids(GridSort {
                key: SortKey::Rating,
                ascending: false
            }),
            vec![c, b, a]
        );
        // Rating asc, ties broken by id asc: a(2),b(5),c(5).
        assert_eq!(
            ids(GridSort {
                key: SortKey::Rating,
                ascending: true
            }),
            vec![a, b, c]
        );
        // Added asc = import order (added_time ties break by id asc).
        assert_eq!(
            ids(GridSort {
                key: SortKey::Added,
                ascending: true
            }),
            vec![a, b, c]
        );

        db::set_flags(&conn, a, 2, -1, Some("red")).unwrap();
        db::set_flags(&conn, b, 5, 1, None).unwrap();
        db::set_flags(&conn, c, 5, 0, Some("blue")).unwrap();
        conn.execute(
            "UPDATE source_asset SET format=CASE path
               WHEN '/a.cr3' THEN 'raw' WHEN '/b.cr3' THEN 'jpeg' ELSE 'dng' END",
            [],
        )
        .unwrap();
        assert_eq!(
            ids(GridSort {
                key: SortKey::Flag,
                ascending: true
            }),
            vec![a, c, b]
        );
        assert_eq!(
            ids(GridSort {
                key: SortKey::Label,
                ascending: true
            }),
            vec![b, c, a]
        );
        assert_eq!(
            ids(GridSort {
                key: SortKey::Filetype,
                ascending: true
            }),
            vec![c, b, a]
        );
    }

    #[test]
    fn list_photos_sorted_paginates_by_rating_without_gaps() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(1))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(2))).unwrap();
        let c = db::import_photo(&conn, &sample("/c.cr3", Some(3))).unwrap();
        db::set_flags(&conn, a, 3, 0, None).unwrap();
        db::set_flags(&conn, b, 5, 0, None).unwrap();
        db::set_flags(&conn, c, 5, 0, None).unwrap();

        let sort = GridSort {
            key: SortKey::Rating,
            ascending: false,
        };
        // Walk one row at a time across the tie at rating 5 — the cursor must not
        // drop or repeat a row at the page boundary.
        let mut seen = Vec::new();
        let mut cursor = None;
        loop {
            let page = db::list_photos_sorted(&conn, cursor, 1, &Default::default(), sort).unwrap();
            seen.extend(page.photos.iter().map(|p| p.id));
            assert!(seen.len() <= 3, "pagination did not terminate: {seen:?}");
            match page.next {
                Some(c) => cursor = Some(c),
                None => break,
            }
        }
        // rating desc, id desc within the rating-5 tie: c, b, then a(3).
        assert_eq!(seen, vec![c, b, a]);
    }

    #[test]
    fn list_photos_sorted_orders_and_paginates_by_filename() {
        let conn = mem();
        // Insert out of name order, with mixed case to prove case-insensitivity.
        let c = db::import_photo(&conn, &sample("/Charlie.cr3", Some(10))).unwrap();
        let a = db::import_photo(&conn, &sample("/alpha.cr3", Some(20))).unwrap();
        let b = db::import_photo(&conn, &sample("/Bravo.cr3", Some(30))).unwrap();

        let ids = |asc: bool| {
            db::list_photos_sorted(
                &conn,
                None,
                10,
                &Default::default(),
                GridSort {
                    key: SortKey::Filename,
                    ascending: asc,
                },
            )
            .unwrap()
            .photos
            .iter()
            .map(|p| p.id)
            .collect::<Vec<_>>()
        };

        // NOCASE order: alpha, Bravo, Charlie — not ASCII order (upper < lower).
        assert_eq!(ids(true), vec![a, b, c]);
        assert_eq!(ids(false), vec![c, b, a]);

        // Walk one row at a time — the text cursor must not drop or repeat a row.
        let sort = GridSort {
            key: SortKey::Filename,
            ascending: true,
        };
        let mut seen = Vec::new();
        let mut cursor = None;
        loop {
            let page = db::list_photos_sorted(&conn, cursor, 1, &Default::default(), sort).unwrap();
            seen.extend(page.photos.iter().map(|p| p.id));
            assert!(seen.len() <= 3, "pagination did not terminate: {seen:?}");
            match page.next {
                Some(c) => cursor = Some(c),
                None => break,
            }
        }
        assert_eq!(seen, vec![a, b, c]);
    }

    #[test]
    fn extended_sort_keys_paginate_without_gaps() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();
        let c = db::import_photo(&conn, &sample("/c.cr3", Some(30))).unwrap();
        db::set_flags(&conn, a, 0, -1, Some("red")).unwrap();
        db::set_flags(&conn, b, 0, 1, None).unwrap();
        db::set_flags(&conn, c, 0, 0, Some("blue")).unwrap();
        conn.execute(
            "UPDATE source_asset SET format=CASE path
               WHEN '/a.cr3' THEN 'raw' WHEN '/b.cr3' THEN 'jpeg' ELSE 'dng' END",
            [],
        )
        .unwrap();

        let drain = |key| {
            let sort = GridSort {
                key,
                ascending: true,
            };
            let mut seen = Vec::new();
            let mut cursor = None;
            loop {
                let page =
                    db::list_photos_sorted(&conn, cursor, 1, &Default::default(), sort).unwrap();
                seen.extend(page.photos.into_iter().map(|photo| photo.id));
                match page.next {
                    Some(next) => cursor = Some(next),
                    None => return seen,
                }
            }
        };
        assert_eq!(drain(SortKey::Flag), vec![a, c, b]);
        assert_eq!(drain(SortKey::Label), vec![b, c, a]);
        assert_eq!(drain(SortKey::Filetype), vec![c, b, a]);
    }

    /// Aspect ratio and the two history-derived keys: they sort on values that
    /// aren't columns on `photo`, so their cursors are re-read from the ORDER BY
    /// expression. Page size 1 proves the cursor never skips or repeats a row.
    #[test]
    fn derived_sort_keys_paginate_without_gaps() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();
        let c = db::import_photo(&conn, &sample("/c.cr3", Some(30))).unwrap();
        // a = square, b = 3:2 landscape (the sample default), c = tall portrait.
        conn.execute("UPDATE photo SET width=4000, height=4000 WHERE id=?1", [a])
            .unwrap();
        conn.execute("UPDATE photo SET width=4000, height=6000 WHERE id=?1", [c])
            .unwrap();
        // c never edited; a has one step, b has two (newest step is b's).
        db::record_history(&conn, a, "Exposure", "{}", Some(2), 0).unwrap();
        db::record_history(&conn, b, "Contrast", "{}", Some(2), 0).unwrap();
        db::record_history(&conn, b, "Clarity", "{}", Some(2), 0).unwrap();
        // record_history stamps wall-clock seconds, so force a total order.
        conn.execute(
            "UPDATE history_step SET created_at = 100 * photo_id + id",
            [],
        )
        .unwrap();

        let drain = |key, ascending| {
            let sort = GridSort { key, ascending };
            let mut seen = Vec::new();
            let mut cursor = None;
            loop {
                let page =
                    db::list_photos_sorted(&conn, cursor, 1, &Default::default(), sort).unwrap();
                seen.extend(page.photos.into_iter().map(|photo| photo.id));
                match page.next {
                    Some(next) => cursor = Some(next),
                    None => return seen,
                }
            }
        };
        // Narrowest → widest: 0.67, 1.0, 1.5.
        assert_eq!(drain(SortKey::Aspect, true), vec![c, a, b]);
        assert_eq!(drain(SortKey::Aspect, false), vec![b, a, c]);
        // Never-edited sorts as 0; b's last step is newer than a's.
        assert_eq!(drain(SortKey::EditTime, true), vec![c, a, b]);
        assert_eq!(drain(SortKey::EditCount, true), vec![c, a, b]);
        assert_eq!(drain(SortKey::EditCount, false), vec![b, a, c]);
    }

    /// A zero height must not divide-by-zero into a NULL sort value — that would
    /// fail every cursor comparison and silently drop the row from later pages.
    #[test]
    fn aspect_sort_survives_zero_height() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();
        conn.execute("UPDATE photo SET height=0 WHERE id=?1", [a])
            .unwrap();

        let sort = GridSort {
            key: SortKey::Aspect,
            ascending: false,
        };
        let first = db::list_photos_sorted(&conn, None, 1, &Default::default(), sort).unwrap();
        assert_eq!(first.photos.iter().map(|p| p.id).collect::<Vec<_>>(), vec![a]);
        let second =
            db::list_photos_sorted(&conn, first.next, 1, &Default::default(), sort).unwrap();
        assert_eq!(
            second.photos.iter().map(|p| p.id).collect::<Vec<_>>(),
            vec![b]
        );
    }

    #[test]
    fn metadata_presets_upsert_and_list() {
        let conn = mem();
        let id = db::add_metadata_preset(&conn, "Studio", r#"{"creator":"Me","copyright":"© 2026"}"#)
            .unwrap();
        db::add_metadata_preset(&conn, "Blank", r#"{"creator":"  "}"#).unwrap();
        // Upsert by name replaces the fields, keeps the id — and the full IPTC
        // set round-trips, not just the creator/copyright projection.
        let id2 = db::add_metadata_preset(
            &conn,
            "Studio",
            r#"{"creator":"Us","copyright":"© 2027","rightsUsageTerms":"Editorial only",
                "creatorEmail":"","keywords":["studio","2027"]}"#,
        )
        .unwrap();
        assert_eq!(id, id2);

        let ps = db::list_metadata_presets(&conn).unwrap();
        assert_eq!(
            ps.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(),
            vec!["Blank", "Studio"]
        );
        let studio = ps.iter().find(|p| p.name == "Studio").unwrap();
        assert_eq!(studio.creator.as_deref(), Some("Us"));
        assert_eq!(studio.copyright.as_deref(), Some("© 2027"));
        assert_eq!(studio.fields["rightsUsageTerms"], "Editorial only");
        // A checked-but-empty field survives as "" (the preset CLEARS it) and
        // an unchecked one stays absent (the preset leaves the photo alone).
        assert_eq!(studio.fields["creatorEmail"], "");
        assert!(studio.fields.get("headline").is_none());
        assert_eq!(studio.fields["keywords"], serde_json::json!(["studio", "2027"]));
        // Blank creator doesn't reach the projection.
        assert!(ps
            .iter()
            .find(|p| p.name == "Blank")
            .unwrap()
            .creator
            .is_none());

        db::delete_metadata_preset(&conn, id).unwrap();
        assert_eq!(db::list_metadata_presets(&conn).unwrap().len(), 1);
    }

    #[test]
    fn metadata_set_normalizes_blanks_and_round_trips() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        assert!(db::get_photo(&conn, a)
            .unwrap()
            .unwrap()
            .iptc
            .copyright
            .is_none());

        db::set_photo_metadata(
            &conn,
            a,
            &PhotoIptc {
                title: some("Sunset"),
                caption: some("   "),
                copyright: some("© 2026 Me"),
                ..Default::default()
            },
        )
        .unwrap();
        let p = db::get_photo(&conn, a).unwrap().unwrap().iptc;
        assert_eq!(p.title.as_deref(), Some("Sunset"));
        assert_eq!(p.caption, None, "blank caption stores as NULL");
        assert_eq!(p.creator, None);
        assert_eq!(p.copyright.as_deref(), Some("© 2026 Me"));

        // Clearing a field (blank) nulls it again.
        db::set_photo_metadata(&conn, a, &PhotoIptc::default()).unwrap();
        assert!(db::get_photo(&conn, a).unwrap().unwrap().iptc.title.is_none());
    }

    #[test]
    fn presets_upsert_by_name_and_list() {
        let conn = mem();
        let id = db::add_preset(&conn, "Punchy", r#"{"version":2}"#, Some(6)).unwrap();
        db::add_preset(&conn, "Bw", r#"{"version":2,"bw":true}"#, Some(6)).unwrap();
        // Re-saving the same name overwrites (same id, new recipe).
        let id2 = db::add_preset(&conn, "Punchy", r#"{"version":2,"v":2}"#, Some(6)).unwrap();
        assert_eq!(id, id2);

        let ps = db::list_presets(&conn).unwrap();
        assert_eq!(
            ps.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(),
            vec!["Bw", "Punchy"]
        );
        assert_eq!(
            ps.iter().find(|p| p.name == "Punchy").unwrap().recipe_json,
            r#"{"version":2,"v":2}"#,
        );

        db::delete_preset(&conn, id).unwrap();
        assert_eq!(db::list_presets(&conn).unwrap().len(), 1);
    }

    #[test]
    fn integrity_check_ok_and_optimize_runs() {
        let conn = mem();
        db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        assert_eq!(db::integrity_check(&conn).unwrap(), "ok");
        db::optimize(&conn).unwrap(); // VACUUM + PRAGMA optimize must not error
        assert_eq!(
            db::count_photos(&conn, &r(0)).unwrap(),
            1,
            "data survives optimize"
        );
    }

    #[test]
    fn backup_copies_a_reopenable_catalog() {
        let dir = std::env::temp_dir().join(format!("galcat-bk-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("src.galcat");
        let dst = dir.join("backup.galcat");
        {
            let conn = db::open(src.to_str().unwrap()).unwrap();
            db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
            db::backup_to(&conn, dst.to_str().unwrap()).unwrap();
        }
        // The backup reopens as a valid catalog with the data.
        let reopened = db::open(dst.to_str().unwrap()).unwrap();
        assert_eq!(db::count_photos(&reopened, &r(0)).unwrap(), 1);
        assert_eq!(db::integrity_check(&reopened).unwrap(), "ok");
        drop(reopened);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn backup_of_in_memory_catalog_errors() {
        let conn = mem();
        assert!(db::backup_to(&conn, "/tmp/never.galcat").is_err());
    }

    // ── Catalog interchange (export a subset / merge another catalog) ────

    /// A scratch dir for the on-disk catalogs interchange needs (VACUUM INTO
    /// and ATTACH both want real files). Named per test so they never collide.
    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("galcat-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A catalog with a rated + developed master, a keyword, a collection
    /// containing it, and a virtual copy — one of each thing a merge remaps.
    fn seeded(path: &std::path::Path) -> (Connection, i64, i64) {
        let conn = db::open(path.to_str().unwrap()).unwrap();
        let a = db::import_photo(&conn, &sample("/shoot/a.cr3", Some(10))).unwrap();
        db::import_photo(&conn, &sample("/shoot/b.cr3", Some(20))).unwrap();
        db::set_flags(&conn, a, 4, 1, Some("red")).unwrap();
        db::set_recipe(&conn, a, r#"{"version":2,"exposure":1.5}"#, Some(6)).unwrap();
        db::add_keyword(&conn, a, "Portrait").unwrap();
        let col = db::create_collection(&conn, "Keepers", "collection", None, None).unwrap();
        db::add_photo_to_collection(&conn, col, a).unwrap();
        let copy = db::create_virtual_copy(&conn, a).unwrap();
        (conn, a, copy)
    }

    #[test]
    fn export_as_catalog_keeps_the_selection_its_master_and_nothing_else() {
        let dir = scratch("export");
        let (conn, a, copy) = seeded(&dir.join("src.galcat"));
        let dest = dir.join("out.galcat");
        // Only the virtual copy is selected: its master has to ride along, or
        // the FK cascade would take the copy with it.
        let kept = db::export_as_catalog(&conn, &[copy], dest.to_str().unwrap()).unwrap();
        assert_eq!(kept, 2, "the copy plus the master it depends on");
        drop(conn);

        let out = db::open(dest.to_str().unwrap()).unwrap();
        assert_eq!(db::integrity_check(&out).unwrap(), "ok");
        assert!(db::get_photo(&out, a).unwrap().is_some(), "master survives");
        assert!(db::get_photo(&out, copy).unwrap().is_some());
        // /shoot/b.cr3 was not selected: neither its photo nor its source row.
        let assets: i64 = out
            .query_row("SELECT COUNT(*) FROM source_asset", [], |r| r.get(0))
            .unwrap();
        assert_eq!(assets, 1, "the unselected photo's source row goes too");
        // The develop work and the vocabulary travel with it.
        assert_eq!(
            db::get_recipe(&out, a).unwrap().unwrap(),
            r#"{"version":2,"exposure":1.5}"#
        );
        assert_eq!(db::list_keywords(&out).unwrap().len(), 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn export_as_catalog_refuses_an_empty_selection() {
        let dir = scratch("export-empty");
        let (conn, _, _) = seeded(&dir.join("src.galcat"));
        assert!(db::export_as_catalog(&conn, &[], dir.join("out.galcat").to_str().unwrap()).is_err());
        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_from_catalog_merges_new_work_and_leaves_ours_alone() {
        let dir = scratch("merge");
        let far = dir.join("far.galcat");
        let (away, _, _) = seeded(&far);
        drop(away);

        // The catalog we merge INTO already has /shoot/a.cr3, rated our way.
        let here = db::open(dir.join("here.galcat").to_str().unwrap()).unwrap();
        let mine = db::import_photo(&here, &sample("/shoot/a.cr3", Some(10))).unwrap();
        db::set_flags(&here, mine, 1, 0, None).unwrap();

        let report = db::import_from_catalog(&here, far.to_str().unwrap(), false, false).unwrap();
        // a.cr3 is the same file → the same photo; b.cr3 and the copy are new.
        assert_eq!(report.photos_added, 2);
        assert_eq!(report.photos_skipped, 1);
        assert_eq!(report.photos_updated, 0);
        assert_eq!(report.collections_added, 1);
        assert_eq!(report.keywords_added, 1);

        // Ours was left exactly as it was — no develop, our rating.
        assert_eq!(db::get_photo(&here, mine).unwrap().unwrap().rating, 1);
        assert!(db::get_recipe(&here, mine).unwrap().is_none());
        // The incoming virtual copy points at OUR master, not a dangling id.
        let master: Option<i64> = here
            .query_row(
                "SELECT master_photo_id FROM photo WHERE is_virtual_copy = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(master, Some(mine));
        // Its keyword and collection membership came across, remapped.
        assert_eq!(
            db::list_collections(&here).unwrap().iter().filter(|c| c.name == "Keepers").count(),
            1
        );
        let members: i64 = here
            .query_row("SELECT COUNT(*) FROM collection_photo", [], |r| r.get(0))
            .unwrap();
        assert_eq!(members, 1, "the collection kept its one member, remapped");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_from_catalog_replaces_on_request_and_a_dry_run_writes_nothing() {
        let dir = scratch("merge-replace");
        let far = dir.join("far.galcat");
        let (away, _, _) = seeded(&far);
        drop(away);

        let here = db::open(dir.join("here.galcat").to_str().unwrap()).unwrap();
        let mine = db::import_photo(&here, &sample("/shoot/a.cr3", Some(10))).unwrap();

        let dry = db::import_from_catalog(&here, far.to_str().unwrap(), true, true).unwrap();
        assert_eq!(dry.photos_added, 2);
        assert_eq!(dry.photos_updated, 1);
        assert_eq!(db::count_photos(&here, &r(0)).unwrap(), 1, "dry run wrote nothing");
        assert!(db::get_recipe(&here, mine).unwrap().is_none());

        let done = db::import_from_catalog(&here, far.to_str().unwrap(), true, false).unwrap();
        assert_eq!(done, dry, "the preview is what actually happens");
        assert_eq!(
            db::get_recipe(&here, mine).unwrap().unwrap(),
            r#"{"version":2,"exposure":1.5}"#,
            "replace takes the incoming develop settings"
        );
        // Re-merging the same catalog is idempotent — nothing is duplicated.
        let again = db::import_from_catalog(&here, far.to_str().unwrap(), true, false).unwrap();
        assert_eq!(again.photos_added, 0);
        assert_eq!(db::count_photos(&here, &r(0)).unwrap(), 3);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_from_catalog_refuses_itself_and_a_non_catalog() {
        let dir = scratch("merge-guard");
        let mine = dir.join("mine.galcat");
        let (here, _, _) = seeded(&mine);
        assert!(
            db::import_from_catalog(&here, mine.to_str().unwrap(), false, false).is_err(),
            "merging a catalog into itself would double it"
        );
        let junk = dir.join("notes.txt");
        std::fs::write(&junk, b"not a database").unwrap();
        assert!(db::import_from_catalog(&here, junk.to_str().unwrap(), false, false).is_err());
        drop(here);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn virtual_copy_shares_source_copies_recipe_and_increments_name() {
        let conn = mem();
        let m = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        db::set_recipe(&conn, m, r#"{"version":2}"#, Some(6)).unwrap();
        let src_asset = db::get_photo(&conn, m).unwrap().unwrap().source_asset_id;

        let c1 = db::create_virtual_copy(&conn, m).unwrap();
        let c2 = db::create_virtual_copy(&conn, m).unwrap();
        assert_ne!(c1, m);
        assert_eq!(
            db::count_photos(&conn, &r(0)).unwrap(),
            3,
            "copies are catalog photos"
        );

        let c1row = db::get_photo(&conn, c1).unwrap().unwrap();
        assert!(c1row.is_virtual_copy);
        assert_eq!(c1row.copy_name.as_deref(), Some("Copy 1"));
        assert_eq!(
            c1row.source_asset_id, src_asset,
            "shares the master's source asset"
        );
        assert_eq!(
            db::get_recipe(&conn, c1).unwrap().as_deref(),
            Some(r#"{"version":2}"#)
        );
        assert_eq!(
            db::get_photo(&conn, c2)
                .unwrap()
                .unwrap()
                .copy_name
                .as_deref(),
            Some("Copy 2"),
        );

        // A copy-of-a-copy roots at the master → "Copy 3", not "Copy 1".
        let c3 = db::create_virtual_copy(&conn, c1).unwrap();
        assert_eq!(
            db::get_photo(&conn, c3)
                .unwrap()
                .unwrap()
                .copy_name
                .as_deref(),
            Some("Copy 3")
        );

        // The copy's develop is independent: editing it leaves the master intact.
        db::set_recipe(&conn, c1, r#"{"version":2,"changed":true}"#, Some(6)).unwrap();
        assert_eq!(
            db::get_recipe(&conn, m).unwrap().as_deref(),
            Some(r#"{"version":2}"#)
        );
    }

    #[test]
    fn set_copy_name_renames_copies_only_and_is_text_searchable() {
        let conn = mem();
        let m = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let c = db::create_virtual_copy(&conn, m).unwrap();

        db::set_copy_name(&conn, c, Some("Black & White")).unwrap();
        let name = |id| db::get_photo(&conn, id).unwrap().unwrap().copy_name;
        assert_eq!(name(c).as_deref(), Some("Black & White"));

        // A master has no copy name — the write is a no-op, not a stamp.
        db::set_copy_name(&conn, m, Some("Nope")).unwrap();
        assert_eq!(name(m), None);

        // Blank clears back to absent (not an empty string).
        db::set_copy_name(&conn, c, Some("  ")).unwrap();
        assert_eq!(name(c), None);

        db::set_copy_name(&conn, c, Some("B&W")).unwrap();
        let text = |target: &str| PhotoFilter {
            text: Some("b&w".into()),
            text_target: Some(target.into()),
            ..Default::default()
        };
        assert_eq!(db::count_photos(&conn, &text("copyName")).unwrap(), 1);
        assert_eq!(db::count_photos(&conn, &text("any")).unwrap(), 1);
        assert_eq!(db::count_photos(&conn, &text("path")).unwrap(), 0);
    }

    #[test]
    fn make_master_photo_swaps_roles_and_rehomes_siblings() {
        let conn = mem();
        let m = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let c1 = db::create_virtual_copy(&conn, m).unwrap();
        let c2 = db::create_virtual_copy(&conn, m).unwrap();
        db::set_copy_name(&conn, c1, Some("B&W")).unwrap();

        db::make_master_photo(&conn, c1).unwrap();
        let row = |id| db::get_photo(&conn, id).unwrap().unwrap();
        // master_photo_id isn't on PhotoRow (the grid never needs it) — read it.
        let master_of = |id: i64| -> Option<i64> {
            conn.query_row(
                "SELECT master_photo_id FROM photo WHERE id=?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap()
        };
        let promoted = row(c1);
        assert!(!promoted.is_virtual_copy);
        assert_eq!(master_of(c1), None);
        assert_eq!(promoted.copy_name, None, "a master carries no copy name");

        // The old master is now a copy of c1, wearing c1's old name.
        let demoted = row(m);
        assert!(demoted.is_virtual_copy);
        assert_eq!(master_of(m), Some(c1));
        assert_eq!(demoted.copy_name.as_deref(), Some("B&W"));
        // The sibling follows the new master instead of dangling at the old one.
        assert_eq!(master_of(c2), Some(c1));

        // Promoting again swaps back; the unnamed side gets the next free
        // "Copy N" — "Copy 2" is still c2's, so it must not be reused.
        db::set_copy_name(&conn, m, None).unwrap();
        db::make_master_photo(&conn, m).unwrap();
        assert_eq!(master_of(m), None);
        assert_eq!(master_of(c2), Some(m));
        assert_eq!(row(c1).copy_name.as_deref(), Some("Copy 3"));

        // A master is not promotable, and nothing is written when it is tried.
        assert!(db::make_master_photo(&conn, m).is_err());
        assert!(!row(m).is_virtual_copy);
    }

    #[test]
    fn duplicate_photos_groups_shared_fingerprints() {
        let conn = mem();
        let mut a = sample("/a.cr3", Some(10));
        a.fingerprint = "dup".into();
        let mut b = sample("/b.cr3", Some(20));
        b.fingerprint = "dup".into();
        let ida = db::import_photo(&conn, &a).unwrap();
        let idb = db::import_photo(&conn, &b).unwrap();
        db::import_photo(&conn, &sample("/c.cr3", Some(30))).unwrap(); // unique fingerprint

        let dups: Vec<i64> = db::duplicate_photos(&conn, 5000, 0)
            .unwrap()
            .iter()
            .map(|p| p.id)
            .collect();
        assert_eq!(dups.len(), 2, "only the shared-fingerprint pair");
        assert!(dups.contains(&ida) && dups.contains(&idb));
    }

    /// PERF-06: collection/keyword/duplicate browses are offset-windowed —
    /// chunked fetches concatenate to the FULL result (photo 2001 exists).
    #[test]
    fn browse_sources_window_by_offset_without_truncation() {
        let conn = mem();
        let col = db::create_collection(&conn, "Big", "collection", None, None).unwrap();
        let mut all: Vec<i64> = Vec::new();
        for i in 0..5 {
            let mut p = sample(&format!("/p{i}.cr3"), Some(100 + i));
            p.fingerprint = "same".into(); // every photo is a duplicate of the rest
            let id = db::import_photo(&conn, &p).unwrap();
            db::add_photo_to_collection(&conn, col, id).unwrap();
            db::add_keyword(&conn, id, "beach").unwrap();
            all.push(id);
        }
        let kw = db::list_keywords(&conn).unwrap()[0].id;

        let drain = |fetch: &dyn Fn(i64, i64) -> Vec<i64>| -> Vec<i64> {
            let mut out = Vec::new();
            let mut offset = 0;
            loop {
                let chunk = fetch(2, offset);
                let short = (chunk.len() as i64) < 2;
                offset += chunk.len() as i64;
                out.extend(chunk);
                if short {
                    return out;
                }
            }
        };
        let ids = |rows: Vec<PhotoRow>| rows.into_iter().map(|p| p.id).collect::<Vec<_>>();

        let col_all = drain(&|l, o| ids(db::list_collection_photos(&conn, col, l, o).unwrap()));
        assert_eq!(
            col_all, all,
            "manual collection: chunks cover every member in order"
        );
        let kw_all = drain(&|l, o| ids(db::list_keyword_photos(&conn, kw, l, o).unwrap()));
        assert_eq!(
            kw_all.len(),
            5,
            "keyword: no photo lost past the chunk size"
        );
        let dup_all = drain(&|l, o| ids(db::duplicate_photos(&conn, l, o).unwrap()));
        assert_eq!(
            dup_all.len(),
            5,
            "duplicates: no photo lost past the chunk size"
        );

        let filename_desc = GridSort {
            key: SortKey::Filename,
            ascending: false,
        };
        let expected = all.iter().rev().copied().collect::<Vec<_>>();
        assert_eq!(
            drain(&|l, o| ids(
                db::list_collection_photos_sorted(&conn, col, l, o, filename_desc).unwrap()
            )),
            expected,
            "collection sort is global across offset chunks"
        );
        assert_eq!(
            drain(&|l, o| ids(
                db::list_keyword_photos_sorted(&conn, kw, l, o, filename_desc).unwrap()
            )),
            expected,
            "keyword sort is global across offset chunks"
        );
        assert_eq!(
            drain(&|l, o| ids(db::duplicate_photos_sorted(&conn, l, o, filename_desc).unwrap())),
            expected,
            "duplicate sort is global across offset chunks"
        );

        let stack = db::stack_photos(&conn, &all).unwrap();
        assert_eq!(
            ids(db::list_stack_sorted(&conn, stack, filename_desc).unwrap()),
            expected,
            "expanded stacks honor the current grid sort"
        );
    }

    #[test]
    fn manual_collection_membership_add_remove_cascade() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();
        let col = db::create_collection(&conn, "Trip", "collection", None, None).unwrap();
        assert!(db::list_collection_photos(&conn, col, 100, 0)
            .unwrap()
            .is_empty());

        db::add_photo_to_collection(&conn, col, a).unwrap();
        db::add_photo_to_collection(&conn, col, b).unwrap();
        db::add_photo_to_collection(&conn, col, a).unwrap(); // idempotent
        let ids: Vec<i64> = db::list_collection_photos(&conn, col, 100, 0)
            .unwrap()
            .iter()
            .map(|p| p.id)
            .collect();
        assert_eq!(ids, vec![a, b], "both members, position order");

        db::remove_photo_from_collection(&conn, col, a).unwrap();
        let ids: Vec<i64> = db::list_collection_photos(&conn, col, 100, 0)
            .unwrap()
            .iter()
            .map(|p| p.id)
            .collect();
        assert_eq!(ids, vec![b]);

        // Deleting the collection cascades its membership rows (photos survive).
        db::delete_collection(&conn, col).unwrap();
        assert!(db::list_collections(&conn).unwrap().is_empty());
        assert_eq!(db::count_photos(&conn, &r(0)).unwrap(), 2);
    }

    #[test]
    fn collection_member_replacement_is_atomic() {
        let conn = mem();
        let old = db::import_photo(&conn, &sample("/old.cr3", Some(10))).unwrap();
        let next = db::import_photo(&conn, &sample("/next.cr3", Some(20))).unwrap();
        let col =
            db::create_collection(&conn, "Previous Import", "collection", None, None).unwrap();
        db::add_photo_to_collection(&conn, col, old).unwrap();

        db::replace_collection_members(&conn, col, &[next, next]).unwrap();
        assert_eq!(
            db::list_collection_photos(&conn, col, 100, 0)
                .unwrap()
                .into_iter()
                .map(|photo| photo.id)
                .collect::<Vec<_>>(),
            vec![next],
        );

        assert!(db::replace_collection_members(&conn, col, &[old, i64::MAX]).is_err());
        assert_eq!(
            db::list_collection_photos(&conn, col, 100, 0)
                .unwrap()
                .into_iter()
                .map(|photo| photo.id)
                .collect::<Vec<_>>(),
            vec![next],
            "failed replacement rolls the deleted membership back",
        );
    }

    #[test]
    fn collection_tree_validates_kind_parent_and_cycles() {
        let conn = mem();
        let root = db::create_collection(&conn, "Portfolio", "set", None, None).unwrap();
        let nested = db::create_collection(&conn, "Clients", "set", Some(root), None).unwrap();
        let manual =
            db::create_collection(&conn, "Acme", "collection", Some(nested), Some("marker"))
                .unwrap();
        let smart = db::create_collection(
            &conn,
            "Five Stars",
            "smart",
            Some(root),
            Some(r#"{"rules":[]}"#),
        )
        .unwrap();

        assert!(db::create_collection(&conn, "Bad", "folder", None, None).is_err());
        assert!(db::create_collection(&conn, "Bad", "collection", Some(manual), None).is_err());
        assert!(db::create_collection(&conn, "Bad", "collection", Some(i64::MAX), None).is_err());
        assert!(
            db::update_collection(&conn, root, "Portfolio", Some(nested), None).is_err(),
            "a set cannot move inside its descendant"
        );

        db::update_collection(&conn, manual, "Acme 2026", Some(root), None).unwrap();
        db::update_collection(
            &conn,
            smart,
            "Picked",
            Some(nested),
            Some(r#"{"rules":[{"field":"flag","op":"eq","value":1}]}"#),
        )
        .unwrap();
        assert!(db::set_collection_rule(&conn, manual, r#"{"rules":[]}"#).is_err());

        let rows = db::list_collections(&conn).unwrap();
        let manual_row = rows.iter().find(|row| row.id == manual).unwrap();
        assert_eq!(manual_row.name, "Acme 2026");
        assert_eq!(manual_row.parent_id, Some(root));
        assert_eq!(manual_row.rule_ast.as_deref(), Some("marker"));
        let smart_row = rows.iter().find(|row| row.id == smart).unwrap();
        assert_eq!(smart_row.name, "Picked");
        assert_eq!(smart_row.parent_id, Some(nested));
        assert!(smart_row.rule_ast.as_deref().unwrap().contains("\"flag\""));
    }

    #[test]
    fn user_order_move_is_atomic_and_keeps_every_member() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();
        let c = db::import_photo(&conn, &sample("/c.cr3", Some(30))).unwrap();
        let col = db::create_collection(&conn, "Sequence", "collection", None, None).unwrap();
        db::replace_collection_members(&conn, col, &[a, b, c]).unwrap();

        conn.execute_batch(&format!(
            "CREATE TRIGGER fail_user_order BEFORE UPDATE OF position ON collection_photo
             WHEN OLD.photo_id = {b}
             BEGIN SELECT RAISE(ABORT, 'blocked'); END;"
        ))
        .unwrap();
        assert!(db::move_collection_members(&conn, col, &[c], -1).is_err());
        assert_eq!(
            db::list_collection_photos(&conn, col, 100, 0)
                .unwrap()
                .into_iter()
                .map(|photo| photo.id)
                .collect::<Vec<_>>(),
            vec![a, b, c],
            "a failed position rewrite rolls the whole order back"
        );

        conn.execute_batch("DROP TRIGGER fail_user_order").unwrap();
        db::move_collection_members(&conn, col, &[c], -1).unwrap();
        assert_eq!(
            db::list_collection_photos(&conn, col, 100, 0)
                .unwrap()
                .into_iter()
                .map(|photo| photo.id)
                .collect::<Vec<_>>(),
            vec![a, c, b]
        );
    }

    #[test]
    fn smart_collection_rule_ast_filters() {
        let conn = mem();
        // a: 5★ EOS R5; b: 2★ EOS R6; c: 5★ EOS R5.
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let mut sb = sample("/b.cr3", Some(20));
        sb.camera_model = Some("EOS R6".into());
        let b = db::import_photo(&conn, &sb).unwrap();
        let c = db::import_photo(&conn, &sample("/c.cr3", Some(30))).unwrap();
        db::set_flags(&conn, a, 5, 0, None).unwrap();
        db::set_flags(&conn, b, 2, 0, None).unwrap();
        db::set_flags(&conn, c, 5, 0, None).unwrap();
        db::add_keyword(&conn, a, "Portrait").unwrap();

        let smart = |ast: &str| -> Vec<i64> {
            let id = db::create_collection(&conn, "S", "smart", None, Some(ast)).unwrap();
            let out = db::list_collection_photos(&conn, id, 100, 0)
                .unwrap()
                .iter()
                .map(|p| p.id)
                .collect();
            db::delete_collection(&conn, id).unwrap();
            out
        };

        // match=all: 5★ AND EOS R5 → a, c (newest-first: c then a).
        assert_eq!(
            smart(
                r#"{"match":"all","rules":[{"field":"rating","op":"gte","value":5},{"field":"camera","op":"eq","value":"EOS R5"}]}"#
            ),
            vec![c, a],
        );
        // match=any: 5★ OR camera=EOS R6 → all three.
        assert_eq!(
            smart(
                r#"{"match":"any","rules":[{"field":"rating","op":"gte","value":5},{"field":"camera","op":"eq","value":"EOS R6"}]}"#
            ),
            vec![c, b, a],
        );
        // keyword membership.
        assert_eq!(
            smart(r#"{"rules":[{"field":"keyword","op":"eq","value":"Portrait"}]}"#),
            vec![a],
        );
        // filename contains.
        assert_eq!(
            smart(r#"{"rules":[{"field":"filename","op":"contains","value":"/b."}]}"#),
            vec![b],
        );
        // Empty rules → all photos (no filter).
        assert_eq!(smart(r#"{"rules":[]}"#).len(), 3);

        // A bad field is a surfaced error, not a silent all/none match.
        assert!(db::create_collection(
            &conn,
            "Bad",
            "smart",
            None,
            Some(r#"{"rules":[{"field":"nope","op":"eq","value":1}]}"#),
        )
        .is_err());
    }

    #[test]
    fn smart_rules_cover_location_size_gps_and_nested_groups() {
        let conn = mem();
        // a: 5★ Paris CR3, GPS + a snapshot, 6000×4000 (24MP), 1 KiB.
        // b: 2★ JPEG with no location, 1000×1000 (1MP), 5 MiB.
        let a = db::import_photo(&conn, &sample("/shoots/paris/a.cr3", Some(10))).unwrap();
        let mut sb = sample("/b.jpg", Some(20));
        sb.format = "jpeg".into();
        sb.width = 1000;
        sb.height = 1000;
        sb.byte_size = 5 * 1024 * 1024;
        let b = db::import_photo(&conn, &sb).unwrap();
        db::set_flags(&conn, a, 5, 0, None).unwrap();
        db::set_flags(&conn, b, 2, 0, None).unwrap();
        db::set_photo_metadata(
            &conn,
            a,
            &PhotoIptc {
                creator: some("Ansel"),
                copyright: some("© Ansel"),
                city: some("Paris"),
                state_province: some("Île-de-France"),
                country: some("France"),
                ..Default::default()
            },
        )
        .unwrap();
        conn.execute(
            "UPDATE photo SET gps_lat=48.85, gps_lon=2.35 WHERE id=?1",
            params![a],
        )
        .unwrap();
        conn.execute(
            "UPDATE photo SET copy_name='Copy 1' WHERE id=?1",
            params![b],
        )
        .unwrap();
        db::add_snapshot(&conn, a, "before", "{}", None).unwrap();

        let smart = |ast: &str| -> Vec<i64> {
            let id = db::create_collection(&conn, "S", "smart", None, Some(ast)).unwrap();
            let out = db::list_collection_photos(&conn, id, 100, 0)
                .unwrap()
                .iter()
                .map(|p| p.id)
                .collect();
            db::delete_collection(&conn, id).unwrap();
            out
        };
        let all = |rules: &str| smart(&format!("{{\"match\":\"all\",\"rules\":{rules}}}"));

        // Location trio.
        assert_eq!(
            all(r#"[{"field":"city","op":"eq","value":"Paris"}]"#),
            vec![a]
        );
        assert_eq!(
            all(r#"[{"field":"state","op":"contains","value":"France"}]"#),
            vec![a]
        );
        assert_eq!(
            all(r#"[{"field":"country","op":"empty","value":null}]"#),
            vec![b]
        );
        // "doesn't contain" keeps rows whose column is NULL — b has no country.
        assert_eq!(
            all(r#"[{"field":"country","op":"notContains","value":"Fran"}]"#),
            vec![b]
        );
        // endsWith over the stored path.
        assert_eq!(
            all(r#"[{"field":"filename","op":"endsWith","value":".jpg"}]"#),
            vec![b]
        );
        // Folder = directory part of the path (trailing slash included).
        assert_eq!(
            all(r#"[{"field":"folder","op":"eq","value":"/shoots/paris/"}]"#),
            vec![a]
        );
        assert_eq!(
            all(r#"[{"field":"folder","op":"startsWith","value":"/shoots"}]"#),
            vec![a]
        );

        // IPTC creator/copyright + virtual-copy name.
        assert_eq!(
            all(r#"[{"field":"creator","op":"eq","value":"Ansel"}]"#),
            vec![a]
        );
        assert_eq!(
            all(r#"[{"field":"copyright","op":"contains","value":"Ansel"}]"#),
            vec![a]
        );
        assert_eq!(
            all(r#"[{"field":"copyName","op":"eq","value":"Copy 1"}]"#),
            vec![b]
        );

        // Size: megapixels / long edge / aspect ratio / byte size.
        assert_eq!(
            all(r#"[{"field":"megapixels","op":"gte","value":20}]"#),
            vec![a]
        );
        assert_eq!(
            all(r#"[{"field":"longEdge","op":"gt","value":2000}]"#),
            vec![a]
        );
        assert_eq!(
            all(r#"[{"field":"aspectRatio","op":"gt","value":1.2}]"#),
            vec![a]
        );
        assert_eq!(
            all(r#"[{"field":"byteSize","op":"gt","value":1048576}]"#),
            vec![b]
        );

        // Exposure time + GPS presence + snapshots + virtual-copy status.
        assert_eq!(
            all(r#"[{"field":"exposureTime","op":"lt","value":0.01}]"#),
            vec![b, a]
        );
        assert_eq!(
            all(r#"[{"field":"hasGps","op":"eq","value":true}]"#),
            vec![a]
        );
        assert_eq!(all(r#"[{"field":"gpsLat","op":"gt","value":48}]"#), vec![a]);
        assert_eq!(
            all(r#"[{"field":"hasSnapshot","op":"eq","value":true}]"#),
            vec![a]
        );
        assert_eq!(
            all(r#"[{"field":"isVirtualCopy","op":"eq","value":false}]"#),
            vec![b, a]
        );

        // Nesting: rating≥2 AND (format=jpeg OR city=Paris) → both; flipping the
        // outer criterion to 5★ leaves only a, which a flat AND/OR can't express.
        let nested = |min: i64| {
            all(&format!(
                r#"[{{"field":"rating","op":"gte","value":{min}}},
                    {{"match":"any","rules":[{{"field":"format","op":"eq","value":"jpeg"}},
                                             {{"field":"city","op":"eq","value":"Paris"}}]}}]"#
            ))
        };
        assert_eq!(nested(2), vec![b, a]);
        assert_eq!(nested(5), vec![a]);

        // A malformed criterion must error, not deserialize as an empty group
        // (which would silently match every photo).
        assert!(db::create_collection(
            &conn,
            "Bad",
            "smart",
            None,
            Some(r#"{"rules":[{"field":"rating","value":1}]}"#),
        )
        .is_err());
    }

    // ── Stacking ──────────────────────────────────────────────────

    #[test]
    fn stack_photos_orders_members_and_sets_cover() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();
        let c = db::import_photo(&conn, &sample("/c.cr3", Some(30))).unwrap();

        // Given order b, c, a — b (first) becomes the cover.
        let stack_id = db::stack_photos(&conn, &[b, c, a]).unwrap();
        let members = db::list_stack(&conn, stack_id).unwrap();
        assert_eq!(
            members.iter().map(|p| p.id).collect::<Vec<_>>(),
            vec![b, c, a]
        );
        assert_eq!(members[0].stack_order, Some(0));
        assert_eq!(members[1].stack_order, Some(1));
        assert_eq!(members[2].stack_order, Some(2));
        assert!(members.iter().all(|p| p.stack_id == Some(stack_id)));
        assert!(members.iter().all(|p| p.stack_count == 3));
    }

    #[test]
    fn stack_photos_rejects_too_few_or_unknown_ids_with_no_partial_write() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        assert!(
            db::stack_photos(&conn, &[a]).is_err(),
            "need at least 2 ids"
        );
        assert!(
            db::stack_photos(&conn, &[a, 999_999]).is_err(),
            "unknown id"
        );
        assert_eq!(
            db::get_photo(&conn, a).unwrap().unwrap().stack_id,
            None,
            "rejected call must not have written anything"
        );
    }

    #[test]
    fn stacking_regroups_members_already_in_another_stack() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();
        let c = db::import_photo(&conn, &sample("/c.cr3", Some(30))).unwrap();
        let d = db::import_photo(&conn, &sample("/d.cr3", Some(40))).unwrap();

        let old_stack = db::stack_photos(&conn, &[a, b]).unwrap();
        // Regroup b into a new stack with c, d — a is left behind alone.
        let new_stack = db::stack_photos(&conn, &[c, d, b]).unwrap();
        assert_ne!(old_stack, new_stack);

        let new_members: Vec<i64> = db::list_stack(&conn, new_stack)
            .unwrap()
            .iter()
            .map(|p| p.id)
            .collect();
        assert_eq!(new_members, vec![c, d, b]);

        // The old stack keeps `a`, now alone: a 1-member stack, not unstacked.
        let old_members = db::list_stack(&conn, old_stack).unwrap();
        assert_eq!(old_members.len(), 1);
        assert_eq!(old_members[0].id, a);
        assert_eq!(old_members[0].stack_id, Some(old_stack));
        assert_eq!(old_members[0].stack_count, 1);
    }

    #[test]
    fn unstack_clears_all_members() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();
        let stack_id = db::stack_photos(&conn, &[a, b]).unwrap();

        db::unstack(&conn, stack_id).unwrap();
        assert!(db::list_stack(&conn, stack_id).unwrap().is_empty());
        let got_a = db::get_photo(&conn, a).unwrap().unwrap();
        assert_eq!(got_a.stack_id, None);
        assert_eq!(got_a.stack_order, None);
        assert_eq!(got_a.stack_count, 1);
    }

    #[test]
    fn set_stack_cover_moves_photo_to_zero_and_renumbers_stably() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();
        let c = db::import_photo(&conn, &sample("/c.cr3", Some(30))).unwrap();
        let stack_id = db::stack_photos(&conn, &[a, b, c]).unwrap();

        db::set_stack_cover(&conn, c).unwrap();
        let members: Vec<i64> = db::list_stack(&conn, stack_id)
            .unwrap()
            .iter()
            .map(|p| p.id)
            .collect();
        // c becomes the cover (0); a, b keep their relative order after it.
        assert_eq!(members, vec![c, a, b]);
    }

    #[test]
    fn split_stack_moves_tail_to_new_stack() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();
        let c = db::import_photo(&conn, &sample("/c.cr3", Some(30))).unwrap();
        let d = db::import_photo(&conn, &sample("/d.cr3", Some(40))).unwrap();
        let stack_id = db::stack_photos(&conn, &[a, b, c, d]).unwrap();

        // Split at c: [a, b] stay; [c, d] become a new stack with c as cover.
        db::split_stack(&conn, c).unwrap();
        let old: Vec<i64> = db::list_stack(&conn, stack_id)
            .unwrap()
            .iter()
            .map(|p| p.id)
            .collect();
        assert_eq!(old, vec![a, b]);
        let got_c = db::get_photo(&conn, c).unwrap().unwrap();
        assert_ne!(got_c.stack_id, Some(stack_id));
        assert_eq!(
            got_c.stack_order,
            Some(0),
            "split photo covers the new stack"
        );
        let new: Vec<i64> = db::list_stack(&conn, got_c.stack_id.unwrap())
            .unwrap()
            .iter()
            .map(|p| p.id)
            .collect();
        assert_eq!(new, vec![c, d]);
    }

    #[test]
    fn split_stack_dissolves_single_member_halves_and_rejects_cover() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();
        let stack_id = db::stack_photos(&conn, &[a, b]).unwrap();

        assert!(
            db::split_stack(&conn, a).is_err(),
            "cover has nothing above it"
        );
        // Splitting a 2-stack leaves two singles — both dissolve.
        db::split_stack(&conn, b).unwrap();
        assert_eq!(db::get_photo(&conn, a).unwrap().unwrap().stack_id, None);
        assert_eq!(db::get_photo(&conn, b).unwrap().unwrap().stack_id, None);
        assert!(db::list_stack(&conn, stack_id).unwrap().is_empty());
        assert!(
            db::split_stack(&conn, a).is_err(),
            "unstacked photo can't split"
        );
    }

    #[test]
    fn move_in_stack_swaps_neighbors_and_stops_at_ends() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();
        let c = db::import_photo(&conn, &sample("/c.cr3", Some(30))).unwrap();
        let stack_id = db::stack_photos(&conn, &[a, b, c]).unwrap();
        let members = |conn: &Connection| -> Vec<i64> {
            db::list_stack(conn, stack_id)
                .unwrap()
                .iter()
                .map(|p| p.id)
                .collect()
        };

        db::move_in_stack(&conn, c, -1).unwrap(); // c up: a b c → a c b
        assert_eq!(members(&conn), vec![a, c, b]);
        db::move_in_stack(&conn, a, 1).unwrap(); // a down: → c a b
        assert_eq!(members(&conn), vec![c, a, b]);
        db::move_in_stack(&conn, c, -1).unwrap(); // cover up: no-op
        db::move_in_stack(&conn, b, 1).unwrap(); // bottom down: no-op
        assert_eq!(members(&conn), vec![c, a, b]);
        assert!(
            db::move_in_stack(&conn, 9999, 1).is_err(),
            "unknown/unstacked photo errors"
        );
    }

    #[test]
    fn expand_stacks_filter_lists_every_member() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();
        let c = db::import_photo(&conn, &sample("/c.cr3", Some(30))).unwrap();
        db::stack_photos(&conn, &[a, b]).unwrap();

        let collapsed = PhotoFilter::default();
        let ids: Vec<i64> = db::list_photos(&conn, None, 10, &collapsed)
            .unwrap()
            .photos
            .iter()
            .map(|p| p.id)
            .collect();
        assert_eq!(ids, vec![c, a], "collapsed: covers only, newest first");

        let expanded = PhotoFilter {
            expand_stacks: true,
            ..Default::default()
        };
        let ids: Vec<i64> = db::list_photos(&conn, None, 10, &expanded)
            .unwrap()
            .photos
            .iter()
            .map(|p| p.id)
            .collect();
        assert_eq!(ids, vec![c, b, a], "expanded: members list in place");
        assert_eq!(db::count_photos(&conn, &expanded).unwrap(), 3);
    }

    #[test]
    fn set_stack_cover_errors_when_unstacked() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        assert!(db::set_stack_cover(&conn, a).is_err());
    }

    #[test]
    fn list_photos_collapses_stack_members_across_pagination_boundary() {
        let conn = mem();
        let e = db::import_photo(&conn, &sample("/e.cr3", Some(50))).unwrap();
        let d = db::import_photo(&conn, &sample("/d.cr3", Some(40))).unwrap();
        let c = db::import_photo(&conn, &sample("/c.cr3", Some(30))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        // Stack d (cover) + c: c must collapse out of list_photos/count_photos.
        let stack_id = db::stack_photos(&conn, &[d, c]).unwrap();

        assert_eq!(
            db::count_photos(&conn, &r(0)).unwrap(),
            4,
            "c collapses into d"
        );

        let page1 = db::list_photos(&conn, None, 2, &r(0)).unwrap();
        assert_eq!(
            page1.photos.iter().map(|p| p.id).collect::<Vec<_>>(),
            vec![e, d]
        );
        assert_eq!(page1.photos[1].stack_count, 2);
        let cursor = page1.next.expect("more pages beyond the stack");

        // Crossing the collapse boundary: the cursor sits at d (sort_time 40);
        // the excluded member c (sort_time 30) must be skipped, not returned
        // and not dropped from the walk.
        let page2 = db::list_photos(&conn, Some(cursor), 2, &r(0)).unwrap();
        assert_eq!(
            page2.photos.iter().map(|p| p.id).collect::<Vec<_>>(),
            vec![b, a]
        );
        assert!(page2.next.is_none());
        assert_eq!(page2.photos[0].stack_count, 1);

        // list_stack still returns every member, uncollapsed, in stack order.
        let members: Vec<i64> = db::list_stack(&conn, stack_id)
            .unwrap()
            .iter()
            .map(|p| p.id)
            .collect();
        assert_eq!(members, vec![d, c]);
    }

    #[test]
    fn auto_stack_respects_gap_boundary_exactly() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(0))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(10))).unwrap(); // gap 10 == boundary: groups
        let c = db::import_photo(&conn, &sample("/c.cr3", Some(21))).unwrap(); // gap 11 > boundary: breaks

        let created = db::auto_stack(&conn, 10).unwrap();
        assert_eq!(created, 1, "only a+b qualify; c is a lone run");

        let a_row = db::get_photo(&conn, a).unwrap().unwrap();
        let b_row = db::get_photo(&conn, b).unwrap().unwrap();
        let c_row = db::get_photo(&conn, c).unwrap().unwrap();
        assert!(a_row.stack_id.is_some());
        assert_eq!(a_row.stack_id, b_row.stack_id);
        assert_eq!(a_row.stack_order, Some(0), "earliest is cover");
        assert_eq!(b_row.stack_count, 2);
        assert_eq!(c_row.stack_id, None, "lone run doesn't qualify");
    }

    #[test]
    fn auto_stack_skips_already_stacked_photos() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(0))).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", Some(5))).unwrap();
        let c = db::import_photo(&conn, &sample("/c.cr3", Some(10))).unwrap();
        let pre_stack = db::stack_photos(&conn, &[a, b]).unwrap();

        // a,b are already stacked (excluded from candidates); c is unstacked
        // but has no unstacked partner within the gap, so no new stack forms.
        let created = db::auto_stack(&conn, 100).unwrap();
        assert_eq!(created, 0);
        assert_eq!(
            db::get_photo(&conn, a).unwrap().unwrap().stack_id,
            Some(pre_stack),
            "pre-existing stack is untouched"
        );
        assert_eq!(db::get_photo(&conn, c).unwrap().unwrap().stack_id, None);
    }

    #[test]
    fn auto_stack_groups_null_capture_photos_via_sort_time_fallback() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", None)).unwrap();
        let b = db::import_photo(&conn, &sample("/b.cr3", None)).unwrap();
        // Both fall back to added_time already; pin sort_time directly so the
        // gap check is deterministic instead of racing the wall clock.
        conn.execute("UPDATE photo SET sort_time=1000 WHERE id=?1", params![a])
            .unwrap();
        conn.execute("UPDATE photo SET sort_time=1005 WHERE id=?1", params![b])
            .unwrap();
        assert_eq!(db::get_photo(&conn, a).unwrap().unwrap().capture_time, None);

        let created = db::auto_stack(&conn, 10).unwrap();
        assert_eq!(created, 1);
        let a_row = db::get_photo(&conn, a).unwrap().unwrap();
        let b_row = db::get_photo(&conn, b).unwrap().unwrap();
        assert_eq!(a_row.stack_id, b_row.stack_id);
        assert_eq!(
            a_row.stack_order,
            Some(0),
            "earlier sort_time is cover despite null capture_time"
        );
    }

    #[test]
    fn auto_stack_rejects_nonpositive_gap() {
        let conn = mem();
        assert!(db::auto_stack(&conn, 0).is_err());
        assert!(db::auto_stack(&conn, -5).is_err());
    }

    #[test]
    fn list_source_paths_reports_missing_flags() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        db::import_photo(&conn, &sample("/b.cr3", Some(20))).unwrap();
        let src_a: i64 = conn
            .query_row(
                "SELECT source_asset_id FROM photo WHERE id=?1",
                params![a],
                |r| r.get(0),
            )
            .unwrap();
        db::mark_missing(&conn, src_a, true).unwrap();

        let rows = db::list_source_paths(&conn).unwrap();
        assert_eq!(rows.len(), 2);
        let row_a = rows.iter().find(|r| r.path == "/a.cr3").unwrap();
        assert!(row_a.missing);
        assert!(!rows.iter().find(|r| r.path == "/b.cr3").unwrap().missing);
        assert_eq!(db::count_missing(&conn).unwrap(), 1);
    }

    #[test]
    fn mark_missing_flips_and_bad_id_errors() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let src_a: i64 = conn
            .query_row(
                "SELECT source_asset_id FROM photo WHERE id=?1",
                params![a],
                |r| r.get(0),
            )
            .unwrap();
        db::mark_missing(&conn, src_a, true).unwrap();
        assert_eq!(db::count_missing(&conn).unwrap(), 1);
        db::mark_missing(&conn, src_a, false).unwrap();
        assert_eq!(db::count_missing(&conn).unwrap(), 0);
        assert!(db::mark_missing(&conn, 999_999, true).is_err());
    }

    #[test]
    fn relink_matching_fingerprint_updates_path_and_clears_missing() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let src_a: i64 = conn
            .query_row(
                "SELECT source_asset_id FROM photo WHERE id=?1",
                params![a],
                |r| r.get(0),
            )
            .unwrap();
        db::mark_missing(&conn, src_a, true).unwrap();

        // sample()'s fingerprint is "fp-{path}"; relink to the SAME content elsewhere.
        db::relink(&conn, src_a, "/moved/a.cr3", "fp-/a.cr3").unwrap();
        let row = db::list_source_paths(&conn).unwrap();
        let r = row.iter().find(|r| r.source_asset_id == src_a).unwrap();
        assert_eq!(r.path, "/moved/a.cr3");
        assert!(!r.missing);
        assert_eq!(db::count_missing(&conn).unwrap(), 0);
    }

    #[test]
    fn relink_mismatched_fingerprint_is_rejected_without_mutation() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let src_a: i64 = conn
            .query_row(
                "SELECT source_asset_id FROM photo WHERE id=?1",
                params![a],
                |r| r.get(0),
            )
            .unwrap();
        db::mark_missing(&conn, src_a, true).unwrap();

        assert!(db::relink(&conn, src_a, "/moved/other.cr3", "fp-different").is_err());
        let r = db::list_source_paths(&conn).unwrap();
        let row = r.iter().find(|r| r.source_asset_id == src_a).unwrap();
        assert_eq!(row.path, "/a.cr3"); // unchanged
        assert!(row.missing); // still missing
        assert!(db::relink(&conn, 999_999, "/x.cr3", "fp").is_err());
    }

    #[test]
    fn reimport_of_a_missing_path_clears_its_missing_flag() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let src_a: i64 = conn
            .query_row(
                "SELECT source_asset_id FROM photo WHERE id=?1",
                params![a],
                |r| r.get(0),
            )
            .unwrap();
        db::mark_missing(&conn, src_a, true).unwrap();
        assert_eq!(db::count_missing(&conn).unwrap(), 1);

        // Re-finding the file (re-import by same path) un-flags it.
        db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        assert_eq!(db::count_missing(&conn).unwrap(), 0);
    }

    // ── The universal container (design doc 11) ──────────────

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "galerie-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A Rythme document: a time container with no catalog anywhere in it.
    fn rythme_container() -> monet_format::container::Container {
        let mut doc = monet_format::container::Container::new(
            monet_format::container::ContainerApp::new("monet-rythme", "0.1.0"),
            monet_format::container::KIND_TIME,
        );
        doc.set("timeline.json", "time", br#"{"tracks":[]}"#.to_vec())
            .unwrap();
        doc.set("audio/take-1.wav", "audio", vec![7u8; 64]).unwrap();
        doc
    }

    /// Rule 1: another app's container is not an error — it is a document with
    /// no catalog in it, and every entry Galerie skipped is named out loud.
    #[test]
    fn a_container_with_no_database_opens_as_nothing_galerie_understands() {
        let bytes = rythme_container().to_bytes().unwrap();
        let (report, has_db) = inspect_container(&bytes).unwrap();
        assert!(!has_db);
        assert_eq!(report.schema_version, None);
        assert_eq!(report.app, "monet-rythme");
        assert_eq!(report.kind, "time");
        assert_eq!(
            report.ignored,
            vec!["timeline.json (time)", "audio/take-1.wav (audio)"]
        );
        // …and a file that is not a container at all still fails loudly.
        assert!(inspect_container(b"not a zip").is_err());
    }

    /// Rule 2, end to end: re-saving someone else's container couriers every
    /// entry Galerie never read, byte-for-byte, and leaves their `kind` alone —
    /// and the catalog it wrote comes back out as a live database.
    #[test]
    fn saving_into_another_apps_container_couriers_it_and_round_trips_the_catalog() {
        let dir = temp_dir("container-courier");
        let source = dir.join("session.mryt");
        let original = rythme_container();
        std::fs::write(&source, original.to_bytes().unwrap()).unwrap();

        let conn = db::open(dir.join("live.galcat").to_str().unwrap()).unwrap();
        let photo = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();

        // "Save As" to a NEW path: the source archive follows the document.
        let target = dir.join("out.mgal");
        write_container_snapshot(&conn, &target, Some(&source), DB_ENTRY, "time").unwrap();

        let saved =
            monet_format::container::Container::parse(&std::fs::read(&target).unwrap()).unwrap();
        assert_eq!(saved.get("timeline.json"), original.get("timeline.json"));
        assert_eq!(
            saved.get("audio/take-1.wav"),
            original.get("audio/take-1.wav")
        );
        assert_eq!(saved.manifest.kind, "time"); // NOT relabelled "catalog"
        assert_eq!(saved.manifest.app.name, "monet-galerie"); // who wrote it last
        assert!(saved.get(DB_ENTRY).is_some());

        // …and the snapshot is a real catalog, not just bytes at a path.
        let reopened =
            monet_db::container::open_from_container(&target, &dir.join("working")).unwrap();
        let live = db::open(reopened.working.to_str().unwrap()).unwrap();
        assert_eq!(db::version(&live).unwrap(), SCHEMA_VERSION);
        let page = db::list_photos(&live, None, 10, &r(0)).unwrap();
        assert_eq!(page.photos.len(), 1);
        assert_eq!(page.photos[0].id, photo);
        assert_eq!(reopened.entry, DB_ENTRY);
        assert_eq!(reopened.kind, "time");

        drop(live);
        drop(reopened);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A live `.galcat` has no container around it: "Save As .mgal" from one is
    /// a brand-new catalog container.
    #[test]
    fn saving_a_bare_catalog_writes_a_fresh_catalog_container() {
        let dir = temp_dir("container-fresh");
        let conn = db::open(dir.join("live.galcat").to_str().unwrap()).unwrap();
        db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();

        let target = dir.join("new.mgal");
        write_container_snapshot(
            &conn,
            &target,
            None,
            DB_ENTRY,
            monet_format::container::KIND_CATALOG,
        )
        .unwrap();

        let saved =
            monet_format::container::Container::parse(&std::fs::read(&target).unwrap()).unwrap();
        assert_eq!(saved.manifest.kind, "catalog");
        assert_eq!(saved.manifest.entries.len(), 1);
        assert_eq!(saved.manifest.entries[0].path, DB_ENTRY);
        assert_eq!(saved.manifest.entries[0].role, "database");

        let (report, has_db) = inspect_container(&std::fs::read(&target).unwrap()).unwrap();
        assert!(has_db);
        assert!(report.ignored.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn photo_row_missing_round_trips_through_list_photos() {
        let conn = mem();
        let a = db::import_photo(&conn, &sample("/a.cr3", Some(10))).unwrap();
        let src_a: i64 = conn
            .query_row(
                "SELECT source_asset_id FROM photo WHERE id=?1",
                params![a],
                |r| r.get(0),
            )
            .unwrap();
        db::mark_missing(&conn, src_a, true).unwrap();
        let page = db::list_photos(&conn, None, 10, &r(0)).unwrap();
        assert!(page.photos.iter().find(|p| p.id == a).unwrap().missing);
    }
}
