// ─────────────────────────────────────────────────────────────
// ops/reverse-path — Object ▸ Path ▸ Reverse Path Direction (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Adobe Illustrator's Reverse Path Direction flips a path's direction: the start
// and end swap and the winding reverses. (On a compound-path subpath this toggles
// whether it reads as a hole.) Geometrically it reverses the anchor order and
// swaps each anchor's in/out handles — exactly what geometry/path.reverse does.

import { reverse } from "../geometry/path";
import { convertToPath, leafIds } from "./path-edit";
import { findItem } from "../model/query";
import { LIVE_SHAPES, type Document, type ID } from "../model/types";

/**
 * Object ▸ Path ▸ Reverse Path Direction — reverse each selected path (and each
 * compound subpath). Live shapes are converted to a path first. Mutates in
 * place; returns the ids it touched.
 */
export const reversePath = (doc: Document, ids: ID[]): ID[] => {
  const done: ID[] = [];
  for (const id of leafIds(doc, ids)) {
    let loc = findItem(doc, id);
    if (!loc) continue;
    if (LIVE_SHAPES.includes(loc.item.type)) {
      convertToPath(doc, id);
      loc = findItem(doc, id);
      if (!loc) continue;
    }
    const it = loc.item;
    if (it.type === "path") {
      it.geometry = reverse(it.geometry);
      done.push(id);
    } else if (it.type === "compound") {
      it.subpaths = it.subpaths.map(reverse);
      done.push(id);
    }
  }
  return done;
};
