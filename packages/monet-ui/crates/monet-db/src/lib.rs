//! monet-db — the shared SQLite plumbing every Monet app's database goes
//! through (design doc 11, "Databases go through a common library").
//!
//! Generic on purpose: it knows about *a* database, not about photos. An app
//! keeps its schema and its queries. What lives here is the part every app
//! would otherwise copy:
//!
//!   * [`open`] + the pragma set
//!   * [`integrity_check`], [`optimize`], [`backup_to`], [`vacuum_into`]
//!   * [`escape_like`], [`sha256_hex`], [`digest_file`], [`file_identity`]
//!   * [`DbState`] — the `Mutex<Option<Connection>>` guard + `with_conn`
//!   * [`container`] — the container ↔ live-database lifecycle
//!
//! Extracted from Galerie's catalog, which is its first consumer.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};

/// Re-exported so an app can speak `rusqlite` types without pinning its own
/// copy of the crate (two copies would be two incompatible `Connection`s).
pub use rusqlite;

#[cfg(feature = "container")]
pub mod container;

// ─────────────────────────────────────────────────────────────
// Open
// ─────────────────────────────────────────────────────────────

/// Open (creating if absent) the database at `path` (`":memory:"` for a scratch
/// one) and apply the pragmas. Schema is the app's business.
pub fn open(path: &str) -> rusqlite::Result<Connection> {
    // SQLite creates the file but not missing parent dirs (e.g. a fresh
    // app-data dir) — ensure they exist first.
    if let Some(parent) = Path::new(path).parent() {
        if !parent.as_os_str().is_empty() {
            let _ = std::fs::create_dir_all(parent);
        }
    }
    let conn = Connection::open(path)?;
    // ponytail: WAL + foreign_keys, and deliberately no `busy_timeout`. This is
    // a behaviour-preserving extraction of the pragmas Galerie has always set,
    // and a timeout changes how every existing catalog behaves under
    // contention. Add one the day a second writer (background job, second
    // window) exists — that is the change that needs it, and can prove it.
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(conn)
}

// ─────────────────────────────────────────────────────────────
// Maintenance (integrity / optimize / backup / snapshot)
// ─────────────────────────────────────────────────────────────

/// Run `PRAGMA integrity_check` and return its first row ("ok" when clean,
/// else the first problem). A cheap consistency probe before mutating.
pub fn integrity_check(conn: &Connection) -> rusqlite::Result<String> {
    conn.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
}

/// Compact + re-analyze the database: flush the WAL, `VACUUM` (reclaims space
/// after deletes), and refresh the query planner's stats.
pub fn optimize(conn: &Connection) -> rusqlite::Result<()> {
    let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    conn.execute_batch("VACUUM; PRAGMA optimize;")?;
    Ok(())
}

/// Back up to `dest` by checkpointing the WAL into the main file and copying it
/// (a consistent point-in-time snapshot). Errors for an in-memory database (no
/// backing file).
pub fn backup_to(conn: &Connection, dest: &str) -> Result<(), String> {
    let src = conn
        .path()
        .filter(|p| !p.is_empty())
        .ok_or_else(|| "database has no file (in-memory)".to_string())?;
    // Fold the WAL back into the main db so the copied file is complete.
    //
    // Read the result (#236): a BUSY checkpoint is NOT an error — it returns a
    // row whose first column is 1 and leaves committed transactions in the
    // `-wal`, which this copy does not include. `execute_batch` discarded that
    // row, so a second connection to the same file (a second window on the same
    // catalog) silently produced a stale "consistent point-in-time snapshot".
    let busy: i64 = conn
        .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if busy != 0 {
        return Err(
            "WAL checkpoint is blocked by another connection to this database — \
             close other windows and retry"
                .to_string(),
        );
    }
    std::fs::copy(src, dest).map_err(|e| e.to_string())?;
    Ok(())
}

