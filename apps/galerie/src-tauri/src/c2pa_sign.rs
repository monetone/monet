//! Export ▸ Content Credentials (Signed): embed a cryptographically signed
//! C2PA manifest into an exported file, in place of the unsigned JSON sidecar
//! `catalog.rs`'s `writeCredentialsSidecar` (export.ts) writes today. Signing
//! needs an X.509 signer, so — exactly as in Vision — it lives here in the
//! native backend using `c2pa-rs`, not in the (crypto-less) frontend.
//!
//! One identity only: a user's own cert+key, imported through a future
//! Preferences panel (the commands below are ready for it) and persisted to
//! `appDataDir/c2pa/{cert.pem,key.pem,tsa}` — the private key as a `0600`
//! file, not the OS keychain (see `docs/c2pa-signing.md`; keychain is the
//! noted upgrade path there, and applies here too).
//!
//! Unlike Vision, there is **no dev signer**. Vision generates its own dev key
//! at build time and does not keep it in the repository. Shipping a copy here
//! would let Galerie sign as an untrusted identity it never earned, and a
//! second bundled key of Galerie's own would still be a private key living in
//! every install for a feature that is opt-in and off by default. So: no signer
//! configured means no embedding — `sign_content_credentials` returns [`NO_SIGNER_ERR`] and the
//! caller (export.ts) falls back to the existing unsigned `.c2pa.json`
//! sidecar, with a clear notice, rather than ever claiming a file is signed
//! when it isn't.
//!
//! No cached signer: every sign call resolves the *current* on-disk signer,
//! so an import takes effect on the very next export with no restart.
//!
//! Exposed as a Tauri plugin ("c2pa") so it registers its own invoke handler
//! alongside `catalog`'s and the others — Tauri allows only one app-level
//! `invoke_handler`, but any number of plugins, each namespaced
//! (`plugin:c2pa|sign_content_credentials`).
use std::fs;
use std::path::{Path, PathBuf};

use c2pa::SigningAlg;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Manager, Runtime, State};

use crate::catalog::{content_credentials, CatalogState, PARENT_LABEL};

/// 1-px PNG used to validate a signer by actually signing (and reading back
/// the resulting manifest) rather than parsing X.509 by hand. Not secret —
/// a blank pixel — unlike the signing key it exercises.
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

/// Every container the signed-export command accepts. c2pa-rs embeds the
/// manifest store natively in each of these — the same set Vision signs.
const SIGNABLE_MIMES: &[&str] = &["image/png", "image/jpeg", "image/tiff"];

/// Error `sign_content_credentials` returns when no custom signer has been
/// imported. Matched by name (not string contents) on the TypeScript side —
/// see `applyContentCredentials` in `export.ts` — as the one expected,
/// non-fatal outcome that means "fall back to the unsigned sidecar", distinct
/// from every other error (which is a real, reportable failure).
pub const NO_SIGNER_ERR: &str = "no signer configured";

/// Containers whose Content Credentials c2pa-rs can read (as an incoming file
/// or as a chained parent ingredient), mapped to the MIME it expects. Anything
/// else Galerie can open (PSD, most managed RAW containers) simply cannot
/// carry a manifest store — the parent is then left unchained rather than
/// failing the export. Mirrors Vision's `mime_for_path`.
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
        _ => return None,
    })
}

/// Identity of the imported signer, surfaced to a future Preferences panel.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SignerInfo {
    issuer: String,
    cert_serial: String,
    /// Lowercase signing alg (`"es256"`, `"ps256"`, …).
    alg: String,
    /// RFC-3161 timestamp authority URL, if the signer countersigns.
    tsa_url: Option<String>,
}

/// The active signer plus the metadata needed to describe it.
struct ActiveSigner {
    signer: Box<dyn c2pa::Signer>,
    tsa_url: Option<String>,
}

/// Sign `bytes` (a `mime` container) with `signer`, embedding `manifest_json`
/// (already-built, trusted claim content — see `content_credentials`) and, if
/// given, chaining `parent_path`'s own Content Credentials as the `parentOf`
/// ingredient. Pure + testable — the Tauri command is a thin wrapper.
fn sign_with(
    signer: &dyn c2pa::Signer,
    bytes: Vec<u8>,
    mime: &str,
    manifest_json: &str,
    parent_path: Option<&str>,
) -> Result<Vec<u8>, String> {
    use std::io::Cursor;
    let mut builder = c2pa::Builder::default()
        .with_definition(manifest_json)
        .map_err(|e| format!("manifest: {e}"))?;
    if let Some(path) = parent_path {
        if let Err(e) = chain_parent(&mut builder, path) {
            // An unreadable/renamed/uncarryable parent must not cost the
            // user the export — the manifest just states less provenance.
            eprintln!("c2pa: parent ingredient skipped ({e})");
        }
    }
    let mut src = Cursor::new(bytes);
    let mut dst = Cursor::new(Vec::new());
    builder
        .sign(signer, mime, &mut src, &mut dst)
        .map_err(|e| format!("sign: {e}"))?;
    Ok(dst.into_inner())
}

