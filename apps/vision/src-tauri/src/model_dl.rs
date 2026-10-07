use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{hash_map::Entry, HashMap, HashSet},
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{
    ipc::Channel,
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime, State, Url,
};

const MAX_REDIRECTS: usize = 5;
const MAX_MODEL_FILES: usize = 32;
const MAX_MODEL_FILE_BYTES: u64 = 3 * 1024 * 1024 * 1024;
const MAX_MODEL_UNIT_BYTES: u64 = 3 * 1024 * 1024 * 1024;

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum DownloadEvent {
    Progress { received: u64, total: u64 },
    Verifying,
    Done,
}

#[derive(Default)]
struct Downloads(Mutex<HashMap<String, Arc<AtomicBool>>>);

#[derive(Clone, Deserialize)]
struct ModelFileSpec {
    rel: String,
    sha256: String,
    bytes: u64,
}

fn validated_rel(rel: &str) -> Result<PathBuf, String> {
    let path = Path::new(rel);
    if rel.is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("invalid model path".into());
    }
    Ok(path.to_path_buf())
}

fn validated_id(id: &str) -> Result<&str, String> {
    if id.is_empty()
        || id.len() > 64
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("invalid model id".into());
    }
    Ok(id)
}

fn path_transfer_key(rel: &str) -> String {
    format!("path:{rel}")
}

fn import_transfer_key(id: &str) -> String {
    format!("import:{id}")
}

fn model_transfer_keys(id: &str, files: &[ModelFileSpec]) -> Vec<String> {
    let mut keys = vec![import_transfer_key(id)];
    keys.extend(files.iter().map(|file| path_transfer_key(&file.rel)));
    keys
}

fn reserve_transfer_keys(
    downloads: &Downloads,
    keys: &[String],
) -> Result<Arc<AtomicBool>, String> {
    let cancel = Arc::new(AtomicBool::new(false));
    let mut active = downloads
        .0
        .lock()
        .map_err(|_| "download state unavailable")?;
    if keys.iter().any(|key| active.contains_key(key)) {
        return Err("model transfer already active".into());
    }
    for key in keys {
        active.insert(key.clone(), cancel.clone());
    }
    Ok(cancel)
}

fn release_transfer_keys(downloads: &Downloads, keys: &[String]) {
    if let Ok(mut active) = downloads.0.lock() {
        for key in keys {
            active.remove(key);
        }
    }
}

fn validated_url(url: &str, allow_loopback_http: bool) -> Result<Url, String> {
    let parsed = Url::parse(url).map_err(|_| "invalid model URL")?;
    let loopback_http = allow_loopback_http
        && parsed.scheme() == "http"
        && parsed
            .host_str()
            .map(|host| {
                host == "localhost"
                    || host
                        .parse::<std::net::IpAddr>()
                        .is_ok_and(|ip| ip.is_loopback())
            })
            .unwrap_or(false);
    if parsed.scheme() != "https" && !loopback_http {
        return Err("model downloads require HTTPS".into());
    }
    Ok(parsed)
}

fn validated_sha256(value: &str) -> Result<String, String> {
    let value = value.to_ascii_lowercase();
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("invalid model SHA-256".into());
    }
    Ok(value)
}

fn validated_size(bytes: u64) -> Result<u64, String> {
    if bytes == 0 || bytes > MAX_MODEL_FILE_BYTES {
        return Err("invalid model byte size".into());
    }
    Ok(bytes)
}

fn suffixed_path(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

fn reject_symlink(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(format!("model path contains a symlink: {}", path.display()))
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

/// Reject the models root and every existing component below it. Unix file
/// opens also use O_NOFOLLOW for the leaf, closing the common symlink race.
fn reject_symlink_components(root: &Path, rel: &Path, include_leaf: bool) -> Result<(), String> {
    reject_symlink(root)?;
    let components: Vec<_> = rel.components().collect();
    let count = if include_leaf {
        components.len()
    } else {
        components.len().saturating_sub(1)
    };
    let mut current = root.to_path_buf();
    for component in components.into_iter().take(count) {
        current.push(component.as_os_str());
        reject_symlink(&current)?;
    }
    Ok(())
}

fn set_no_follow(options: &mut OpenOptions) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
}

fn open_read(path: &Path) -> Result<fs::File, String> {
    let mut options = OpenOptions::new();
    options.read(true);
    set_no_follow(&mut options);
    options.open(path).map_err(|e| e.to_string())
}

fn sync_parent_directory_best_effort(path: &Path) {
    let Some(parent) = path.parent() else {
        return;
    };
    if let Ok(directory) = fs::File::open(parent) {
        let _ = directory.sync_all();
    }
}

fn hash_file(path: &Path) -> Result<(Sha256, u64), String> {
    let mut file = open_read(path)?;
    let mut hash = Sha256::new();
    let mut buf = vec![0_u8; 256 * 1024];
    let mut bytes = 0;
    loop {
        let read = file.read(&mut buf).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hash.update(&buf[..read]);
        bytes += read as u64;
    }
    Ok((hash, bytes))
}

fn validated_redirect(
    current: &Url,
    location: &str,
    allow_loopback_http: bool,
) -> Result<Url, String> {
    let next = current
        .join(location)
        .map_err(|_| "invalid model redirect URL")?;
    if current.scheme() == "https" && next.scheme() != "https" {
        return Err("model redirect attempted to downgrade HTTPS".into());
    }
    validated_url(next.as_str(), allow_loopback_http)
}

fn request_with_redirects(
    client: &ureq::Agent,
    initial: &Url,
    offset: u64,
    allow_loopback_http: bool,
) -> Result<ureq::http::Response<ureq::Body>, String> {
    let mut current = initial.clone();
    for redirects in 0..=MAX_REDIRECTS {
        let mut request = client
            .get(current.as_str())
            .header("Accept-Encoding", "identity");
        if offset > 0 {
            request = request.header("Range", format!("bytes={offset}-"));
        }
        let response = request.call().map_err(|e| e.to_string())?;
        if response.status().is_redirection() {
            if redirects == MAX_REDIRECTS {
                return Err("too many model download redirects".into());
            }
            let location = response
                .headers()
                .get(ureq::http::header::LOCATION)
                .ok_or("model redirect omitted Location")?
                .to_str()
                .map_err(|_| "invalid model redirect Location")?;
            current = validated_redirect(&current, location, allow_loopback_http)?;
            continue;
        }
        return Ok(response);
    }
    unreachable!()
}

fn verify_file(dest_dir: &Path, file: &ModelFileSpec) -> Result<bool, String> {
    let rel = validated_rel(&file.rel)?;
    let expected = validated_sha256(&file.sha256)?;
    let expected_bytes = validated_size(file.bytes)?;
    reject_symlink_components(dest_dir, &rel, true)?;
    let path = dest_dir.join(rel);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.to_string()),
    };
    if !metadata.is_file() || metadata.len() != expected_bytes {
        return Ok(false);
    }
    let (hash, bytes) = hash_file(&path)?;
    Ok(bytes == expected_bytes && format!("{:x}", hash.finalize()) == expected)
}

fn verify_model_unit_at(dest_dir: &Path, files: &[ModelFileSpec]) -> Result<bool, String> {
    if files.is_empty() {
        return Ok(false);
    }
    recover_remove_transaction(dest_dir, files)?;
    recover_import_transaction(dest_dir, files)?;
    for file in files {
        if !verify_file(dest_dir, file)? {
            return Ok(false);
        }
    }
    Ok(true)
}

struct ImportEntry {
    rel: PathBuf,
    source: PathBuf,
    final_path: PathBuf,
    part_path: PathBuf,
    marker_path: PathBuf,
    marker_part_path: PathBuf,
    expected: String,
    bytes: u64,
}

fn validate_file_specs(files: &[ModelFileSpec]) -> Result<Vec<PathBuf>, String> {
    if files.is_empty() || files.len() > MAX_MODEL_FILES {
        return Err("invalid model unit file count".into());
    }
    let mut seen = HashSet::new();
    let mut total = 0_u64;
    let rels: Result<Vec<_>, String> = files
        .iter()
        .map(|file| {
            let rel = validated_rel(&file.rel)?;
            validated_sha256(&file.sha256)?;
            total = total
                .checked_add(validated_size(file.bytes)?)
                .ok_or("model unit size overflow")?;
            if !seen.insert(rel.clone()) {
                return Err("model unit contains a duplicate path".into());
            }
            Ok(rel)
        })
        .collect();
    let rels = rels?;
    if total > MAX_MODEL_UNIT_BYTES {
        return Err("model unit exceeds maximum supported size".into());
    }
    Ok(rels)
}

