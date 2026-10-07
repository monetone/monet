// ─────────────────────────────────────────────────────────────
// wasm — wasm-bindgen JS bindings for the `.monet` project format (the `format`
// half). Compiled only under the `wasm` feature; `wasm-pack build --features
// wasm` packages these for the app frontends (Cinema, Rythme, …).
//
// Only the real algorithms cross the boundary — parse / serialize / timeBase
// conversion. The trivial object helpers (createFile / getData / setData) stay
// as JS in the `@monet-ui/monet-format` wrapper. The importer half is pure Rust
// (the Vision engine binds its own wasm), so it is not re-exported here.
// ─────────────────────────────────────────────────────────────

use crate::container::{self, Container, Manifest};
use crate::format;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// Serialize Rust → JS using plain objects (not `Map`) so `data.cinema` works.
fn serializer() -> serde_wasm_bindgen::Serializer {
    serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true)
}

/// Parse + validate a `.monet` JSON string into a `MonetFile` JS object.
/// Throws (rejects) with the format error message on bad input.
#[wasm_bindgen(js_name = parse)]
pub fn parse(json: &str) -> Result<JsValue, JsValue> {
    let file = format::parse(json).map_err(|e| JsValue::from_str(&e.0))?;
    file.serialize(&serializer())
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Serialize a `MonetFile` JS object to pretty `.monet` JSON.
#[wasm_bindgen(js_name = serialize)]
pub fn serialize(file: JsValue) -> Result<String, JsValue> {
    let file: format::MonetFile =
        serde_wasm_bindgen::from_value(file).map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(format::serialize(&file))
}

// ─────────────────────────────────────────────────────────────
// container — the ONE Monet document container, over the same bridge.
//
// JS sees `{ manifest, entries: [{ path, data: Uint8Array }] }`: the WHOLE
// container, always. That is the courier rule (design doc 11 rule 2) made
// structural — a reader that hands the object back to `writeContainer` cannot
// drop another app's entries, because it never had a way to leave them out.
// ─────────────────────────────────────────────────────────────

/// `Vec<u8>` serializes as a JS array of numbers by default; `serialize_bytes`
/// gets a `Uint8Array` instead, without pulling in `serde_bytes`.
fn as_bytes<S: serde::Serializer>(data: &&[u8], s: S) -> Result<S::Ok, S::Error> {
    s.serialize_bytes(data)
}

#[derive(Serialize)]
struct JsEntry<'a> {
    path: &'a str,
    #[serde(serialize_with = "as_bytes")]
    data: &'a [u8],
}

/// The manifest crosses as JSON TEXT, not as a JS object: serde-wasm-bindgen
/// THROWS on an integer beyond 2^53 (a foreign writer's 64-bit id, content hash
/// or nanosecond timestamp), which would make that whole document unopenable
/// from JS — the opposite of rule 3. The TS wrapper `JSON.parse`s it, so the
/// typed surface is unchanged.
// ponytail: THE JS NUMBER CEILING, stated in full — an unknown manifest NUMBER
// is not couriered byte-for-byte across this lane, because `JSON.parse` puts it
// in an f64 and `JSON.stringify` re-prints it from there. Two ways that shows:
// an integer past 2^53 comes back rounded (…993 → …992) and RE-SAVES rounded,
// and a float whose JS text form differs loses that form (`24.0` → `24`,
// `1e2` → `100`). Values are semantically equal in the float case and altered
// in the integer one; the pure-Rust lane (`Container`) keeps both exactly.
// Fixing it needs a BigInt/raw-number-aware JSON parser AND printer on the TS
// side — add one only if a writer ever depends on it. Also in
// docs/plans/11-universal-container.md §"Known limits".
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JsContainer<'a> {
    manifest_json: String,
    entries: Vec<JsEntry<'a>>,
}

#[derive(Deserialize)]
struct InEntry {
    path: String,
    data: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InContainer {
    manifest_json: String,
    entries: Vec<InEntry>,
}

/// Parse container bytes into `{ manifestJson, entries }`. Throws with the parse
/// error on anything that is not a Monet container.
#[wasm_bindgen(js_name = readContainer)]
pub fn read_container(bytes: &[u8]) -> Result<JsValue, JsValue> {
    let container = Container::parse(bytes).map_err(|e| JsValue::from_str(&e))?;
    let manifest_json = serde_json::to_string(&container.manifest)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    JsContainer {
        manifest_json,
        entries: container
            .entries()
            .iter()
            .map(|(path, data)| JsEntry { path, data })
            .collect(),
    }
    .serialize(&serializer())
    .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Serialize `{ manifestJson, entries }` back to container bytes — `manifest.json`
/// first, then every entry in order. Goes through `Container::from_parts`, so
/// the reserved-path refusal and the 4 GB refusal apply on the JS write path
/// exactly as they do in Rust.
#[wasm_bindgen(js_name = writeContainer)]
pub fn write_container(value: JsValue) -> Result<Vec<u8>, JsValue> {
    let input: InContainer =
        serde_wasm_bindgen::from_value(value).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let manifest: Manifest = serde_json::from_str(&input.manifest_json)
        .map_err(|e| JsValue::from_str(&format!("{}: {e}", container::MANIFEST_PATH)))?;
    let entries = input.entries.into_iter().map(|e| (e.path, e.data)).collect();
    Container::from_parts(manifest, entries)
        .and_then(|c| c.to_bytes())
        .map_err(|e| JsValue::from_str(&e))
}

/// Sniff: is this a Monet container (vs. a bare-JSON `.monet`, a foreign zip)?
#[wasm_bindgen(js_name = isContainer)]
pub fn is_container(bytes: &[u8]) -> bool {
    container::is_container(bytes)
}

/// Convert a sequence's timeBase, returning a new `MonetSequence` JS object
/// (domain `data` bags preserved verbatim).
#[wasm_bindgen(js_name = convertSequenceTimeBase)]
pub fn convert_sequence_time_base(seq: JsValue, to: JsValue) -> Result<JsValue, JsValue> {
    let seq: format::MonetSequence =
        serde_wasm_bindgen::from_value(seq).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let to: format::TimeBase =
        serde_wasm_bindgen::from_value(to).map_err(|e| JsValue::from_str(&e.to_string()))?;
    format::convert_sequence_time_base(&seq, &to)
        .serialize(&serializer())
        .map_err(|e| JsValue::from_str(&e.to_string()))
}
