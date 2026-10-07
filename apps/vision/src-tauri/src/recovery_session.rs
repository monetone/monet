//! Crash-recovery ownership (#553).
//!
//! Every GUI process shares one app-data `recovery/` folder. On Windows and
//! Linux a file association starts a second process, and that process used to
//! treat the running session's snapshots as a crash and delete them. The first
//! process claims `session.lock`. A second process that finds a live owner
//! leaves every snapshot untouched and boots with `?recoveryBlocked=1`.

use std::path::Path;

pub const RECOVERY_DIR: &str = "recovery";
const LOCK_NAME: &str = "session.lock";

/// Claim the recovery folder for `self_pid`.
///
/// Returns `true` when this process may scan the folder (no lock, or the
/// recorded owner is us or dead). Returns `false` when another live process
/// owns it — the caller must not offer or delete those snapshots. This function
/// never removes a snapshot.
pub fn claim_recovery_session(dir: &Path, self_pid: u32, alive: impl Fn(u32) -> bool) -> bool {
    let lock = dir.join(LOCK_NAME);
    if let Ok(text) = std::fs::read_to_string(&lock) {
        if let Ok(owner) = text.trim().parse::<u32>() {
            if owner != self_pid && alive(owner) {
                return false;
            }
        }
    }
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    std::fs::write(&lock, self_pid.to_string()).is_ok()
}

/// Whether `pid` is still a process. `EPERM` counts as alive: we could see it
/// but not signal it.
pub fn pid_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(unix)]
    {
        let rc = unsafe { libc::kill(pid as libc::pid_t, 0) };
        if rc == 0 {
            return true;
        }
        return std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM);
    }
    #[cfg(windows)]
    {
        const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
        extern "system" {
            fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut core::ffi::c_void;
            fn CloseHandle(handle: *mut core::ffi::c_void) -> i32;
        }
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            return false;
        }
        unsafe { CloseHandle(handle) };
        true
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch() -> std::path::PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("vision-recovery-session-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_live_owner_keeps_its_snapshots_and_its_lock() {
        let dir = scratch();
        let snapshot = dir.join("4-photo.mvision");
        fs::write(&snapshot, b"pixels").unwrap();
        fs::write(dir.join(LOCK_NAME), "42").unwrap();

        let claimed = claim_recovery_session(&dir, 7, |pid| pid == 42);

        assert!(!claimed, "a second process must not scan a live session");
        assert_eq!(fs::read(&snapshot).unwrap(), b"pixels");
        assert_eq!(fs::read_to_string(dir.join(LOCK_NAME)).unwrap(), "42");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_dead_owner_can_be_claimed_without_deleting_snapshots() {
        let dir = scratch();
        let snapshot = dir.join("4-photo.mvision");
        fs::write(&snapshot, b"pixels").unwrap();
        fs::write(dir.join(LOCK_NAME), "42").unwrap();

        let claimed = claim_recovery_session(&dir, 7, |_| false);

        assert!(claimed);
        assert_eq!(fs::read(&snapshot).unwrap(), b"pixels");
        assert_eq!(fs::read_to_string(dir.join(LOCK_NAME)).unwrap(), "7");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_unwritable_folder_is_not_claimed() {
        let missing = std::env::temp_dir().join("vision-recovery-missing-parent/no-such/recovery");
        // Parent does not exist and we only create `dir` itself — create_dir_all
        // would succeed. Point at a file so create_dir_all fails.
        let file = std::env::temp_dir().join(format!(
            "vision-recovery-not-a-dir-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::write(&file, b"x").unwrap();
        assert!(!claim_recovery_session(&file, 7, |_| false));
        assert_eq!(fs::read(&file).unwrap(), b"x");
        let _ = fs::remove_file(&file);
        let _ = missing;
    }
}
