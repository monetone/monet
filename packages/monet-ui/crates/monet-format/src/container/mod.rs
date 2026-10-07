// ─────────────────────────────────────────────────────────────
// container — the ONE Monet document container (design doc 11).
//
// A STORE-only ZIP whose FIRST entry is `manifest.json`. Only the extension and
// the entries inside differ per app, so every app opens every extension and
// dispatch is on the manifest's `kind`/`role`, never on the file name.
//
// It lives here, not in the render engine, because jouer/anime/rythme do not
// link the engine — one implementation, seven consumers. The engine's graphics
// writer builds a `Container` from here, so the bytes are shared, not merely
// similar.
//
// The three rules (design doc 11 §"The four rules") show up in the API:
//   1. open what you understand — `role()` returns None instead of erroring, an
//      unknown `kind`/`role` is just a string, and a manifest field nothing
//      dispatches on (a missing `app.version`) never fails the open.
//   2. COURIER EVERYTHING ELSE — `parse` keeps every entry as raw bytes and
//      `to_bytes` writes every one of them back verbatim, so an app that
//      replaces only what it owns (`set`) cannot destroy another app's work.
//      This is the rule the whole design rests on.
//   3. additive only — unknown manifest fields land in `extra` and are
//      re-emitted; a strictly newer `schemaVersion` is rejected, not guessed.
// ─────────────────────────────────────────────────────────────

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::format::{Extra, MONET_FORMAT};

/// The reserved first zip entry. Its presence is the container sniff.
pub const MANIFEST_PATH: &str = "manifest.json";

// Metadata is parsed into a second in-memory tree, so bound it independently
// from payloads (which may legitimately be multi-GB Galerie catalogs).
const MAX_MANIFEST_BYTES: usize = 16 * 1024 * 1024;

/// The CONTAINER's wire version. Deliberately its OWN constant: the container
/// and the `.monet` envelope are independent formats that happen to both be at
/// 1 today, and bumping one must not silently bump the other.
pub const CONTAINER_SCHEMA_VERSION: u32 = 1;

/// `kind` — the primary payload class a container carries.
pub const KIND_GRAPHICS: &str = "graphics";
pub const KIND_TIME: &str = "time";
pub const KIND_CATALOG: &str = "catalog";
pub const KIND_SCENE: &str = "scene";

/// Where a container's graphics document lives (design doc 11 table).
pub const GRAPHICS_ENTRY: &str = "graphics.json";

/// Who wrote a container last. Container-local, and every field defaults:
/// a manifest is metadata nothing dispatches on, so a foreign writer that omits
/// `version` (or `app` entirely) must still open everywhere (rule 1). The
/// `.monet` envelope's stricter `format::AppInfo` is a different wire format and
/// is left alone.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
pub struct ContainerApp {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version: String,
    /// Forward-compat: unknown app fields round-trip verbatim.
    #[serde(flatten)]
    pub extra: Extra,
}

impl ContainerApp {
    pub fn new(name: &str, version: &str) -> ContainerApp {
        ContainerApp {
            name: name.to_string(),
            version: version.to_string(),
            extra: Map::new(),
        }
    }
}

/// One manifest entry. `role` is what a reader dispatches on; an unknown `role`
/// is not an error, it is an entry this app couriers (rule 1 + 2) — and neither
/// is a MISSING one: both fields default, so a row a foreign writer left thin
/// cannot brick a document whose payload entries are perfectly readable.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    #[serde(default, deserialize_with = "lenient")]
    pub path: String,
    #[serde(default, deserialize_with = "lenient")]
    pub role: String,
    /// Forward-compat: unknown per-entry fields round-trip verbatim.
    #[serde(flatten)]
    pub extra: Extra,
}

impl ManifestEntry {
    pub fn new(path: &str, role: &str) -> ManifestEntry {
        ManifestEntry {
            path: path.to_string(),
            role: role.to_string(),
            extra: Map::new(),
        }
    }
}

/// `manifest.json` — the universal discriminator plus the entry table.
///
/// EVERY field except `format` (which `parse` has already read) defaults. Rule
/// 1 in its strongest form: every app opens every container, so a manifest field
/// nothing dispatches on must never fail the whole open. A malformed `entries`
/// ARRAY still is a hard error — that is the payload table, not metadata.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    /// Always `"monet"`.
    pub format: String,
    #[serde(default = "one", deserialize_with = "lenient_schema_version")]
    pub schema_version: u32,
    /// Who wrote it last.
    #[serde(default, deserialize_with = "lenient")]
    pub app: ContainerApp,
    /// `graphics | time | catalog | scene` — open, so a future kind still loads.
    #[serde(default, deserialize_with = "lenient")]
    pub kind: String,
    #[serde(default)]
    pub entries: Vec<ManifestEntry>,
    /// Forward-compat: unknown top-level manifest fields round-trip verbatim.
    #[serde(flatten)]
    pub extra: Extra,
}

fn one() -> u32 {
    CONTAINER_SCHEMA_VERSION
}

/// Rule 1 for EVERY metadata field: `#[serde(default)]` only covers an ABSENT
/// field, so a foreign writer that emits the right key with the wrong JSON type
/// (`"kind": 3`, a bare-string `app`, a row's `"path": 5`) would otherwise fail
/// the whole open — the document unopenable in all seven apps, payload entries
/// and all (#217). Anything that doesn't fit the field's type defaults instead.
// ponytail: a wrong-typed value is DROPPED, not couriered — preserving it would
// need an untyped shadow field per field. Do that if a writer ever puts meaning
// there.
fn lenient<'de, D, T>(d: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::de::DeserializeOwned + Default,
{
    let value = Value::deserialize(d)?;
    Ok(serde_json::from_value(value).unwrap_or_default())
}

