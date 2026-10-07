// FoldersPanel — Lightroom's Folders: browse the catalog by on-disk folder,
// shown as a tree (depth + collapse via lib/folderTree). Clicking a folder
// filters the paginated library to files under it (subfolders included, or
// direct children only via the Show Photos in Subfolders toggle; click again
// for All Photos). "+ Add Folder…" registers/creates a directory; hover ＋
// creates a subfolder inside, ✎ renames (disk + catalog), ⟳ runs per-folder
// Synchronize, ⇱ is Update Folder Location (repoint a folder moved outside
// the app), ✕ removes the folder from the catalog (files stay on disk).
// Dragging a folder onto another moves it there on disk (undoable), and
// dropping photos from the grid/filmstrip onto a folder moves their files
// into it (LR's drag-to-move; undoable batch).

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";

import { synchronizeFolders } from "../import";
import { canDropFolder, folderTreeRows, joinPath, movePhotoSteps, visibleFolderRows } from "../lib/folderTree";
import { PHOTO_DRAG_TYPE, readPhotoDrag } from "../lib/photoDrag";
import { store, useCatalog } from "../state/store";

const leafOf = (p: string): string => p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1) || p;

export function FoldersPanel() {
  const st = useCatalog();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [dropPath, setDropPath] = useState<string | null>(null);
  useEffect(() => {
    void store.refreshFolders();
  }, []);
  // Prune collapse state for paths that no longer exist (rename/move re-keys
  // them); a stale entry would silently hide any future folder under it.
  useEffect(() => {
    setCollapsed((c) => {
      const live = new Set(st.folders.map((f) => f.path));
      const kept = [...c].filter((p) => live.has(p));
      return kept.length === c.size ? c : new Set(kept);
    });
  }, [st.folders]);
  const rows = visibleFolderRows(folderTreeRows(st.folders), collapsed);
  return (
    <div className="gal-kw-list">
      <div
        className="gal-kw-row"
        title="Register an existing folder (or one you create in the picker) as a destination"
        onClick={() =>
          void openDialog({ directory: true, multiple: false, title: "Add Folder" }).then((dir) => {
            if (typeof dir === "string") void store.createFolder(dir);
          })
        }
      >
        <span className="gal-kw-name" style={{ opacity: 0.75 }}>
          + Add Folder…
        </span>
      </div>
      <div
        className="gal-kw-row"
        title="On: a folder shows everything beneath it. Off: direct children only."
        onClick={() => void store.setFolderRecursive(!st.folderRecursive)}
      >
        <span className="gal-kw-name" style={{ opacity: 0.75 }}>
          {st.folderRecursive ? "☑" : "☐"} Show Photos in Subfolders
        </span>
      </div>
      {st.folders.length === 0 && <div className="gal-kw-empty">No folders yet — import photos</div>}
      {rows.map((f) => (
        <div
          key={f.path}
          className={
            "gal-kw-row" +
            (st.activeFolderPath === f.path ? " is-active" : "") +
            (dropPath === f.path ? " is-drop" : "")
          }
          style={{ paddingLeft: 6 + f.depth * 14 }}
          title={f.path}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            setDragPath(f.path);
          }}
          onDragEnd={() => {
            setDragPath(null);
            setDropPath(null);
          }}
          onDragOver={(e) => {
            // Two drag sources land here: another folder row (move the folder)
            // or grid/filmstrip photos (move the files into this folder).
            if (dragPath ? canDropFolder(dragPath, f.path) : e.dataTransfer.types.includes(PHOTO_DRAG_TYPE)) {
              e.preventDefault();
              setDropPath(f.path);
            }
          }}
          onDragLeave={() => setDropPath((p) => (p === f.path ? null : p))}
          onDrop={(e) => {
            e.preventDefault();
            setDropPath(null);
            if (!dragPath) {
              // Photo drop (LR): move the dragged photos' files into this
              // folder on disk, keeping filenames. One undoable batch.
              const steps = movePhotoSteps(st.photos, readPhotoDrag(e.dataTransfer), f.path);
              if (steps.length === 0) return;
              const n = steps.length;
              if (window.confirm(`Move ${n} photo${n === 1 ? "" : "s"} into "${leafOf(f.path)}"? The files move on disk.`)) {
                void store.renamePhotos(steps).then(async () => {
                  // Folder counts and any active folder filter changed with
                  // the paths — the in-place buffer patch is not enough.
                  await store.reload();
                  await store.refreshFolders();
                });
              }
              return;
            }
            if (!canDropFolder(dragPath, f.path)) return;
            const leaf = leafOf(dragPath);
            if (window.confirm(`Move "${leaf}" into "${leafOf(f.path)}"? The folder moves on disk.`)) {
              // Auto-expand the target so the moved folder doesn't vanish
              // into a collapsed subtree (LR behavior).
              setCollapsed((c) => {
                if (!c.has(f.path)) return c;
                const next = new Set(c);
                next.delete(f.path);
                return next;
              });
              void store.renameFolder(dragPath, joinPath(f.path, leaf));
            }
          }}
          onClick={() => void store.setActiveFolder(st.activeFolderPath === f.path ? null : f.path)}
        >
          <span
            className="gal-folder-disc"
            onClick={(e) => {
              e.stopPropagation();
              if (!f.hasChildren) return;
              setCollapsed((c) => {
                const next = new Set(c);
                if (next.has(f.path)) next.delete(f.path);
                else next.add(f.path);
                return next;
              });
            }}
          >
            {f.hasChildren ? (collapsed.has(f.path) ? "▸" : "▾") : ""}
          </span>
          <span className="gal-kw-name">{leafOf(f.path)}</span>
          <span className="gal-kw-count">{f.count}</span>
          <button
            type="button"
            className="gal-kw-del"
            title="Create a folder inside this one"
            onClick={(e) => {
              e.stopPropagation();
              const name = window.prompt(`Create folder inside "${leafOf(f.path)}"`)?.trim();
              if (!name) return;
              if (name.includes("/") || name.includes("\\")) {
                store.notify("Folder names cannot contain path separators.");
                return;
              }
              // Auto-expand so the new child is visible immediately.
              setCollapsed((c) => {
                if (!c.has(f.path)) return c;
                const next = new Set(c);
                next.delete(f.path);
                return next;
              });
              void store.createFolder(joinPath(f.path, name));
            }}
          >
            ＋
          </button>
          <button
            type="button"
            className="gal-kw-del"
            title="Rename this folder (disk + catalog)"
            onClick={(e) => {
              e.stopPropagation();
              const leaf = leafOf(f.path);
              const name = window.prompt("Rename folder", leaf)?.trim();
              if (!name || name === leaf) return;
              if (name.includes("/") || name.includes("\\")) {
                store.notify("Folder names cannot contain path separators.");
                return;
              }
              const parent = f.path.slice(0, f.path.length - leaf.length);
              void store.renameFolder(f.path, parent + name);
            }}
          >
            ✎
          </button>
          <button
            type="button"
            className="gal-kw-del"
            title="Synchronize this folder — import new files found on disk"
            onClick={(e) => {
              e.stopPropagation();
              void synchronizeFolders(f.path).then((found) => {
                if (found.length === 0) store.notify("Folder is up to date — no new photos");
                else store.requestImportPaths(found);
              });
            }}
          >
            ⟳
          </button>
          <button
            type="button"
            className="gal-kw-del"
            title="Update Folder Location — the folder moved outside the app; repoint the catalog (files are not moved)"
            onClick={(e) => {
              e.stopPropagation();
              void openDialog({ directory: true, multiple: false, title: "Update Folder Location" }).then((sel) => {
                if (typeof sel !== "string" || sel === f.path) return;
                if (
                  window.confirm(
                    `Point the cataloged photos under "${leafOf(f.path)}" at "${sel}"? No files are moved on disk.`,
                  )
                )
                  void store.updateFolderLocation(f.path, sel);
              });
            }}
          >
            ⇱
          </button>
          <button
            type="button"
            className="gal-kw-del"
            title="Remove this folder from the catalog — photos under it (subfolders included) lose their catalog entries and edits; files stay on disk"
            onClick={(e) => {
              e.stopPropagation();
              if (
                window.confirm(
                  `Remove "${leafOf(f.path)}" from the catalog? Every photo under it (subfolders included) loses its catalog entry and edits. Files stay on disk. This cannot be undone.`,
                )
              )
                void store.removeFolder(f.path);
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
