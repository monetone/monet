// ─────────────────────────────────────────────────────────────
// format::schema — the universal `.monet` project document schema.
//
// Ported 1:1 from the former TypeScript `schema.ts`. Design:
//  • SELF-DESCRIBING TIME per sequence (`time_base`: frames+fps | seconds).
//  • SHARED TIMING BACKBONE on every clip (id/start/duration/in_point/speed/enabled),
//    matching monet-timeline's `TimelineClip`.
//  • NAMESPACED `data.<app>` bags (arbitrary JSON) carry per-app payload; a
//    non-owning app preserves foreign namespaces verbatim (lossless round-trip).
//
// FORWARD-COMPAT: every struct carries a flattened `extra` map, so unknown
// fields (a future minor schema, a foreign writer) survive a round-trip verbatim
// rather than being dropped — matching the old TS passthrough.
//
// JSON is camelCase (`#[serde(rename_all = "camelCase")]`); absent optionals are
// omitted (`skip_serializing_if`), matching `JSON.stringify`'s undefined-elision.
// Whole numbers may serialize as `24.0` (serde `f64`) rather than `24` — the same
// value, re-parses identically; only the textual form differs from the old JS.
// An explicit `null` on a typed optional deserializes to None (so re-serializes
// as absent); the schema defines null ≡ absent for `end`/`embed`/`activeSequenceId`.
// ─────────────────────────────────────────────────────────────

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub const MONET_FORMAT: &str = "monet";
pub const SCHEMA_VERSION: u32 = 1;

/// Per-entity namespaced payload bag, e.g. `{ "cinema": {…}, "rythme": {…} }`.
pub type DataBag = Value;

/// Captured unknown JSON fields, preserved verbatim across a round-trip.
pub type Extra = Map<String, Value>;

fn default_one() -> f64 {
    1.0
}
fn default_true() -> bool {
    true
}
fn default_untitled() -> String {
    "Untitled".to_string()
}

/// Per-sequence time unit. Serializes as `{"kind":"frames","fps":24}` / `{"kind":"seconds"}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum TimeBase {
    Frames { fps: f64 },
    Seconds,
}

/// A duration expressed in either unit (whichever the source knows).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonetDuration {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frames: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fps: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seconds: Option<f64>,
    #[serde(flatten)]
    pub extra: Extra,
}

/// `path` XOR `embed` (embedded PCM/bytes).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSource {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embed: Option<Value>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonetMedia {
    pub id: String,
    pub name: String,
    /// "video" | "audio" | "image" | "color" (open string for forward-compat).
    pub kind: String,
    pub source: MediaSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<MonetDuration>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_audio: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<DataBag>,
    #[serde(flatten)]
    pub extra: Extra,
}

/// A clip: the shared timing backbone + a namespaced domain `data` bag.
/// (Backbone fields mirror monet-timeline's `TimelineClip`.) `in_point`/`speed`/
/// `enabled` default (0 / 1 / true) so minimal clips — e.g. audio, which the
/// timeline model notes "have no in-point/speed/enabled" — still load.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonetClip {
    pub id: String,
    pub start: f64,
    pub duration: f64,
    #[serde(default)]
    pub in_point: f64,
    #[serde(default = "default_one")]
    pub speed: f64,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<DataBag>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonetTrack {
    pub id: String,
    /// "video" | "audio".
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locked: Option<bool>,
    pub clips: Vec<MonetClip>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<DataBag>,
    #[serde(flatten)]
    pub extra: Extra,
}

/// Unit-independent sequence configuration (video + audio fields coexist).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonetSequenceSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sample_rate: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tempo: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_signature: Option<[f64; 2]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub master_gain_db: Option<f64>,
    /// Total length, in the sequence's `time_base` units.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonetMarker {
    /// In the sequence's `time_base` units.
    pub time: f64,
    /// Region end (audio) or absent for a cue point.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<DataBag>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonetSequence {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub time_base: TimeBase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings: Option<MonetSequenceSettings>,
    pub tracks: Vec<MonetTrack>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub markers: Option<Vec<MonetMarker>>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonetDefaults {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fps: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sample_rate: Option<f64>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonetDocument {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    // `parse` is lenient like the old TS normalizeDocument: a document missing
    // name/media/sequences gets "Untitled"/[]/[] rather than failing.
    #[serde(default = "default_untitled")]
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub defaults: Option<MonetDefaults>,
    #[serde(default)]
    pub media: Vec<MonetMedia>,
    #[serde(default)]
    pub sequences: Vec<MonetSequence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_sequence_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<DataBag>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppInfo {
    /// e.g. "monet-cinema" | "monet-rythme" (open string).
    pub name: String,
    pub version: String,
    #[serde(flatten)]
    pub extra: Extra,
}

/// The top-level `.monet` file envelope.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonetFile {
    pub format: String,
    pub schema_version: u32,
    pub app: AppInfo,
    pub document: MonetDocument,
    #[serde(flatten)]
    pub extra: Extra,
}
