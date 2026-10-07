//! Durable atomic save for every Monet app.
//!
//! Register it alongside Monet's [`invoke_handler`](crate::invoke_handler):
//!
//! ```no_run
//! tauri::Builder::default()
//!     .invoke_handler(monet_ui::invoke_handler())
//!     .plugin(monet_ui::atomic_save_plugin())
//!     // ...
//! # ;
//! ```
//!
//! The frontend drives it through `@monet-ui/monet-react`'s `atomicWriteBytes`,
//! which falls back to a plain plugin-fs write + rename when this plugin is not
//! registered — so a document is never lost just because an app forgot it, but
//! the write is only power-loss durable with the plugin installed.
//
// `atomicWriteBytes` used to write a temp sibling through tauri-plugin-fs and then
// rename it over the destination. The plugin's write path only does `write_all` —
// it exposes no fsync at all — so the rename could reach disk while the temp file's
// data blocks were still in the page cache. A power cut or kernel panic in that
// window left the destination pointing at a truncated file with the original's
// bytes already unlinked: the document was gone, and the save had just deleted its
// crash-recovery snapshot too.
//
// The durable sequence is write → flush → fsync(file) → rename → fsync(parent dir),
// which is what `model_dl.rs` already does for downloaded models. On macOS a plain
// `fsync` only pushes to the drive's write cache, so `F_FULLFSYNC` is used where
// available (that is the documented way to get real power-loss durability on APFS/
// HFS+); it is best-effort, falling back to `sync_all` if the drive refuses it.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use tauri::plugin::{Builder, TauriPlugin};
use tauri::Runtime;

/// Flush a file all the way to durable media. Returns the first hard error.
fn sync_file(file: &fs::File) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::io::AsRawFd;
        // F_FULLFSYNC asks the drive to flush its own write cache. Not every
        // filesystem implements it (it fails with ENOTSUP/EINVAL on some), so a
        // refusal falls through to sync_all rather than failing the save.
        let rc = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_FULLFSYNC) };
        if rc != -1 {
            return Ok(());
        }
    }
    file.sync_all()
}

/// fsync the directory holding `path`, so the rename itself is durable. Best
/// effort: not every platform allows opening a directory read-only.
fn sync_parent_directory(path: &Path) {
    if let Some(parent) = path.parent() {
        if let Ok(dir) = fs::File::open(parent) {
            let _ = dir.sync_all();
        }
    }
}

fn unique_temp_path(destination: &Path) -> PathBuf {
    let name = destination
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "document".into());
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    destination.with_file_name(format!(".{name}.monet-{stamp}.tmp"))
}

/// Decode the percent-encoded `x-destination` header (`encodeURIComponent` on the
/// JS side). HTTP header values are ASCII, filesystem paths are not.
fn decode_destination(value: &str) -> Result<String, String> {
    percent_encoding::percent_decode_str(value)
        .decode_utf8()
        .map(|decoded| decoded.into_owned())
        .map_err(|e| e.to_string())
}

/// Write `bytes` to `destination` durably: a fully-synced temp sibling is renamed
/// over the destination, then the directory entry itself is synced.
///
/// The bytes arrive as a raw IPC body and the destination as a percent-encoded
/// `x-destination` header, so a large save never becomes a JSON number array.
#[tauri::command]
async fn atomic_write(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let destination = request
        .headers()
        .get("x-destination")
        .and_then(|v| v.to_str().ok())
        .ok_or("atomic_write needs an x-destination header")?;
    let destination = decode_destination(destination)?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.to_vec(),
        _ => return Err("atomic_write takes raw bytes".into()),
    };

    tauri::async_runtime::spawn_blocking(move || {
        let destination = PathBuf::from(destination);
        if destination.as_os_str().is_empty() {
            return Err("empty destination path".to_string());
        }
        let temp = unique_temp_path(&destination);

        let write_and_sync = || -> std::io::Result<()> {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)?;
            file.write_all(&bytes)?;
            file.flush()?;
            sync_file(&file)?;
            // Close before renaming so no handle is open across the swap.
            drop(file);
            fs::rename(&temp, &destination)?;
            Ok(())
        };

        match write_and_sync() {
            Ok(()) => {
                sync_parent_directory(&destination);
                Ok(())
            }
            Err(e) => {
                // Never leave a partial temp file behind; keep the real error.
                let _ = fs::remove_file(&temp);
                Err(e.to_string())
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The `atomicsave` plugin: one `atomic_write` command, write→fsync→rename→fsync-dir.
pub fn atomic_save_plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("atomicsave")
        .invoke_handler(tauri::generate_handler![atomic_write])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_synced_write_replaces_the_destination_and_leaves_no_temp() {
        let dir = std::env::temp_dir().join(format!(
            "monet-atomic-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("doc.mvision");
        fs::write(&dest, b"old").unwrap();

        // Drive the same sequence the command runs.
        let temp = unique_temp_path(&dest);
        {
            let mut f = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)
                .unwrap();
            f.write_all(b"new bytes").unwrap();
            f.flush().unwrap();
            sync_file(&f).expect("the file syncs to durable media");
        }
        fs::rename(&temp, &dest).unwrap();
        sync_parent_directory(&dest);

        assert_eq!(fs::read(&dest).unwrap(), b"new bytes");
        assert!(!temp.exists(), "the temp sibling is consumed by the rename");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_destination_header_decodes_percent_escapes() {
        assert_eq!(
            decode_destination("/Users/a/Photos/%C3%A9t%C3%A9.jpg").unwrap(),
            "/Users/a/Photos/été.jpg"
        );
        assert_eq!(decode_destination("/plain/path.png").unwrap(), "/plain/path.png");
    }

    #[test]
    fn the_temp_path_is_a_hidden_sibling_of_the_destination() {
        let dest = Path::new("/tmp/some/dir/doc.mvision");
        let temp = unique_temp_path(dest);
        assert_eq!(
            temp.parent(),
            dest.parent(),
            "temp must sit on the SAME filesystem, or the rename is not atomic"
        );
        assert!(temp
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with('.'));
    }
}
