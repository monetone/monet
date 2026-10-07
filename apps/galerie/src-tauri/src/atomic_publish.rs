//! Descriptor-safe staged publication: create a temp file in the
//! destination directory, validate it, then atomically rename it onto the
//! final destination with no-clobber semantics (macOS `renameatx_np(...,
//! RENAME_EXCL)`). Ordinary `rename` is never used because it can silently
//! overwrite an existing object.

use sha2::{Digest, Sha256};
use std::ffi::{CString, OsString};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_ID: AtomicU64 = AtomicU64::new(0);

const O_RDONLY: i32 = 0;
const O_RDWR: i32 = 0x0002;
const O_CREAT: i32 = 0x0200;
const O_EXCL: i32 = 0x0800;
const O_NOFOLLOW: i32 = 0x0100;
const O_CLOEXEC: i32 = 0x0100_0000;
const EEXIST: i32 = 17;
const ENOENT: i32 = 2;
#[cfg(target_os = "macos")]
const RENAME_EXCL: u32 = 0x0000_0004;

pub struct AtomicStagedFile {
    file: File,
    directory: File,
    temp: OsString,
    destination: OsString,
    published: bool,
    /// Pathname the destination directory was opened through, retained so
    /// `publish` can detect the parent being replaced (e.g. swapped for a
    /// symlink, or removed/recreated) between `create` and `publish`.
    parent_path: PathBuf,
    parent_identity: (u64, u64),
    /// The staged temp file's own (device, inode), captured once at
    /// creation. `Drop`/`remove_owned_temp` only ever unlink the
    /// still-named temp entry when it still matches this identity — never
    /// an entry that happens to share the name but isn't the file we made.
    staged_identity: (u64, u64),
}

/// The terminal outcome of a publication attempt that reached visibility.
/// Once the destination is visible (via a successful rename, or verified
/// identical-bytes reuse on `EEXIST`), `publish` always returns `Ok` here —
/// any failure in the steps that follow (reopening the published path,
/// re-verifying its digest, syncing file/directory) becomes
/// `durability_warning` instead of an `Err`, so a caller can never mistake
/// "a later verification step failed" for "nothing was published."
#[derive(Debug)]
pub enum PublishOutcome {
    Committed {
        /// A handle to the published file, when we could reopen/keep one.
        /// `None` only in the rare case that even reopening the
        /// now-visible destination failed; the object is still published
        /// and byte-verified up through the pre-rename checks.
        file: Option<File>,
        durability_warning: Option<String>,
    },
}

/// One named checkpoint inside [`AtomicStagedFile::publish`], passed to
/// [`PublishHooks::before_step`] immediately before the real operation at
/// that point runs. Lets a test inject a deterministic failure at any of
/// these individual boundaries without a disk fault, sleep, or filesystem-
/// exhaustion trick.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublishStep {
    /// The staged file's `flush` + `sync_all`, before it is reopened for
    /// digest reverification.
    StagedSync,
    /// The descriptor-relative, no-follow reopen of the just-staged temp
    /// file used for digest reverification.
    StagedReopen,
    /// The exclusive, no-clobber `renameatx_np` publication itself —
    /// immediately after `final_guard` passes, before the syscall.
    Rename,
    /// The post-rename reopen of the now-published destination.
    PostPublishReopen,
    /// The post-rename digest reverification of the reopened destination.
    PostPublishDigest,
    /// The published file's own `sync_all`.
    PublishedSync,
    /// The destination directory's `sync_all`.
    ParentSync,
}

/// Deterministic injection seams for tests. Production code always uses
/// `PublishHooks::default()` (every hook is a no-op).
pub struct PublishHooks {
    /// Invoked immediately before the rename, after every other check
    /// (staged digest, caller `validate`, parent-identity) has passed —
    /// the last practical moment to recheck cancellation and/or
    /// source-identity immediately at the publication boundary. Returning
    /// `Err` aborts before anything becomes visible.
    pub final_guard: Box<dyn FnOnce() -> Result<(), String>>,
    /// Invoked right after a successful rename, before the file is
    /// reopened/re-verified — lets a test simulate a failure in that
    /// window (e.g. deleting the destination) to prove such a failure
    /// degrades to a `durability_warning`, never an `Err`.
    pub after_rename: Box<dyn FnOnce()>,
    /// Invoked immediately before each [`PublishStep`] checkpoint's real
    /// operation. Returning `Err` is treated exactly as though that real
    /// operation itself had failed — the same error handling applies,
    /// whether that means a hard pre-visibility `Err` or (once the rename
    /// has already committed) a `durability_warning`. Production default
    /// always returns `Ok(())` for every step and never runs the real
    /// operation any differently.
    pub before_step: Box<dyn FnMut(PublishStep) -> Result<(), String>>,
}