/// `VACUUM INTO` — a consistent, compacted copy of the database at `dest`.
/// Unlike [`backup_to`] it works on an in-memory database and never touches the
/// source file, which is what makes it the snapshot a container packs. SQLite
/// refuses an existing `dest`; that refusal is the safety, not an obstacle.
pub fn vacuum_into(conn: &Connection, dest: &Path) -> Result<(), String> {
    let dest = dest.to_str().ok_or("snapshot path is not UTF-8")?;
    conn.execute("VACUUM INTO ?1", params![dest])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// A consistent point-in-time copy of the database as BYTES — [`vacuum_into`] a
/// scratch file, read it back, drop it. This is what a container packs.
///
/// The scratch is written BESIDE `beside` — the file these bytes are headed for
/// — and never in the shared system temp dir: a second full copy of a user's
/// database in `/tmp` is a disk problem and a privacy problem, and a predictable
/// name there is two concurrent snapshots overwriting each other.
pub fn snapshot_bytes(conn: &Connection, beside: &Path) -> Result<Vec<u8>, String> {
    let dir = beside
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    // Leading dot: on unix the scratch stays out of the user's file listing for
    // the seconds it exists. Elsewhere it is just an unusual name.
    let scratch = dir.join(format!(".{}.sqlite", unique_name("monet-db-snapshot")));
    vacuum_into(conn, &scratch)?;
    let bytes = std::fs::read(&scratch).map_err(|e| format!("read snapshot: {e}"));
    let _ = std::fs::remove_file(&scratch);
    bytes
}

/// A name no concurrent caller can collide with: pid (another process) + nanos +
/// a per-process counter (two calls inside the same nanosecond).
///
/// Collision is not a cosmetic issue here — two opens sharing a working
/// directory is exactly the stale-journal defect `container` guards against.
pub(crate) fn unique_name(prefix: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{}-{nanos}-{seq}", std::process::id())
}

// ─────────────────────────────────────────────────────────────
// Query + identity helpers
// ─────────────────────────────────────────────────────────────

/// Escape LIKE wildcards so a literal % / _ / \ matches itself. Pair it with
/// `ESCAPE '\'` in the statement.
pub fn escape_like(s: &str) -> String {
    s.chars()
        .flat_map(|c| match c {
            '\\' | '%' | '_' => vec!['\\', c],
            c => vec![c],
        })
        .collect()
}

/// Lowercase hex SHA-256 of `bytes` — the content identity every app stores.
pub fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// Stream `file` from the start and return `(size, sha256_hex)`. `buffer_bytes`
/// is the read chunk — the caller's, because the right size depends on what it
/// is hashing.
pub fn digest_file(file: &File, buffer_bytes: usize) -> Result<(u64, String), String> {
    let mut file = file.try_clone().map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut size = 0_u64;
    let mut buffer = vec![0; buffer_bytes];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        size = size.checked_add(read as u64).ok_or("file size overflow")?;
        hash.update(&buffer[..read]);
    }
    Ok((size, format!("{:x}", hash.finalize())))
}

/// The full descriptor-identity tuple used to detect any change to a
/// retained/reopened file: not just `(device, inode)` (which misses an in-place
/// same-inode byte mutation) but also size and both mtime/ctime at nanosecond
/// resolution.
#[cfg(unix)]
pub type FileIdentity = (u64, u64, u64, i64, i64, i64, i64);

#[cfg(unix)]
pub fn file_identity(meta: &std::fs::Metadata) -> FileIdentity {
    use std::os::unix::fs::MetadataExt;
    (
        meta.dev(),
        meta.ino(),
        meta.len(),
        meta.mtime(),
        meta.mtime_nsec(),
        meta.ctime(),
        meta.ctime_nsec(),
    )
}

// ─────────────────────────────────────────────────────────────
// The state guard
// ─────────────────────────────────────────────────────────────

/// The open connection for one app session (Tauri-managed state). `None` until
/// something opens a database.
pub struct DbState(pub Mutex<Option<Connection>>);

impl DbState {
    pub fn new() -> DbState {
        DbState(Mutex::new(None))
    }

    /// Run `f` against the open connection, or error if none is open.
    pub fn with_conn<T>(
        &self,
        f: impl FnOnce(&Connection) -> rusqlite::Result<T>,
    ) -> Result<T, String> {
        let guard = self
            .0
            .lock()
            .map_err(|e| format!("database lock poisoned: {e}"))?;
        let conn = guard.as_ref().ok_or("no database open")?;
        f(conn).map_err(|e| e.to_string())
    }
}

