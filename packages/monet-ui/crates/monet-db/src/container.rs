//! The container ↔ live-database lifecycle (design doc 11).
//!
//! SQLite cannot be operated inside a zip, so a container-backed database is
//! **extracted** to a working file, worked on there normally, and **snapshotted
//! back** on save — couriering every other entry byte-for-byte (rule 2).
//!
//! A bare database opened directly (Galerie's `.galcat`) never comes through
//! here: it is a live database with no container around it.

use std::path::{Path, PathBuf};

use monet_format::container::{Container, ContainerApp};
use rusqlite::Connection;

use crate::{open, snapshot_bytes, unique_name};

/// The manifest `role` a database entry carries. `role` is what a reader
/// dispatches on — never the path, never the extension.
pub const DB_ROLE: &str = "database";

/// The 16 bytes every SQLite file starts with. An entry that does not is not a
/// database: SQLite would happily "open" a zero-byte or foreign payload as a
/// brand-new empty database, and the next save would write that emptiness back
/// over the real one.
const SQLITE_MAGIC: &[u8] = b"SQLite format 3\0";

/// The working file's name inside the per-open directory. FIXED, not derived
/// from the entry path: that path comes out of a foreign container and
/// `db/../../elsewhere` is not a file name we want to join onto anything.
const WORKING_FILE: &str = "database.sqlite";

/// A database extracted from a container: the live connection, the working file
/// it actually lives in, and where it came from.
pub struct ContainerDb {
    pub conn: Connection,
    /// The extracted, live database file. All reads/writes go here.
    pub working: PathBuf,
    /// The private directory `working` lives in — created empty by
    /// [`open_from_container`] and removed when this goes out of scope.
    working_dir: PathBuf,
    /// The container it came from — where [`ContainerDb::save`] writes back.
    pub container: PathBuf,
    /// The manifest path of the database entry, e.g. `db/catalog.sqlite`.
    pub entry: String,
    /// The manifest `kind` the container carried, re-stamped on save so a round
    /// trip through this crate cannot relabel someone else's document.
    pub kind: String,
}

impl ContainerDb {
    /// Snapshot the live database back into its container.
    pub fn save(&self, app: &ContainerApp) -> Result<(), String> {
        snapshot_to_container(&self.conn, &self.container, &self.entry, app, &self.kind)
    }
}

impl Drop for ContainerDb {
    fn drop(&mut self) {
        // ponytail: best-effort, and `conn` is still open here (struct fields
        // drop after this body). Unix does not mind unlinking an open file; a
        // Windows port has to close the connection first.
        let _ = std::fs::remove_dir_all(&self.working_dir);
    }
}