/// Chain `parent_path`'s own Content Credentials into `builder` as the
/// `parentOf` ingredient labelled [`PARENT_LABEL`] — the id
/// `content_credentials`'s `c2pa.opened` action already names in
/// `catalog.rs`, so the two must always agree or the manifest validates as
/// Invalid (`assertion.action.ingredientMismatch`).
fn chain_parent(builder: &mut c2pa::Builder, parent_path: &str) -> Result<(), String> {
    let mime = mime_for_path(parent_path).ok_or("parent container cannot carry a manifest store")?;
    let mut src = fs::File::open(parent_path).map_err(|e| format!("open parent: {e}"))?;
    let ingredient = builder
        .add_ingredient_from_stream(r#"{"relationship":"parentOf"}"#, mime, &mut src)
        .map_err(|e| format!("parent ingredient: {e}"))?;
    ingredient.set_label(PARENT_LABEL);
    if let Some(name) = Path::new(parent_path).file_name().and_then(|n| n.to_str()) {
        ingredient.set_title(name);
    }
    Ok(())
}

/// Auto-detect the signing algorithm for a cert+key pair by trial-signing the
/// bundled fixture with each candidate; the first that succeeds is the answer.
fn detect_alg(cert: &[u8], key: &[u8]) -> Result<SigningAlg, String> {
    for alg in CANDIDATE_ALGS {
        let Ok(signer) = c2pa::create_signer::from_keys(cert, key, alg, None) else {
            continue;
        };
        if sign_with(signer.as_ref(), FIXTURE_PNG.to_vec(), "image/png", PROBE_MANIFEST, None).is_ok() {
            return Ok(alg);
        }
    }
    Err("could not determine signing algorithm — is this a valid ES256/ES384/PS256/Ed25519 cert+key pair?".into())
}

/// Minimal, spec-valid manifest used only to trial-sign the fixture (algorithm
/// detection, import validation, signer-info readback) — never what an actual
/// export embeds, which always carries `content_credentials`'s real claim.
const PROBE_MANIFEST: &str = r#"{
  "claim_generator_info": [{ "name": "Monet Galerie", "version": "0.1.0" }],
  "title": "Monet Galerie signer probe"
}"#;

/// Resolve the signer to use right now: the custom cert+key under `c2pa_dir`
/// if both files are present, else `None` — there is no bundled fallback (see
/// module docs). `countersign` controls whether the built signer embeds the
/// configured RFC-3161 TSA — true for real exports (`sign_content_credentials`),
/// false for the identity probe (`c2pa_signer_info`) so merely *describing*
/// the signer never makes a network request (or fails/hangs offline).
fn active_signer(dir: &Path, countersign: bool) -> Result<Option<ActiveSigner>, String> {
    let cert_path = dir.join(CERT_FILE);
    let key_path = dir.join(KEY_FILE);
    if !cert_path.is_file() || !key_path.is_file() {
        return Ok(None);
    }
    let cert = fs::read(&cert_path).map_err(|e| format!("read cert: {e}"))?;
    let key = fs::read(&key_path).map_err(|e| format!("read key: {e}"))?;
    let tsa = read_tsa(dir);
    let alg = detect_alg(&cert, &key)?;
    let signer = c2pa::create_signer::from_keys(&cert, &key, alg, countersign.then(|| tsa.clone()).flatten())
        .map_err(|e| format!("signer: {e}"))?;
    Ok(Some(ActiveSigner { signer, tsa_url: tsa }))
}