impl Default for PublishHooks {
    fn default() -> Self {
        Self {
            final_guard: Box::new(|| Ok(())),
            after_rename: Box::new(|| {}),
            before_step: Box::new(|_| Ok(())),
        }
    }
}

fn push_warning(slot: &mut Option<String>, message: String) {
    match slot {
        Some(existing) => {
            existing.push_str("; ");
            existing.push_str(&message);
        }
        None => *slot = Some(message),
    }
}

fn component(value: &std::ffi::OsStr) -> Result<CString, String> {
    CString::new(value.as_bytes()).map_err(|_| "path component contains NUL".into())
}

pub(crate) fn openat_file(
    directory: &File,
    name: &std::ffi::OsStr,
    flags: i32,
    mode: u32,
) -> std::io::Result<File> {
    extern "C" {
        fn openat(fd: i32, path: *const i8, flags: i32, ...) -> i32;
    }
    let name =
        component(name).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;
    let fd = unsafe { openat(directory.as_raw_fd(), name.as_ptr(), flags, mode) };
    if fd < 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(unsafe { File::from_raw_fd(fd) })
}

fn identity_of(file: &File) -> Result<(u64, u64), String> {
    let meta = file.metadata().map_err(|e| e.to_string())?;
    Ok((meta.dev(), meta.ino()))
}