/// Extract the container's database entry into a fresh working directory under
/// `working_root`, open it there, and remember where it came from.
///
/// The extracted copy gets a directory **of its own**, created empty and owned
/// by the returned [`ContainerDb`]. That is not tidiness: SQLite validates a
/// `-wal` against the WAL header's own salts, never against the main database,
/// so a stale journal left beside a reused working path by an unclean previous
/// session is *replayed over* the freshly extracted file — you open container A
/// and get container B's rows, and the next [`save`] writes them back.
///
/// [`save`]: ContainerDb::save
pub fn open_from_container(container: &Path, working_root: &Path) -> Result<ContainerDb, String> {
    let bytes = std::fs::read(container).map_err(|e| format!("read container: {e}"))?;
    let parsed = Container::parse(&bytes)?;
    // Same predicate as `Container::role` — the first `database` row that has a
    // payload, so a manifest row whose file is missing doesn't hide a later one.
    let entry = parsed
        .paths_for_role(DB_ROLE)
        .into_iter()
        .find(|path| parsed.get(path).is_some())
        .ok_or("container carries no database entry")?
        .to_string();
    let payload = parsed.get(&entry).unwrap_or_default();

    // Validate BEFORE creating or writing anything: a failed open must leave the
    // disk exactly as it found it.
    if !payload.starts_with(SQLITE_MAGIC) {
        return Err(format!("container entry {entry} is not a SQLite database"));
    }

    std::fs::create_dir_all(working_root).map_err(|e| format!("create working dir: {e}"))?;
    let working_dir = working_root.join(unique_name("open"));
    // `create_dir`, not `create_dir_all`: if the name somehow exists the
    // directory is not ours and not empty, and that is the whole defect.
    std::fs::create_dir(&working_dir).map_err(|e| format!("create working dir: {e}"))?;
    let working = working_dir.join(WORKING_FILE);

    let opened = (|| {
        std::fs::write(&working, payload).map_err(|e| format!("write working database: {e}"))?;
        let path = working.to_str().ok_or("working path is not UTF-8")?;
        open(path).map_err(|e| e.to_string())
    })();
    let conn = match opened {
        Ok(conn) => conn,
        // Nothing outlives a failed open — the directory is ours alone.
        Err(e) => {
            let _ = std::fs::remove_dir_all(&working_dir);
            return Err(e);
        }
    };

    Ok(ContainerDb {
        conn,
        working,
        working_dir,
        container: container.to_path_buf(),
        entry,
        kind: parsed.manifest.kind.clone(),
    })
}

