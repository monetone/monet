// folderSync — plan Lightroom's "Synchronize Folders": which files inside the
// catalog's folders are importable but not yet cataloged. Pure, so the plan is
// unit-tested; the fs listing and the import run live in import.ts.

export interface DirListing {
  dir: string;
  /** Absolute file paths inside `dir` (non-recursive). */
  files: string[];
}

/** New importable paths: extension-matched files under the catalog's folders
 *  that no source asset references yet. De-duplicated, sorted. */
export function planFolderSync(
  catalogedPaths: readonly string[],
  listings: readonly DirListing[],
  extensions: ReadonlySet<string>,
): string[] {
  const known = new Set(catalogedPaths);
  const out = new Set<string>();
  for (const l of listings) {
    for (const f of l.files) {
      const dot = f.lastIndexOf(".");
      const ext = dot >= 0 ? f.slice(dot + 1).toLowerCase() : "";
      if (!extensions.has(ext) || known.has(f)) continue;
      out.add(f);
    }
  }
  return [...out].sort();
}

/** The distinct parent directories of the cataloged source paths. */
export function sourceDirs(paths: readonly string[]): string[] {
  const dirs = new Set<string>();
  for (const p of paths) {
    const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    if (i > 0) dirs.add(p.slice(0, i));
  }
  return [...dirs].sort();
}