/// Create (idempotently) and open a subdirectory of `parent` by name, using
/// descriptor-relative, no-follow syscalls throughout — never a
/// pathname-based `create_dir_all`/`set_permissions`, which would follow a
/// symlink planted at any ancestor path component. Mode `0700` is
/// (re)applied via `fchmod` on the opened descriptor whether the directory
/// was just created or already existed, so a pre-existing directory can
/// never retain looser permissions than intended.
pub fn ensure_dir_nofollow(parent: &File, name: &std::ffi::OsStr) -> Result<File, String> {
    extern "C" {
        fn mkdirat(fd: i32, path: *const i8, mode: u32) -> i32;
        fn fchmod(fd: i32, mode: u32) -> i32;
    }
    let c_name = component(name)?;
    let rc = unsafe { mkdirat(parent.as_raw_fd(), c_name.as_ptr(), 0o700) };
    if rc < 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() != Some(EEXIST) {
            return Err(format!("create managed directory: {error}"));
        }
    }
    let dir = openat_file(parent, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC, 0)
        .map_err(|e| format!("open managed directory: {e}"))?;
    if !dir.metadata().map_err(|e| e.to_string())?.is_dir() {
        return Err("managed path component is not a directory".into());
    }
    if unsafe { fchmod(dir.as_raw_fd(), 0o700) } < 0 {
        return Err(format!(
            "set managed directory permissions: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(dir)
}

fn digest(mut file: File) -> Result<(u64, String), String> {
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut size = 0u64;
    let mut buf = vec![0; 1024 * 1024];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        size = size.checked_add(n as u64).ok_or("file size overflow")?;
        hash.update(&buf[..n])
    }
    Ok((size, format!("{:x}", hash.finalize())))
}

impl AtomicStagedFile {
    #[cfg(target_os = "macos")]
    pub fn create(destination: &Path) -> Result<Self, String> {
        let parent_path = destination
            .parent()
            .ok_or("destination has no parent")?
            .to_path_buf();
        let name = destination
            .file_name()
            .ok_or("destination has no file name")?
            .to_os_string();
        let directory =
            File::open(&parent_path).map_err(|e| format!("open destination directory: {e}"))?;
        Self::create_in(directory, parent_path, &name)
    }

    /// Same as [`Self::create`], but using an already-open, already-trusted
    /// destination directory descriptor instead of reopening the parent by
    /// pathname — the caller is responsible for having obtained
    /// `directory` in a descriptor-safe (no-follow) way, e.g. via a
    /// descriptor-relative directory-creation chain.
    #[cfg(target_os = "macos")]
    pub fn create_in(
        directory: File,
        parent_path: PathBuf,
        destination_name: &std::ffi::OsStr,
    ) -> Result<Self, String> {
        use std::os::unix::fs::PermissionsExt;
        if !directory.metadata().map_err(|e| e.to_string())?.is_dir() {
            return Err("destination parent is not a directory".into());
        }
        let parent_identity = identity_of(&directory)?;
        let destination = destination_name.to_os_string();
        for _ in 0..100 {
            let temp = OsString::from(format!(
                ".monet-stage-{}-{}",
                std::process::id(),
                TEMP_ID.fetch_add(1, Ordering::Relaxed)
            ));
            match openat_file(
                &directory,
                &temp,
                O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
                0o600,
            ) {
                Ok(file) => {
                    let m = file.metadata().map_err(|e| e.to_string())?;
                    if !m.is_file() || m.nlink() != 1 {
                        return Err("staged output identity is invalid".into());
                    }
                    // Belt-and-suspenders: the mode is also set explicitly
                    // in case the platform's `openat` honored a different
                    // effective mode (e.g. umask).
                    let _ = file.set_permissions(std::fs::Permissions::from_mode(0o600));
                    let staged_identity = (m.dev(), m.ino());
                    return Ok(Self {
                        file,
                        directory,
                        temp,
                        destination,
                        published: false,
                        parent_path,
                        parent_identity,
                        staged_identity,
                    });
                }
                Err(e) if e.raw_os_error() == Some(EEXIST) => continue,
                Err(e) => return Err(format!("create staged output: {e}")),
            }
        }
        Err("could not allocate unique staged output".into())
    }

    #[cfg(not(target_os = "macos"))]
    pub fn create(_: &Path) -> Result<Self, String> {
        Err("atomic DNG publication requires macOS renameatx_np".into())
    }
    #[cfg(not(target_os = "macos"))]
    pub fn create_in(_: File, _: PathBuf, _: &std::ffi::OsStr) -> Result<Self, String> {
        Err("atomic DNG publication requires macOS renameatx_np".into())
    }

    pub fn writer(&mut self) -> Result<File, String> {
        self.file.try_clone().map_err(|e| e.to_string())
    }

    /// Detect the destination parent directory being replaced (removed,
    /// recreated, or swapped for a symlink) since `create`.
    fn assert_parent_identity(&self) -> Result<(), String> {
        let reopened = File::open(&self.parent_path)
            .map_err(|e| format!("reopen destination directory for identity check: {e}"))?;
        if identity_of(&reopened)? != self.parent_identity {
            return Err("destination parent directory was replaced".into());
        }
        Ok(())
    }

    pub fn publish(
        mut self,
        expected_size: u64,
        expected_digest: &str,
        validate: impl FnOnce(&mut File) -> Result<(), String>,
        mut hooks: PublishHooks,
    ) -> Result<PublishOutcome, String> {
        (hooks.before_step)(PublishStep::StagedSync)
            .map_err(|e| format!("flush staged output: {e}"))?;
        self.file
            .flush()
            .map_err(|e| format!("flush staged output: {e}"))?;
        self.file
            .sync_all()
            .map_err(|e| format!("sync staged output: {e}"))?;
        (hooks.before_step)(PublishStep::StagedReopen)
            .map_err(|e| format!("reopen staged output: {e}"))?;
        let mut reopened = openat_file(
            &self.directory,
            &self.temp,
            O_RDONLY | O_NOFOLLOW | O_CLOEXEC,
            0,
        )
        .map_err(|e| format!("reopen staged output: {e}"))?;
        let (size, hash) = digest(reopened.try_clone().map_err(|e| e.to_string())?)?;
        if size != expected_size || hash != expected_digest {
            return Err("staged output size or digest mismatch".into());
        }
        validate(&mut reopened)?;
        // Final pre-rename guard: parent-directory identity, plus whatever
        // cancellation/source-identity recheck the caller supplies —
        // evaluated as late as possible, immediately before the rename
        // that makes the file visible. Everything above (and this) can
        // still safely fail with nothing published.
        self.assert_parent_identity()?;
        (hooks.final_guard)()?;
        (hooks.before_step)(PublishStep::Rename)
            .map_err(|e| format!("publish staged output: {e}"))?;
        #[cfg(target_os = "macos")]
        {
            extern "C" {
                fn renameatx_np(
                    fromfd: i32,
                    from: *const i8,
                    tofd: i32,
                    to: *const i8,
                    flags: u32,
                ) -> i32;
            }
            let from = component(&self.temp)?;
            let to = component(&self.destination)?;
            let rc = unsafe {
                renameatx_np(
                    self.directory.as_raw_fd(),
                    from.as_ptr(),
                    self.directory.as_raw_fd(),
                    to.as_ptr(),
                    RENAME_EXCL,
                )
            };
            if rc < 0 {
                let error = std::io::Error::last_os_error();
                if error.raw_os_error() == Some(EEXIST) {
                    return self.reuse_existing_destination(expected_size, expected_digest);
                }
                return Err(format!("publish staged output: {error}"));
            }
        }
        // The rename committed: the file is now visible at the
        // destination. From here on, any failure is a durability warning,
        // never a hard `Err` — the caller must receive a committed
        // terminal outcome and must never report Cancelled/Failed as
        // though no output exists.
        self.published = true;
        (hooks.after_rename)();
        Ok(self.finalize_committed(expected_size, expected_digest, &mut hooks.before_step))
    }

    fn reuse_existing_destination(
        &mut self,
        expected_size: u64,
        expected_digest: &str,
    ) -> Result<PublishOutcome, String> {
        let existing = openat_file(
            &self.directory,
            &self.destination,
            O_RDONLY | O_NOFOLLOW | O_CLOEXEC,
            0,
        )
        .map_err(|e| format!("open existing destination: {e}"))?;
        let existing_identity = digest(existing.try_clone().map_err(|e| e.to_string())?)?;
        if existing_identity != (expected_size, expected_digest.to_owned()) {
            // Pre-visibility from our own staged file's perspective: we
            // never touch the different existing object.
            return Err("destination collision: existing bytes differ".into());
        }
        // Idempotent reuse: the destination already holds our exact bytes,
        // so it is exactly as committed as a fresh rename would have been.
        self.published = true;
        let mut warning = None;
        if let Err(e) = self.remove_owned_temp() {
            push_warning(
                &mut warning,
                format!("remove owned temp after EEXIST reuse: {e}"),
            );
        }
        if let Err(e) = existing.sync_all() {
            push_warning(&mut warning, format!("sync existing destination: {e}"));
        }
        if let Err(e) = self.directory.sync_all() {
            push_warning(&mut warning, format!("sync destination directory: {e}"));
        }
        Ok(PublishOutcome::Committed {
            file: Some(existing),
            durability_warning: warning,
        })
    }

    fn finalize_committed(
        &mut self,
        expected_size: u64,
        expected_digest: &str,
        before_step: &mut dyn FnMut(PublishStep) -> Result<(), String>,
    ) -> PublishOutcome {
        let mut warning = None;
        let published = match before_step(PublishStep::PostPublishReopen).and_then(|()| {
            openat_file(
                &self.directory,
                &self.destination,
                O_RDONLY | O_NOFOLLOW | O_CLOEXEC,
                0,
            )
            .map_err(|e| e.to_string())
        }) {
            Ok(f) => Some(f),
            Err(e) => {
                push_warning(&mut warning, format!("reopen published output: {e}"));
                None
            }
        };
        if let Some(f) = &published {
            match before_step(PublishStep::PostPublishDigest)
                .and_then(|()| f.try_clone().map_err(|e| e.to_string()))
                .and_then(digest)
            {
                Ok(observed) if observed == (expected_size, expected_digest.to_owned()) => {}
                Ok(_) => push_warning(&mut warning, "post-publication validation failed".into()),
                Err(e) => push_warning(&mut warning, format!("post-publication digest: {e}")),
            }
            match before_step(PublishStep::PublishedSync)
                .and_then(|()| f.sync_all().map_err(|e| e.to_string()))
            {
                Ok(()) => {}
                Err(e) => push_warning(&mut warning, format!("sync published output: {e}")),
            }
        }
        match before_step(PublishStep::ParentSync)
            .and_then(|()| self.directory.sync_all().map_err(|e| e.to_string()))
        {
            Ok(()) => {}
            Err(e) => push_warning(&mut warning, format!("sync destination directory: {e}")),
        }
        PublishOutcome::Committed {
            file: published,
            durability_warning: warning,
        }
    }

    /// Remove the temp file, but only if the still-named directory entry
    /// is still the exact file we created (same device/inode) — never an
    /// entry that happens to share the name but was put there by someone
    /// else after ours was removed or replaced.
    fn remove_owned_temp(&self) -> Result<(), String> {
        let current = match openat_file(
            &self.directory,
            &self.temp,
            O_RDONLY | O_NOFOLLOW | O_CLOEXEC,
            0,
        ) {
            Ok(f) => f,
            Err(e) if e.raw_os_error() == Some(ENOENT) => return Ok(()),
            Err(e) => return Err(format!("inspect owned temp before removal: {e}")),
        };
        if identity_of(&current)? != self.staged_identity {
            // Not our file (name reused by something else); leave it alone.
            return Ok(());
        }
        extern "C" {
            fn unlinkat(fd: i32, path: *const i8, flags: i32) -> i32;
        }
        let temp = component(&self.temp)?;
        if unsafe { unlinkat(self.directory.as_raw_fd(), temp.as_ptr(), 0) } < 0 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() == Some(ENOENT) {
                return Ok(());
            }
            return Err(format!("remove staged output: {error}"));
        }
        Ok(())
    }
}