/// Read a trimmed, non-empty TSA URL from `<dir>/tsa`, if any.
fn read_tsa(dir: &Path) -> Option<String> {
    fs::read_to_string(dir.join(TSA_FILE))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Build a `SignerInfo` by test-signing the probe manifest and reading back
/// the manifest's `signature_info()` (issuer/serial/alg).
fn signer_info_for(signer: &dyn c2pa::Signer, tsa_url: Option<String>) -> Result<SignerInfo, String> {
    use std::io::Cursor;
    let signed = sign_with(signer, FIXTURE_PNG.to_vec(), "image/png", PROBE_MANIFEST, None)?;
    let reader = c2pa::Reader::default()
        .with_stream("image/png", &mut Cursor::new(&signed))
        .map_err(|e| format!("read back: {e}"))?;
    let manifest = reader.active_manifest().ok_or("no active manifest")?;
    let info = manifest.signature_info().ok_or("no signature info")?;
    Ok(SignerInfo {
        issuer: info.issuer.clone().unwrap_or_default(),
        cert_serial: info.cert_serial_number.clone().unwrap_or_default(),
        alg: info.alg.map(|a| a.to_string()).unwrap_or_default(),
        tsa_url,
    })
}

/// Validate a cert+key by actually signing, then persist them as `0600` files
/// under `dir` (creating it). Returns the resulting signer identity. Nothing
/// is written if validation fails.
fn import_signer(dir: &Path, cert: &[u8], key: &[u8], tsa_url: Option<String>) -> Result<SignerInfo, String> {
    // Validate by signing (also rejects a mismatched cert/key here, pre-persist).
    let alg = detect_alg(cert, key)?;
    let tsa = tsa_url.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    // Describe the signer from a TSA-less sign so import works offline.
    let probe = c2pa::create_signer::from_keys(cert, key, alg, None).map_err(|e| format!("signer: {e}"))?;
    let info = signer_info_for(probe.as_ref(), tsa.clone())?;

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

/// Remove the custom signer files, reverting to "no signer configured".
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
    let base = app.path().app_data_dir().map_err(|e| format!("app data dir: {e}"))?;
    Ok(base.join(C2PA_SUBDIR))
}

/// `invoke("plugin:c2pa|sign_content_credentials", imageBytes, { headers })` →
/// signed image bytes. Raw request body in, raw response body out — never
/// JSON-array a multi-MB image. Resolves the active signer per call so an
/// import takes effect immediately.
///
/// `x-c2pa-mime`: the exported container, allowlisted to [`SIGNABLE_MIMES`].
/// `x-c2pa-photo-id`: the catalog photo id. The manifest is **never** taken
/// from the request — it is rebuilt here from `content_credentials(conn, id)`,
/// the same trusted, database-built claim `catalog_content_credentials`
/// already serves. Nothing the renderer sends ever reaches
/// `c2pa::Builder::with_definition` as claim content: a stricter cut of the
/// discipline Vision's header-token allowlist applies, possible here because
/// Galerie's Rust side already knows the whole claim and never has to trust
/// the renderer with authoring it.
///
/// Errors [`NO_SIGNER_ERR`] when nothing has been imported — the frontend's
/// cue to fall back to the unsigned `.c2pa.json` sidecar rather than report a
/// failed export.
#[tauri::command]
fn sign_content_credentials<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, CatalogState>,
    request: Request<'_>,
) -> Result<Response, String> {
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        _ => return Err("expected raw image body".into()),
    };
    let requested = request
        .headers()
        .get("x-c2pa-mime")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing x-c2pa-mime header")?;
    let mime = SIGNABLE_MIMES
        .iter()
        .find(|m| **m == requested)
        .ok_or_else(|| format!("unsupported C2PA export container: {requested}"))?;
    let id: i64 = request
        .headers()
        .get("x-c2pa-photo-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or("missing or invalid x-c2pa-photo-id header")?;

    let dir = c2pa_dir(&app)?;
    let Some(active) = active_signer(&dir, true)? else {
        return Err(NO_SIGNER_ERR.into());
    };
    let creds = {
        let guard = state.0.lock().map_err(|e| format!("catalog lock poisoned: {e}"))?;
        let conn = guard.as_ref().ok_or("no catalog open")?;
        content_credentials(conn, id)?
    };
    let signed = sign_with(active.signer.as_ref(), bytes, mime, &creds.manifest_json, Some(&creds.parent_path))?;
    Ok(Response::new(signed))
}

/// Identity of the imported signer, or `null` when nothing is configured yet.
#[tauri::command]
fn c2pa_signer_info<R: Runtime>(app: AppHandle<R>) -> Result<Option<SignerInfo>, String> {
    let dir = c2pa_dir(&app)?;
    // countersign=false: describing the signer must never hit the TSA network.
    match active_signer(&dir, false)? {
        Some(active) => signer_info_for(active.signer.as_ref(), active.tsa_url).map(Some),
        None => Ok(None),
    }
}

