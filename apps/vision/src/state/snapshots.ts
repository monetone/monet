// History Snapshots — pure & node-safe helpers (no engine/DOM). A snapshot is a
// named, full-document checkpoint (Photoshop's History-panel snapshots): it
// captures the whole document as engine project bytes so it can be restored
// later, independent of the linear undo history. Session-only — not saved with
// the file, matching Photoshop. The store captures/restores via save_project /
// buildProject.
//   https://helpx.adobe.com/photoshop/using/undo-history.html (Snapshots)

export interface DocSnapshot {
  id: number;
  name: string;
  bytes: Uint8Array; // engine.save_project() payload — a full-document checkpoint
}

/** Next default name: "Snapshot N" where N is one past the highest existing N. */
export function defaultSnapshotName(names: string[]): string {
  let max = 0;
  for (const n of names) {
    const m = /^Snapshot (\d+)$/.exec(n);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `Snapshot ${max + 1}`;
}

/** Immutably append a snapshot. */
export function addSnapshot(list: DocSnapshot[], snap: DocSnapshot): DocSnapshot[] {
  return [...list, snap];
}

/** Immutably remove the snapshot with the given id (no match → unchanged). */
export function removeSnapshot(list: DocSnapshot[], id: number): DocSnapshot[] {
  return list.filter((s) => s.id !== id);
}

/** Immutably rename the snapshot with the given id (blank name ignored). */
export function renameSnapshot(list: DocSnapshot[], id: number, name: string): DocSnapshot[] {
  const n = name.trim();
  if (!n) return list;
  return list.map((s) => (s.id === id ? { ...s, name: n } : s));
}