/// Same, but a wrong-typed `schemaVersion` falls back to the ABSENT default
/// (this reader's version), not to `0` — a container with no usable version is
/// exactly the "assume current" case, and the rule-3 gate in `parse` has already
/// had its say on anything that reads as a number (#217).
fn lenient_schema_version<'de, D: serde::Deserializer<'de>>(d: D) -> Result<u32, D::Error> {
    let value = Value::deserialize(d)?;
    Ok(serde_json::from_value(value).unwrap_or_else(|_| one()))
}

impl Manifest {
    pub fn new(app: ContainerApp, kind: &str) -> Manifest {
        Manifest {
            format: MONET_FORMAT.to_string(),
            schema_version: CONTAINER_SCHEMA_VERSION,
            app,
            kind: kind.to_string(),
            entries: Vec::new(),
            extra: Map::new(),
        }
    }
}

/// A parsed container: the manifest plus EVERY entry, as raw bytes.
///
/// Rule 2 is structural, not documentation: the entries an app never looks at
/// are still here, and `to_bytes` writes them back byte-for-byte. Replacing only
/// what you own (`set`) is the short path; losing a foreign entry takes effort.
#[derive(Debug, Clone)]
pub struct Container {
    pub manifest: Manifest,
    /// File order, EXCLUDING `manifest.json` (`to_bytes` writes that from
    /// `manifest`).
    entries: Vec<(String, Vec<u8>)>,
}

impl Container {
    /// An empty container written by `app`, carrying `kind`.
    pub fn new(app: ContainerApp, kind: &str) -> Container {
        Container {
            manifest: Manifest::new(app, kind),
            entries: Vec::new(),
        }
    }

    /// Rebuild from a manifest and its entries — the wasm bridge's write path,
    /// so it is a TRUST BOUNDARY and enforces the reserved path here rather than
    /// downstream: the writer emits `manifest.json` from `manifest`, and an entry
    /// claiming that name could only shadow it.
    pub fn from_parts(
        manifest: Manifest,
        entries: Vec<(String, Vec<u8>)>,
    ) -> Result<Container, String> {
        if entries.iter().any(|(name, _)| name == MANIFEST_PATH) {
            return Err(format!(
                "{MANIFEST_PATH} is reserved — the writer emits the manifest itself"
            ));
        }
        validate_entries(&entries)?;
        Ok(Container { manifest, entries })
    }

    /// Parse container bytes. A `format: "monet"` container and nothing else.
    pub fn parse(bytes: &[u8]) -> Result<Container, String> {
        let mut entries = zip_read(bytes)?;
        if entries.first().map(|(name, _)| name.as_str()) != Some(MANIFEST_PATH) {
            return Err(format!("not a Monet container (first entry is not {MANIFEST_PATH})"));
        }
        let (_, raw) = entries.remove(0);
        let text = std::str::from_utf8(&raw).map_err(|_| format!("{MANIFEST_PATH} is not valid UTF-8"))?;
        let value: Value =
            serde_json::from_str(text).map_err(|e| format!("{MANIFEST_PATH}: {e}"))?;
        match value.get("format").and_then(Value::as_str) {
            Some(MONET_FORMAT) => {
                // Rule 3: reject a strictly newer version rather than guess.
                if let Some(ver) = value.get("schemaVersion").and_then(Value::as_u64) {
                    if ver > CONTAINER_SCHEMA_VERSION as u64 {
                        return Err(format!(
                            "container schemaVersion {ver} is newer than supported {CONTAINER_SCHEMA_VERSION}"
                        ));
                    }
                }
                let manifest: Manifest = serde_json::from_value(value)
                    .map_err(|e| format!("{MANIFEST_PATH}: {e}"))?;
                Ok(Container { manifest, entries })
            }
            Some(other) => Err(format!("not a Monet container: format {other}")),
            None => Err(format!("{MANIFEST_PATH} has no format field")),
        }
    }

    /// Serialize back to container bytes: `manifest.json` first, then every
    /// entry in file order, unchanged (rule 2).
    pub fn to_bytes(&self) -> Result<Vec<u8>, String> {
        let mut files = Vec::with_capacity(self.entries.len() + 1);
        // `?`, never `unwrap_or_default()`: a zero-byte manifest is an archive
        // nothing can open, and this function already has an error channel.
        let manifest = serde_json::to_string_pretty(&self.manifest)
            .map_err(|e| format!("{MANIFEST_PATH}: {e}"))?;
        validate_manifest_size(manifest.len())?;
        files.push((MANIFEST_PATH.to_string(), manifest.into_bytes()));
        files.extend(self.entries.iter().cloned());
        zip_store(&files)
    }

    /// Raw bytes of one entry, by path.
    pub fn get(&self, path: &str) -> Option<&[u8]> {
        self.entries
            .iter()
            .find(|(name, _)| name == path)
            .map(|(_, data)| data.as_slice())
    }

    /// Raw bytes of the first entry carrying `role` THAT HAS A PAYLOAD — the
    /// normal dispatch. A manifest row whose file is missing does not hide a
    /// later row that has one; a genuinely missing role is `None`, not an error
    /// (rule 1).
    pub fn role(&self, role: &str) -> Option<&[u8]> {
        self.manifest
            .entries
            .iter()
            .filter(|e| e.role == role)
            .find_map(|e| self.get(&e.path))
    }

    /// Every path carrying `role`, in manifest order (e.g. all `pixels`).
    pub fn paths_for_role(&self, role: &str) -> Vec<&str> {
        self.manifest
            .entries
            .iter()
            .filter(|e| e.role == role)
            .map(|e| e.path.as_str())
            .collect()
    }