/// Import a user cert+key (PEM strings) as the signer. Validated by signing,
/// then persisted `0600`. `tsa_url` (optional) enables RFC-3161 countersigning
/// on future exports.
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

/// Remove the imported signer. Exports with Content Credentials on then fall
/// back to the unsigned sidecar again, same as before any import.
#[tauri::command]
fn c2pa_clear_signer<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let dir = c2pa_dir(&app)?;
    clear_signer(&dir)
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("c2pa")
        .invoke_handler(tauri::generate_handler![
            sign_content_credentials,
            c2pa_signer_info,
            c2pa_import_signer,
            c2pa_clear_signer
        ])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{db, ImportPhoto};
    use std::sync::atomic::{AtomicU32, Ordering};

    // Test-only throwaway ES256 pair. Generated in-process so no private key
    // is committed. Galerie itself ships no signing key (see module docs);
    // this path is compiled only under `cfg(test)` and never reaches the app binary.
    fn test_material() -> &'static (Vec<u8>, Vec<u8>) {
        use std::sync::OnceLock;
        static PEMS: OnceLock<(Vec<u8>, Vec<u8>)> = OnceLock::new();
        PEMS.get_or_init(|| {
            let key = rcgen::KeyPair::generate_for(&rcgen::PKCS_ECDSA_P256_SHA256).expect("test key");
            let mut params = rcgen::CertificateParams::default();
            params.not_before = rcgen::date_time_ymd(2026, 1, 1);
            params.not_after = rcgen::date_time_ymd(2036, 1, 1);
            params.subject_alt_names.clear();
            params.distinguished_name = rcgen::DistinguishedName::new();
            params
                .distinguished_name
                .push(rcgen::DnType::CommonName, "Monet Galerie Test Signer");
            params
                .distinguished_name
                .push(rcgen::DnType::OrganizationName, "Monet");
            params
                .distinguished_name
                .push(rcgen::DnType::CountryName, "US");
            params.is_ca = rcgen::IsCa::ExplicitNoCa;
            params.key_usages = vec![rcgen::KeyUsagePurpose::DigitalSignature];
            params.extended_key_usages = vec![rcgen::ExtendedKeyUsagePurpose::EmailProtection];
            params.use_authority_key_identifier_extension = true;
            let cert = params.self_signed(&key).expect("test cert");
            (cert.pem().into_bytes(), key.serialize_pem().into_bytes())
        })
    }

    fn test_cert() -> &'static [u8] {
        &test_material().0
    }

    fn test_key() -> &'static [u8] {
        &test_material().1
    }

    fn test_signer() -> Box<dyn c2pa::Signer> {
        c2pa::create_signer::from_keys(test_cert(), test_key(), SigningAlg::Es256, None).expect("test signer")
    }

    /// Unique temp dir per test (no `tempfile` dev-dep); cleaned by the caller.
    fn temp_dir(label: &str) -> PathBuf {
        static N: AtomicU32 = AtomicU32::new(0);
        let n = N.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let dir = std::env::temp_dir().join(format!("mg-c2pa-{label}-{pid}-{n}"));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn no_signer_configured_is_a_clean_none_not_an_error() {
        let dir = temp_dir("nosigner");
        // Nothing imported: detection must degrade cleanly (`Ok(None)`), never
        // error — that is exactly what lets the export path fall back to the
        // unsigned sidecar instead of surfacing a failure.
        assert_eq!(active_signer(&dir, true).unwrap().is_none(), true);

        let cert_path = dir.join(CERT_FILE);
        assert!(!cert_path.exists());
    }

    #[test]
    fn signing_over_a_catalog_photo_embeds_a_manifest_that_validates() {
        // A real catalog photo whose source file actually exists on disk, so
        // the parent ingredient (chained from `content_credentials`'s own
        // `parent_path`) can be opened and its Content Credentials read back —
        // proving the *real* Rust-built claim (not a hand-written stub) signs
        // and validates end to end, exactly as an export would produce it.
        let catalog_path = temp_dir("catalog").with_extension("galcat");
        let source_dir = temp_dir("source");
        fs::create_dir_all(&source_dir).unwrap();
        let source_path = source_dir.join("shot.png");
        fs::write(&source_path, FIXTURE_PNG).unwrap();

        let conn = db::open(catalog_path.to_str().unwrap()).unwrap();
        let id = db::import_photo(
            &conn,
            &ImportPhoto {
                path: source_path.to_string_lossy().into_owned(),
                fingerprint: "fp-shot".into(),
                format: "png".into(),
                byte_size: FIXTURE_PNG.len() as i64,
                mtime: 100,
                width: 1,
                height: 1,
                orientation: 1,
                capture_time: None,
                camera_make: None,
                camera_model: None,
                lens: None,
                iso: None,
                f_number: None,
                focal_length: None,
                exposure_time: None,
                gps_lat: None,
                gps_lon: None,
            },
        )
        .unwrap();

        let creds = content_credentials(&conn, id).unwrap();
        assert_eq!(creds.parent_path, source_path.to_string_lossy());

        let signer = test_signer();
        let exported = FIXTURE_PNG.to_vec(); // stand-in for the rendered export bytes
        let signed = sign_with(signer.as_ref(), exported, "image/png", &creds.manifest_json, Some(&creds.parent_path))
            .expect("signing the real catalog manifest must succeed");

        let reader = c2pa::Reader::default()
            .with_stream("image/png", &mut std::io::Cursor::new(&signed))
            .expect("embedded manifest must be readable");
        let active = reader.active_manifest().expect("has an active manifest");
        // No IPTC title on this photo → content_credentials names the manifest
        // after the source file, same as catalog.rs's own test expects.
        assert_eq!(active.title().unwrap_or_default(), "shot.png");
        let report = reader.json_checked().expect("report");
        assert!(report.contains("\"parentOf\""), "parent chained: {report}");
        assert!(report.contains("shot.png"), "ingredient names the source file: {report}");
        assert!(!report.contains("ingredientMismatch"), "opened action links the ingredient: {report}");
        assert!(report.contains("\"validation_state\": \"Valid\""), "signed export validates: {report}");

        drop(conn);
        let _ = fs::remove_file(catalog_path.with_extension("galcat-shm"));
        let _ = fs::remove_file(catalog_path.with_extension("galcat-wal"));
        let _ = fs::remove_file(&catalog_path);
        let _ = fs::remove_dir_all(&source_dir);
    }

    #[test]
    fn custom_signer_imports_signs_and_clear_reverts_to_no_signer() {
        let dir = temp_dir("custom");

        assert!(active_signer(&dir, true).unwrap().is_none());

        let info = import_signer(&dir, test_cert(), test_key(), None).unwrap();
        assert_eq!(info.alg, "es256");
        assert!(!info.issuer.is_empty(), "issuer should be read back from the manifest");

        let active = active_signer(&dir, true).unwrap().expect("now configured");
        let signed = sign_with(active.signer.as_ref(), FIXTURE_PNG.to_vec(), "image/png", PROBE_MANIFEST, None).unwrap();
        assert!(signed.len() > FIXTURE_PNG.len());

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for f in [CERT_FILE, KEY_FILE] {
                let mode = fs::metadata(dir.join(f)).unwrap().permissions().mode();
                assert_eq!(mode & 0o777, 0o600, "{f} must be 0600");
            }
        }

        clear_signer(&dir).unwrap();
        assert!(active_signer(&dir, true).unwrap().is_none());
        assert!(!dir.join(CERT_FILE).exists());
        assert!(!dir.join(KEY_FILE).exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn import_rejects_mismatched_key_and_persists_nothing() {
        let dir = temp_dir("bad");
        let bad_key = b"-----BEGIN PRIVATE KEY-----\nbm90IGEga2V5\n-----END PRIVATE KEY-----\n";
        assert!(import_signer(&dir, test_cert(), bad_key, None).is_err());
        assert!(!dir.join(CERT_FILE).exists(), "no cert persisted on rejection");
        assert!(!dir.join(KEY_FILE).exists(), "no key persisted on rejection");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unreadable_parent_does_not_fail_the_sign() {
        let signer = test_signer();
        // A parent path that does not exist on disk must not cost the export —
        // the manifest is signed unchained instead of the whole call failing.
        let signed = sign_with(
            signer.as_ref(),
            FIXTURE_PNG.to_vec(),
            "image/png",
            PROBE_MANIFEST,
            Some("/nonexistent/nowhere.png"),
        )
        .expect("still signs without a chainable parent");
        let reader = c2pa::Reader::default()
            .with_stream("image/png", &mut std::io::Cursor::new(&signed))
            .unwrap();
        let report = reader.json_checked().unwrap();
        assert!(!report.contains("\"parentOf\""));
    }
}