impl Default for DbState {
    fn default() -> DbState {
        DbState::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CREATE_T: &str = "CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT, b TEXT);";

    /// Open + create the scratch table the maintenance tests operate on.
    fn open_t(path: &str) -> Connection {
        let conn = open(path).unwrap();
        conn.execute_batch(CREATE_T).unwrap();
        conn
    }

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("monet-db-test-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn open_applies_the_pragmas() {
        let dir = temp_dir("open");
        let path = dir.join("nested/a.sqlite"); // parent dir does not exist yet
        let conn = open_t(path.to_str().unwrap());

        let journal: String = conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(journal.to_lowercase(), "wal");
        let fk: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fk, 1);
        conn.execute("INSERT INTO t(a, b) VALUES('x', 'y')", [])
            .unwrap();
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn integrity_optimize_backup_and_vacuum_into() {
        let dir = temp_dir("maint");
        let src = dir.join("src.sqlite");
        let conn = open_t(src.to_str().unwrap());
        conn.execute("INSERT INTO t(a) VALUES('row')", []).unwrap();

        assert_eq!(integrity_check(&conn).unwrap(), "ok");
        optimize(&conn).unwrap();

        let copy = dir.join("copy.sqlite");
        backup_to(&conn, copy.to_str().unwrap()).unwrap();
        let reopened = open(copy.to_str().unwrap()).unwrap();
        assert_eq!(
            reopened
                .query_row("SELECT a FROM t", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "row"
        );

        let snap = dir.join("snap.sqlite");
        vacuum_into(&conn, &snap).unwrap();
        assert!(vacuum_into(&conn, &snap).is_err(), "refuses to clobber");
        let from_snap = Connection::open(&snap).unwrap();
        assert_eq!(
            from_snap
                .query_row("SELECT a FROM t", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "row"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn backup_of_an_in_memory_database_errors() {
        let conn = Connection::open_in_memory().unwrap();
        assert!(backup_to(&conn, "/tmp/monet-db-never.sqlite").is_err());
    }

    /// #236 — a copy of the main file is only a snapshot if the WAL actually
    /// folded in. With a second connection holding a read snapshot (a second
    /// window on the same catalog) the TRUNCATE checkpoint reports BUSY without
    /// erroring, so `backup_to` used to return Ok and write a destination that
    /// was missing every transaction still living in the `-wal`.
    #[test]
    fn backup_refuses_when_the_wal_checkpoint_is_blocked() {
        let dir = temp_dir("busy-backup");
        let src = dir.join("src.sqlite");
        let conn = open_t(src.to_str().unwrap());
        conn.execute("INSERT INTO t(a) VALUES('first')", []).unwrap();

        // Second connection pins a read snapshot of the database.
        let reader = open(src.to_str().unwrap()).unwrap();
        reader.execute_batch("BEGIN").unwrap();
        assert_eq!(
            reader
                .query_row("SELECT COUNT(*) FROM t", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );

        // This row can only live in the -wal while the reader holds its snapshot.
        conn.execute("INSERT INTO t(a) VALUES('second')", []).unwrap();

        let copy = dir.join("copy.sqlite");
        let err = backup_to(&conn, copy.to_str().unwrap())
            .expect_err("a blocked checkpoint must not report a successful backup");
        assert!(err.contains("checkpoint"), "{err}");
        assert!(!copy.exists(), "no half-a-database left behind: {err}");

        // Once the reader lets go, the same call succeeds and is complete.
        reader.execute_batch("COMMIT").unwrap();
        backup_to(&conn, copy.to_str().unwrap()).unwrap();
        let reopened = Connection::open(&copy).unwrap();
        assert_eq!(
            reopened
                .query_row("SELECT COUNT(*) FROM t", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn snapshot_bytes_is_an_openable_database() {
        let conn = open_t(":memory:");
        conn.execute("INSERT INTO t(a) VALUES('mem')", []).unwrap();

        let dir = temp_dir("snapbytes");
        let path = dir.join("out.sqlite");
        let bytes = snapshot_bytes(&conn, &path).unwrap();
        std::fs::write(&path, &bytes).unwrap();
        let reopened = Connection::open(&path).unwrap();
        assert_eq!(
            reopened
                .query_row("SELECT a FROM t", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "mem"
        );
        // The scratch is gone, and nothing but the destination is left behind.
        let left: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(left, ["out.sqlite"], "scratch not cleaned up");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_snapshot_scratch_lives_beside_the_destination_not_in_temp() {
        let conn = open_t(":memory:");
        let dir = temp_dir("snapbeside");
        // A destination directory that does not exist. The system temp dir
        // always does, so this call could only succeed by putting a user's
        // whole database there instead.
        assert!(
            snapshot_bytes(&conn, &dir.join("missing/out.mgal")).is_err(),
            "the scratch must be written beside the destination"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn escape_like_escapes_every_wildcard() {
        assert_eq!(escape_like("100%_of\\it"), "100\\%\\_of\\\\it");
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(CREATE_T).unwrap();
        conn.execute("INSERT INTO t(a) VALUES('50%'), ('50x')", [])
            .unwrap();
        let hits: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM t WHERE a LIKE ?1 ESCAPE '\\'",
                params![format!("%{}%", escape_like("50%"))],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hits, 1, "a literal % must not match everything");
    }

    #[test]
    fn digests_match_across_the_two_entry_points() {
        let dir = temp_dir("digest");
        let path = dir.join("blob.bin");
        let payload = vec![7_u8; 300_000];
        std::fs::write(&path, &payload).unwrap();

        let file = File::open(&path).unwrap();
        let (size, hex) = digest_file(&file, 64 * 1024).unwrap();
        assert_eq!(size, payload.len() as u64);
        assert_eq!(hex, sha256_hex(&payload));
        assert_eq!(hex.len(), 64);

        #[cfg(unix)]
        {
            let identity = file_identity(&std::fs::metadata(&path).unwrap());
            assert_eq!(identity.2, payload.len() as u64);
            assert_eq!(identity, file_identity(&std::fs::metadata(&path).unwrap()));
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn state_guard_reports_a_closed_database() {
        let count = |c: &Connection| c.query_row("SELECT COUNT(*) FROM t", [], |r| r.get::<_, i64>(0));
        let state = DbState::new();
        assert_eq!(state.with_conn(count).unwrap_err(), "no database open");
        *state.0.lock().unwrap() = Some(open_t(":memory:"));
        assert_eq!(state.with_conn(count).unwrap(), 0);
    }
}