/// `VACUUM INTO` a consistent snapshot of `conn` and write it back into
/// `container` as `entry`, couriering every other entry unchanged. Creates the
/// container when it doesn't exist yet — that is what "save as" means.
///
/// `kind` is the caller's document class (`graphics | time | catalog | scene`,
/// or whatever an app invents next). This crate is generic: it knows about *a*
/// database, so it has no business naming one.
pub fn snapshot_to_container(
    conn: &Connection,
    container: &Path,
    entry: &str,
    app: &ContainerApp,
    kind: &str,
) -> Result<(), String> {
    if let Some(parent) = container.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| format!("create container dir: {e}"))?;
        }
    }
    let snapshot = snapshot_bytes(conn, container)?;
    let mut doc = match std::fs::read(container) {
        Ok(bytes) => Container::parse(&bytes)?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Container::new(app.clone(), kind),
        Err(e) => return Err(format!("read container: {e}")),
    };
    doc.manifest.app = app.clone(); // "who wrote it last"
    doc.manifest.kind = kind.to_string(); // …and what they say it is

    // EXACTLY ONE database entry, at the path the caller names. Appending a
    // second leaves the next open taking whichever comes first in manifest
    // order — the stale one.
    let existing: Vec<String> = doc
        .paths_for_role(DB_ROLE)
        .iter()
        .map(|path| path.to_string())
        .collect();
    if existing.len() > 1 {
        return Err(format!(
            "container carries {} database entries — refusing to guess which to replace",
            existing.len()
        ));
    }
    if let Some(old) = existing.first() {
        if old != entry {
            doc.remove(old);
        }
    }
    doc.set(entry, DB_ROLE, snapshot)?;
    let bytes = doc.to_bytes()?;
    // ponytail: plain write, no temp-file rename. The container primitive builds
    // the whole archive in memory first, so the window is one `write` — swap in
    // an atomic rename if crash-during-save ever shows up in the wild.
    std::fs::write(container, bytes).map_err(|e| format!("write container: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    use monet_format::container::{KIND_CATALOG, KIND_SCENE, KIND_TIME};

    /// Open + create the scratch table these tests round-trip.
    fn open_t(path: &Path) -> Connection {
        let conn = open(path.to_str().unwrap()).unwrap();
        conn.execute_batch("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, a TEXT);")
            .unwrap();
        conn
    }

    fn app() -> ContainerApp {
        ContainerApp::new("monet-galerie", "0.1.0")
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(unique_name(&format!("monet-db-container-{tag}")));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn rows(conn: &Connection) -> Vec<String> {
        conn.prepare("SELECT a FROM t ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    /// SQLite's journal sits at `<db>-wal`, a suffix on the whole file name.
    fn wal_of(db: &Path) -> PathBuf {
        PathBuf::from(format!("{}-wal", db.display()))
    }

    /// A container carrying one database with `row` in it.
    fn seeded_container(dir: &Path, at: &Path, row: &str) {
        let live = open_t(&dir.join(unique_name("seed")));
        live.execute("INSERT INTO t(a) VALUES(?1)", [row]).unwrap();
        let mut doc = Container::new(app(), KIND_CATALOG);
        doc.set("db/catalog.sqlite", DB_ROLE, snapshot_bytes(&live, at).unwrap())
            .unwrap();
        std::fs::write(at, doc.to_bytes().unwrap()).unwrap();
    }

    #[test]
    fn round_trips_a_database_and_couriers_every_other_entry() {
        let dir = temp_dir("roundtrip");
        let container = dir.join("session.mgal");

        // A container someone else wrote: a database plus two entries we don't
        // understand, one of them a foreign role.
        let mut seed = Container::new(ContainerApp::new("other-app", "9.9"), KIND_CATALOG);
        let live = open_t(&dir.join("seed.sqlite"));
        live.execute("INSERT INTO t(a) VALUES('seeded')", []).unwrap();
        seed.set(
            "db/catalog.sqlite",
            DB_ROLE,
            snapshot_bytes(&live, &container).unwrap(),
        )
        .unwrap();
        seed.set("previews/1.png", "pixels", vec![1, 2, 3]).unwrap();
        seed.set("notes/todo.txt", "future-role", b"keep me".to_vec())
            .unwrap();
        std::fs::write(&container, seed.to_bytes().unwrap()).unwrap();

        // Open it, work in the extracted copy, save back.
        let db = open_from_container(&container, &dir.join("work")).unwrap();
        assert_eq!(db.entry, "db/catalog.sqlite");
        assert_eq!(db.container, container);
        assert_eq!(rows(&db.conn), ["seeded"]);
        db.conn
            .execute("INSERT INTO t(a) VALUES('added')", [])
            .unwrap();
        db.save(&app()).unwrap();

        let saved = Container::parse(&std::fs::read(&container).unwrap()).unwrap();
        assert_eq!(saved.get("previews/1.png"), Some(&[1, 2, 3][..]));
        assert_eq!(saved.get("notes/todo.txt"), Some(&b"keep me"[..]));
        assert_eq!(saved.manifest.app.name, "monet-galerie");
        assert_eq!(saved.manifest.kind, KIND_CATALOG);

        // Reopen: both rows are there, in a fresh working file.
        let reopened = open_from_container(&container, &dir.join("work")).unwrap();
        assert_eq!(rows(&reopened.conn), ["seeded", "added"]);
        std::fs::remove_dir_all(&dir).ok();
    }

    /// The blocker: SQLite validates a `-wal` against the WAL header's OWN
    /// salts, never against the main database, so a journal an unclean session
    /// left at a reused working path is replayed over whatever is extracted
    /// there next — open container A, get container B's rows, save them back.
    #[test]
    fn a_stale_wal_in_the_working_root_cannot_swap_in_another_database() {
        let dir = temp_dir("stalewal");
        let container = dir.join("real.mgal");
        seeded_container(&dir, &container, "real");

        // What an unclean previous session leaves behind: a database whose
        // pages live entirely in an uncheckpointed WAL. Copy the pair out WHILE
        // THE CONNECTION IS OPEN — the last close checkpoints and deletes the
        // WAL, and then there would be nothing stale to find.
        let root = dir.join("work");
        std::fs::create_dir_all(&root).unwrap();
        let stale = root.join("catalog.sqlite"); // the name the old code used
        {
            let ghost = dir.join("previous-session.sqlite");
            let conn = Connection::open(&ghost).unwrap();
            conn.pragma_update(None, "journal_mode", "WAL").unwrap();
            conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
            conn.execute_batch(
                "CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT);
                 INSERT INTO t(a) VALUES('ghost');",
            )
            .unwrap();
            std::fs::copy(&ghost, &stale).unwrap();
            std::fs::copy(wal_of(&ghost), wal_of(&stale)).unwrap();
        }
        let stale_bytes = std::fs::read(&stale).unwrap();

        // The fixture really is a live stale WAL: replay a copy of the pair and
        // the other database's rows come back.
        let probe = dir.join("probe.sqlite");
        std::fs::copy(&stale, &probe).unwrap();
        std::fs::copy(wal_of(&stale), wal_of(&probe)).unwrap();
        assert_eq!(
            rows(&Connection::open(&probe).unwrap()),
            ["ghost"],
            "fixture is not a genuine stale WAL — the rest of this test proves nothing"
        );

        let db = open_from_container(&container, &root).unwrap();
        assert_eq!(
            rows(&db.conn),
            ["real"],
            "a stale WAL was replayed over the extracted database"
        );
        // Extracted somewhere of its own, and the previous session's files are
        // byte-for-byte as they were: a failed guess must not destroy them.
        assert_ne!(db.working, stale);
        assert_eq!(std::fs::read(&stale).unwrap(), stale_bytes);
        assert!(wal_of(&stale).exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_working_directory_is_private_to_one_open_and_dies_with_it() {
        let dir = temp_dir("private");
        let container = dir.join("s.mgal");
        seeded_container(&dir, &container, "real");
        let root = dir.join("work");

        let (first, second) = {
            let a = open_from_container(&container, &root).unwrap();
            let b = open_from_container(&container, &root).unwrap();
            // Two concurrent opens cannot collide, so neither can see the
            // other's journal.
            assert_ne!(a.working, b.working);
            assert!(a.working.exists() && b.working.exists());
            (a.working.clone(), b.working.clone())
        };
        assert!(!first.exists(), "the working copy outlived its ContainerDb");
        assert!(!second.exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    /// A zero-byte or foreign entry would otherwise "open" as a brand-new empty
    /// database, and the next save would write that emptiness back.
    #[test]
    fn an_entry_that_is_not_sqlite_is_refused_without_touching_the_disk() {
        let dir = temp_dir("notsqlite");
        let root = dir.join("work");
        std::fs::create_dir_all(&root).unwrap();
        let keep = root.join("do-not-touch");
        std::fs::write(&keep, b"mine").unwrap();

        for payload in [Vec::new(), b"SQLite format 2\0 nope".to_vec()] {
            let container = dir.join("broken.mgal");
            let mut doc = Container::new(app(), KIND_CATALOG);
            doc.set("db/catalog.sqlite", DB_ROLE, payload).unwrap();
            std::fs::write(&container, doc.to_bytes().unwrap()).unwrap();

            assert_eq!(
                open_from_container(&container, &root).err(),
                Some("container entry db/catalog.sqlite is not a SQLite database".to_string())
            );
        }
        assert_eq!(std::fs::read(&keep).unwrap(), b"mine");
        assert_eq!(
            std::fs::read_dir(&root).unwrap().count(),
            1,
            "a refused open left something behind"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn saving_replaces_the_database_entry_instead_of_appending_a_second() {
        let dir = temp_dir("replace");
        let container = dir.join("s.mgal");
        seeded_container(&dir, &container, "stale");

        // Save under a DIFFERENT entry name: appending leaves the next open
        // taking whichever comes first in manifest order — the stale one.
        let fresh = open_t(Path::new(":memory:"));
        fresh.execute("INSERT INTO t(a) VALUES('fresh')", []).unwrap();
        snapshot_to_container(&fresh, &container, "db/renamed.sqlite", &app(), KIND_CATALOG)
            .unwrap();

        let saved = Container::parse(&std::fs::read(&container).unwrap()).unwrap();
        assert_eq!(saved.paths_for_role(DB_ROLE), ["db/renamed.sqlite"]);
        assert!(
            saved.get("db/catalog.sqlite").is_none(),
            "the replaced database is still in the archive"
        );
        let db = open_from_container(&container, &dir.join("work")).unwrap();
        assert_eq!(rows(&db.conn), ["fresh"]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn more_than_one_database_entry_is_an_error_not_a_guess() {
        let dir = temp_dir("twodbs");
        let container = dir.join("two.mgal");
        let live = open_t(Path::new(":memory:"));
        let snapshot = snapshot_bytes(&live, &container).unwrap();
        let mut doc = Container::new(app(), KIND_CATALOG);
        doc.set("db/a.sqlite", DB_ROLE, snapshot.clone()).unwrap();
        doc.set("db/b.sqlite", DB_ROLE, snapshot).unwrap();
        std::fs::write(&container, doc.to_bytes().unwrap()).unwrap();

        let err = snapshot_to_container(&live, &container, "db/a.sqlite", &app(), KIND_CATALOG)
            .unwrap_err();
        assert!(err.starts_with("container carries 2 database entries"), "{err}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_manifest_kind_comes_from_the_caller() {
        let dir = temp_dir("kind");
        let container = dir.join("samples.mryt");
        let conn = open_t(Path::new(":memory:"));

        // Created with the caller's kind — this crate knows about *a* database,
        // so it has no catalog of its own to name.
        snapshot_to_container(&conn, &container, "db/samples.sqlite", &app(), KIND_TIME).unwrap();
        let saved = Container::parse(&std::fs::read(&container).unwrap()).unwrap();
        assert_eq!(saved.manifest.kind, KIND_TIME);

        // …and re-stamped when packing into one that already exists.
        snapshot_to_container(&conn, &container, "db/samples.sqlite", &app(), KIND_SCENE).unwrap();
        let saved = Container::parse(&std::fs::read(&container).unwrap()).unwrap();
        assert_eq!(saved.manifest.kind, KIND_SCENE);

        // A round trip keeps whatever the container said it was.
        let db = open_from_container(&container, &dir.join("work")).unwrap();
        assert_eq!(db.kind, KIND_SCENE);
        db.save(&ContainerApp::new("monet-jouer", "0.2.0")).unwrap();
        let saved = Container::parse(&std::fs::read(&container).unwrap()).unwrap();
        assert_eq!(saved.manifest.kind, KIND_SCENE);
        assert_eq!(saved.manifest.app.name, "monet-jouer");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn creates_the_container_on_first_save() {
        let dir = temp_dir("create");
        // A directory that does not exist yet — "save as" into a new folder.
        let container = dir.join("new/first.mgal");
        let conn = open_t(Path::new(":memory:"));
        conn.execute("INSERT INTO t(a) VALUES('first')", []).unwrap();

        snapshot_to_container(&conn, &container, "db/catalog.sqlite", &app(), KIND_CATALOG)
            .unwrap();

        let db = open_from_container(&container, &dir.join("work")).unwrap();
        assert_eq!(rows(&db.conn), ["first"]);
        // No snapshot scratch left in the user's folder.
        let left: Vec<_> = std::fs::read_dir(dir.join("new"))
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(left, ["first.mgal"]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_container_with_no_database_entry_is_an_error() {
        let dir = temp_dir("nodb");
        let container = dir.join("graphics.mvis");
        let mut doc = Container::new(app(), "graphics");
        doc.set("graphics.json", "graphics", b"{}".to_vec()).unwrap();
        std::fs::write(&container, doc.to_bytes().unwrap()).unwrap();

        let opened = open_from_container(&container, &dir.join("work"));
        assert_eq!(
            opened.err(),
            Some("container carries no database entry".to_string())
        );
        std::fs::remove_dir_all(&dir).ok();
    }
}
