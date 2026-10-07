//! File ▸ Export ▸ Content Credentials (Signed): embed a cryptographically
//! signed C2PA manifest into an exported PNG. The WASM engine can only write an
//! unsigned JSON sidecar (no crypto); signing needs an X.509 signer, so it lives
//! here in the native backend using `c2pa-rs`.
//!
//! Also the *read* side: `c2pa_read_manifest` verifies and reports the manifest
//! store embedded in a file the user opens (producer, actions, ingredients,
//! signature info, validation state) so the frontend can surface incoming
//! Content Credentials, not just write outgoing ones. And the *chain* side: a
//! signed export can name the file it was derived from, whose credentials are
//! embedded as the `parentOf` ingredient — dropping that would break the very
//! provenance chain the standard exists to maintain.
//!
//! Two signer identities:
//!   * **dev** — a self-signed ES256 key generated at build time into OUT_DIR
//!     (`build.rs`). Proves signed embedding works and round-trips through
//!     `c2pa::Reader`, but is *not* a trust anchor: contentcredentials.org/verify
//!     shows it as an untrusted signer. The private key is not in the repository.
//!   * **custom** — a user's own cert+key (typically CA-issued) imported through
//!     Preferences and persisted to `appDataDir/c2pa/{cert.pem,key.pem,tsa}`. The
//!     private key lives as a `0600` file, not in the OS keychain (see
//!     docs/c2pa-signing.md; keychain is the noted upgrade path).
//!
//! No cached signer: every sign/info call resolves the *current* on-disk signer,
//! so an import takes effect on the very next export with no restart.
//!
//! Exposed as a Tauri plugin ("c2pa") so it registers its own invoke handler
//! alongside monet_ui's — Tauri allows only one app-level `invoke_handler`, but
//! any number of plugins, each namespaced (`plugin:c2pa|sign_content_credentials`).
use std::fs;
use std::path::{Path, PathBuf};

use c2pa::SigningAlg;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Manager, Runtime};

// Build-generated self-signed ES256 dev signer. `build.rs` writes the pair into
// OUT_DIR so the private key is never a source file. Production swaps in a
// CA-issued signing cert via Preferences (import). This key is not a trust anchor.
const SIGN_CERT: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/es256-cert.pem"));
const SIGN_KEY: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/es256-key.pem"));

/// 1-px PNG used to validate a signer by actually signing (and reading back the
/// resulting manifest) rather than parsing X.509 by hand.
const FIXTURE_PNG: &[u8] = include_bytes!("../fixtures/px.png");

/// Custom-signer files live under `appDataDir/c2pa/`.
const C2PA_SUBDIR: &str = "c2pa";
const CERT_FILE: &str = "cert.pem";
const KEY_FILE: &str = "key.pem";
const TSA_FILE: &str = "tsa";

/// Algorithms tried (in order) when auto-detecting a key's signing algorithm.
/// Each is bound to one key type in `rust_native_crypto`, so a key that isn't
/// that type fails signer creation — "first that signs" is therefore reliable.
const CANDIDATE_ALGS: [SigningAlg; 4] = [
    SigningAlg::Es256,
    SigningAlg::Es384,
    SigningAlg::Ps256,
    SigningAlg::Ed25519,
];

/// Minimal, spec-valid C2PA manifest: who generated it + the actions that made
/// this asset. `{ACTIONS}` is substituted per export — see `actions_json`.
const MANIFEST_JSON: &str = r#"{
  "claim_generator_info": [{ "name": "Monet Vision", "version": "0.1.0" }],
  "title": "Monet Vision Export",
  "assertions": [
    { "label": "c2pa.actions", "data": { "actions": [{ACTIONS}] } },
    { "label": "stds.schema-org.CreativeWork", "data": { "@context": "https://schema.org", "@type": "CreativeWork" } }
  ]
}"#;

/// Links the chained ingredient to the `c2pa.opened` action below.
const PARENT_LABEL: &str = "parent";
/// Label stem for the placed (`componentOf`) ingredients — `placed0`, `placed1`,
/// … — each named by exactly one `c2pa.placed` action.
const PLACED_LABEL: &str = "placed";
/// Cap on placed ingredients per export. The list is renderer-supplied and each
/// entry costs a file read plus an embedded manifest; a document with more
/// linked sources than this simply names the first `MAX_PLACED`.
/// ponytail: a flat cap, not a byte budget — revisit if real documents hit it.
const MAX_PLACED: usize = 32;

/// C2PA action ids the renderer may name in `x-c2pa-actions` (the engine derives
/// them from the document's edit history). An allowlist, not a passthrough: the
/// header is renderer-supplied, so tokens are *matched* and the JSON is rebuilt
/// here — nothing from the header is ever interpolated into a claim.
const RECIPE_ACTIONS: &[&str] = &[
    "c2pa.color_adjustments",
    "c2pa.cropped",
    "c2pa.drawing",
    "c2pa.edited",
    "c2pa.filtered",
    "c2pa.orientation",
    "c2pa.resized",
];
/// Token meaning "this document contains generative-AI content" — expanded to a
/// `c2pa.edited` carrying the IPTC disclosure below. Mirrors the engine's
/// `C2PA_AI_TOKEN` / `C2PA_AI_SOURCE_TYPE` (the two sides share no crate).
const AI_TOKEN: &str = "ai";
/// IPTC digital source type for content produced by a model trained on sampled
/// media. Disclosing this is the entire point of the standard for AI provenance.
const AI_SOURCE_TYPE: &str =
    "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";

