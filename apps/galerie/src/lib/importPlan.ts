// importPlan — pure source→destination planning for the Import dialog. "Add"
// references files in place (dest === src); "Copy" and "Move" target a chosen
// folder, optionally date-organized and renamed via the shared filename
// template (sequence-numbered), with within-batch collision suffixes so no copy
// silently overwrites another, plus Lightroom's optional untouched second copy
// (Copy only). Move plans exactly like Copy — deleting the source once the copy
// lands is import.ts's job, since only it knows the copy succeeded. The file
// I/O + catalog insert live there; this stays pure + unit-tested.

import { epochToLocalInput } from "./captureTime";
import { renderFilenameTemplate, stripExt } from "./filenameTemplate";

export type ImportHandling = "add" | "copy" | "move";

export interface ImportPlanOptions {
  handling: ImportHandling;
  /** Destination folder for "copy"/"move" (ignored for "add"). */
  destDir: string | null;
  /** Rename relocated files via `template` (copy/move only). */
  rename: boolean;
  template: string;
  startNumber: number;
  /** LR's Organize "By date": land in `destDir/YYYY/YYYY-MM-DD` subfolders. */
  organizeByDate?: boolean;
  /** LR's "Make a Second Copy To": a backup of the untouched original. */
  secondCopyDir?: string | null;
}

export interface ImportItem {
  src: string;
  /** Where the file lands: === src for "add"; a destDir path otherwise. */
  dest: string;
  /** Backup copy of the untouched original, or null when none was asked for. */
  second: string | null;
}

const baseName = (p: string): string =>
  p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1);

const extOf = (p: string): string => {
  const b = baseName(p);
  const dot = b.lastIndexOf(".");
  return dot > 0 ? b.slice(dot + 1) : "";
};

const joinPath = (dir: string, name: string): string => `${dir.replace(/[/\\]+$/, "")}/${name}`;

/** Claim `dir/name`, suffixing `-N` until it is free within this batch. */
function claim(dir: string, name: string, ext: string, used: Set<string>): string {
  let path = joinPath(dir, name);
  const stem = stripExt(name);
  for (let n = 1; used.has(path); n++) path = joinPath(dir, ext ? `${stem}-${n}.${ext}` : `${stem}-${n}`);
  used.add(path);
  return path;
}

/** LR's Organize "By date" subfolder for a capture time (epoch seconds), in
 *  local time like the rest of the app's capture-time handling. An unknown date
 *  lands straight in destDir rather than in an invented bucket.
 *  ponytail: one date format; LR offers a menu of them — add if asked. */
function dateSubdir(capture: number | null | undefined): string {
  if (capture == null) return "";
  const local = epochToLocalInput(capture); // "YYYY-MM-DDTHH:mm"
  return `${local.slice(0, 4)}/${local.slice(0, 10)}`;
}

/** Plan the src→dest for each imported file. "add" imports in place;
 *  "copy"/"move" target destDir, optionally date-organized (needs
 *  `captureTimes`, keyed by source path) and renamed. Batch-internal name
 *  collisions get a `-N` suffix so nothing is overwritten. Falls back to "add"
 *  when there is no destination; the second copy only applies to "copy", as in
 *  Lightroom (Move offers no second copy — there is no original left to back
 *  up, and a stale preset must not smuggle one in). */
export function planImport(
  paths: string[],
  opts: ImportPlanOptions,
  captureTimes?: ReadonlyMap<string, number | null>,
): ImportItem[] {
  if (opts.handling === "add" || !opts.destDir) {
    return paths.map((src) => ({ src, dest: src, second: null }));
  }
  const root = opts.destDir;
  const usedDest = new Set<string>();
  const usedSecond = new Set<string>();
  return paths.map((src, i) => {
    const ext = extOf(src);
    const name = opts.rename
      ? renderFilenameTemplate(
          opts.template,
          { name: stripExt(baseName(src)), copyName: null, sequence: opts.startNumber + i, customText: "" },
          ext,
        )
      : baseName(src);
    const sub = opts.organizeByDate ? dateSubdir(captureTimes?.get(src)) : "";
    const dir = sub ? joinPath(root, sub) : root;
    return {
      src,
      dest: claim(dir, name, ext, usedDest),
      // The second copy is a backup of the original: never renamed, never
      // date-organized (LR keeps it a flat untouched dump of the card).
      second:
        opts.secondCopyDir && opts.handling === "copy"
          ? claim(opts.secondCopyDir, baseName(src), ext, usedSecond)
          : null,
    };
  });
}
