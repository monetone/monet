// ─────────────────────────────────────────────────────────────
// format::serialize — `.monet` envelope (de)serialization + validation + the
// namespaced data-bag accessors. Ported from `serialize.ts`.
// ─────────────────────────────────────────────────────────────

use serde_json::Value;

use super::schema::{
    AppInfo, DataBag, MonetDefaults, MonetDocument, MonetFile, MONET_FORMAT, SCHEMA_VERSION,
};

/// Error parsing/validating a `.monet` file. Mirrors the TS `MonetFormatError`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MonetFormatError(pub String);

impl std::fmt::Display for MonetFormatError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl std::error::Error for MonetFormatError {}

/// Wrap a document in the current envelope.
pub fn create_file(document: MonetDocument, app: AppInfo) -> MonetFile {
    MonetFile {
        format: MONET_FORMAT.to_string(),
        schema_version: SCHEMA_VERSION,
        app,
        document,
        extra: Default::default(),
    }
}

/// Serialize a `.monet` file to pretty (2-space) JSON, matching `JSON.stringify(_, null, 2)`.
pub fn serialize(file: &MonetFile) -> String {
    serde_json::to_string_pretty(file).expect("MonetFile is always serializable")
}

/// Parse + validate a `.monet` file. Rejects a non-monet payload and a
/// future-major schema; fills document defaults and repairs a dangling
/// active-sequence pointer.
pub fn parse(json: &str) -> Result<MonetFile, MonetFormatError> {
    let mut raw: Value = serde_json::from_str(json)
        .map_err(|e| MonetFormatError(format!("not valid JSON: {e}")))?;

    // Validate the envelope on the raw value first (so we can give the TS-shaped
    // errors before typed deserialization).
    {
        let obj = raw
            .as_object()
            .ok_or_else(|| MonetFormatError("empty document".to_string()))?;
        let format_ok = matches!(obj.get("format"), Some(Value::String(s)) if s == MONET_FORMAT);
        if !format_ok {
            let f = obj.get("format").cloned().unwrap_or(Value::Null);
            return Err(MonetFormatError(format!("not a .monet file (format={f})")));
        }
        // Like the old TS: a non-number schemaVersion falls back to the current
        // version; only a numeric version GREATER than supported is rejected.
        let version = obj
            .get("schemaVersion")
            .and_then(Value::as_u64)
            .unwrap_or(SCHEMA_VERSION as u64);
        if version > SCHEMA_VERSION as u64 {
            return Err(MonetFormatError(format!(
                "schemaVersion {version} is newer than supported ({SCHEMA_VERSION}); update the app"
            )));
        }
    }

    // migrate (no-op at v1): coerce schemaVersion to the current numeric version
    // so a string/null/absent value deserializes into the typed `u32` field.
    if let Some(obj) = raw.as_object_mut() {
        obj.insert("schemaVersion".to_string(), Value::from(SCHEMA_VERSION));
    }

    let mut file: MonetFile = serde_json::from_value(raw)
        .map_err(|e| MonetFormatError(format!("invalid .monet document: {e}")))?;
    file.document = normalize_document(file.document);
    Ok(file)
}

/// Fill document defaults and repair a dangling active-sequence pointer
/// (mirrors the TS `normalizeDocument`).
fn normalize_document(mut d: MonetDocument) -> MonetDocument {
    if d.defaults.is_none() {
        d.defaults = Some(MonetDefaults::default());
    }
    let active_is_valid = d
        .active_sequence_id
        .as_ref()
        .is_some_and(|id| d.sequences.iter().any(|s| &s.id == id));
    if !d.sequences.is_empty() && !active_is_valid {
        d.active_sequence_id = Some(d.sequences[0].id.clone());
    }
    d
}

// ── namespaced data-bag accessors ─────────────────────────────

/// Read an entity's payload for `app` (e.g. "cinema"); an empty object if absent.
pub fn get_data(data: Option<&DataBag>, app: &str) -> Value {
    data.and_then(|d| d.get(app))
        .cloned()
        .unwrap_or_else(|| Value::Object(serde_json::Map::new()))
}

/// Set an entity's payload for `app`, preserving other namespaces.
pub fn set_data(data: &mut Option<DataBag>, app: &str, payload: Value) {
    match data {
        Some(Value::Object(map)) => {
            map.insert(app.to_string(), payload);
        }
        _ => {
            let mut map = serde_json::Map::new();
            map.insert(app.to_string(), payload);
            *data = Some(Value::Object(map));
        }
    }
}