/// The `c2pa.actions` list for one export: how the asset came to exist, the
/// assets composed into it, then the recipe of what was done to it (`recipe` =
/// the engine's comma-separated action tokens; unknown tokens are dropped).
///
/// With no parent this document originated here (`c2pa.created`). A derived asset
/// was *not* created by us — claiming `c2pa.created` over someone else's photo is
/// a false provenance claim — so it opens the parent instead, and `c2pa.opened`
/// must name the ingredient it opened (`PARENT_LABEL`) or the manifest fails
/// validation with `assertion.action.ingredientMismatch`.
///
/// `placed` is the number of `componentOf` ingredients added (the document's
/// linked Smart Objects). Each gets its own `c2pa.placed` naming its label, for
/// the same reason: an action that changes ingredients must point at one.
fn actions_json(parent: bool, placed: usize, recipe: &str) -> String {
    let mut seen: Vec<&str> = Vec::new();
    let mut out: Vec<String> = Vec::new();
    if parent {
        out.push(format!(
            r#"{{ "action": "c2pa.opened", "parameters": {{ "ingredientIds": ["{PARENT_LABEL}"] }} }}"#
        ));
        out.push(r#"{ "action": "c2pa.edited" }"#.to_string());
        seen.push("c2pa.edited");
    } else {
        out.push(r#"{ "action": "c2pa.created" }"#.to_string());
    }
    for i in 0..placed {
        out.push(format!(
            r#"{{ "action": "c2pa.placed", "parameters": {{ "ingredientIds": ["{PLACED_LABEL}{i}"] }} }}"#
        ));
    }
    for token in recipe.split(',').map(str::trim) {
        if token == AI_TOKEN {
            // Always listed, even next to a plain c2pa.edited: the disclosure is
            // the assertion, not the fact that some editing happened.
            out.push(format!(
                r#"{{ "action": "c2pa.edited", "digitalSourceType": "{AI_SOURCE_TYPE}" }}"#
            ));
            continue;
        }
        let Some(id) = RECIPE_ACTIONS.iter().find(|a| **a == token) else {
            continue;
        };
        if seen.contains(id) {
            continue;
        }
        seen.push(id);
        out.push(format!(r#"{{ "action": "{id}" }}"#));
    }
    out.join(", ")
}

/// Identity of the signer that File ▸ Export will use, surfaced in Preferences.
#[derive(serde::Serialize)]
struct SignerInfo {
    /// `"dev"` (bundled self-signed) or `"custom"` (user-imported).
    kind: String,
    issuer: String,
    cert_serial: String,
    /// Lowercase signing alg (`"es256"`, `"ps256"`, …).
    alg: String,
    /// RFC-3161 timestamp authority URL, if the signer countersigns.
    tsa_url: Option<String>,
    // ponytail: cert expiry needs an X.509 parser (D8 forbids a new dep); left
    // None. Upgrade path: parse `SignatureInfo::cert_chain` when we add one.
    not_after: Option<String>,
}

/// The active signer plus the metadata needed to describe it. Kept together so
/// callers don't re-resolve on-disk state twice.
struct ActiveSigner {
    kind: &'static str,
    signer: Box<dyn c2pa::Signer>,
    tsa_url: Option<String>,
}

/// Every container the signed-export command accepts. c2pa-rs embeds the
/// manifest store natively in each of these.
const SIGNABLE_MIMES: &[&str] = &["image/png", "image/jpeg", "image/tiff"];

/// Containers whose Content Credentials c2pa-rs can read (as an incoming file or
/// as a chained parent ingredient), mapped to the MIME it expects. Anything else
/// Vision can open — PSD, `.mvision`, most RAW — simply cannot carry a manifest
/// store, which is "no credentials", not an error.
fn mime_for_path(path: &str) -> Option<&'static str> {
    let ext = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "tif" | "tiff" => "image/tiff",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "heic" => "image/heic",
        "heif" => "image/heif",
        "gif" => "image/gif",
        "dng" => "image/x-adobe-dng",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        _ => return None,
    })
}

/// Sign `bytes` (a `mime` container) with `signer` and return the same image
/// with an embedded C2PA manifest store. Pure + testable — the Tauri command
/// is a thin wrapper.
///
/// `parent` is the path of the file this export was derived from. When it names
/// a container c2pa can parse, its manifest store is chained in as the `parentOf`
/// ingredient and the actions become opened+edited; anything else is ignored so
/// an ordinary export from a PSD still signs.
///
/// `placed` are the paths of the assets composed *into* this document (Vision's
/// linked Smart Objects). Each readable one becomes a `componentOf` ingredient
/// carrying its own credentials plus a `c2pa.placed` action — the "what is this
/// made of" half of provenance, which a parent alone never answers. Ones we
/// cannot read are dropped: an unreachable source is not an ingredient we saw.
///
/// `recipe` is the engine's action-token list for the document (see
/// `actions_json`), so the manifest states what was actually done to the image
/// and discloses generative-AI content instead of claiming the same provenance
/// for every export.
fn sign_with(
    signer: &dyn c2pa::Signer,
    bytes: Vec<u8>,
    mime: &str,
    parent: Option<&str>,
    placed: &[&str],
    recipe: &str,
) -> Result<Vec<u8>, String> {
    use std::io::Cursor;
    let parent = parent.and_then(|p| mime_for_path(p).map(|m| (p, m)));
    // Resolve the placed sources *before* the manifest is built: the action list
    // names ingredient labels, so the count has to be the one actually added or
    // the claim validates as `ingredientMismatch`.
    let mut placed: Vec<(&str, &'static str, fs::File)> = placed
        .iter()
        .filter_map(|p| Some((*p, mime_for_path(p)?, fs::File::open(p).ok()?)))
        .take(MAX_PLACED)
        .collect();
    let actions = actions_json(parent.is_some(), placed.len(), recipe);
    let mut builder = c2pa::Builder::default()
        .with_definition(MANIFEST_JSON.replace("{ACTIONS}", &actions).as_str())
        .map_err(|e| format!("manifest: {e}"))?;
    if let Some((path, parent_mime)) = parent {
        let mut src = fs::File::open(path).map_err(|e| format!("open parent: {e}"))?;
        // c2pa-rs pulls the parent's own manifest store out of the stream — that
        // is the chain. Title is set on the returned Ingredient rather than
        // interpolated into JSON, so a filename can never break the manifest.
        let ingredient = builder
            .add_ingredient_from_stream(r#"{"relationship":"parentOf"}"#, parent_mime, &mut src)
            .map_err(|e| format!("parent ingredient: {e}"))?;
        ingredient.set_label(PARENT_LABEL);
        if let Some(name) = Path::new(path).file_name().and_then(|n| n.to_str()) {
            ingredient.set_title(name);
        }
    }
    for (i, (path, placed_mime, src)) in placed.iter_mut().enumerate() {
        let ingredient = builder
            .add_ingredient_from_stream(r#"{"relationship":"componentOf"}"#, placed_mime, src)
            .map_err(|e| format!("placed ingredient: {e}"))?;
        ingredient.set_label(&format!("{PLACED_LABEL}{i}"));
        if let Some(name) = Path::new(*path).file_name().and_then(|n| n.to_str()) {
            ingredient.set_title(name);
        }
    }
    let mut src = Cursor::new(bytes);
    let mut dst = Cursor::new(Vec::new());
    builder
        .sign(signer, mime, &mut src, &mut dst)
        .map_err(|e| format!("sign: {e}"))?;
    Ok(dst.into_inner())
}

/// Read + verify the C2PA manifest store in `stream` (a `mime` container).
/// Returns the full `c2pa::Reader` JSON report — active manifest, all manifests
/// (producer, actions, ingredients, signature_info) plus
/// validation_status/results/state — or `None` when the file simply carries no
/// Content Credentials (the common case, distinct from a real read error).
/// Pure + testable — the Tauri command is a thin wrapper.
fn read_manifest<S: std::io::Read + std::io::Seek + Send>(
    stream: &mut S,
    mime: &str,
) -> Result<Option<String>, String> {
    match c2pa::Reader::default().with_stream(mime, stream) {
        Ok(reader) => reader.json_checked().map(Some).map_err(|e| format!("report: {e}")),
        // No JUMBF box → the file has no manifest store at all.
        Err(c2pa::Error::JumbfNotFound) => Ok(None),
        Err(e) => Err(format!("read: {e}")),
    }
}

/// Decode a percent-encoded header value (`encodeURIComponent` on the JS side).
/// HTTP header values are ASCII, filesystem paths are not; a malformed escape
/// yields `None` so we refuse rather than guess at a path.
fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            out.push(u8::from_str_radix(value.get(i + 1..i + 3)?, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Auto-detect the signing algorithm for a cert+key pair by trial-signing the
/// bundled fixture with each candidate; the first that succeeds is the answer.
fn detect_alg(cert: &[u8], key: &[u8]) -> Result<SigningAlg, String> {
    for alg in CANDIDATE_ALGS {
        let Ok(signer) = c2pa::create_signer::from_keys(cert, key, alg, None) else {
            continue;
        };
        if sign_with(signer.as_ref(), FIXTURE_PNG.to_vec(), "image/png", None, &[], "").is_ok() {
            return Ok(alg);
        }
    }
    Err("could not determine signing algorithm — is this a valid ES256/ES384/PS256/Ed25519 cert+key pair?".into())
}

/// Resolve the signer to use right now: the custom cert+key under `c2pa_dir` if
/// both files are present, else the bundled dev signer. `c2pa_dir` is `None`
/// only in tests that want to force the dev path.
///
/// `countersign` controls whether the built signer embeds the configured RFC-3161
/// TSA — true for real exports (`sign_content_credentials`), false for the
/// identity probe (`c2pa_signer_info`) so merely *describing* the signer never
/// makes a network request (or fails/hangs offline). `tsa_url` is reported from
/// on-disk config either way.
fn active_signer(c2pa_dir: Option<&Path>, countersign: bool) -> Result<ActiveSigner, String> {
    if let Some(dir) = c2pa_dir {
        let cert_path = dir.join(CERT_FILE);
        let key_path = dir.join(KEY_FILE);
        if cert_path.is_file() && key_path.is_file() {
            let cert = fs::read(&cert_path).map_err(|e| format!("read cert: {e}"))?;
            let key = fs::read(&key_path).map_err(|e| format!("read key: {e}"))?;
            let tsa = read_tsa(dir);
            let alg = detect_alg(&cert, &key)?;
            let signer = c2pa::create_signer::from_keys(&cert, &key, alg, countersign.then(|| tsa.clone()).flatten())
                .map_err(|e| format!("signer: {e}"))?;
            return Ok(ActiveSigner { kind: "custom", signer, tsa_url: tsa });
        }
    }
    let signer = c2pa::create_signer::from_keys(SIGN_CERT, SIGN_KEY, SigningAlg::Es256, None)
        .map_err(|e| format!("signer: {e}"))?;
    Ok(ActiveSigner { kind: "dev", signer, tsa_url: None })
}

/// Read a trimmed, non-empty TSA URL from `<dir>/tsa`, if any.
fn read_tsa(dir: &Path) -> Option<String> {
    fs::read_to_string(dir.join(TSA_FILE))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Build a `SignerInfo` by test-signing the fixture and reading back the
/// manifest's `signature_info()` (issuer/serial/alg). Signs without the TSA so
/// this never makes a network request; `tsa_url` is reported from config.
fn signer_info_for(
    kind: &str,
    signer: &dyn c2pa::Signer,
    tsa_url: Option<String>,
) -> Result<SignerInfo, String> {
    use std::io::Cursor;
    let signed = sign_with(signer, FIXTURE_PNG.to_vec(), "image/png", None, &[], "")?;
    let reader = c2pa::Reader::default()
        .with_stream("image/png", &mut Cursor::new(&signed))
        .map_err(|e| format!("read back: {e}"))?;
    let manifest = reader.active_manifest().ok_or("no active manifest")?;
    let info = manifest.signature_info().ok_or("no signature info")?;
    Ok(SignerInfo {
        kind: kind.to_string(),
        issuer: info.issuer.clone().unwrap_or_default(),
        cert_serial: info.cert_serial_number.clone().unwrap_or_default(),
        alg: info.alg.map(|a| a.to_string()).unwrap_or_default(),
        tsa_url,
        not_after: None,
    })
}

/// Validate a cert+key by actually signing, then persist them as `0600` files
/// under `dir` (creating it). Returns the resulting signer identity. Nothing is
/// written if validation fails.
fn import_signer(
    dir: &Path,
    cert: &[u8],
    key: &[u8],
    tsa_url: Option<String>,
) -> Result<SignerInfo, String> {
    // Validate by signing (also rejects a mismatched cert/key here, pre-persist).
    let alg = detect_alg(cert, key)?;
    let tsa = tsa_url.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    // Describe the signer from a TSA-less sign so import works offline.
    let probe = c2pa::create_signer::from_keys(cert, key, alg, None)
        .map_err(|e| format!("signer: {e}"))?;
    let info = signer_info_for("custom", probe.as_ref(), tsa.clone())?;

    fs::create_dir_all(dir).map_err(|e| format!("create dir: {e}"))?;
    write_private(&dir.join(CERT_FILE), cert)?;
    write_private(&dir.join(KEY_FILE), key)?;
    match &tsa {
        Some(url) => write_private(&dir.join(TSA_FILE), url.as_bytes())?,
        None => {
            let _ = fs::remove_file(dir.join(TSA_FILE));
        }
    }
    Ok(info)
}

/// Remove the custom signer files, reverting to the bundled dev signer.
fn clear_signer(dir: &Path) -> Result<(), String> {
    for f in [CERT_FILE, KEY_FILE, TSA_FILE] {
        let p = dir.join(f);
        if p.exists() {
            fs::remove_file(&p).map_err(|e| format!("remove {f}: {e}"))?;
        }
    }
    Ok(())
}

/// Write `bytes` to `path`, then tighten to owner-only (`0600`) on Unix — the
/// private key must not be world/group-readable in app data.
fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    fs::write(path, bytes).map_err(|e| format!("write {}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("chmod {}: {e}", path.display()))?;
    }
    Ok(())
}

/// `appDataDir/c2pa`, where custom-signer files live.
fn c2pa_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?;
    Ok(base.join(C2PA_SUBDIR))
}

/// `invoke("plugin:c2pa|sign_content_credentials", pngBytes)` → signed PNG bytes.
/// Raw request body in, raw response body out — never JSON-array a multi-MB image.
/// Resolves the active signer per call so an import takes effect immediately.
///
/// Optional `x-c2pa-parent` header: the percent-encoded path of the file this
/// document was opened from. Its credentials are chained as the `parentOf`
/// ingredient. A path we can't read is not fatal — the export still signs,
/// unchained, rather than losing the user's work to a provenance detail.
///
/// Optional `x-c2pa-placed` header: comma-separated, percent-encoded paths of
/// the assets placed into the document (linked Smart Objects), recorded as
/// `componentOf` ingredients + `c2pa.placed` actions. Same rule — a source we
/// can't read is dropped, never fatal.
///
/// Optional `x-c2pa-actions` header: the engine's `c2pa_action_list()` for this
/// document — the edit recipe plus the `ai` disclosure token. Absent, the
/// manifest still states how the asset came to exist, just not what was done to
/// it; unknown tokens are dropped (see `actions_json`).
#[tauri::command]
fn sign_content_credentials<R: Runtime>(
    app: AppHandle<R>,
    request: Request<'_>,
) -> Result<Response, String> {
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        _ => return Err("expected raw image body".into()),
    };
    // Container type comes from an allowlisted header; anything else is refused
    // before the signer runs (the renderer is not trusted to name arbitrary mimes).
    let requested = request
        .headers()
        .get("x-c2pa-mime")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/png");
    let mime = SIGNABLE_MIMES
        .iter()
        .find(|m| **m == requested)
        .ok_or_else(|| format!("unsupported C2PA export container: {requested}"))?;
    let parent = request
        .headers()
        .get("x-c2pa-parent")
        .and_then(|v| v.to_str().ok())
        .and_then(percent_decode)
        .filter(|p| !p.is_empty());
    // Each entry is percent-encoded, so a comma can only be the separator.
    let placed: Vec<String> = request
        .headers()
        .get("x-c2pa-placed")
        .and_then(|v| v.to_str().ok())
        .map(|v| {
            v.split(',')
                .filter_map(percent_decode)
                .filter(|p| !p.is_empty())
                .collect()
        })
        .unwrap_or_default();
    let placed: Vec<&str> = placed.iter().map(String::as_str).collect();
    // Plain ASCII tokens, allowlisted in `actions_json` — no decoding needed.
    let recipe = request
        .headers()
        .get("x-c2pa-actions")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    let dir = c2pa_dir(&app)?;
    let active = active_signer(Some(&dir), true)?;
    let signer = active.signer.as_ref();
    // The retry copy is only paid for when there are ingredients to lose.
    let signed = if parent.is_some() || !placed.is_empty() {
        sign_with(signer, bytes.clone(), mime, parent.as_deref(), &placed, recipe).or_else(|e| {
            // An unreadable/renamed source must not cost the user the export.
            eprintln!("c2pa: ingredients skipped ({e})");
            sign_with(signer, bytes, mime, None, &[], recipe)
        })?
    } else {
        sign_with(signer, bytes, mime, None, &[], recipe)?
    };
    Ok(Response::new(signed))
}

/// `invoke("plugin:c2pa|c2pa_read_manifest", { path })` → JSON report string of
/// the manifest store embedded in that file (see `read_manifest`), or `null`
/// when it carries no Content Credentials. Streamed from disk rather than taking
/// bytes over IPC — an opened photo can be hundreds of MB and only the manifest
/// box is wanted. The renderer can already read any file it can name (it picked
/// the path), and only the manifest report comes back, so this adds no reach.
#[tauri::command]
fn c2pa_read_manifest(path: String) -> Result<Option<String>, String> {
    // A container that cannot carry a manifest store has no credentials to show.
    let Some(mime) = mime_for_path(&path) else { return Ok(None) };
    let mut file = fs::File::open(&path).map_err(|e| format!("open: {e}"))?;
    read_manifest(&mut file, mime)
}

/// Identity of the signer File ▸ Export would use right now.
#[tauri::command]
fn c2pa_signer_info<R: Runtime>(app: AppHandle<R>) -> Result<SignerInfo, String> {
    let dir = c2pa_dir(&app)?;
    // countersign=false: describing the signer must never hit the TSA network.
    let active = active_signer(Some(&dir), false)?;
    signer_info_for(active.kind, active.signer.as_ref(), active.tsa_url)
}

/// Import a user cert+key (PEM strings) as the custom signer. Validated by
/// signing, then persisted `0600`. `tsa_url` (optional) enables RFC-3161
/// countersigning on future exports.
#[tauri::command]
fn c2pa_import_signer<R: Runtime>(
    app: AppHandle<R>,
    cert_pem: String,
    key_pem: String,
    tsa_url: Option<String>,
) -> Result<SignerInfo, String> {
    let dir = c2pa_dir(&app)?;
    import_signer(&dir, cert_pem.as_bytes(), key_pem.as_bytes(), tsa_url)
}

/// Remove the custom signer, reverting to the bundled dev signer.
#[tauri::command]
fn c2pa_clear_signer<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let dir = c2pa_dir(&app)?;
    clear_signer(&dir)
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("c2pa")
        .invoke_handler(tauri::generate_handler![
            sign_content_credentials,
            c2pa_read_manifest,
            c2pa_signer_info,
            c2pa_import_signer,
            c2pa_clear_signer
        ])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// Unique temp dir per test (no `tempfile` dev-dep); cleaned by the caller.
    fn temp_c2pa_dir() -> PathBuf {
        static N: AtomicU32 = AtomicU32::new(0);
        let n = N.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let dir = std::env::temp_dir().join(format!("mv-c2pa-test-{pid}-{n}"));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn signs_and_embeds_a_readable_c2pa_manifest() {
        let png = FIXTURE_PNG.to_vec();
        let dev = active_signer(None, true).expect("dev signer");
        let signed = sign_with(dev.signer.as_ref(), png.clone(), "image/png", None, &[], "").expect("signing must succeed");
        assert!(signed.len() > png.len(), "signed PNG must carry an embedded manifest");

        // Round-trip: c2pa must read back exactly the manifest we embedded.
        let reader = c2pa::Reader::default()
            .with_stream("image/png", &mut std::io::Cursor::new(&signed))
            .expect("embedded manifest must be readable");
        let active = reader.active_manifest().expect("has an active manifest");
        assert_eq!(active.title().unwrap_or_default(), "Monet Vision Export");
    }

    #[test]
    fn signs_jpeg_and_tiff_containers_too() {
        const FIXTURE_JPEG: &[u8] = include_bytes!("../fixtures/heic-orient6.jpg");
        const FIXTURE_TIFF: &[u8] = include_bytes!("../fixtures/px.tiff");
        let dev = active_signer(None, true).expect("dev signer");
        for (bytes, mime) in [
            (FIXTURE_JPEG.to_vec(), "image/jpeg"),
            (FIXTURE_TIFF.to_vec(), "image/tiff"),
        ] {
            let signed = sign_with(dev.signer.as_ref(), bytes.clone(), mime, None, &[], "").expect(mime);
            let reader = c2pa::Reader::default()
                .with_stream(mime, &mut std::io::Cursor::new(&signed))
                .expect("embedded manifest must be readable");
            let active = reader.active_manifest().expect("has an active manifest");
            assert_eq!(active.title().unwrap_or_default(), "Monet Vision Export", "{mime}");
        }
    }

    /// `read_manifest` over a byte slice — the shape every test wants.
    fn read_bytes(bytes: &[u8], mime: &str) -> Result<Option<String>, String> {
        read_manifest(&mut std::io::Cursor::new(bytes), mime)
    }

    #[test]
    fn read_manifest_reports_signed_file_and_none_for_unsigned() {
        // Unsigned fixture → no Content Credentials, not an error.
        assert_eq!(read_bytes(FIXTURE_PNG, "image/png").unwrap(), None);

        // Signed fixture → full JSON report with manifest + validation state.
        let dev = active_signer(None, true).expect("dev signer");
        let signed = sign_with(dev.signer.as_ref(), FIXTURE_PNG.to_vec(), "image/png", None, &[], "").unwrap();
        let report = read_bytes(&signed, "image/png")
            .expect("readable")
            .expect("has credentials");
        assert!(report.contains("\"Monet Vision Export\""), "title in report");
        assert!(report.contains("validation_state"), "verification result in report");
        assert!(report.contains("active_manifest"), "active manifest named in report");

        // A container c2pa can't parse is a read error, not a silent None.
        assert!(read_bytes(b"not an image", "application/x-nonsense").is_err());
    }

    #[test]
    fn read_manifest_command_streams_from_a_path_and_ignores_uncarryable_containers() {
        let dir = temp_c2pa_dir();
        fs::create_dir_all(&dir).unwrap();
        let dev = active_signer(None, true).expect("dev signer");
        let signed = sign_with(dev.signer.as_ref(), FIXTURE_PNG.to_vec(), "image/png", None, &[], "").unwrap();

        let png = dir.join("signed.png");
        fs::write(&png, &signed).unwrap();
        let report = c2pa_read_manifest(png.to_string_lossy().into_owned())
            .expect("readable")
            .expect("has credentials");
        assert!(report.contains("\"Monet Vision Export\""));

        // Same bytes behind an extension c2pa can't carry a store in → no
        // credentials, not an error the UI would have to explain.
        let psd = dir.join("signed.psd");
        fs::write(&psd, &signed).unwrap();
        assert_eq!(c2pa_read_manifest(psd.to_string_lossy().into_owned()).unwrap(), None);

        // A path that isn't there is a real error, not silent "no credentials".
        assert!(c2pa_read_manifest(dir.join("gone.png").to_string_lossy().into_owned()).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn signing_over_a_parent_chains_its_credentials_as_an_ingredient() {
        let dir = temp_c2pa_dir();
        fs::create_dir_all(&dir).unwrap();
        let dev = active_signer(None, true).expect("dev signer");

        // An incoming file that already carries Content Credentials.
        let incoming = sign_with(dev.signer.as_ref(), FIXTURE_PNG.to_vec(), "image/png", None, &[], "").unwrap();
        let parent = dir.join("incoming.png");
        fs::write(&parent, &incoming).unwrap();

        // Re-export derived from it must keep the chain, not restart it.
        let derived = sign_with(
            dev.signer.as_ref(),
            FIXTURE_PNG.to_vec(),
            "image/png",
            Some(&parent.to_string_lossy()),
            &[],
            "",
        )
        .expect("derived export signs");
        let report = read_bytes(&derived, "image/png").unwrap().expect("has credentials");
        assert!(report.contains("\"parentOf\""), "parent ingredient chained: {report}");
        assert!(report.contains("incoming.png"), "ingredient names the source file");
        assert!(report.contains("active_manifest"), "ingredient carries the parent's manifest");
        assert!(report.contains("c2pa.opened"), "derived actions");
        // c2pa.opened must name the ingredient it opened, or the whole manifest
        // validates as Invalid — a broken chain is worse than no chain.
        assert!(!report.contains("ingredientMismatch"), "opened action links the ingredient: {report}");
        assert!(report.contains("\"validation_state\": \"Valid\""), "chained manifest validates: {report}");

        // Over an *unsigned* parent nothing else can contribute a c2pa.created,
        // so this is where "we must not claim to have created it" is provable.
        let plain = dir.join("plain.png");
        fs::write(&plain, FIXTURE_PNG).unwrap();
        let over_plain = sign_with(
            dev.signer.as_ref(),
            FIXTURE_PNG.to_vec(),
            "image/png",
            Some(&plain.to_string_lossy()),
            &[],
            "",
        )
        .unwrap();
        let report = read_bytes(&over_plain, "image/png").unwrap().expect("has credentials");
        assert!(report.contains("\"parentOf\""));
        assert!(!report.contains("c2pa.created"), "must not claim creation: {report}");

        // A parent in a container c2pa can't parse is simply not chained.
        let psd = dir.join("incoming.psd");
        fs::write(&psd, &incoming).unwrap();
        let unchained = sign_with(
            dev.signer.as_ref(),
            FIXTURE_PNG.to_vec(),
            "image/png",
            Some(&psd.to_string_lossy()),
            &[],
            "",
        )
        .expect("still signs without a chainable parent");
        let report = read_bytes(&unchained, "image/png").unwrap().expect("has credentials");
        assert!(!report.contains("\"parentOf\""));
        assert!(report.contains("c2pa.created"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn placed_sources_become_component_ingredients_with_their_own_credentials() {
        let dir = temp_c2pa_dir();
        fs::create_dir_all(&dir).unwrap();
        let dev = active_signer(None, true).expect("dev signer");

        // Two linked Smart Object sources: one already carrying credentials, one
        // a plain image. Both are things this export is *made of*.
        let signed_source = sign_with(dev.signer.as_ref(), FIXTURE_PNG.to_vec(), "image/png", None, &[], "").unwrap();
        let logo = dir.join("logo.png");
        fs::write(&logo, &signed_source).unwrap();
        let texture = dir.join("texture.png");
        fs::write(&texture, FIXTURE_PNG).unwrap();
        // Never opened (relinked/missing) and a container that can't carry a
        // store — neither may become an ingredient, nor break the export.
        let gone = dir.join("gone.png");
        let doc = dir.join("nested.psd");
        fs::write(&doc, FIXTURE_PNG).unwrap();

        let placed: Vec<String> = [&logo, &texture, &gone, &doc]
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        let placed: Vec<&str> = placed.iter().map(String::as_str).collect();
        let composed = sign_with(
            dev.signer.as_ref(),
            FIXTURE_PNG.to_vec(),
            "image/png",
            None,
            &placed,
            "c2pa.drawing",
        )
        .expect("composed export signs");

        let report = read_bytes(&composed, "image/png").unwrap().expect("has credentials");
        assert!(report.contains("\"componentOf\""), "placed sources are ingredients: {report}");
        assert!(report.contains("logo.png"), "ingredient names the placed file");
        assert!(report.contains("texture.png"), "…all of the readable ones");
        assert!(!report.contains("gone.png"), "an unreadable source is not claimed");
        assert!(!report.contains("nested.psd"), "a store-less container is not claimed");
        assert_eq!(report.matches("\"componentOf\"").count(), 2, "exactly the two we read: {report}");
        assert_eq!(report.matches("c2pa.placed").count(), 2, "one action per ingredient: {report}");
        assert!(report.contains("c2pa.drawing"), "the recipe still rides along");
        // Labels have to line up with the actions or the whole claim is Invalid —
        // a manifest that names an ingredient it doesn't have is worse than none.
        assert!(!report.contains("ingredientMismatch"), "placed actions link their ingredients: {report}");
        assert!(report.contains("\"validation_state\": \"Valid\""), "composed manifest validates: {report}");

        // A document with no placed sources must not claim any.
        let plain = sign_with(dev.signer.as_ref(), FIXTURE_PNG.to_vec(), "image/png", None, &[], "").unwrap();
        let plain_report = read_bytes(&plain, "image/png").unwrap().unwrap();
        assert!(!plain_report.contains("c2pa.placed"), "no placement claimed without one");

        // Parent and placed coexist: derived from one file, composed of others.
        let both = sign_with(
            dev.signer.as_ref(),
            FIXTURE_PNG.to_vec(),
            "image/png",
            Some(&logo.to_string_lossy()),
            &[texture.to_string_lossy().as_ref()],
            "",
        )
        .expect("chained + composed export signs");
        let both_report = read_bytes(&both, "image/png").unwrap().expect("has credentials");
        assert!(both_report.contains("\"parentOf\""));
        assert!(both_report.contains("\"componentOf\""));
        assert!(!both_report.contains("ingredientMismatch"), "{both_report}");
        assert!(both_report.contains("\"validation_state\": \"Valid\""), "{both_report}");

        // The renderer-supplied list is bounded.
        assert_eq!(actions_json(false, MAX_PLACED + 5, "").matches("c2pa.placed").count(), MAX_PLACED + 5);
        let flood: Vec<String> = (0..MAX_PLACED + 5).map(|_| logo.to_string_lossy().into_owned()).collect();
        let flood: Vec<&str> = flood.iter().map(String::as_str).collect();
        let capped = sign_with(dev.signer.as_ref(), FIXTURE_PNG.to_vec(), "image/png", None, &flood, "").unwrap();
        let capped_report = read_bytes(&capped, "image/png").unwrap().unwrap();
        assert_eq!(capped_report.matches("\"componentOf\"").count(), MAX_PLACED, "capped at MAX_PLACED");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn percent_decode_round_trips_non_ascii_paths_and_refuses_bad_escapes() {
        // Headers are ASCII; real photo paths are not.
        assert_eq!(percent_decode("/Users/a/Photos/%C3%A9t%C3%A9.jpg").as_deref(), Some("/Users/a/Photos/été.jpg"));
        assert_eq!(percent_decode("/plain/path.png").as_deref(), Some("/plain/path.png"));
        assert_eq!(percent_decode("%zz"), None);
        assert_eq!(percent_decode("trailing%"), None);
    }

    #[test]
    fn manifest_records_the_edit_recipe_and_discloses_generative_ai() {
        let dev = active_signer(None, true).expect("dev signer");
        let recipe = "c2pa.filtered,c2pa.color_adjustments,c2pa.filtered,ai";
        let signed = sign_with(
            dev.signer.as_ref(),
            FIXTURE_PNG.to_vec(),
            "image/png",
            None,
            &[],
            recipe,
        )
        .expect("signs with a recipe");
        let report = read_bytes(&signed, "image/png").unwrap().expect("has credentials");
        assert!(report.contains("c2pa.filtered"), "tools used are named: {report}");
        assert!(report.contains("c2pa.color_adjustments"), "…all of them: {report}");
        assert_eq!(report.matches("c2pa.filtered").count(), 1, "deduped: {report}");
        // The whole point of the standard for AI provenance.
        assert!(report.contains(AI_SOURCE_TYPE), "AI content disclosed: {report}");
        assert!(report.contains("\"validation_state\": \"Valid\""), "still validates: {report}");

        // Two documents with different histories must not claim the same thing.
        let plain = sign_with(dev.signer.as_ref(), FIXTURE_PNG.to_vec(), "image/png", None, &[], "").unwrap();
        let plain_report = read_bytes(&plain, "image/png").unwrap().unwrap();
        assert!(!plain_report.contains(AI_SOURCE_TYPE), "no AI claim without AI");
        assert!(!plain_report.contains("c2pa.filtered"), "no edits claimed that weren't made");

        // The header is renderer-supplied: anything off the allowlist is dropped,
        // never interpolated into the claim.
        let hostile = sign_with(
            dev.signer.as_ref(),
            FIXTURE_PNG.to_vec(),
            "image/png",
            None,
            &[],
            r#"c2pa.cropped,c2pa.made_up,"}],"assertions":[{"label":"evil"#,
        )
        .expect("hostile tokens must not break signing");
        let hostile_report = read_bytes(&hostile, "image/png").unwrap().unwrap();
        assert!(hostile_report.contains("c2pa.cropped"), "the valid token survives");
        assert!(!hostile_report.contains("evil"), "injection dropped: {hostile_report}");
        assert!(!hostile_report.contains("made_up"), "unknown action dropped");

        // A derived export keeps opened+edited and still lists the recipe once.
        let derived = actions_json(true, 0, "c2pa.edited,c2pa.cropped,ai");
        assert!(derived.contains("c2pa.opened"));
        assert_eq!(derived.matches(r#""action": "c2pa.edited""#).count(), 2, "{derived}");
        assert!(derived.contains(AI_SOURCE_TYPE));
    }

    #[test]
    fn detect_alg_identifies_es256_for_dev_cert() {
        assert_eq!(detect_alg(SIGN_CERT, SIGN_KEY).unwrap(), SigningAlg::Es256);
    }

    #[test]
    fn custom_signer_overrides_dev_cert_then_clear_reverts() {
        let dir = temp_c2pa_dir();

        // Nothing imported yet → dev signer.
        assert_eq!(active_signer(Some(&dir), true).unwrap().kind, "dev");

        // Reuse the dev cert/key as a stand-in "custom" import target.
        let info = import_signer(&dir, SIGN_CERT, SIGN_KEY, None).unwrap();
        assert_eq!(info.kind, "custom");
        assert_eq!(info.alg, "es256");
        assert!(!info.issuer.is_empty(), "issuer should be read back from the manifest");

        // Active signer is now the custom one and signs successfully.
        let active = active_signer(Some(&dir), true).unwrap();
        assert_eq!(active.kind, "custom");
        let signed = sign_with(active.signer.as_ref(), FIXTURE_PNG.to_vec(), "image/png", None, &[], "").unwrap();
        assert!(signed.len() > FIXTURE_PNG.len());

        // Persisted key is owner-only.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for f in [CERT_FILE, KEY_FILE] {
                let mode = fs::metadata(dir.join(f)).unwrap().permissions().mode();
                assert_eq!(mode & 0o777, 0o600, "{f} must be 0600");
            }
        }

        // Clear reverts to the dev signer and removes the files.
        clear_signer(&dir).unwrap();
        assert_eq!(active_signer(Some(&dir), true).unwrap().kind, "dev");
        assert!(!dir.join(CERT_FILE).exists());
        assert!(!dir.join(KEY_FILE).exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn import_persists_tsa_and_signer_reports_it() {
        let dir = temp_c2pa_dir();
        let info = import_signer(
            &dir,
            SIGN_CERT,
            SIGN_KEY,
            Some("http://timestamp.example/tsa".into()),
        )
        .unwrap();
        assert_eq!(info.tsa_url.as_deref(), Some("http://timestamp.example/tsa"));
        // The resolved active signer carries the same TSA URL from disk.
        assert_eq!(
            active_signer(Some(&dir), true).unwrap().tsa_url.as_deref(),
            Some("http://timestamp.example/tsa")
        );
        // Identity probe (countersign=false) must succeed offline: the configured
        // TSA is unreachable, so if the info path countersigned this would error.
        let probe = active_signer(Some(&dir), false).unwrap();
        let probe_info =
            signer_info_for(probe.kind, probe.signer.as_ref(), probe.tsa_url).unwrap();
        assert_eq!(probe_info.tsa_url.as_deref(), Some("http://timestamp.example/tsa"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn import_rejects_mismatched_key_and_persists_nothing() {
        let dir = temp_c2pa_dir();
        let bad_key = b"-----BEGIN PRIVATE KEY-----\nbm90IGEga2V5\n-----END PRIVATE KEY-----\n";
        assert!(import_signer(&dir, SIGN_CERT, bad_key, None).is_err());
        assert!(!dir.join(CERT_FILE).exists(), "no cert persisted on rejection");
        assert!(!dir.join(KEY_FILE).exists(), "no key persisted on rejection");
        let _ = fs::remove_dir_all(&dir);
    }
}

