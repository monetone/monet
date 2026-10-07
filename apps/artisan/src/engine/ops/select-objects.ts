// ─────────────────────────────────────────────────────────────
// ops/select-objects — Select ▸ Object (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Adobe Illustrator's Select ▸ Object submenu selects all objects of a kind
// across the document, regardless of the current selection. This covers the
// deterministic structural members:
//   • Text Objects        — every text object (point, area, or on a path)
//   • Point Text Objects  — click-set text with no area box and no path
//   • Area Text Objects   — text flowed inside a fixed area box (boxWidth/Height)
//   • Stray Points        — single-anchor paths (isolated points left by editing)
//   • Clipping Masks       — the clipping path of every clip group
//
// Pure query: returns the matching ids; the command sets the selection to them.

import { eachItem, isSelectable, isSelectableLocation } from "../model/query";
import type { Document, ID } from "../model/types";

export type SelectKind = "text" | "point-text" | "area-text" | "stray-points" | "clipping-masks";

export const matchingObjectIds = (doc: Document, kind: SelectKind): ID[] => {
  const ids: ID[] = [];
  eachItem(doc, (item, loc) => {
    if (!isSelectableLocation(loc)) return;
    switch (kind) {
      case "text":
        if (item.type === "text") ids.push(item.id);
        break;
      case "point-text":
        // Point text: no area box and not flowed along a path.
        if (item.type === "text" && item.boxWidth == null && item.boxHeight == null && item.pathD == null) ids.push(item.id);
        break;
      case "area-text":
        // Area text: text with a fixed area box.
        if (item.type === "text" && (item.boxWidth != null || item.boxHeight != null)) ids.push(item.id);
        break;
      case "stray-points":
        if (item.type === "path" && item.geometry.anchors.length < 2) ids.push(item.id);
        break;
      case "clipping-masks":
        if (item.type === "group" && item.clip && item.children[0] && isSelectable(doc, item.children[0].id)) ids.push(item.children[0].id);
        break;
    }
  });
  return ids;
};