impl Drop for AtomicStagedFile {
    fn drop(&mut self) {
        if !self.published {
            let _ = self.remove_owned_temp();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::{Arc, Mutex};

    fn root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "galerie-atomic-{}-{}-{}",
            name,
            std::process::id(),
            TEMP_ID.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir(&root).unwrap();
        root
    }

    fn hash_of(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn publishes_without_clobber() {
        let root = root("publish");
        let dest = root.join("x.dng");
        let bytes = b"dng";
        let hash = hash_of(bytes);
        let mut stage = AtomicStagedFile::create(&dest).unwrap();
        stage.writer().unwrap().write_all(bytes).unwrap();
        let outcome = stage
            .publish(
                bytes.len() as u64,
                &hash,
                |_| Ok(()),
                PublishHooks::default(),
            )
            .unwrap();
        let PublishOutcome::Committed {
            file,
            durability_warning,
        } = outcome;
        assert!(file.is_some());
        assert_eq!(durability_warning, None);
        assert_eq!(std::fs::read(&dest).unwrap(), bytes);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn eexist_with_identical_bytes_reuses_and_leaves_object_untouched() {
        let root = root("eexist-same");
        let dest = root.join("x.dng");
        let bytes = b"identical";
        let hash = hash_of(bytes);
        std::fs::write(&dest, bytes).unwrap();
        let before = std::fs::metadata(&dest).unwrap().ino();

        let mut stage = AtomicStagedFile::create(&dest).unwrap();
        stage.writer().unwrap().write_all(bytes).unwrap();
        let outcome = stage
            .publish(
                bytes.len() as u64,
                &hash,
                |_| Ok(()),
                PublishHooks::default(),
            )
            .unwrap();
        let PublishOutcome::Committed { file, .. } = outcome;
        assert!(file.is_some());
        assert_eq!(std::fs::read(&dest).unwrap(), bytes);
        // The pre-existing object was reused, not replaced.
        assert_eq!(std::fs::metadata(&dest).unwrap().ino(), before);
        // The owned temp was cleaned up; only the destination remains.
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn eexist_with_different_bytes_is_a_hard_error_and_leaves_object_untouched() {
        let root = root("eexist-diff");
        let dest = root.join("x.dng");
        std::fs::write(&dest, b"original").unwrap();
        let before = std::fs::read(&dest).unwrap();

        let mut stage = AtomicStagedFile::create(&dest).unwrap();
        stage.writer().unwrap().write_all(b"different").unwrap();
        let err = stage
            .publish(
                b"different".len() as u64,
                &hash_of(b"different"),
                |_| Ok(()),
                PublishHooks::default(),
            )
            .unwrap_err();
        assert!(err.contains("collision"), "{err}");
        assert_eq!(std::fs::read(&dest).unwrap(), before);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn validate_failure_publishes_nothing() {
        let root = root("validate-fail");
        let dest = root.join("x.dng");
        let mut stage = AtomicStagedFile::create(&dest).unwrap();
        stage.writer().unwrap().write_all(b"bytes").unwrap();
        let err = stage
            .publish(
                b"bytes".len() as u64,
                &hash_of(b"bytes"),
                |_| Err("rejected by caller validation".into()),
                PublishHooks::default(),
            )
            .unwrap_err();
        assert!(err.contains("rejected by caller validation"));
        assert!(!dest.exists());
        // The temp was removed on drop; nothing but the empty dir remains.
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn final_guard_failure_publishes_nothing() {
        let root = root("final-guard-fail");
        let dest = root.join("x.dng");
        let mut stage = AtomicStagedFile::create(&dest).unwrap();
        stage.writer().unwrap().write_all(b"bytes").unwrap();
        let hooks = PublishHooks {
            final_guard: Box::new(|| Err("cancelled immediately before publish".into())),
            after_rename: Box::new(|| panic!("must not rename after a failed final guard")),
            ..Default::default()
        };
        let err = stage
            .publish(b"bytes".len() as u64, &hash_of(b"bytes"), |_| Ok(()), hooks)
            .unwrap_err();
        assert!(err.contains("cancelled immediately before publish"));
        assert!(!dest.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn parent_replaced_before_publish_is_rejected_before_rename() {
        let root = root("parent-replaced");
        let dest = root.join("x.dng");
        let mut stage = AtomicStagedFile::create(&dest).unwrap();
        stage.writer().unwrap().write_all(b"bytes").unwrap();
        // Swap the parent directory itself between create() and publish():
        // move the original aside (the already-open `directory` descriptor
        // keeps working against it, unaffected by the rename — this is
        // exactly why the check must reopen by pathname) and put a brand
        // new, empty directory at the original path.
        let moved_aside = PathBuf::from(format!("{}-moved-aside", root.to_string_lossy()));
        std::fs::rename(&root, &moved_aside).unwrap();
        std::fs::create_dir(&root).unwrap();
        let err = stage
            .publish(
                b"bytes".len() as u64,
                &hash_of(b"bytes"),
                |_| Ok(()),
                PublishHooks::default(),
            )
            .unwrap_err();
        assert!(err.contains("parent directory was replaced"), "{err}");
        assert!(!dest.exists());
        std::fs::remove_dir_all(moved_aside).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn post_rename_reopen_failure_still_reports_committed_with_warning() {
        let root = root("post-rename-fail");
        let dest = root.join("x.dng");
        let mut stage = AtomicStagedFile::create(&dest).unwrap();
        stage.writer().unwrap().write_all(b"bytes").unwrap();
        let dest_for_hook = dest.clone();
        let hooks = PublishHooks {
            final_guard: Box::new(|| Ok(())),
            // Simulate a failure in the window right after the rename
            // commits (the file IS visible) but before we reopen it.
            after_rename: Box::new(move || {
                std::fs::remove_file(&dest_for_hook).unwrap();
            }),
            ..Default::default()
        };
        let outcome = stage
            .publish(b"bytes".len() as u64, &hash_of(b"bytes"), |_| Ok(()), hooks)
            .expect("a post-rename failure must never surface as Err");
        let PublishOutcome::Committed {
            file,
            durability_warning,
        } = outcome;
        assert!(file.is_none());
        assert!(durability_warning
            .unwrap()
            .contains("reopen published output"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn drop_removes_only_the_still_owned_unpublished_temp() {
        let root = root("drop-owned");
        let dest = root.join("x.dng");
        {
            let mut stage = AtomicStagedFile::create(&dest).unwrap();
            stage.writer().unwrap().write_all(b"bytes").unwrap();
            // Dropped without publishing.
        }
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn drop_never_removes_a_temp_name_reused_by_something_else() {
        let root = root("drop-not-owned");
        let dest = root.join("x.dng");
        let stage = AtomicStagedFile::create(&dest).unwrap();
        let temp_path = root.join(&stage.temp);
        // Simulate the owned temp being replaced (e.g. by a symlink
        // attack, or a name collision after some other cleanup) before
        // this handle is dropped.
        std::fs::remove_file(&temp_path).unwrap();
        std::fs::write(&temp_path, b"not ours").unwrap();
        drop(stage);
        // The replacement must survive: Drop must never remove an entry
        // that doesn't match the identity it created.
        assert_eq!(std::fs::read(&temp_path).unwrap(), b"not ours");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn create_in_uses_the_supplied_directory_descriptor_without_reopening_by_path() {
        let root = root("create-in");
        let directory = File::open(&root).unwrap();
        let mut stage =
            AtomicStagedFile::create_in(directory, root.clone(), std::ffi::OsStr::new("x.dng"))
                .unwrap();
        stage.writer().unwrap().write_all(b"bytes").unwrap();
        let outcome = stage
            .publish(
                b"bytes".len() as u64,
                &hash_of(b"bytes"),
                |_| Ok(()),
                PublishHooks::default(),
            )
            .unwrap();
        let PublishOutcome::Committed { file, .. } = outcome;
        assert!(file.is_some());
        assert_eq!(std::fs::read(root.join("x.dng")).unwrap(), b"bytes");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn final_guard_runs_after_validate_and_can_observe_shared_state() {
        // Proves the guard runs as the very last check (after staged
        // digest + caller validate + parent-identity), not merely at
        // `publish`'s entry, by having both `validate` and the guard mark
        // a shared flag and asserting the order.
        let root = root("order");
        let dest = root.join("x.dng");
        let mut stage = AtomicStagedFile::create(&dest).unwrap();
        stage.writer().unwrap().write_all(b"bytes").unwrap();
        let validated = Arc::new(Mutex::new(false));
        let validated_in_guard = validated.clone();
        let hooks = PublishHooks {
            final_guard: Box::new(move || {
                assert!(
                    *validated_in_guard.lock().unwrap(),
                    "final_guard must run after validate"
                );
                Ok(())
            }),
            after_rename: Box::new(|| {}),
            ..Default::default()
        };
        stage
            .publish(
                b"bytes".len() as u64,
                &hash_of(b"bytes"),
                |_| {
                    *validated.lock().unwrap() = true;
                    Ok(())
                },
                hooks,
            )
            .unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    // --- `PublishStep` fault-injection checkpoints -------------------------
    //
    // Each of `AtomicStagedFile::publish`'s named internal steps
    // (staged-file sync, staged reopen, the exclusive rename itself,
    // post-publication reopen/digest/sync, and the destination directory's
    // sync) gets its own deterministic test via `PublishHooks::before_step`
    // — never a real disk fault, sleep, or filesystem-exhaustion trick.

    fn step_hook(target: PublishStep, message: &'static str) -> PublishHooks {
        PublishHooks {
            before_step: Box::new(move |step| {
                if step == target {
                    Err(message.into())
                } else {
                    Ok(())
                }
            }),
            ..Default::default()
        }
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn staged_sync_failure_publishes_nothing() {
        let root = root("staged-sync-fail");
        let dest = root.join("x.dng");
        let mut stage = AtomicStagedFile::create(&dest).unwrap();
        stage.writer().unwrap().write_all(b"bytes").unwrap();
        let err = stage
            .publish(
                b"bytes".len() as u64,
                &hash_of(b"bytes"),
                |_| Ok(()),
                step_hook(
                    PublishStep::StagedSync,
                    "simulated staged-file sync failure",
                ),
            )
            .unwrap_err();
        assert!(err.contains("simulated staged-file sync failure"), "{err}");
        assert!(!dest.exists());
        // The temp was removed on drop; nothing but the empty dir remains.
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn staged_reopen_failure_publishes_nothing() {
        let root = root("staged-reopen-fail");
        let dest = root.join("x.dng");
        let mut stage = AtomicStagedFile::create(&dest).unwrap();
        stage.writer().unwrap().write_all(b"bytes").unwrap();
        let err = stage
            .publish(
                b"bytes".len() as u64,
                &hash_of(b"bytes"),
                |_| Ok(()),
                step_hook(PublishStep::StagedReopen, "simulated staged reopen failure"),
            )
            .unwrap_err();
        assert!(err.contains("simulated staged reopen failure"), "{err}");
        assert!(!dest.exists());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn rename_step_failure_publishes_nothing() {
        let root = root("rename-step-fail");
        let dest = root.join("x.dng");
        let mut stage = AtomicStagedFile::create(&dest).unwrap();
        stage.writer().unwrap().write_all(b"bytes").unwrap();
        let err = stage
            .publish(
                b"bytes".len() as u64,
                &hash_of(b"bytes"),
                |_| Ok(()),
                step_hook(
                    PublishStep::Rename,
                    "simulated exclusive-publication failure",
                ),
            )
            .unwrap_err();
        assert!(
            err.contains("simulated exclusive-publication failure"),
            "{err}"
        );
        assert!(
            !dest.exists(),
            "the real rename must never have been attempted"
        );
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn post_publish_reopen_failure_is_committed_with_warning() {
        let root = root("post-publish-reopen-fail");
        let dest = root.join("x.dng");
        let mut stage = AtomicStagedFile::create(&dest).unwrap();
        stage.writer().unwrap().write_all(b"bytes").unwrap();
        let outcome = stage
            .publish(
                b"bytes".len() as u64,
                &hash_of(b"bytes"),
                |_| Ok(()),
                step_hook(
                    PublishStep::PostPublishReopen,
                    "simulated post-publish reopen failure",
                ),
            )
            .expect("a post-rename failure must never surface as Err");
        let PublishOutcome::Committed {
            file,
            durability_warning,
        } = outcome;
        assert!(file.is_none());
        assert!(durability_warning
            .unwrap()
            .contains("simulated post-publish reopen failure"));
        // The rename itself already committed: the bytes are visible.
        assert_eq!(std::fs::read(&dest).unwrap(), b"bytes");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn post_publish_digest_failure_is_committed_with_warning() {
        let root = root("post-publish-digest-fail");
        let dest = root.join("x.dng");
        let mut stage = AtomicStagedFile::create(&dest).unwrap();
        stage.writer().unwrap().write_all(b"bytes").unwrap();
        let outcome = stage
            .publish(
                b"bytes".len() as u64,
                &hash_of(b"bytes"),
                |_| Ok(()),
                step_hook(
                    PublishStep::PostPublishDigest,
                    "simulated post-publish digest failure",
                ),
            )
            .expect("a post-rename failure must never surface as Err");
        let PublishOutcome::Committed {
            file,
            durability_warning,
        } = outcome;
        assert!(file.is_some(), "the file was still reopened successfully");
        assert!(durability_warning
            .unwrap()
            .contains("simulated post-publish digest failure"));
        assert_eq!(std::fs::read(&dest).unwrap(), b"bytes");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn published_sync_failure_is_committed_with_warning() {
        let root = root("published-sync-fail");
        let dest = root.join("x.dng");
        let mut stage = AtomicStagedFile::create(&dest).unwrap();
        stage.writer().unwrap().write_all(b"bytes").unwrap();
        let outcome = stage
            .publish(
                b"bytes".len() as u64,
                &hash_of(b"bytes"),
                |_| Ok(()),
                step_hook(
                    PublishStep::PublishedSync,
                    "simulated published-file sync failure",
                ),
            )
            .expect("a post-rename failure must never surface as Err");
        let PublishOutcome::Committed {
            file,
            durability_warning,
        } = outcome;
        assert!(file.is_some());
        assert!(durability_warning
            .unwrap()
            .contains("simulated published-file sync failure"));
        assert_eq!(std::fs::read(&dest).unwrap(), b"bytes");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn parent_sync_failure_is_committed_with_warning() {
        let root = root("parent-sync-fail");
        let dest = root.join("x.dng");
        let mut stage = AtomicStagedFile::create(&dest).unwrap();
        stage.writer().unwrap().write_all(b"bytes").unwrap();
        let outcome = stage
            .publish(
                b"bytes".len() as u64,
                &hash_of(b"bytes"),
                |_| Ok(()),
                step_hook(
                    PublishStep::ParentSync,
                    "simulated parent-directory sync failure",
                ),
            )
            .expect("a post-rename failure must never surface as Err");
        let PublishOutcome::Committed {
            file,
            durability_warning,
        } = outcome;
        assert!(file.is_some());
        assert!(durability_warning
            .unwrap()
            .contains("simulated parent-directory sync failure"));
        assert_eq!(std::fs::read(&dest).unwrap(), b"bytes");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn ensure_dir_nofollow_creates_idempotently_and_fixes_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let r = root("ensure-dir");
        let parent = File::open(&r).unwrap();
        let dir1 = ensure_dir_nofollow(&parent, std::ffi::OsStr::new("child")).unwrap();
        assert!(dir1.metadata().unwrap().is_dir());
        std::fs::set_permissions(r.join("child"), std::fs::Permissions::from_mode(0o777)).unwrap();
        let dir2 = ensure_dir_nofollow(&parent, std::ffi::OsStr::new("child")).unwrap();
        assert_eq!(dir2.metadata().unwrap().permissions().mode() & 0o777, 0o700);
        std::fs::remove_dir_all(r).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn ensure_dir_nofollow_rejects_a_symlink_in_place_of_the_directory() {
        let r = root("ensure-dir-symlink");
        let parent = File::open(&r).unwrap();
        let elsewhere = r.join("elsewhere");
        std::fs::create_dir(&elsewhere).unwrap();
        std::os::unix::fs::symlink(&elsewhere, r.join("child")).unwrap();
        let err = ensure_dir_nofollow(&parent, std::ffi::OsStr::new("child")).unwrap_err();
        assert!(!err.is_empty());
        assert!(elsewhere.is_dir());
        std::fs::remove_dir_all(r).unwrap();
    }
}
