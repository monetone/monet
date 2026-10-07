// SnapshotsPanel — named develop snapshots for the active photo (Phase 2). A
// snapshot freezes the current recipe under a name; clicking one restores it,
// ⟳ updates it with the current settings, ✎ renames it, × deletes it. Persisted
// in the catalog (survives restart, per photo) via the catalog bridge; the Rust
// db layer owns the CRUD + per-name upsert semantics — and that upsert IS the
// update/rename primitive here, so neither needs a command of its own.

import { Button } from "@monet-ui/monet-react";
import { useEffect, useState } from "react";

import type { DevelopRecipeV2 } from "@monet-ui/monet-photo";

import { addSnapshot, catalogAvailable, deleteSnapshot, listSnapshots } from "../catalog/catalog";
import type { SnapshotRow } from "../catalog/types";

/** LR's "Update with Current Settings": same name, today's recipe. The catalog
 *  upserts by (photo, name), so re-saving the name IS the in-place update. */
export function updateSnapshot(
  photoId: number,
  name: string,
  recipe: DevelopRecipeV2,
): Promise<number> {
  return addSnapshot(photoId, name, JSON.stringify(recipe), recipe.processVersion);
}

/** Rename = write the recipe under the new name, then drop the old row. Taking
 *  a name another snapshot already holds overwrites it (same as saving over a
 *  name); the id check is what stops a no-op rename deleting what it wrote. */
export async function renameSnapshot(s: SnapshotRow, name: string): Promise<void> {
  const id = await addSnapshot(s.photoId, name, s.recipeJson, s.processVersion);
  if (id !== s.id) await deleteSnapshot(s.id);
}

export function SnapshotsPanel({
  photoId,
  recipe,
  onRestore,
}: {
  photoId: number;
  recipe: DevelopRecipeV2;
  onRestore: (r: DevelopRecipeV2) => void;
}) {
  const [snaps, setSnaps] = useState<SnapshotRow[]>([]);

  const reload = () => {
    if (!catalogAvailable()) return;
    listSnapshots(photoId)
      .then(setSnaps)
      .catch(() => setSnaps([]));
  };

  useEffect(() => {
    let cancelled = false;
    if (!catalogAvailable()) {
      setSnaps([]);
      return;
    }
    listSnapshots(photoId)
      .then((s) => !cancelled && setSnaps(s))
      .catch(() => !cancelled && setSnaps([]));
    return () => {
      cancelled = true;
    };
  }, [photoId]);

  const create = async () => {
    const name = window.prompt("Snapshot name")?.trim();
    if (!name) return;
    try {
      await updateSnapshot(photoId, name, recipe); // create and update are the same upsert
      reload();
    } catch (e) {
      console.error("galerie snapshot: create failed", e);
    }
  };

  const restore = (s: SnapshotRow) => {
    try {
      onRestore(JSON.parse(s.recipeJson) as DevelopRecipeV2);
    } catch (e) {
      console.error("galerie snapshot: restore failed", s.name, e);
    }
  };

  const update = async (s: SnapshotRow) => {
    try {
      await updateSnapshot(photoId, s.name, recipe);
      reload();
    } catch (e) {
      console.error("galerie snapshot: update failed", s.name, e);
    }
  };

  const rename = async (s: SnapshotRow) => {
    const name = window.prompt("Rename snapshot", s.name)?.trim();
    if (!name || name === s.name) return;
    try {
      await renameSnapshot(s, name);
      reload();
    } catch (e) {
      console.error("galerie snapshot: rename failed", s.name, e);
    }
  };

  const remove = async (id: number) => {
    try {
      await deleteSnapshot(id);
      reload();
    } catch (e) {
      console.error("galerie snapshot: delete failed", e);
    }
  };

  return (
    <div className="gal-dev-panel">
      <div className="gal-dev-head">
        <span className="gal-dev-title">Snapshots</span>
        <Button variant="ghost" size="sm" onClick={create}>
          ＋ New
        </Button>
      </div>
      {snaps.length === 0 ? (
        <div className="gal-snap-empty">No snapshots</div>
      ) : (
        <ul className="gal-snap-list">
          {snaps.map((s) => (
            <li key={s.id} className="gal-snap-row">
              <button className="gal-snap-name" onClick={() => restore(s)} title="Restore this snapshot">
                {s.name}
              </button>
              {/* gal-snap-del is the row's small icon-button style, not just delete. */}
              <button
                className="gal-snap-del"
                onClick={() => void update(s)}
                title="Update with Current Settings"
                aria-label={`Update snapshot ${s.name} with current settings`}
              >
                ⟳
              </button>
              <button
                className="gal-snap-del"
                onClick={() => void rename(s)}
                title="Rename snapshot"
                aria-label={`Rename snapshot ${s.name}`}
              >
                ✎
              </button>
              <button
                className="gal-snap-del"
                onClick={() => void remove(s.id)}
                title="Delete snapshot"
                aria-label={`Delete snapshot ${s.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
