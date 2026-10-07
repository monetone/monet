// renamePlan — plan Lightroom's Rename Photos (F2): each photo's on-disk
// rename derived from the filename template, extension and directory kept,
// names unique within the batch. Pure; the fs/catalog work lives in the store.

import type { PhotoRow } from "../catalog/types";
import { renderFilenameTemplate, stripExt } from "./filenameTemplate";

export interface RenameStep {
  id: number;
  from: string;
  to: string;
}

const sep = (p: string): number => Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
const dirOf = (p: string): string => p.slice(0, sep(p) + 1); // keeps the trailing separator
const baseOf = (p: string): string => p.slice(sep(p) + 1);
const extOf = (p: string): string => {
  const b = baseOf(p);
  const dot = b.lastIndexOf(".");
  return dot > 0 ? b.slice(dot + 1) : "";
};

/** Plan the batch: the sequence runs from `startNumber`, results are unique
 *  within the batch, and photos whose rendered name equals the current one are
 *  dropped (nothing to do). */
export function planRename(
  photos: readonly Pick<PhotoRow, "id" | "path" | "copyName">[],
  template: string,
  customText: string,
  startNumber: number,
): RenameStep[] {
  const used = new Set<string>();
  const steps: RenameStep[] = [];
  photos.forEach((p, i) => {
    const ext = extOf(p.path);
    const name = renderFilenameTemplate(
      template,
      { name: stripExt(baseOf(p.path)), copyName: p.copyName, sequence: startNumber + i, customText },
      ext,
    );
    let to = dirOf(p.path) + name;
    const stem = stripExt(name);
    for (let n = 1; used.has(to); n++) {
      to = dirOf(p.path) + (ext ? `${stem}-${n}.${ext}` : `${stem}-${n}`);
    }
    used.add(to);
    if (to !== p.path) steps.push({ id: p.id, from: p.path, to });
  });
  return steps;
}
