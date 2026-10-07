// ─────────────────────────────────────────────────────────────
// ops/rasterize — Object ▸ Rasterize (vector selection → embedded image)
// ─────────────────────────────────────────────────────────────
// Adobe Illustrator's Object ▸ Rasterize swaps the selected vector artwork for a
// pixel image of the same artwork at its current bounds. The actual pixels are
// produced by the browser (canvas) in the async command; this op owns the pure
// document side: build the selection-only SVG to rasterize, and — given the PNG
// data URL — replace the selection with one ImageItem at the selection's world
// bounds (taking the frontmost object's z-position, like Blend ▸ Make).

import { cloneItemDeep } from "./items";
import { exportSVG } from "../io/svg";
import type { Rect } from "../geometry/bbox";
import { makeImage, makeLayer } from "../model/factory";
import { type ItemLocation, eachItem, selectionBounds, worldTransformAt } from "../model/query";
import type { Document, ID, Item } from "../model/types";

// Top-level-selected items in stacking order (bottom→top). An item whose group
// ancestor is itself selected rasterizes as part of that group, not separately.
const selectedRoots = (doc: Document, ids: Iterable<ID>): ItemLocation[] => {
  const idset = new Set(ids);
  const out: ItemLocation[] = [];
  eachItem(doc, (item, loc) => {
    if (!idset.has(item.id)) return;
    if (loc.ancestors.some((a) => idset.has(a.id))) return;
    out.push(loc);
  });
  return out;
};

/** SVG string of ONLY the selected items (world-baked clones), clipped to `region`. */
export const selectionToSvg = (doc: Document, ids: Iterable<ID>, region: Rect): string => {
  const clones: Item[] = selectedRoots(doc, ids).map((loc) => {
    const clone = cloneItemDeep(loc.item);
    clone.transform = worldTransformAt(loc);
    return clone;
  });
  return exportSVG({ ...doc, layers: [makeLayer("Rasterize", clones)] }, { region });
};

/**
 * Object ▸ Rasterize — replace the selected items with a single ImageItem painted
 * from `href` (a PNG data URL the caller produced from selectionToSvg), placed at the
 * selection's combined world bounds. `scale` records the supersample factor in the
 * image's natural pixel size. Returns the new image id, or null if there is nothing
 * to rasterize. Mutates `doc` in place.
 */
export const rasterize = (doc: Document, ids: Iterable<ID>, href: string, scale = 2): ID | null => {
  const idArr = [...ids];
  const bounds = selectionBounds(doc, idArr);
  const roots = selectedRoots(doc, idArr);
  if (!bounds || roots.length === 0) return null;

  const image = makeImage(
    href,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    Math.max(1, Math.round(bounds.width * scale)),
    Math.max(1, Math.round(bounds.height * scale)),
  );

  // Drop every selected root except the frontmost, then swap the frontmost for the
  // image — so the image inherits the frontmost object's container + z-position.
  const frontmost = roots[roots.length - 1];
  for (const loc of roots) {
    if (loc === frontmost) continue;
    const i = loc.container.indexOf(loc.item);
    if (i >= 0) loc.container.splice(i, 1);
  }
  const fi = frontmost.container.indexOf(frontmost.item);
  frontmost.container.splice(fi, 1, image);
  return image.id;
};
