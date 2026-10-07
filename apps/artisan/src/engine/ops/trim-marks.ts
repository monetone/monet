// ─────────────────────────────────────────────────────────────
// ops/trim-marks — Object ▸ Create Trim Marks (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Adobe Illustrator's Create Trim Marks (formerly Crop Marks) draws printer's
// trim marks at the four corners of the selection's bounding box: at each corner
// a horizontal and a vertical mark, each set back from the trim edge by `offset`
// and `length` long, pointing OUTWARD so they never cross the artwork. The eight
// marks are grouped (thin black, no fill); the original artwork is kept.

import type { Rect } from "../geometry/bbox";
import { BLACK } from "../color";
import { findItem, selectionBounds } from "../model/query";
import { defaultStroke, makeGroup, makeLine, noPaint, solid } from "../model/factory";
import type { Document, ID, Item } from "../model/types";

export interface TrimMarksOptions {
  /** Length of each mark in user units. Default 18 (≈ 0.25in @ 72dpi). */
  length?: number;
  /** Gap between the trim edge and the start of each mark. Default 3. */
  offset?: number;
}

/** Eight [x1,y1,x2,y2] marks (2 per corner) for a trim box. */
const markSegments = (b: Rect, length: number, offset: number): [number, number, number, number][] => {
  const L = b.x;
  const T = b.y;
  const R = b.x + b.width;
  const B = b.y + b.height;
  const o = offset;
  const n = length;
  return [
    [L - o - n, T, L - o, T], // top-left — horizontal (extends left)
    [L, T - o - n, L, T - o], // top-left — vertical (extends up)
    [R + o, T, R + o + n, T], // top-right — horizontal (extends right)
    [R, T - o - n, R, T - o], // top-right — vertical (extends up)
    [L - o - n, B, L - o, B], // bottom-left — horizontal (extends left)
    [L, B + o, L, B + o + n], // bottom-left — vertical (extends down)
    [R + o, B, R + o + n, B], // bottom-right — horizontal (extends right)
    [R, B + o, R, B + o + n], // bottom-right — vertical (extends down)
  ];
};

/**
 * Object ▸ Create Trim Marks — add a "Trim Marks" group around the selection's
 * bounding box (artwork is kept). Returns the new group's id, or null when
 * nothing with bounds is selected.
 */
export const trimMarks = (doc: Document, ids: ID[], opts: TrimMarksOptions = {}): ID | null => {
  const length = opts.length ?? 18;
  const offset = opts.offset ?? 3;
  const b = selectionBounds(doc, ids);
  if (!b) return null;

  const stroke = { ...defaultStroke(solid(BLACK)), width: 0.5 };
  const lines: Item[] = markSegments(b, length, offset).map(([x1, y1, x2, y2]) =>
    makeLine(x1, y1, x2, y2, { stroke, fill: noPaint(), name: "Trim Mark" }),
  );
  const group = makeGroup(lines, { name: "Trim Marks" });

  // Place the marks on the layer holding the (first) selected artwork, on top.
  const loc = findItem(doc, ids[0]);
  const layer = loc ? loc.layer : doc.layers[doc.layers.length - 1];
  layer.items.push(group);
  return group.id;
};