    /// Add or replace one entry the app owns, in place. Everything else — and
    /// this entry's own manifest `extra` — is left alone.
    ///
    /// FALLIBLE, and the refusal is loud. `manifest.json` is reserved (the
    /// writer emits its own): writing it would produce an archive with two of
    /// them, where the impostor wins the next read.
    pub fn set(&mut self, path: &str, role: &str, data: Vec<u8>) -> Result<(), String> {
        validate_entry_path(path)?;
        if path == MANIFEST_PATH {
            return Err(format!(
                "{MANIFEST_PATH} is reserved — the writer emits the manifest itself"
            ));
        }
        match self.entries.iter_mut().find(|(name, _)| name == path) {
            Some(slot) => slot.1 = data,
            None => self.entries.push((path.to_string(), data)),
        }
        match self.manifest.entries.iter_mut().find(|e| e.path == path) {
            Some(entry) => entry.role = role.to_string(),
            None => self.manifest.entries.push(ManifestEntry::new(path, role)),
        }
        Ok(())
    }

    /// Drop one entry. Only for an entry this app owns — dropping a foreign one
    /// is exactly what rule 2 forbids.
    pub fn remove(&mut self, path: &str) {
        self.entries.retain(|(name, _)| name != path);
        self.manifest.entries.retain(|e| e.path != path);
    }

    /// Every entry, in file order.
    pub fn entries(&self) -> &[(String, Vec<u8>)] {
        &self.entries
    }
}

fn validate_manifest_size(size: usize) -> Result<(), String> {
    if size > MAX_MANIFEST_BYTES {
        return Err(format!(
            "{MANIFEST_PATH} is {size} bytes; metadata is limited to {MAX_MANIFEST_BYTES} bytes"
        ));
    }
    Ok(())
}

fn validate_entry_path(path: &str) -> Result<(), String> {
    let bytes = path.as_bytes();
    let drive_absolute = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && bytes[2] == b'/';
    if path.is_empty()
        || path.starts_with('/')
        || drive_absolute
        || path.contains('\\')
        || path.contains('\0')
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(format!("invalid container entry path `{path}`"));
    }
    Ok(())
}

fn validate_entries(entries: &[(String, Vec<u8>)]) -> Result<(), String> {
    let mut seen = HashSet::with_capacity(entries.len());
    for (name, _) in entries {
        validate_entry_path(name)?;
        if !seen.insert(name.as_str()) {
            return Err(format!("container has duplicate entry `{name}`"));
        }
    }
    Ok(())
}

/// Sniff: ZIP magic AND a first local entry named `manifest.json`. Deliberately
/// header-only — a plain `.monet` JSON document and a foreign zip both fail it
/// without a parse, so callers can fall through to their other readers.
pub fn is_container(bytes: &[u8]) -> bool {
    if bytes.len() < 30 || bytes[..4] != [0x50, 0x4B, 0x03, 0x04] {
        return false;
    }
    let namelen = u16::from_le_bytes([bytes[26], bytes[27]]) as usize;
    bytes.len() >= 30 + namelen && &bytes[30..30 + namelen] == MANIFEST_PATH.as_bytes()
}

/// The path a container manifest gives to its first `role` entry, or `None` when
/// this is not a Monet manifest / carries no such role. Lets a loader that
/// already holds the entries — the engine's graphics loader — resolve the
/// document without reading the zip a second time.
pub fn manifest_role_path(manifest_json: &str, role: &str) -> Option<String> {
    let value: Value = serde_json::from_str(manifest_json).ok()?;
    if value.get("format").and_then(Value::as_str) != Some(MONET_FORMAT) {
        return None;
    }
    value
        .get("entries")?
        .as_array()?
        .iter()
        .find(|e| e.get("role").and_then(Value::as_str) == Some(role))?
        .get("path")?
        .as_str()
        .map(str::to_string)
}

// ─────────────────────────────────────────────────────────────
// STORE-only zip. Ported byte-identically from the engine's private writer, and
// `container::tests::zip_bytes_match_the_engine_writer` pins the layout every
// persisted container depends on. A stored zip is ~120 lines, which is why there
// is no zip crate here.
// ─────────────────────────────────────────────────────────────

/// The CRC-32 (IEEE 802.3, the zip polynomial) byte table, built at COMPILE time
/// — the bit-by-bit loop it replaces ran at ~150 MB/s, and every save pays it on
/// every byte (a Galerie catalog snapshot is measured in GB). Identical output,
/// so the golden-byte test below still pins the archive layout.
const CRC_TABLE: [u32; 256] = {
    let mut table = [0u32; 256];
    let mut i = 0usize;
    while i < 256 {
        let mut crc = i as u32;
        let mut bit = 0;
        while bit < 8 {
            crc = (crc >> 1) ^ (0xEDB8_8320 & (crc & 1).wrapping_neg());
            bit += 1;
        }
        table[i] = crc;
        i += 1;
    }
    table
};

/// CRC-32 (IEEE 802.3, the zip polynomial), table-driven.
fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &b in data {
        crc = (crc >> 8) ^ CRC_TABLE[((crc ^ b as u32) & 0xFF) as usize];
    }
    !crc
}

/// The 32-bit zip ceiling, applied. Design doc 11 §"Known limits" calls the 4 GB
/// wall "a hard wall, not a soft one: the writer must refuse rather than
/// silently truncate" — a wrapped size or offset is unrecoverable user data.
// ponytail: refusing is the whole fix. ZIP64 is the upgrade path if a >4 GiB
// entry (a Galerie catalog snapshot) ever becomes normal.
fn u32_or_refuse(n: usize, what: impl FnOnce() -> String) -> Result<u32, String> {
    u32::try_from(n)
        .map_err(|_| format!("{} is {n} bytes; the container tops out at 4 GiB (no ZIP64)", what()))
}

