// folderTree — pure helpers for the Folders panel's tree view: derive nesting
// depth from the flat folder list, filter collapsed subtrees, and validate
// drag-to-move targets. Only folders that directly contain photos appear
// (db::list_folders); depth is relative to the nearest LISTED ancestor.
// ponytail: no synthesized intermediate nodes — add if deep trees read poorly.

export interface FolderTreeRow {
  path: string;
  count: number;
  depth: number;
  hasChildren: boolean;
}

const isUnder = (child: string, parent: string): boolean =>
  child.startsWith(parent + "/") || child.startsWith(parent + "\\");

export const parentDirOf = (p: string): string => {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : "";
};

/** Join dir + leaf using the dir's own separator style. */
export const joinPath = (dir: string, leaf: string): string =>
  dir + (dir.includes("/") || !dir.includes("\\") ? "/" : "\\") + leaf;

// Sort key mapping separators below every printable char, so children always
// immediately follow their parent (a plain sort lets siblings like "2024-01"
// interleave between "2024" and "2024/jan", detaching the subtree).
const sortKey = (p: string): string => p.replace(/[/\\]/g, "\0") + "\0";

/** Flat folder list → tree-ordered display rows with depth + child markers. */
export function folderTreeRows(
  folders: readonly { path: string; count: number }[],
): FolderTreeRow[] {
  const sorted = [...folders]
    .map((f) => ({ f, key: sortKey(f.path) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((e) => e.f);
  const rows: FolderTreeRow[] = [];
  const stack: FolderTreeRow[] = [];
  for (const f of sorted) {
    while (stack.length > 0 && !isUnder(f.path, stack[stack.length - 1].path)) stack.pop();
    const row = { path: f.path, count: f.count, depth: stack.length, hasChildren: false };
    if (stack.length > 0) stack[stack.length - 1].hasChildren = true;
    rows.push(row);
    stack.push(row);
  }
  return rows;
}

/** Rows minus any inside a collapsed ancestor (the collapsed row itself stays). */
export function visibleFolderRows(
  rows: readonly FolderTreeRow[],
  collapsed: ReadonlySet<string>,
): FolderTreeRow[] {
  return rows.filter((r) => {
    for (const c of collapsed) if (isUnder(r.path, c)) return false;
    return true;
  });
}

/** A folder may drop into `dest` unless it IS dest, dest sits inside it, or
 *  dest is already its parent (a no-op move). */
export function canDropFolder(src: string, dest: string): boolean {
  return src !== dest && !isUnder(dest, src) && parentDirOf(src) !== dest;
}

/** Photo-onto-folder drop → `store.renamePhotos` steps: each dragged photo
 *  moves into `destDir` keeping its filename. Ids not in the loaded buffer or
 *  already directly inside `destDir` are skipped (no-op moves). */
export function movePhotoSteps(
  photos: readonly { id: number; path: string }[],
  ids: readonly number[],
  destDir: string,
): { id: number; from: string; to: string }[] {
  const want = new Set(ids);
  return photos
    .filter((p) => want.has(p.id) && parentDirOf(p.path) !== destDir)
    .map((p) => ({
      id: p.id,
      from: p.path,
      to: joinPath(destDir, p.path.slice(Math.max(p.path.lastIndexOf("/"), p.path.lastIndexOf("\\")) + 1)),
    }));
}

/** Is `path` a DIRECT child of `dir` (no further separator after the prefix)?
 *  The folder-only filter's client-side mirror. */
export function isDirectChild(path: string, dir: string): boolean {
  if (!isUnder(path, dir)) return false;
  return !/[/\\]/.test(path.slice(dir.length + 1));
}

/** Merge session-created empty folders (count 0) into the cataloged folder
 *  list, dropping any that the catalog now lists itself. */
export function mergeExtraFolders(
  folders: readonly { path: string; count: number }[],
  extras: readonly string[],
): { path: string; count: number }[] {
  const listed = new Set(folders.map((f) => f.path));
  return [...folders, ...extras.filter((p) => !listed.has(p)).map((path) => ({ path, count: 0 }))];
}