fn shared_source_prefix(rels: &[PathBuf]) -> Option<PathBuf> {
    if rels.len() < 2 {
        return None;
    }
    let first = rels
        .first()?
        .components()
        .next()?
        .as_os_str()
        .to_os_string();
    rels.iter()
        .all(|rel| {
            rel.components()
                .next()
                .is_some_and(|component| component.as_os_str() == first.as_os_str())
        })
        .then(|| PathBuf::from(first))
}

fn regular_metadata(path: &Path, role: &str) -> Result<fs::Metadata, String> {
    reject_symlink(path)?;
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err(format!("{role} is not a regular file: {}", path.display()));
    }
    Ok(metadata)
}

fn prepare_import_entries(
    dest_dir: &Path,
    source: &Path,
    files: &[ModelFileSpec],
) -> Result<Vec<ImportEntry>, String> {
    if !source.is_absolute() {
        return Err("model import source must be an absolute path".into());
    }
    reject_symlink(source)?;
    let rels = validate_file_specs(files)?;
    let source_metadata = fs::symlink_metadata(source).map_err(|e| e.to_string())?;
    if files.len() == 1 {
        if !source_metadata.is_file() {
            return Err("single-file model source is not a regular file".into());
        }
    } else if !source_metadata.is_dir() {
        return Err("multi-file model source is not a directory".into());
    }
    let shared_prefix = shared_source_prefix(&rels);

    files
        .iter()
        .zip(rels)
        .map(|(file, rel)| {
            let source_path = if files.len() == 1 {
                source.to_path_buf()
            } else {
                let source_rel = shared_prefix
                    .as_ref()
                    .and_then(|prefix| rel.strip_prefix(prefix).ok())
                    .unwrap_or(&rel);
                if source_rel.as_os_str().is_empty() {
                    return Err("invalid model source layout".into());
                }
                reject_symlink_components(source, source_rel, true)?;
                source.join(source_rel)
            };
            let source_meta = regular_metadata(&source_path, "model source")?;
            if source_meta.len() != file.bytes {
                return Err(format!(
                    "model source size mismatch for {}: expected {} bytes, got {}",
                    file.rel,
                    file.bytes,
                    source_meta.len()
                ));
            }

            reject_symlink_components(dest_dir, &rel, false)?;
            let final_path = dest_dir.join(&rel);
            if let Some(parent) = final_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            reject_symlink_components(dest_dir, &rel, true)?;
            let part_path = suffixed_path(&final_path, ".part");
            let marker_path = suffixed_path(&final_path, ".sha256");
            let marker_part_path = suffixed_path(&marker_path, ".part");
            for path in [&part_path, &marker_path, &marker_part_path] {
                reject_symlink(path)?;
            }

            Ok(ImportEntry {
                rel,
                source: source_path,
                final_path,
                part_path,
                marker_path,
                marker_part_path,
                expected: validated_sha256(&file.sha256)?,
                bytes: file.bytes,
            })
        })
        .collect()
}

fn remove_regular_if_present(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(format!("model path contains a symlink: {}", path.display()))
        }
        Ok(metadata) if metadata.is_file() => fs::remove_file(path).map_err(|e| e.to_string()),
        Ok(_) => Err(format!(
            "model path is not a regular file: {}",
            path.display()
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn safe_remove_import_path(dest_dir: &Path, entry: &ImportEntry, path: &Path) {
    if reject_symlink_components(dest_dir, &entry.rel, false).is_ok() {
        let _ = fs::remove_file(path);
    }
}

fn cleanup_import_parts(dest_dir: &Path, entries: &[ImportEntry]) {
    for entry in entries {
        safe_remove_import_path(dest_dir, entry, &entry.part_path);
        safe_remove_import_path(dest_dir, entry, &entry.marker_part_path);
    }
}

#[cfg_attr(not(test), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DownloadActivationFailure {
    MarkerOpen,
    MarkerWrite,
    MarkerSync,
    Rename,
}

fn stage_marker_path(
    marker_part_path: &Path,
    expected: &str,
    failure: Option<DownloadActivationFailure>,
) -> Result<(), String> {
    remove_regular_if_present(marker_part_path)?;
    if failure == Some(DownloadActivationFailure::MarkerOpen) {
        return Err("injected model marker open failure".into());
    }
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    set_no_follow(&mut options);
    let mut marker = options.open(marker_part_path).map_err(|e| e.to_string())?;
    if failure == Some(DownloadActivationFailure::MarkerWrite) {
        return Err("injected model marker write failure".into());
    }
    marker
        .write_all(format!("{expected}\n").as_bytes())
        .map_err(|e| e.to_string())?;
    if failure == Some(DownloadActivationFailure::MarkerSync) {
        return Err("injected model marker sync failure".into());
    }
    marker.sync_all().map_err(|e| e.to_string())?;
    sync_parent_directory_best_effort(marker_part_path);
    Ok(())
}

fn stage_marker(entry: &ImportEntry) -> Result<(), String> {
    stage_marker_path(&entry.marker_part_path, &entry.expected, None)
}

struct TransactionTarget {
    rel: PathBuf,
    staged: PathBuf,
    final_path: PathBuf,
    backup: PathBuf,
}

fn import_transaction(
    dest_dir: &Path,
    files: &[ModelFileSpec],
) -> Result<(PathBuf, Vec<TransactionTarget>), String> {
    let rels = validate_file_specs(files)?;
    let mut ordered: Vec<_> = files.iter().collect();
    ordered.sort_by(|a, b| a.rel.cmp(&b.rel));
    let mut digest = Sha256::new();
    for file in ordered {
        digest.update(file.rel.as_bytes());
        digest.update([0]);
    }
    let token = format!("{:x}", digest.finalize())[..16].to_owned();
    let transaction = dest_dir.join(format!(".model-import-{token}.txn"));
    let mut targets = Vec::with_capacity(files.len() * 2);
    for rel in rels {
        let final_path = dest_dir.join(&rel);
        let marker_path = suffixed_path(&final_path, ".sha256");
        targets.push(TransactionTarget {
            rel: rel.clone(),
            staged: suffixed_path(&final_path, ".part"),
            backup: suffixed_path(&final_path, &format!(".import-{token}.backup")),
            final_path,
        });
        targets.push(TransactionTarget {
            rel,
            staged: suffixed_path(&marker_path, ".part"),
            backup: suffixed_path(&marker_path, &format!(".import-{token}.backup")),
            final_path: marker_path,
        });
    }
    Ok((transaction, targets))
}

fn write_transaction_state(path: &Path, state: &str) -> Result<(), String> {
    reject_symlink(path)?;
    let mut options = OpenOptions::new();
    options.create(true).write(true).truncate(true);
    set_no_follow(&mut options);
    let mut file = options.open(path).map_err(|e| e.to_string())?;
    file.write_all(state.as_bytes())
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())
}