/// Write a STORE-only zip (local headers + central directory + EOCD). Refuses
/// anything the 32-bit format cannot represent rather than truncating it.
pub fn zip_store(files: &[(String, Vec<u8>)]) -> Result<Vec<u8>, String> {
    let count = u16::try_from(files.len()).map_err(|_| {
        format!(
            "container has {} entries; the container tops out at {} (no ZIP64)",
            files.len(),
            u16::MAX
        )
    })?;
    let mut out = Vec::new();
    let mut central = Vec::new();
    for (name, data) in files {
        // Cheap invariants FIRST: refusing a 4 GiB entry used to cost a full
        // CRC pass over it (~29 s) before anyone looked at its length.
        let off = u32_or_refuse(out.len(), || "the container".to_string())?;
        let size = u32_or_refuse(data.len(), || format!("entry `{name}`"))?;
        let nb = name.as_bytes();
        let namelen = u16::try_from(nb.len())
            .map_err(|_| format!("entry `{name}` has a path longer than {} bytes", u16::MAX))?;
        let crc = crc32(data);
        // Bit 11 says the name is UTF-8, which ours always is. Without it a
        // spec-conforming reader must decode the name as CP437 and mojibakes
        // every non-ASCII path (`media/*`, `assets/*` carry user file names).
        let flags = if name.is_ascii() { 0u16 } else { 0x0800u16 };
        out.extend_from_slice(&0x0403_4b50u32.to_le_bytes()); // PK\x03\x04
        out.extend_from_slice(&20u16.to_le_bytes()); // version needed
        out.extend_from_slice(&flags.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // method 0 = store
        out.extend_from_slice(&0u16.to_le_bytes()); // mod time
        out.extend_from_slice(&0u16.to_le_bytes()); // mod date
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&size.to_le_bytes()); // comp size
        out.extend_from_slice(&size.to_le_bytes()); // uncomp size
        out.extend_from_slice(&namelen.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // extra len
        out.extend_from_slice(nb);
        out.extend_from_slice(data);

        central.extend_from_slice(&0x0201_4b50u32.to_le_bytes()); // PK\x01\x02
        central.extend_from_slice(&20u16.to_le_bytes()); // version made by
        central.extend_from_slice(&20u16.to_le_bytes()); // version needed
        central.extend_from_slice(&flags.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes()); // method
        central.extend_from_slice(&0u16.to_le_bytes()); // mod time
        central.extend_from_slice(&0u16.to_le_bytes()); // mod date
        central.extend_from_slice(&crc.to_le_bytes());
        central.extend_from_slice(&size.to_le_bytes());
        central.extend_from_slice(&size.to_le_bytes());
        central.extend_from_slice(&namelen.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes()); // extra
        central.extend_from_slice(&0u16.to_le_bytes()); // comment
        central.extend_from_slice(&0u16.to_le_bytes()); // disk number
        central.extend_from_slice(&0u16.to_le_bytes()); // internal attrs
        central.extend_from_slice(&0u32.to_le_bytes()); // external attrs
        central.extend_from_slice(&off.to_le_bytes()); // local header offset
        central.extend_from_slice(nb);
    }
    let cd_offset = u32_or_refuse(out.len(), || "the container".to_string())?;
    let cd_size = u32_or_refuse(central.len(), || "the central directory".to_string())?;
    out.extend_from_slice(&central);
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes()); // PK\x05\x06 EOCD
    out.extend_from_slice(&0u16.to_le_bytes()); // disk
    out.extend_from_slice(&0u16.to_le_bytes()); // cd start disk
    out.extend_from_slice(&count.to_le_bytes()); // entries this disk
    out.extend_from_slice(&count.to_le_bytes()); // total entries
    out.extend_from_slice(&cd_size.to_le_bytes());
    out.extend_from_slice(&cd_offset.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // comment len
    Ok(out)
}

/// Read a STORE-only zip by scanning local file headers in order. Errors on a
/// missing/short header, truncated data, or non-store compression.
///
/// This is a TRUST BOUNDARY — the bytes are somebody's file — so every bound is
/// computed by SUBTRACTION from `bytes.len()`. Adding a header-supplied `comp`
/// to an offset wraps on wasm32 (32-bit `usize`, and `wasm-pack` is the shipping
/// target), which turns a hostile archive into a module-killing trap instead of
/// the `Err` every caller expects.
pub fn zip_read(bytes: &[u8]) -> Result<Vec<(String, Vec<u8>)>, String> {
    let corrupt = || "invalid container (corrupt zip)".to_string();
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let mut p = 0usize; // invariant: p <= bytes.len(), so `bytes.len() - p` is safe
    loop {
        if bytes.len() - p < 4 {
            return Err(corrupt());
        }
        let sig = u32::from_le_bytes([bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]]);
        if sig == 0x0201_4b50 || sig == 0x0605_4b50 {
            break; // central directory / EOCD reached
        }
        if sig != 0x0403_4b50 || bytes.len() - p < 30 {
            return Err(corrupt());
        }
        let method = u16::from_le_bytes([bytes[p + 8], bytes[p + 9]]);
        let comp = u32::from_le_bytes([bytes[p + 18], bytes[p + 19], bytes[p + 20], bytes[p + 21]])
            as usize;
        let uncomp = u32::from_le_bytes([bytes[p + 22], bytes[p + 23], bytes[p + 24], bytes[p + 25]])
            as usize;
        let namelen = u16::from_le_bytes([bytes[p + 26], bytes[p + 27]]) as usize;
        let extralen = u16::from_le_bytes([bytes[p + 28], bytes[p + 29]]) as usize;
        if method != 0 {
            return Err("container uses unsupported compression".to_string());
        }
        if comp != uncomp {
            return Err("invalid container (stored entry sizes differ)".to_string());
        }
        let header = 30 + namelen + extralen; // ≤ 131_100: cannot overflow
        if bytes.len() - p < header || bytes.len() - p - header < comp {
            return Err(corrupt());
        }
        let name_start = p + 30;
        let data_start = p + header;
        // Names are UTF-8 (we set the flag that says so). A foreign archive with
        // a CP437/Shift-JIS path is refused rather than silently transliterated:
        // rule 2 is byte-for-byte, and a mangled path is a broken pixel ref.
        // ponytail: byte-exact foreign names would need `Vec<u8>` paths through
        // the whole API — do that only if a real foreign container turns up.
        let name = String::from_utf8(bytes[name_start..name_start + namelen].to_vec())
            .map_err(|_| "invalid container (entry name is not UTF-8)".to_string())?;
        validate_entry_path(&name)?;
        if !seen.insert(name.clone()) {
            return Err(format!("container has duplicate entry `{name}`"));
        }
        if name == MANIFEST_PATH {
            validate_manifest_size(comp)?;
        }
        if out.len() == u16::MAX as usize {
            return Err(format!(
                "container has more than {} entries (no ZIP64)",
                u16::MAX
            ));
        }
        out.push((name, bytes[data_start..data_start + comp].to_vec()));
        p = data_start + comp;
    }
    if out.is_empty() {
        return Err(corrupt());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app() -> ContainerApp {
        ContainerApp::new("monet-vision", "0.1.0")
    }

    fn sample() -> Container {
        let mut c = Container::new(app(), KIND_GRAPHICS);
        c.set("graphics.json", "graphics", br#"{"width":1}"#.to_vec()).unwrap();
        c.set("pixels/0.png", "pixels", vec![0x89, 0x50, 0x4E, 0x47]).unwrap();
        c.set("audio/1.wav", "audio", vec![0xFF; 64]).unwrap();
        c
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn push_empty_local_entry(out: &mut Vec<u8>, name: &str) {
        let name = name.as_bytes();
        out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        out.extend_from_slice(&20u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&[0; 16]);
        out.extend_from_slice(&(name.len() as u16).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(name);
    }

    #[test]
    fn round_trips_a_container_with_several_entries() {
        let bytes = sample().to_bytes().unwrap();
        assert!(is_container(&bytes), "own output sniffs as a container");
        let back = Container::parse(&bytes).expect("parse");
        assert_eq!(back.manifest.format, MONET_FORMAT);
        assert_eq!(back.manifest.schema_version, CONTAINER_SCHEMA_VERSION);
        assert_eq!(back.manifest.app.name, "monet-vision");
        assert_eq!(back.manifest.kind, KIND_GRAPHICS);
        assert_eq!(back.entries(), sample().entries(), "entries byte-identical");
        assert_eq!(back.role("pixels"), Some([0x89, 0x50, 0x4E, 0x47].as_slice()));
        assert_eq!(back.paths_for_role("audio"), vec!["audio/1.wav"]);
        assert_eq!(back.role("nothing-here"), None, "unknown role is not an error");
        // manifest.json is the first entry, so the sniff holds for every writer.
        let raw = zip_read(&bytes).unwrap();
        assert_eq!(raw[0].0, MANIFEST_PATH);
        // …and a loader that already holds the entries (the engine's graphics
        // loader) resolves the document straight off the manifest text.
        let manifest = String::from_utf8(raw[0].1.clone()).unwrap();
        assert_eq!(manifest_role_path(&manifest, "graphics").as_deref(), Some(GRAPHICS_ENTRY));
        assert_eq!(manifest_role_path(&manifest, "nothing-here"), None);
        assert_eq!(manifest_role_path("not json", "graphics"), None);
    }

    #[test]
    fn couriers_untouched_entries_and_unknown_manifest_fields() {
        // A writer we don't know about: an extra manifest field, an extra
        // per-entry field, and an entry whose role this reader never handles.
        let mut original = sample();
        original
            .manifest
            .extra
            .insert("futureTop".into(), serde_json::json!({ "k": [1, 2] }));
        original.manifest.entries[2]
            .extra
            .insert("sampleRate".into(), serde_json::json!(48000));
        let disk = original.to_bytes().unwrap();

        // A rythme-shaped reader: consumes `audio`, rewrites it, ignores the rest.
        let mut reader = Container::parse(&disk).expect("parse");
        assert_eq!(reader.role("audio").map(<[u8]>::len), Some(64));
        reader.set("audio/1.wav", "audio", vec![0x01; 8]).unwrap();
        reader.manifest.app = ContainerApp::new("monet-rythme", "0.1.0");
        let resaved = Container::parse(&reader.to_bytes().unwrap()).expect("reparse");

        // Rule 2: everything it did not consume comes back byte-for-byte.
        for path in ["graphics.json", "pixels/0.png"] {
            assert_eq!(
                resaved.get(path),
                original.get(path),
                "{path} must survive a foreign app's re-save byte-for-byte"
            );
        }
        assert_eq!(resaved.get("audio/1.wav"), Some([0x01; 8].as_slice()));
        // Rule 3: unknown manifest fields are re-emitted, at both levels.
        assert_eq!(resaved.manifest.extra["futureTop"], serde_json::json!({ "k": [1, 2] }));
        assert_eq!(
            resaved.manifest.entries[2].extra["sampleRate"],
            serde_json::json!(48000)
        );
        assert_eq!(resaved.manifest.app.name, "monet-rythme", "app is who wrote it last");
    }

    #[test]
    fn sniff_rejects_plain_json_and_a_foreign_zip() {
        assert!(!is_container(br#"{"format":"monet","schemaVersion":1}"#));
        assert!(!is_container(b""));
        assert!(!is_container(&[0x50, 0x4B, 0x03, 0x04]));
        let foreign = zip_store(&[
            ("mimetype".to_string(), b"application/epub+zip".to_vec()),
            (MANIFEST_PATH.to_string(), b"{}".to_vec()),
        ])
        .unwrap();
        assert!(
            !is_container(&foreign),
            "manifest.json must be FIRST, not merely present"
        );
        assert!(Container::parse(&foreign).is_err(), "and parse agrees");
        assert!(Container::parse(b"not a zip").is_err());
        // A newer schema is refused rather than half-read (rule 3).
        let future = zip_store(&[(
            MANIFEST_PATH.to_string(),
            br#"{"format":"monet","schemaVersion":99,"app":{"name":"x","version":"1"},"kind":"time","entries":[]}"#.to_vec(),
        )])
        .unwrap();
        assert!(Container::parse(&future).unwrap_err().contains("newer"));
        // `format` is the discriminator, and it discriminates: anything that is
        // not a v1 Monet container — a `.monetgfx` envelope included — is
        // refused by name, not half-read.
        let foreign_format = zip_store(&[(
            MANIFEST_PATH.to_string(),
            br#"{"format":"monet-graphics","schemaVersion":4,"document":{"width":1,"height":1}}"#.to_vec(),
        )])
        .unwrap();
        let err = Container::parse(&foreign_format).unwrap_err();
        assert!(err.contains("monet-graphics"), "got {err}");
        let no_format = zip_store(&[(MANIFEST_PATH.to_string(), b"{}".to_vec())]).unwrap();
        assert!(Container::parse(&no_format).unwrap_err().contains("no format field"));
    }

    #[test]
    fn zip_bytes_match_the_engine_writer() {
        // Captured from packages/engine's private `zip_store` before it delegated
        // here. If this changes, every persisted container changes with it.
        const GOLDEN: &str = "504b030414000000000000000000ac2a93d8020000000200000001000000616869504b03041400000000000000000072fddb6c020000000200000003000000622f6300ff504b0102140014000000000000000000ac2a93d8020000000200000001000000000000000000000000000000000061504b010214001400000000000000000072fddb6c0200000002000000030000000000000000000000000021000000622f63504b0506000000000200020060000000440000000000";
        let files = vec![
            ("a".to_string(), b"hi".to_vec()),
            ("b/c".to_string(), vec![0u8, 255u8]),
        ];
        assert_eq!(hex(&zip_store(&files).unwrap()), GOLDEN);
        assert_eq!(
            zip_read(&zip_store(&files).unwrap()).unwrap(),
            files,
            "reader is the inverse"
        );
    }

    #[test]
    fn rejects_compressed_and_truncated_zips() {
        let mut deflated = zip_store(&[(MANIFEST_PATH.to_string(), b"{}".to_vec())]).unwrap();
        deflated[8] = 8; // method 8 = deflate
        assert!(zip_read(&deflated).unwrap_err().contains("compression"));
        let good = sample().to_bytes().unwrap();
        assert!(zip_read(&good[..40]).is_err(), "truncated entry rejected");
    }

    #[test]
    fn zip_read_refuses_a_hostile_declared_size_without_wrapping() {
        // D1/D15: `comp` comes straight off the wire. The old `data_start + comp`
        // wraps where `usize` is 32 bits (wasm32 — the shipping target), passes
        // the guard, and traps on the slice. Subtraction cannot wrap.
        let mut evil = sample().to_bytes().unwrap();
        evil[18..22].copy_from_slice(&u32::MAX.to_le_bytes()); // comp size
        evil[22..26].copy_from_slice(&u32::MAX.to_le_bytes()); // uncomp size
        assert!(zip_read(&evil).unwrap_err().contains("corrupt"));
        assert!(Container::parse(&evil).unwrap_err().contains("corrupt"));
        // A header that claims more name than there is file, too.
        let mut short = sample().to_bytes().unwrap();
        short[26..28].copy_from_slice(&u16::MAX.to_le_bytes());
        assert!(zip_read(&short).is_err());
    }

    #[test]
    fn zip_read_refuses_a_non_utf8_entry_name() {
        // D10: the name used to come back through `from_utf8_lossy`, so a foreign
        // path was silently transliterated (U+FFFD) and re-saved mangled.
        let mut bytes = zip_store(&[("ab".to_string(), b"x".to_vec())]).unwrap();
        let at = bytes.windows(2).position(|w| w == b"ab").unwrap();
        bytes[at] = 0x83; // Shift-JIS lead byte: not valid UTF-8
        assert!(zip_read(&bytes).unwrap_err().contains("UTF-8"));
    }

    #[test]
    fn zip_store_refuses_what_the_format_cannot_represent() {
        // D3/D5/D7/D14: design doc 11 §"Known limits" — "the writer must refuse
        // rather than silently truncate". Truncating writes unrecoverable bytes.
        let many: Vec<(String, Vec<u8>)> = (0..70_000u32)
            .map(|i| (format!("previews/{i}.bin"), Vec::new()))
            .collect();
        let err = zip_store(&many).unwrap_err();
        assert!(err.contains("70000") && err.contains("65535"), "got {err}");

        let long = zip_store(&[("x".repeat(70_000), b"hi".to_vec())]).unwrap_err();
        assert!(long.contains("path longer than"), "got {long}");

        // The 4 GiB wall itself, without allocating 4 GiB: the guard every size
        // and offset in `zip_store` goes through.
        assert!(u32_or_refuse(u32::MAX as usize, || "x".to_string()).is_ok());
        let over = u32_or_refuse(u32::MAX as usize + 1, || "entry `db/catalog.sqlite`".to_string())
            .unwrap_err();
        assert!(over.contains("db/catalog.sqlite") && over.contains("4 GiB"), "got {over}");

        // 65535 entries is still fine, and the EOCD count is the real one.
        let ok = zip_store(&(0..70u32).map(|i| (format!("e{i}"), vec![7u8])).collect::<Vec<_>>())
            .unwrap();
        let n = u16::from_le_bytes([ok[ok.len() - 12], ok[ok.len() - 11]]);
        assert_eq!(n, 70, "EOCD total-entries field is exact");
    }

    #[test]
    fn non_ascii_paths_carry_the_utf8_name_flag() {
        // D8: without bit 11 a conforming reader decodes the name as CP437, so
        // `unzip`/Finder mojibake every user-supplied file name.
        let bytes = zip_store(&[("media/файл.wav".to_string(), b"x".to_vec())]).unwrap();
        assert_eq!(u16::from_le_bytes([bytes[6], bytes[7]]), 0x0800, "local header flag");
        let cd = bytes.windows(4).position(|w| w == 0x0201_4b50u32.to_le_bytes()).unwrap();
        assert_eq!(u16::from_le_bytes([bytes[cd + 8], bytes[cd + 9]]), 0x0800, "central flag");
        assert_eq!(zip_read(&bytes).unwrap()[0].0, "media/файл.wav");
        // ASCII names keep flag 0 — the golden-byte layout is untouched.
        let ascii = zip_store(&[("media/a.wav".to_string(), b"x".to_vec())]).unwrap();
        assert_eq!(u16::from_le_bytes([ascii[6], ascii[7]]), 0);
    }

    #[test]
    fn the_reserved_manifest_path_cannot_be_impersonated() {
        // D9: `set` used to accept it, so the writer emitted TWO manifest.json
        // entries and the impostor won every subsequent read.
        let mut c = sample();
        let err = c.set(MANIFEST_PATH, "graphics", b"IMPOSTOR".to_vec()).unwrap_err();
        assert!(err.contains(MANIFEST_PATH), "refused LOUDLY, not queued: {err}");
        assert_eq!(c.get(MANIFEST_PATH), None);
        let written = zip_read(&c.to_bytes().unwrap()).unwrap();
        assert_eq!(written.iter().filter(|(n, _)| n == MANIFEST_PATH).count(), 1);

        // D9 at the OTHER entry point: `from_parts` is the whole JS write path,
        // and it used to trust its input. An entry named `manifest.json` shadows
        // the caller's real manifest, so the archive comes out unopenable — Ok
        // bytes, broken file.
        let mut forged = Manifest::new(app(), KIND_GRAPHICS);
        forged.entries.push(ManifestEntry::new(GRAPHICS_ENTRY, "graphics"));
        let err = Container::from_parts(
            forged.clone(),
            vec![
                (MANIFEST_PATH.to_string(), b"IMPOSTOR".to_vec()),
                (GRAPHICS_ENTRY.to_string(), b"DOC".to_vec()),
            ],
        )
        .unwrap_err();
        assert!(err.contains(MANIFEST_PATH), "got {err}");
        let honest = Container::from_parts(forged, vec![(GRAPHICS_ENTRY.into(), b"DOC".to_vec())])
            .expect("no reserved path, no refusal");
        assert_eq!(
            Container::parse(&honest.to_bytes().unwrap()).unwrap().role("graphics"),
            Some(b"DOC".as_slice())
        );
        // And an archive that already carries two fails closed on read.
        let dupes = zip_store(&[
            (MANIFEST_PATH.to_string(), br#"{"format":"monet","schemaVersion":1,"app":{"name":"x","version":"1"},"kind":"time","entries":[]}"#.to_vec()),
            (MANIFEST_PATH.to_string(), b"IMPOSTOR".to_vec()),
        ])
        .unwrap();
        assert!(Container::parse(&dupes).unwrap_err().contains("duplicate"));
    }

    #[test]
    fn hostile_paths_and_duplicate_payloads_fail_closed() {
        let manifest = serde_json::to_vec(&Manifest::new(app(), KIND_GRAPHICS)).unwrap();
        for path in [
            "",
            "/absolute.bin",
            "C:/absolute.bin",
            "../escape.bin",
            "media/../../escape.bin",
            "media//empty.bin",
            "media/./dot.bin",
            "media\\backslash.bin",
            "media/trailing/",
            "media/nul\0.bin",
        ] {
            let mut direct = Container::new(app(), KIND_GRAPHICS);
            assert!(direct.set(path, "pixels", vec![1]).is_err(), "set accepted {path:?}");
            assert!(
                Container::from_parts(
                    Manifest::new(app(), KIND_GRAPHICS),
                    vec![(path.to_string(), vec![1])],
                )
                .is_err(),
                "from_parts accepted {path:?}"
            );
            let bytes = zip_store(&[
                (MANIFEST_PATH.to_string(), manifest.clone()),
                (path.to_string(), vec![1]),
            ])
            .unwrap();
            assert!(Container::parse(&bytes).is_err(), "reader accepted {path:?}");
        }

        let duplicate = vec![
            ("pixels/a.bin".to_string(), vec![1]),
            ("pixels/a.bin".to_string(), vec![2]),
        ];
        assert!(
            Container::from_parts(Manifest::new(app(), KIND_GRAPHICS), duplicate.clone())
                .unwrap_err()
                .contains("duplicate")
        );
        let bytes = zip_store(&[
            (MANIFEST_PATH.to_string(), manifest),
            duplicate[0].clone(),
            duplicate[1].clone(),
        ])
        .unwrap();
        assert!(Container::parse(&bytes).unwrap_err().contains("duplicate"));

        let mut valid = Container::new(app(), KIND_GRAPHICS);
        valid
            .set("media/файл.wav", "audio", vec![1, 2, 3])
            .expect("safe nested Unicode path remains valid");
        Container::parse(&valid.to_bytes().unwrap()).expect("safe path round-trips");
    }

    #[test]
    fn hostile_metadata_and_store_headers_are_bounded() {
        let oversized = zip_store(&[(
            MANIFEST_PATH.to_string(),
            vec![b' '; MAX_MANIFEST_BYTES + 1],
        )])
        .unwrap();
        assert!(
            Container::parse(&oversized)
                .unwrap_err()
                .contains("metadata is limited"),
            "oversized metadata is rejected before JSON parsing"
        );

        let mut unwritable = Container::new(app(), KIND_GRAPHICS);
        unwritable.manifest.extra.insert(
            "hostile".into(),
            Value::String("x".repeat(MAX_MANIFEST_BYTES)),
        );
        assert!(
            unwritable
                .to_bytes()
                .unwrap_err()
                .contains("metadata is limited"),
            "the writer must not emit a file its own reader refuses"
        );

        let mut mismatched = sample().to_bytes().unwrap();
        let stored = u32::from_le_bytes(mismatched[18..22].try_into().unwrap());
        mismatched[22..26].copy_from_slice(&stored.saturating_add(1).to_le_bytes());
        assert!(zip_read(&mismatched).unwrap_err().contains("sizes differ"));
    }

    #[test]
    fn hostile_entry_count_stops_at_the_zip16_boundary() {
        let mut bytes = Vec::new();
        for i in 0..=u16::MAX as u32 {
            push_empty_local_entry(&mut bytes, &format!("e{i}"));
        }
        assert!(zip_read(&bytes).unwrap_err().contains("no ZIP64"));
    }

    #[test]
    fn role_finds_a_later_entry_when_the_first_has_no_payload() {
        // D11: `role` gave up on the first manifest row, so an app reported "no
        // timeline" for a document that has one.
        let mut c = Container::new(app(), KIND_TIME);
        c.manifest
            .entries
            .push(ManifestEntry::new("missing.json", "time"));
        c.set("real.json", "time", b"PAYLOAD".to_vec()).unwrap();
        assert_eq!(c.role("time"), Some(b"PAYLOAD".as_slice()));
        assert_eq!(c.role("absent"), None, "a genuinely missing role is still None");
    }

    #[test]
    fn a_manifest_app_without_a_version_still_opens() {
        // D12: every app opens every container — a metadata field nothing
        // dispatches on must never fail the whole open.
        let partial = zip_store(&[(
            MANIFEST_PATH.to_string(),
            br#"{"format":"monet","schemaVersion":1,"app":{"name":"monet-jouer"},"kind":"scene","entries":[]}"#.to_vec(),
        )])
        .unwrap();
        let c = Container::parse(&partial).expect("opens without app.version");
        assert_eq!(c.manifest.app.name, "monet-jouer");
        assert_eq!(c.manifest.app.version, "");
        // …and with no `app` at all.
        let none = zip_store(&[(
            MANIFEST_PATH.to_string(),
            br#"{"format":"monet","schemaVersion":1,"kind":"scene","entries":[]}"#.to_vec(),
        )])
        .unwrap();
        assert_eq!(Container::parse(&none).expect("opens").manifest.app, ContainerApp::default());
    }

    #[test]
    fn a_thin_or_malformed_metadata_field_never_fails_the_open() {
        // D12 widened: "every app opens every container" is the whole point, so
        // a missing `kind`, a row missing `role`/`path`, an `app` that is a bare
        // string and an absent `schemaVersion` all DEFAULT. Each of these used to
        // brick the document for all seven apps, payload entries and all.
        let thin = zip_store(&[
            (
                MANIFEST_PATH.to_string(),
                br#"{"format":"monet","app":"monet-vision","entries":[{"mime":"application/octet-stream"},{"path":"a.bin"}]}"#.to_vec(),
            ),
            ("a.bin".to_string(), vec![7, 7]),
        ])
        .unwrap();
        let c = Container::parse(&thin).expect("a thin manifest still opens");
        assert_eq!(c.manifest.kind, "");
        assert_eq!(c.manifest.schema_version, CONTAINER_SCHEMA_VERSION);
        assert_eq!(c.manifest.app, ContainerApp::default(), "a bare-string app defaults");
        assert_eq!(c.manifest.entries[0].path, "");
        assert_eq!(c.manifest.entries[1].role, "");
        assert_eq!(c.get("a.bin"), Some([7u8, 7].as_slice()), "the payload was always fine");
        assert_eq!(
            c.manifest.entries[0].extra["mime"],
            serde_json::json!("application/octet-stream"),
            "the row's own unknown fields are still couriered"
        );

        // …and the same fields with the WRONG TYPE, not merely absent (#217):
        // `#[serde(default)]` only fires on absence, so `"kind": 3` used to abort
        // the whole parse with `invalid type: integer`.
        let wrong_typed = zip_store(&[
            (
                MANIFEST_PATH.to_string(),
                br#"{"format":"monet","schemaVersion":"1","kind":3,"app":{"name":7},"entries":[{"path":5,"role":true,"mime":"x"},{"path":"a.bin","role":"pixels"}]}"#.to_vec(),
            ),
            ("a.bin".to_string(), vec![9]),
        ])
        .unwrap();
        let c = Container::parse(&wrong_typed).expect("a wrong-typed metadata field still opens");
        assert_eq!(c.manifest.kind, "", "a non-string `kind` defaults");
        assert_eq!(
            c.manifest.schema_version, CONTAINER_SCHEMA_VERSION,
            "a non-integer `schemaVersion` falls back to this reader's version"
        );
        assert_eq!(c.manifest.app, ContainerApp::default(), "a wrong-typed `app` defaults");
        assert_eq!(c.manifest.entries[0].path, "", "a non-string row `path` defaults");
        assert_eq!(c.manifest.entries[0].role, "", "a non-string row `role` defaults");
        assert_eq!(
            c.role("pixels"),
            Some([9u8].as_slice()),
            "the readable rows — and the payload — were always fine"
        );

        // The line: PAYLOAD structure is not metadata. A malformed `entries` and
        // an unreadable zip stay hard errors.
        let bad = zip_store(&[(
            MANIFEST_PATH.to_string(),
            br#"{"format":"monet","kind":"time","entries":"nope"}"#.to_vec(),
        )])
        .unwrap();
        assert!(Container::parse(&bad).is_err(), "a non-array `entries` is malformed");
        let bad_row = zip_store(&[(
            MANIFEST_PATH.to_string(),
            br#"{"format":"monet","entries":[5]}"#.to_vec(),
        )])
        .unwrap();
        assert!(
            Container::parse(&bad_row).is_err(),
            "a row that is not even an object is malformed"
        );
    }

    #[test]
    fn crc32_matches_the_standard_check_value() {
        // The table is built at compile time; a wrong table would still produce
        // self-consistent archives that no other unzip agrees with. 0xCBF43926
        // is the published CRC-32/ISO-HDLC check value for "123456789".
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
        assert_eq!(crc32(b""), 0);
    }
}