fn recover_import_transaction(dest_dir: &Path, files: &[ModelFileSpec]) -> Result<(), String> {
    let (transaction, targets) = import_transaction(dest_dir, files)?;
    reject_symlink(&transaction)?;
    let state = match fs::symlink_metadata(&transaction) {
        Ok(metadata) if metadata.is_file() => {
            let mut state = String::new();
            open_read(&transaction)?
                .read_to_string(&mut state)
                .map_err(|e| e.to_string())?;
            state
        }
        Ok(_) => return Err("model import transaction is not a regular file".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    let state = state.trim();
    if !matches!(state, "backing-up" | "activating" | "committed") {
        return Err("invalid model import transaction state".into());
    }
    for target in &targets {
        reject_symlink_components(dest_dir, &target.rel, false)?;
        reject_symlink(&target.final_path)?;
        reject_symlink(&target.staged)?;
        reject_symlink(&target.backup)?;
    }

    let committed_complete = state == "committed"
        && targets
            .iter()
            .all(|target| fs::symlink_metadata(&target.final_path).is_ok_and(|m| m.is_file()));
    if state == "activating" || (state == "committed" && !committed_complete) {
        for target in &targets {
            remove_regular_if_present(&target.final_path)?;
        }
    }
    if state != "committed" || !committed_complete {
        for target in &targets {
            if fs::symlink_metadata(&target.backup).is_ok_and(|m| m.is_file()) {
                remove_regular_if_present(&target.final_path)?;
                fs::rename(&target.backup, &target.final_path).map_err(|e| e.to_string())?;
            }
        }
    } else {
        for target in &targets {
            remove_regular_if_present(&target.backup)?;
        }
    }
    for target in &targets {
        remove_regular_if_present(&target.staged)?;
        remove_regular_if_present(&target.backup)?;
    }
    fs::remove_file(&transaction).map_err(|e| e.to_string())?;
    for target in &targets {
        sync_parent_directory_best_effort(&target.final_path);
    }
    sync_parent_directory_best_effort(&transaction);
    Ok(())
}

struct RemoveTarget {
    rel: PathBuf,
    final_path: PathBuf,
    backup: PathBuf,
}

fn remove_transaction(
    dest_dir: &Path,
    files: &[ModelFileSpec],
) -> Result<(PathBuf, Vec<RemoveTarget>), String> {
    let rels = validate_file_specs(files)?;
    let mut ordered: Vec<_> = files.iter().collect();
    ordered.sort_by(|a, b| a.rel.cmp(&b.rel));
    let mut digest = Sha256::new();
    for file in ordered {
        digest.update(file.rel.as_bytes());
        digest.update([0]);
    }
    let token = format!("{:x}", digest.finalize())[..16].to_owned();
    let transaction = dest_dir.join(format!(".model-remove-{token}.txn"));
    let mut targets = Vec::with_capacity(files.len() * 4);
    for rel in rels {
        let final_path = dest_dir.join(&rel);
        let part_path = suffixed_path(&final_path, ".part");
        let marker_path = suffixed_path(&final_path, ".sha256");
        let marker_part_path = suffixed_path(&marker_path, ".part");
        for path in [final_path, part_path, marker_path, marker_part_path] {
            targets.push(RemoveTarget {
                rel: rel.clone(),
                backup: suffixed_path(&path, &format!(".remove-{token}.backup")),
                final_path: path,
            });
        }
    }
    Ok((transaction, targets))
}

fn recover_remove_transaction(dest_dir: &Path, files: &[ModelFileSpec]) -> Result<(), String> {
    let (transaction, targets) = remove_transaction(dest_dir, files)?;
    reject_symlink(&transaction)?;
    let state = match fs::symlink_metadata(&transaction) {
        Ok(metadata) if metadata.is_file() => {
            let mut state = String::new();
            open_read(&transaction)?
                .read_to_string(&mut state)
                .map_err(|e| e.to_string())?;
            state
        }
        Ok(_) => return Err("model remove transaction is not a regular file".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    let state = state.trim();
    if !matches!(state, "removing" | "committed") {
        return Err("invalid model remove transaction state".into());
    }
    for target in &targets {
        reject_symlink_components(dest_dir, &target.rel, false)?;
        reject_symlink(&target.final_path)?;
        reject_symlink(&target.backup)?;
        for path in [&target.final_path, &target.backup] {
            if fs::symlink_metadata(path).is_ok_and(|metadata| !metadata.is_file()) {
                return Err(format!(
                    "model remove path is not a regular file: {}",
                    path.display()
                ));
            }
        }
    }

    if state == "committed" {
        for target in &targets {
            remove_regular_if_present(&target.final_path)?;
            remove_regular_if_present(&target.backup)?;
        }
    } else {
        for target in &targets {
            if fs::symlink_metadata(&target.backup).is_ok_and(|metadata| metadata.is_file()) {
                remove_regular_if_present(&target.final_path)?;
                fs::rename(&target.backup, &target.final_path).map_err(|e| e.to_string())?;
            }
        }
    }
    fs::remove_file(&transaction).map_err(|e| e.to_string())?;
    for target in &targets {
        sync_parent_directory_best_effort(&target.final_path);
    }
    sync_parent_directory_best_effort(&transaction);
    Ok(())
}

fn remove_model_at(dest_dir: &Path, id: &str, files: &[ModelFileSpec]) -> Result<(), String> {
    remove_model_at_inner(dest_dir, id, files, None)
}

fn remove_model_at_inner(
    dest_dir: &Path,
    id: &str,
    files: &[ModelFileSpec],
    fail_after: Option<usize>,
) -> Result<(), String> {
    validated_id(id)?;
    validate_file_specs(files)?;
    recover_import_transaction(dest_dir, files)?;
    recover_remove_transaction(dest_dir, files)?;
    let (transaction, targets) = remove_transaction(dest_dir, files)?;
    reject_symlink(&transaction)?;

    let mut has_target = false;
    for target in &targets {
        reject_symlink_components(dest_dir, &target.rel, false)?;
        reject_symlink(&target.final_path)?;
        reject_symlink(&target.backup)?;
        match fs::symlink_metadata(&target.final_path) {
            Ok(metadata) if metadata.is_file() => has_target = true,
            Ok(_) => {
                return Err(format!(
                    "model path is not a regular file: {}",
                    target.final_path.display()
                ))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
        if fs::symlink_metadata(&target.backup).is_ok() {
            return Err("stale model remove backup requires recovery".into());
        }
    }
    if !has_target {
        return Ok(());
    }

    write_transaction_state(&transaction, "removing")?;
    sync_parent_directory_best_effort(&transaction);
    for (index, target) in targets.iter().enumerate() {
        if fs::symlink_metadata(&target.final_path).is_ok_and(|metadata| metadata.is_file()) {
            if let Err(error) =
                fs::rename(&target.final_path, &target.backup).map_err(|e| e.to_string())
            {
                return match recover_remove_transaction(dest_dir, files) {
                    Ok(()) => Err(error),
                    Err(rollback) => {
                        Err(format!("{error}; model remove rollback failed: {rollback}"))
                    }
                };
            }
            sync_parent_directory_best_effort(&target.final_path);
        }
        if fail_after == Some(index + 1) {
            recover_remove_transaction(dest_dir, files)?;
            return Err("injected model remove failure".into());
        }
    }
    if let Err(error) = write_transaction_state(&transaction, "committed") {
        return match recover_remove_transaction(dest_dir, files) {
            Ok(()) => Err(error),
            Err(rollback) => Err(format!("{error}; model remove rollback failed: {rollback}")),
        };
    }
    recover_remove_transaction(dest_dir, files)
}

fn activate_import_transaction(
    dest_dir: &Path,
    files: &[ModelFileSpec],
    fail_after: Option<usize>,
) -> Result<(), String> {
    let (transaction, targets) = import_transaction(dest_dir, files)?;
    reject_symlink(&transaction)?;
    for target in &targets {
        reject_symlink_components(dest_dir, &target.rel, false)?;
        reject_symlink(&target.final_path)?;
        reject_symlink(&target.staged)?;
        reject_symlink(&target.backup)?;
        if fs::symlink_metadata(&target.backup).is_ok() {
            return Err("stale model import backup requires recovery".into());
        }
    }

    write_transaction_state(&transaction, "backing-up")?;
    sync_parent_directory_best_effort(&transaction);
    for target in &targets {
        if fs::symlink_metadata(&target.final_path).is_ok_and(|m| m.is_file()) {
            if let Err(error) =
                fs::rename(&target.final_path, &target.backup).map_err(|e| e.to_string())
            {
                let _ = recover_import_transaction(dest_dir, files);
                return Err(error);
            }
            sync_parent_directory_best_effort(&target.final_path);
        }
    }
    if let Err(error) = write_transaction_state(&transaction, "activating") {
        let _ = recover_import_transaction(dest_dir, files);
        return Err(error);
    }

    for (index, target) in targets.iter().enumerate() {
        if let Err(error) =
            fs::rename(&target.staged, &target.final_path).map_err(|e| e.to_string())
        {
            let _ = recover_import_transaction(dest_dir, files);
            return Err(error);
        }
        sync_parent_directory_best_effort(&target.final_path);
        if fail_after == Some(index + 1) {
            recover_import_transaction(dest_dir, files)?;
            return Err("injected model activation failure".into());
        }
    }
    if let Err(error) = write_transaction_state(&transaction, "committed") {
        let _ = recover_import_transaction(dest_dir, files);
        return Err(error);
    }
    recover_import_transaction(dest_dir, files)
}

fn import_model_at(
    dest_dir: &Path,
    source: &Path,
    files: &[ModelFileSpec],
    mut on_event: impl FnMut(DownloadEvent),
    cancelled: impl Fn() -> bool,
) -> Result<(), String> {
    import_model_at_inner(dest_dir, source, files, &mut on_event, cancelled, None)
}

fn import_model_at_inner(
    dest_dir: &Path,
    source: &Path,
    files: &[ModelFileSpec],
    on_event: &mut impl FnMut(DownloadEvent),
    cancelled: impl Fn() -> bool,
    activation_failure_after: Option<usize>,
) -> Result<(), String> {
    recover_remove_transaction(dest_dir, files)?;
    recover_import_transaction(dest_dir, files)?;
    let entries = prepare_import_entries(dest_dir, source, files)?;
    let total = entries
        .iter()
        .try_fold(0_u64, |sum, entry| sum.checked_add(entry.bytes))
        .ok_or("model unit size overflow")?;
    let mut received = 0_u64;
    on_event(DownloadEvent::Progress { received, total });

    let staged = (|| {
        for entry in &entries {
            if cancelled() {
                return Err("model import cancelled".into());
            }
            reject_symlink_components(dest_dir, &entry.rel, false)?;
            remove_regular_if_present(&entry.part_path)?;
            let mut input = open_read(&entry.source)?;
            let mut options = OpenOptions::new();
            options.create_new(true).write(true);
            set_no_follow(&mut options);
            let mut output = options.open(&entry.part_path).map_err(|e| e.to_string())?;
            let mut file_hash = Sha256::new();
            let mut file_bytes = 0_u64;
            let mut buf = vec![0_u8; 256 * 1024];
            loop {
                if cancelled() {
                    return Err("model import cancelled".into());
                }
                let read = input.read(&mut buf).map_err(|e| e.to_string())?;
                if read == 0 {
                    break;
                }
                let next_file = file_bytes
                    .checked_add(read as u64)
                    .ok_or("model import size overflow")?;
                if next_file > entry.bytes {
                    return Err(format!(
                        "model source exceeded expected size of {} bytes",
                        entry.bytes
                    ));
                }
                output.write_all(&buf[..read]).map_err(|e| e.to_string())?;
                file_hash.update(&buf[..read]);
                file_bytes = next_file;
                received = received
                    .checked_add(read as u64)
                    .ok_or("model unit size overflow")?;
                on_event(DownloadEvent::Progress { received, total });
            }
            output.sync_all().map_err(|e| e.to_string())?;
            drop(output);
            if file_bytes != entry.bytes {
                return Err(format!(
                    "model source size mismatch: expected {} bytes, got {file_bytes}",
                    entry.bytes
                ));
            }
            let actual = format!("{:x}", file_hash.finalize());
            if actual != entry.expected {
                return Err(format!(
                    "model checksum mismatch: expected {}, got {actual}",
                    entry.expected
                ));
            }
        }
        if cancelled() {
            return Err("model import cancelled".into());
        }
        on_event(DownloadEvent::Verifying);
        for entry in &entries {
            reject_symlink_components(dest_dir, &entry.rel, false)?;
            stage_marker(entry)?;
            for path in [&entry.final_path, &entry.marker_path] {
                reject_symlink(path)?;
                if fs::symlink_metadata(path).is_ok_and(|metadata| !metadata.is_file()) {
                    return Err(format!(
                        "model destination is not a regular file: {}",
                        path.display()
                    ));
                }
            }
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = staged {
        cleanup_import_parts(dest_dir, &entries);
        return Err(error);
    }

    if let Err(error) = activate_import_transaction(dest_dir, files, activation_failure_after) {
        cleanup_import_parts(dest_dir, &entries);
        return Err(error);
    }
    on_event(DownloadEvent::Done);
    Ok(())
}

fn activate_model(
    dest_dir: &Path,
    file: &ModelFileSpec,
    on_event: &mut impl FnMut(DownloadEvent),
) -> Result<(), String> {
    activate_model_inner(dest_dir, file, on_event, None)
}

fn activate_model_inner(
    dest_dir: &Path,
    file: &ModelFileSpec,
    on_event: &mut impl FnMut(DownloadEvent),
    failure: Option<DownloadActivationFailure>,
) -> Result<(), String> {
    let rel = validated_rel(&file.rel)?;
    let expected = validated_sha256(&file.sha256)?;
    validated_size(file.bytes)?;
    recover_remove_transaction(dest_dir, std::slice::from_ref(file))?;
    recover_import_transaction(dest_dir, std::slice::from_ref(file))?;
    reject_symlink_components(dest_dir, &rel, false)?;
    let final_path = dest_dir.join(&rel);
    let part_path = suffixed_path(&final_path, ".part");
    let marker_path = suffixed_path(&final_path, ".sha256");
    let marker_part_path = suffixed_path(&marker_path, ".part");
    let part_metadata = regular_metadata(&part_path, "downloaded model partial")?;
    if part_metadata.len() != file.bytes {
        return Err("downloaded model partial size changed before activation".into());
    }
    for path in [&final_path, &marker_path, &marker_part_path] {
        reject_symlink(path)?;
        if fs::symlink_metadata(path).is_ok_and(|metadata| !metadata.is_file()) {
            return Err(format!(
                "model destination is not a regular file: {}",
                path.display()
            ));
        }
    }

    let marker_failure = failure.filter(|failure| {
        matches!(
            failure,
            DownloadActivationFailure::MarkerOpen
                | DownloadActivationFailure::MarkerWrite
                | DownloadActivationFailure::MarkerSync
        )
    });
    if let Err(error) = stage_marker_path(&marker_part_path, &expected, marker_failure) {
        let _ = remove_regular_if_present(&marker_part_path);
        return Err(error);
    }
    let inject_rename_failure = failure == Some(DownloadActivationFailure::Rename);
    if inject_rename_failure {
        remove_regular_if_present(&marker_part_path)?;
    }
    if let Err(error) = activate_import_transaction(dest_dir, std::slice::from_ref(file), None) {
        let _ = remove_regular_if_present(&marker_part_path);
        if inject_rename_failure {
            return Err(format!("injected model activation rename failure: {error}"));
        }
        return Err(error);
    }
    on_event(DownloadEvent::Done);
    Ok(())
}

fn download_to(
    dest_dir: &Path,
    rel: &str,
    url: &str,
    sha256: &str,
    bytes: u64,
    allow_loopback_http: bool,
    mut on_event: impl FnMut(DownloadEvent),
    cancelled: impl Fn() -> bool,
) -> Result<PathBuf, String> {
    let rel_text = rel.to_owned();
    let rel = validated_rel(rel)?;
    let url = validated_url(url, allow_loopback_http)?;
    let expected = validated_sha256(sha256)?;
    let expected_bytes = validated_size(bytes)?;
    let file = ModelFileSpec {
        rel: rel_text,
        sha256: expected.clone(),
        bytes: expected_bytes,
    };
    let final_path = dest_dir.join(&rel);
    let part_path = suffixed_path(&final_path, ".part");
    let marker_path = suffixed_path(&final_path, ".sha256");
    reject_symlink_components(dest_dir, &rel, false)?;
    if let Some(parent) = final_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    reject_symlink_components(dest_dir, &rel, true)?;
    recover_remove_transaction(dest_dir, std::slice::from_ref(&file))?;
    recover_import_transaction(dest_dir, std::slice::from_ref(&file))?;
    reject_symlink(&part_path)?;
    reject_symlink(&marker_path)?;

    let client: ureq::Agent = ureq::Agent::config_builder()
        .https_only(!allow_loopback_http)
        .http_status_as_error(false)
        .max_redirects(0)
        .build()
        .into();
    let (mut hash, mut offset) = if part_path.exists() {
        let size = fs::symlink_metadata(&part_path)
            .map_err(|e| e.to_string())?
            .len();
        if size > expected_bytes {
            fs::remove_file(&part_path).map_err(|e| e.to_string())?;
            return Err(format!(
                "partial model exceeds expected size of {expected_bytes} bytes"
            ));
        }
        hash_file(&part_path)?
    } else {
        (Sha256::new(), 0)
    };

    if offset == expected_bytes {
        on_event(DownloadEvent::Verifying);
        let actual = format!("{:x}", hash.finalize());
        if actual != expected {
            let _ = fs::remove_file(&part_path);
            return Err(format!(
                "model checksum mismatch: expected {expected}, got {actual}"
            ));
        }
        activate_model(dest_dir, &file, &mut on_event)?;
        return Ok(final_path);
    }

    let request = |offset: u64| request_with_redirects(&client, &url, offset, allow_loopback_http);
    let mut response = request(offset)?;
    if offset > 0 && response.status().as_u16() == 200 {
        // The server ignored Range but this response already starts at byte zero:
        // truncate the local partial and consume it once, without redownloading.
        offset = 0;
        hash = Sha256::new();
    } else if offset > 0 && response.status().as_u16() != 206 {
        // A rejected complete/stale partial needs a fresh byte-zero request.
        offset = 0;
        hash = Sha256::new();
        response = request(0)?;
    }
    if !response.status().is_success() {
        return Err(format!("model server returned {}", response.status()));
    }

    let remaining = expected_bytes - offset;
    if let Some(content_length) = response.body().content_length() {
        if content_length != remaining {
            return Err(format!(
                "model response size mismatch: expected {remaining} bytes, got {content_length}"
            ));
        }
    }
    let mut options = OpenOptions::new();
    options
        .create(true)
        .write(true)
        .append(offset > 0)
        .truncate(offset == 0);
    set_no_follow(&mut options);
    let mut output = options.open(&part_path).map_err(|e| e.to_string())?;
    let mut received = offset;
    on_event(DownloadEvent::Progress {
        received,
        total: expected_bytes,
    });
    let mut reader = response.body_mut().as_reader();
    let mut buf = vec![0_u8; 256 * 1024];
    loop {
        let read = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        if cancelled() {
            return Err("download cancelled".into());
        }
        let next = received
            .checked_add(read as u64)
            .ok_or("model response size overflow")?;
        if next > expected_bytes {
            drop(output);
            let _ = fs::remove_file(&part_path);
            return Err(format!(
                "model response exceeded expected size of {expected_bytes} bytes"
            ));
        }
        output.write_all(&buf[..read]).map_err(|e| e.to_string())?;
        hash.update(&buf[..read]);
        received = next;
        on_event(DownloadEvent::Progress {
            received,
            total: expected_bytes,
        });
    }
    output.sync_all().map_err(|e| e.to_string())?;
    drop(output);
    if received != expected_bytes {
        return Err(format!(
            "model size mismatch: expected {expected_bytes} bytes, got {received}"
        ));
    }
    on_event(DownloadEvent::Verifying);

    let actual = format!("{:x}", hash.finalize());
    if actual != expected {
        let _ = fs::remove_file(&part_path);
        return Err(format!(
            "model checksum mismatch: expected {expected}, got {actual}"
        ));
    }
    activate_model(dest_dir, &file, &mut on_event)?;
    Ok(final_path)
}

#[tauri::command]
#[allow(unreachable_code)]
async fn download_model<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, Downloads>,
    rel: String,
    url: String,
    sha256: String,
    bytes: u64,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    // Pure-local provisioning policy (2026-07-16): Monet Vision never fetches
    // model weights over the network. Users download from the verified
    // upstream sources documented in public/models/MODELS.md and install via
    // Import (sha-validated). Refusing here — before reading ANY renderer
    // input — also closes the renderer-supplied-URL trust boundary: a
    // compromised webview cannot make the app fetch bytes. The transfer
    // machinery below is retained (unreachable) for its unit tests.
    return Err(
        "Model downloads are disabled — models are provisioned locally; see MODELS.md and use Import."
            .into(),
    );
    validated_rel(&rel)?;
    validated_size(bytes)?;
    let dest = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models");
    let active_key = path_transfer_key(&rel);
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut active = state.0.lock().map_err(|_| "download state unavailable")?;
        match active.entry(active_key.clone()) {
            Entry::Vacant(entry) => {
                entry.insert(cancel.clone());
            }
            Entry::Occupied(_) => return Err("model download already active".into()),
        }
    }
    let worker_cancel = cancel.clone();
    let worker_rel = rel.clone();
    let result = match tauri::async_runtime::spawn_blocking(move || {
        download_to(
            &dest,
            &worker_rel,
            &url,
            &sha256,
            bytes,
            false,
            |event| {
                let _ = on_event.send(event);
            },
            || worker_cancel.load(Ordering::Relaxed),
        )
    })
    .await
    {
        Ok(result) => result.map(|_| ()),
        Err(error) => Err(error.to_string()),
    };
    if let Ok(mut active) = state.0.lock() {
        active.remove(&active_key);
    }
    result
}

#[tauri::command]
async fn import_model<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, Downloads>,
    id: String,
    source: String,
    files: Vec<ModelFileSpec>,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    validated_id(&id)?;
    validate_file_specs(&files)?;
    let dest = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models");
    let active_keys = model_transfer_keys(&id, &files);
    let cancel = reserve_transfer_keys(state.inner(), &active_keys)?;
    let source = PathBuf::from(source);
    let worker_cancel = cancel.clone();
    let result = match tauri::async_runtime::spawn_blocking(move || {
        import_model_at(
            &dest,
            &source,
            &files,
            |event| {
                let _ = on_event.send(event);
            },
            || worker_cancel.load(Ordering::Relaxed),
        )
    })
    .await
    {
        Ok(result) => result,
        Err(error) => Err(error.to_string()),
    };
    release_transfer_keys(state.inner(), &active_keys);
    result
}

#[tauri::command]
async fn verify_model_unit<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, Downloads>,
    files: Vec<ModelFileSpec>,
) -> Result<bool, String> {
    validate_file_specs(&files)?;
    {
        let active = state.0.lock().map_err(|_| "download state unavailable")?;
        if files
            .iter()
            .any(|file| active.contains_key(&path_transfer_key(&file.rel)))
        {
            return Ok(false);
        }
    }
    let dest = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models");
    tauri::async_runtime::spawn_blocking(move || verify_model_unit_at(&dest, &files))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn remove_model<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, Downloads>,
    id: String,
    files: Vec<ModelFileSpec>,
) -> Result<(), String> {
    validated_id(&id)?;
    validate_file_specs(&files)?;
    let dest = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models");
    let active_keys = model_transfer_keys(&id, &files);
    let _reservation = reserve_transfer_keys(state.inner(), &active_keys)?;
    let result =
        match tauri::async_runtime::spawn_blocking(move || remove_model_at(&dest, &id, &files))
            .await
        {
            Ok(result) => result,
            Err(error) => Err(error.to_string()),
        };
    release_transfer_keys(state.inner(), &active_keys);
    result
}

#[tauri::command]
fn cancel_download(state: State<'_, Downloads>, rel: String) -> Result<(), String> {
    let active = state.0.lock().map_err(|_| "download state unavailable")?;
    if let Some(cancel) = active.get(&path_transfer_key(&rel)) {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
fn cancel_import(state: State<'_, Downloads>, id: String) -> Result<(), String> {
    validated_id(&id)?;
    let active = state.0.lock().map_err(|_| "download state unavailable")?;
    if let Some(cancel) = active.get(&import_transfer_key(&id)) {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("models")
        .invoke_handler(tauri::generate_handler![
            download_model,
            cancel_download,
            import_model,
            cancel_import,
            verify_model_unit,
            remove_model
        ])
        .setup(|app, _| {
            app.manage(Downloads::default());
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader},
        net::TcpListener,
        sync::atomic::{AtomicU32, Ordering as AtomicOrdering},
        thread,
    };

    fn temp_dir() -> PathBuf {
        static N: AtomicU32 = AtomicU32::new(0);
        let path = std::env::temp_dir().join(format!(
            "mv-model-test-{}-{}",
            std::process::id(),
            N.fetch_add(1, AtomicOrdering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn sha(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    fn serve_once(body: Vec<u8>) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut request = String::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                request.push_str(&line);
            }
            let offset = request
                .lines()
                .find_map(|line| {
                    line.strip_prefix("range: bytes=")
                        .or_else(|| line.strip_prefix("Range: bytes="))
                })
                .and_then(|value| value.trim_end_matches('-').parse::<usize>().ok())
                .unwrap_or(0);
            let status = if offset > 0 {
                "206 Partial Content"
            } else {
                "200 OK"
            };
            let slice = &body[offset..];
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                slice.len()
            )
            .unwrap();
            stream.write_all(slice).unwrap();
            request
        });
        (format!("http://{addr}/model.onnx"), handle)
    }

    fn serve_ignoring_range(body: Vec<u8>) -> (String, thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            let mut requests = Vec::new();
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut request = String::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                request.push_str(&line);
            }
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .unwrap();
            stream.write_all(&body).unwrap();
            requests.push(request);
            requests
        });
        (format!("http://{addr}/model.onnx"), handle)
    }

    fn serve_without_length(body: Vec<u8>) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
            }
            write!(stream, "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n").unwrap();
            stream.write_all(&body).unwrap();
        });
        (format!("http://{addr}/model.onnx"), handle)
    }

    fn serve_redirect(location: &str) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let location = location.to_owned();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
            }
            write!(
                stream,
                "HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            )
            .unwrap();
        });
        (format!("http://{addr}/model.onnx"), handle)
    }

    #[test]
    fn downloads_and_verifies_before_installing() {
        let dir = temp_dir();
        let body = b"verified model bytes".to_vec();
        let (url, server) = serve_once(body.clone());
        let path = download_to(
            &dir,
            "nested/model.onnx",
            &url,
            &sha(&body),
            body.len() as u64,
            true,
            |_| {},
            || false,
        )
        .unwrap();
        server.join().unwrap();
        assert_eq!(fs::read(&path).unwrap(), body);
        assert_eq!(
            fs::read_to_string(format!("{}.sha256", path.display()))
                .unwrap()
                .trim(),
            sha(&body)
        );
        assert!(!PathBuf::from(format!("{}.part", path.display())).exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn resumes_an_existing_partial_with_range() {
        let dir = temp_dir();
        let body = b"resume this model download".to_vec();
        let final_path = dir.join("model.onnx");
        fs::write(format!("{}.part", final_path.display()), &body[..7]).unwrap();
        let (url, server) = serve_once(body.clone());
        download_to(
            &dir,
            "model.onnx",
            &url,
            &sha(&body),
            body.len() as u64,
            true,
            |_| {},
            || false,
        )
        .unwrap();
        let request = server.join().unwrap();
        assert!(request.contains("bytes=7-"));
        assert_eq!(fs::read(final_path).unwrap(), body);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn promotes_a_complete_partial_without_network_access() {
        let dir = temp_dir();
        let body = b"download finished before activation";
        let final_path = dir.join("model.onnx");
        fs::write(suffixed_path(&final_path, ".part"), body).unwrap();

        let path = download_to(
            &dir,
            "model.onnx",
            "http://127.0.0.1:9/model.onnx",
            &sha(body),
            body.len() as u64,
            true,
            |_| {},
            || false,
        )
        .unwrap();

        assert_eq!(fs::read(path).unwrap(), body);
        assert!(!suffixed_path(&final_path, ".part").exists());
        assert_eq!(
            fs::read_to_string(suffixed_path(&final_path, ".sha256"))
                .unwrap()
                .trim(),
            sha(body)
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn download_activation_failures_restore_the_old_pair_without_done() {
        for failure in [
            DownloadActivationFailure::MarkerOpen,
            DownloadActivationFailure::MarkerWrite,
            DownloadActivationFailure::MarkerSync,
            DownloadActivationFailure::Rename,
        ] {
            let dir = temp_dir();
            let old = b"old-model";
            let new = b"new-model";
            let final_path = dir.join("model.onnx");
            let marker_path = suffixed_path(&final_path, ".sha256");
            let marker_part_path = suffixed_path(&marker_path, ".part");
            fs::write(&final_path, old).unwrap();
            fs::write(&marker_path, format!("{}\n", sha(old))).unwrap();
            fs::write(suffixed_path(&final_path, ".part"), new).unwrap();
            let file = ModelFileSpec {
                rel: "model.onnx".into(),
                sha256: sha(new),
                bytes: new.len() as u64,
            };
            let mut events = Vec::new();

            let error =
                activate_model_inner(&dir, &file, &mut |event| events.push(event), Some(failure))
                    .unwrap_err();

            assert!(error.contains("injected"), "{failure:?}: {error}");
            assert_eq!(fs::read(&final_path).unwrap(), old, "{failure:?}");
            assert_eq!(
                fs::read_to_string(&marker_path).unwrap().trim(),
                sha(old),
                "{failure:?}"
            );
            assert!(
                !events
                    .iter()
                    .any(|event| matches!(event, DownloadEvent::Done)),
                "{failure:?} emitted a false completion"
            );
            assert!(!marker_part_path.exists(), "{failure:?}");
            let (transaction, targets) = import_transaction(&dir, &[file]).unwrap();
            assert!(!transaction.exists(), "{failure:?}");
            assert!(
                targets.iter().all(|target| !target.backup.exists()),
                "{failure:?} left an activation backup"
            );
            fs::remove_dir_all(dir).unwrap();
        }
    }

    #[test]
    fn restarts_when_the_server_ignores_range() {
        let dir = temp_dir();
        let body = b"server sends the whole model".to_vec();
        let final_path = dir.join("model.onnx");
        fs::write(format!("{}.part", final_path.display()), &body[..5]).unwrap();
        let (url, server) = serve_ignoring_range(body.clone());
        download_to(
            &dir,
            "model.onnx",
            &url,
            &sha(&body),
            body.len() as u64,
            true,
            |_| {},
            || false,
        )
        .unwrap();
        let requests = server.join().unwrap();
        assert!(requests[0].contains("bytes=5-"));
        assert_eq!(
            requests.len(),
            1,
            "the full response is consumed instead of requested twice"
        );
        assert_eq!(fs::read(final_path).unwrap(), body);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_corrupt_download_and_unsafe_inputs() {
        let dir = temp_dir();
        let body = b"tampered".to_vec();
        let (url, server) = serve_once(body);
        let result = download_to(
            &dir,
            "model.onnx",
            &url,
            &sha(b"expected"),
            8,
            true,
            |_| {},
            || false,
        );
        server.join().unwrap();
        assert!(result.unwrap_err().contains("checksum mismatch"));
        assert!(!dir.join("model.onnx").exists());
        assert!(!dir.join("model.onnx.part").exists());
        assert!(validated_rel("../escape.onnx").is_err());
        assert!(validated_url("http://example.com/model", false).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn enforces_expected_size_with_and_without_content_length() {
        let dir = temp_dir();
        let body = b"more bytes than allowed".to_vec();
        let (url, server) = serve_once(body.clone());
        let error = download_to(
            &dir,
            "declared.onnx",
            &url,
            &sha(&body),
            (body.len() - 1) as u64,
            true,
            |_| {},
            || false,
        )
        .unwrap_err();
        server.join().unwrap();
        assert!(error.contains("response size mismatch"));
        assert!(!dir.join("declared.onnx.part").exists());

        let (url, server) = serve_without_length(body.clone());
        let error = download_to(
            &dir,
            "streamed.onnx",
            &url,
            &sha(&body),
            (body.len() - 1) as u64,
            true,
            |_| {},
            || false,
        )
        .unwrap_err();
        server.join().unwrap();
        assert!(error.contains("exceeded expected size"));
        assert!(!dir.join("streamed.onnx.part").exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn revalidates_every_redirect_against_transport_policy() {
        let dir = temp_dir();
        let (url, server) = serve_redirect("http://example.com/model.onnx");
        let error = download_to(
            &dir,
            "model.onnx",
            &url,
            &sha(b"x"),
            1,
            true,
            |_| {},
            || false,
        )
        .unwrap_err();
        server.join().unwrap();
        assert!(error.contains("require HTTPS"));

        let secure = Url::parse("https://models.example/model.onnx").unwrap();
        assert!(
            validated_redirect(&secure, "http://127.0.0.1/model.onnx", true)
                .unwrap_err()
                .contains("downgrade")
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn native_verification_hashes_bytes_instead_of_trusting_the_marker() {
        let dir = temp_dir();
        let expected = b"trusted model";
        let path = dir.join("model.onnx");
        fs::write(&path, expected).unwrap();
        fs::write(
            dir.join("model.onnx.sha256"),
            format!("{}\n", sha(expected)),
        )
        .unwrap();
        let files = [ModelFileSpec {
            rel: "model.onnx".into(),
            sha256: sha(expected),
            bytes: expected.len() as u64,
        }];
        assert!(verify_model_unit_at(&dir, &files).unwrap());

        fs::write(&path, b"altered model").unwrap();
        assert!(!verify_model_unit_at(&dir, &files).unwrap());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn removes_an_entire_model_unit_and_its_partial_artifacts() {
        let dir = temp_dir();
        let files = [
            ModelFileSpec {
                rel: "unit/a.onnx".into(),
                sha256: sha(b"model-a"),
                bytes: 7,
            },
            ModelFileSpec {
                rel: "unit/b.onnx".into(),
                sha256: sha(b"model-b"),
                bytes: 7,
            },
        ];
        for (file, bytes) in files.iter().zip([b"model-a", b"model-b"]) {
            let path = dir.join(&file.rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, bytes).unwrap();
            fs::write(suffixed_path(&path, ".part"), b"partial").unwrap();
            fs::write(
                suffixed_path(&path, ".sha256"),
                format!("{}\n", file.sha256),
            )
            .unwrap();
            fs::write(suffixed_path(&path, ".sha256.part"), b"marker-partial").unwrap();
        }

        remove_model_at(&dir, "unit", &files).unwrap();

        for file in &files {
            let path = dir.join(&file.rel);
            for target in [
                path.clone(),
                suffixed_path(&path, ".part"),
                suffixed_path(&path, ".sha256"),
                suffixed_path(&path, ".sha256.part"),
            ] {
                assert!(!target.exists(), "{} survived removal", target.display());
            }
        }
        let (transaction, targets) = remove_transaction(&dir, &files).unwrap();
        assert!(!transaction.exists());
        assert!(targets.iter().all(|target| !target.backup.exists()));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn remove_failure_restores_every_artifact_in_the_model_unit() {
        let dir = temp_dir();
        let files = [
            ModelFileSpec {
                rel: "unit/a.onnx".into(),
                sha256: sha(b"model-a"),
                bytes: 7,
            },
            ModelFileSpec {
                rel: "unit/b.onnx".into(),
                sha256: sha(b"model-b"),
                bytes: 7,
            },
        ];
        let mut originals = Vec::new();
        for (file, bytes) in files.iter().zip([b"model-a", b"model-b"]) {
            let path = dir.join(&file.rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            for (target, contents) in [
                (path.clone(), bytes.as_slice()),
                (suffixed_path(&path, ".part"), b"partial".as_slice()),
                (suffixed_path(&path, ".sha256"), file.sha256.as_bytes()),
                (
                    suffixed_path(&path, ".sha256.part"),
                    b"marker-partial".as_slice(),
                ),
            ] {
                fs::write(&target, contents).unwrap();
                originals.push((target, contents.to_vec()));
            }
        }

        let error = remove_model_at_inner(&dir, "unit", &files, Some(5)).unwrap_err();

        assert!(error.contains("injected"));
        for (path, contents) in originals {
            assert_eq!(
                fs::read(&path).unwrap(),
                contents,
                "{} was not restored",
                path.display()
            );
        }
        let (transaction, targets) = remove_transaction(&dir, &files).unwrap();
        assert!(!transaction.exists());
        assert!(targets.iter().all(|target| !target.backup.exists()));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn verification_recovers_interrupted_and_committed_remove_journals() {
        let dir = temp_dir();
        let bytes = b"installed-model";
        let path = dir.join("unit/model.onnx");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, bytes).unwrap();
        fs::write(suffixed_path(&path, ".sha256"), format!("{}\n", sha(bytes))).unwrap();
        let files = [ModelFileSpec {
            rel: "unit/model.onnx".into(),
            sha256: sha(bytes),
            bytes: bytes.len() as u64,
        }];
        let (transaction, targets) = remove_transaction(&dir, &files).unwrap();
        let changed_manifest = [ModelFileSpec {
            rel: files[0].rel.clone(),
            sha256: sha(b"new-manifest-model"),
            bytes: 18,
        }];
        assert_eq!(
            transaction,
            remove_transaction(&dir, &changed_manifest).unwrap().0,
            "remove recovery must depend on paths, not mutable hashes or sizes",
        );

        write_transaction_state(&transaction, "removing").unwrap();
        for target in &targets {
            if target.final_path.exists() {
                fs::rename(&target.final_path, &target.backup).unwrap();
            }
        }
        recover_remove_transaction(&dir, &changed_manifest).unwrap();
        assert!(verify_model_unit_at(&dir, &files).unwrap());
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert!(!transaction.exists());

        write_transaction_state(&transaction, "removing").unwrap();
        for target in &targets {
            if target.final_path.exists() {
                fs::rename(&target.final_path, &target.backup).unwrap();
            }
        }
        write_transaction_state(&transaction, "committed").unwrap();
        assert!(!verify_model_unit_at(&dir, &files).unwrap());
        assert!(!path.exists());
        assert!(!suffixed_path(&path, ".sha256").exists());
        assert!(!transaction.exists());
        assert!(targets.iter().all(|target| !target.backup.exists()));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn remove_validates_the_unit_and_refuses_import_or_path_overlap() {
        let dir = temp_dir();
        let path = dir.join("unit/model.onnx");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"x").unwrap();
        let files = [ModelFileSpec {
            rel: "unit/model.onnx".into(),
            sha256: sha(b"x"),
            bytes: 1,
        }];
        assert!(remove_model_at(&dir, "invalid id", &files)
            .unwrap_err()
            .contains("invalid model id"));
        let invalid_files = [ModelFileSpec {
            rel: files[0].rel.clone(),
            sha256: "not-a-hash".into(),
            bytes: 1,
        }];
        assert!(remove_model_at(&dir, "unit", &invalid_files)
            .unwrap_err()
            .contains("SHA-256"));
        assert_eq!(fs::read(&path).unwrap(), b"x");

        let downloads = Downloads::default();
        let remove_keys = model_transfer_keys("unit", &files);
        let path_keys = vec![path_transfer_key(&files[0].rel)];
        reserve_transfer_keys(&downloads, &path_keys).unwrap();
        assert!(reserve_transfer_keys(&downloads, &remove_keys)
            .unwrap_err()
            .contains("already active"));
        release_transfer_keys(&downloads, &path_keys);

        let import_keys = vec![import_transfer_key("unit")];
        reserve_transfer_keys(&downloads, &import_keys).unwrap();
        assert!(reserve_transfer_keys(&downloads, &remove_keys)
            .unwrap_err()
            .contains("already active"));
        release_transfer_keys(&downloads, &import_keys);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn imports_a_single_pinned_file_without_routing_bytes_through_ipc() {
        let source_dir = temp_dir();
        let dest = temp_dir();
        let bytes = b"locally built model";
        let source = source_dir.join("drunet_color.onnx");
        fs::write(&source, bytes).unwrap();
        let files = [ModelFileSpec {
            rel: "drunet_color.onnx".into(),
            sha256: sha(bytes),
            bytes: bytes.len() as u64,
        }];

        import_model_at(&dest, &source, &files, |_| {}, || false).unwrap();

        let installed = dest.join("drunet_color.onnx");
        assert_eq!(fs::read(&installed).unwrap(), bytes);
        assert_eq!(
            fs::read_to_string(suffixed_path(&installed, ".sha256"))
                .unwrap()
                .trim(),
            sha(bytes)
        );
        assert!(!suffixed_path(&installed, ".part").exists());
        fs::remove_dir_all(source_dir).unwrap();
        fs::remove_dir_all(dest).unwrap();
    }

    #[test]
    fn imports_a_complete_folder_only_after_every_file_verifies() {
        let source = temp_dir();
        let dest = temp_dir();
        let text = b"text encoder";
        let unet = b"unet weights";
        fs::create_dir_all(source.join("text_encoder")).unwrap();
        fs::create_dir_all(source.join("unet")).unwrap();
        fs::write(source.join("text_encoder/model.onnx"), text).unwrap();
        fs::write(source.join("unet/model.onnx"), unet).unwrap();
        let files = [
            ModelFileSpec {
                rel: "sd15/text_encoder/model.onnx".into(),
                sha256: sha(text),
                bytes: text.len() as u64,
            },
            ModelFileSpec {
                rel: "sd15/unet/model.onnx".into(),
                sha256: sha(unet),
                bytes: unet.len() as u64,
            },
        ];

        import_model_at(&dest, &source, &files, |_| {}, || false).unwrap();

        assert_eq!(fs::read(dest.join(&files[0].rel)).unwrap(), text);
        assert_eq!(fs::read(dest.join(&files[1].rel)).unwrap(), unet);
        fs::remove_dir_all(source).unwrap();
        fs::remove_dir_all(dest).unwrap();
    }

    #[test]
    fn import_failure_activates_nothing_and_cleans_every_partial() {
        let source = temp_dir();
        let dest = temp_dir();
        fs::write(source.join("a.onnx"), b"first").unwrap();
        fs::write(source.join("b.onnx"), b"wrong").unwrap();
        let files = [
            ModelFileSpec {
                rel: "unit/a.onnx".into(),
                sha256: sha(b"first"),
                bytes: 5,
            },
            ModelFileSpec {
                rel: "unit/b.onnx".into(),
                sha256: sha(b"right"),
                bytes: 5,
            },
        ];

        let error = import_model_at(&dest, &source, &files, |_| {}, || false).unwrap_err();

        assert!(error.contains("checksum mismatch"));
        for file in &files {
            let final_path = dest.join(&file.rel);
            assert!(!final_path.exists());
            assert!(!suffixed_path(&final_path, ".part").exists());
            assert!(!suffixed_path(&final_path, ".sha256.part").exists());
        }
        fs::remove_dir_all(source).unwrap();
        fs::remove_dir_all(dest).unwrap();
    }

    #[test]
    fn activation_failure_restores_the_entire_previous_unit() {
        let source = temp_dir();
        let dest = temp_dir();
        fs::write(source.join("a.onnx"), b"new-a").unwrap();
        fs::write(source.join("b.onnx"), b"new-b").unwrap();
        fs::create_dir_all(dest.join("unit")).unwrap();
        fs::write(dest.join("unit/a.onnx"), b"old-a").unwrap();
        fs::write(dest.join("unit/b.onnx"), b"old-b").unwrap();
        fs::write(
            dest.join("unit/a.onnx.sha256"),
            format!("{}\n", sha(b"old-a")),
        )
        .unwrap();
        fs::write(
            dest.join("unit/b.onnx.sha256"),
            format!("{}\n", sha(b"old-b")),
        )
        .unwrap();
        let files = [
            ModelFileSpec {
                rel: "unit/a.onnx".into(),
                sha256: sha(b"new-a"),
                bytes: 5,
            },
            ModelFileSpec {
                rel: "unit/b.onnx".into(),
                sha256: sha(b"new-b"),
                bytes: 5,
            },
        ];
        let mut on_event = |_| {};

        let error = import_model_at_inner(&dest, &source, &files, &mut on_event, || false, Some(1))
            .unwrap_err();

        assert!(error.contains("injected"));
        assert_eq!(fs::read(dest.join("unit/a.onnx")).unwrap(), b"old-a");
        assert_eq!(fs::read(dest.join("unit/b.onnx")).unwrap(), b"old-b");
        assert_eq!(
            fs::read_to_string(dest.join("unit/a.onnx.sha256"))
                .unwrap()
                .trim(),
            sha(b"old-a")
        );
        assert_eq!(
            fs::read_to_string(dest.join("unit/b.onnx.sha256"))
                .unwrap()
                .trim(),
            sha(b"old-b")
        );
        let (transaction, targets) = import_transaction(&dest, &files).unwrap();
        assert!(!transaction.exists());
        assert!(targets
            .iter()
            .all(|target| !target.staged.exists() && !target.backup.exists()));
        fs::remove_dir_all(source).unwrap();
        fs::remove_dir_all(dest).unwrap();
    }

    #[test]
    fn native_verification_recovers_a_crash_mid_activation_after_manifest_change() {
        let dest = temp_dir();
        fs::create_dir_all(dest.join("unit")).unwrap();
        let old_files = [
            ModelFileSpec {
                rel: "unit/a.onnx".into(),
                sha256: sha(b"old-a"),
                bytes: 5,
            },
            ModelFileSpec {
                rel: "unit/b.onnx".into(),
                sha256: sha(b"old-b"),
                bytes: 5,
            },
        ];
        let new_files = [
            ModelFileSpec {
                rel: "unit/a.onnx".into(),
                sha256: sha(b"new-a"),
                bytes: 5,
            },
            ModelFileSpec {
                rel: "unit/b.onnx".into(),
                sha256: sha(b"new-b"),
                bytes: 5,
            },
        ];
        fs::write(dest.join("unit/a.onnx"), b"old-a").unwrap();
        fs::write(dest.join("unit/b.onnx"), b"old-b").unwrap();
        fs::write(
            dest.join("unit/a.onnx.sha256"),
            format!("{}\n", sha(b"old-a")),
        )
        .unwrap();
        fs::write(
            dest.join("unit/b.onnx.sha256"),
            format!("{}\n", sha(b"old-b")),
        )
        .unwrap();
        let (transaction, targets) = import_transaction(&dest, &old_files).unwrap();
        assert_eq!(
            transaction,
            import_transaction(&dest, &new_files).unwrap().0,
            "transaction recovery must not depend on artifact hash or size",
        );
        for (index, target) in targets.iter().enumerate() {
            fs::write(&target.staged, format!("new-{index}")).unwrap();
        }
        write_transaction_state(&transaction, "backing-up").unwrap();
        for target in &targets {
            fs::rename(&target.final_path, &target.backup).unwrap();
        }
        write_transaction_state(&transaction, "activating").unwrap();
        fs::rename(&targets[0].staged, &targets[0].final_path).unwrap();

        // A new app version verifies against its new manifest. Recovery still
        // finds the prior version's journal and restores the complete old unit.
        assert!(!verify_model_unit_at(&dest, &new_files).unwrap());
        assert_eq!(fs::read(dest.join("unit/a.onnx")).unwrap(), b"old-a");
        assert_eq!(fs::read(dest.join("unit/b.onnx")).unwrap(), b"old-b");
        assert!(!transaction.exists());
        assert!(targets
            .iter()
            .all(|target| !target.staged.exists() && !target.backup.exists()));
        fs::remove_dir_all(dest).unwrap();
    }

    #[test]
    fn rejects_unbounded_native_import_manifests() {
        let hash = sha(b"x");
        let too_many: Vec<_> = (0..=MAX_MODEL_FILES)
            .map(|index| ModelFileSpec {
                rel: format!("unit/{index}.onnx"),
                sha256: hash.clone(),
                bytes: 1,
            })
            .collect();
        assert!(validate_file_specs(&too_many)
            .unwrap_err()
            .contains("file count"));

        let size = MAX_MODEL_UNIT_BYTES / 2 + 1;
        let too_large = [
            ModelFileSpec {
                rel: "unit/a.onnx".into(),
                sha256: hash.clone(),
                bytes: size,
            },
            ModelFileSpec {
                rel: "unit/b.onnx".into(),
                sha256: hash,
                bytes: size,
            },
        ];
        assert!(validate_file_specs(&too_large)
            .unwrap_err()
            .contains("maximum supported size"));
    }

    #[test]
    fn cancelled_import_removes_its_partial_file() {
        use std::cell::Cell;

        let source_dir = temp_dir();
        let dest = temp_dir();
        let source = source_dir.join("model.onnx");
        let bytes = vec![7_u8; 600_000];
        fs::write(&source, &bytes).unwrap();
        let files = [ModelFileSpec {
            rel: "model.onnx".into(),
            sha256: sha(&bytes),
            bytes: bytes.len() as u64,
        }];
        let checks = Cell::new(0);

        let error = import_model_at(
            &dest,
            &source,
            &files,
            |_| {},
            || {
                checks.set(checks.get() + 1);
                checks.get() >= 3
            },
        )
        .unwrap_err();

        assert!(error.contains("cancelled"));
        assert!(!dest.join("model.onnx").exists());
        assert!(!dest.join("model.onnx.part").exists());
        fs::remove_dir_all(source_dir).unwrap();
        fs::remove_dir_all(dest).unwrap();
    }

    #[test]
    fn local_import_rejects_escapes_and_non_regular_sources() {
        let source = temp_dir();
        let dest = temp_dir();
        let files = [ModelFileSpec {
            rel: "../escape.onnx".into(),
            sha256: sha(b"x"),
            bytes: 1,
        }];
        assert!(import_model_at(&dest, &source, &files, |_| {}, || false)
            .unwrap_err()
            .contains("invalid model path"));

        let files = [ModelFileSpec {
            rel: "model.onnx".into(),
            sha256: sha(b"x"),
            bytes: 1,
        }];
        assert!(import_model_at(&dest, &source, &files, |_| {}, || false)
            .unwrap_err()
            .contains("not a regular file"));
        fs::remove_dir_all(source).unwrap();
        fs::remove_dir_all(dest).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn local_import_rejects_symlinked_sources() {
        use std::os::unix::fs::symlink;

        let source_dir = temp_dir();
        let dest = temp_dir();
        fs::write(source_dir.join("target.onnx"), b"trusted").unwrap();
        let source = source_dir.join("model.onnx");
        symlink(source_dir.join("target.onnx"), &source).unwrap();
        let files = [ModelFileSpec {
            rel: "model.onnx".into(),
            sha256: sha(b"trusted"),
            bytes: 7,
        }];

        assert!(import_model_at(&dest, &source, &files, |_| {}, || false)
            .unwrap_err()
            .contains("symlink"));
        assert!(!dest.join("model.onnx").exists());
        fs::remove_dir_all(source_dir).unwrap();
        fs::remove_dir_all(dest).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_beneath_the_models_root() {
        use std::os::unix::fs::symlink;

        let dir = temp_dir();
        let outside = temp_dir();
        fs::write(outside.join("model.onnx"), b"trusted model").unwrap();
        symlink(&outside, dir.join("nested")).unwrap();

        let error = download_to(
            &dir,
            "nested/model.onnx",
            "http://127.0.0.1:9/model.onnx",
            &sha(b"trusted model"),
            13,
            true,
            |_| {},
            || false,
        )
        .unwrap_err();
        assert!(error.contains("symlink"));

        symlink(outside.join("model.onnx"), dir.join("model.onnx")).unwrap();
        let files = [ModelFileSpec {
            rel: "model.onnx".into(),
            sha256: sha(b"trusted model"),
            bytes: 13,
        }];
        assert!(verify_model_unit_at(&dir, &files)
            .unwrap_err()
            .contains("symlink"));
        fs::remove_dir_all(dir).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
}
