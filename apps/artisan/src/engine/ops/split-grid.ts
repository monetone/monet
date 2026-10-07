// ─────────────────────────────────────────────────────────────
// ops/split-grid — Object ▸ Path ▸ Split Into Grid (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Adobe Illustrator's Split Into Grid divides each selected object into a grid of
// `rows` × `columns` rectangular cells that tile the object's bounding box, with
// optional row/column gutters between cells. The cells inherit the object's
// fill/stroke and replace it as a single group (matching Illustrator, which
// swaps the object for the grid of rectangles).

import type { Rect } from "../geometry/bbox";
import { cloneDeep } from "../clone";
import { localBounds } from "../model/shapes";
import { findItem } from "../model/query";
import { carryItemState, makeGroup, makeRect } from "../model/factory";
import type { Document, ID } from "../model/types";

export interface SplitGridOptions {
  rows: number;
  columns: number;
  /** Gap between rows (user units). Default 0. */
  rowGutter?: number;
  /** Gap between columns (user units). Default 0. */
  columnGutter?: number;
}

/** Cell rectangles (row-major) tiling `b` with the given gutters, or [] if a
 *  cell would be non-positive (gutters too large for the box). */
const cellRects = (b: Rect, rows: number, cols: number, gr: number, gc: number): Rect[] => {
  const cellW = (b.width - (cols - 1) * gc) / cols;
  const cellH = (b.height - (rows - 1) * gr) / rows;
  if (cellW <= 0 || cellH <= 0) return [];
  const out: Rect[] = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      out.push({ x: b.x + j * (cellW + gc), y: b.y + i * (cellH + gr), width: cellW, height: cellH });
    }
  }
  return out;
};

export const splitIntoGrid = (doc: Document, ids: ID[], opts: SplitGridOptions): ID[] => {
  const rows = Math.max(1, Math.floor(opts.rows));
  const cols = Math.max(1, Math.floor(opts.columns));
  const gr = Math.max(0, opts.rowGutter ?? 0);
  const gc = Math.max(0, opts.columnGutter ?? 0);

  const newIds: ID[] = [];
  for (const id of ids) {
    const loc = findItem(doc, id);
    if (!loc) continue;
    const item = loc.item;
    const b = localBounds(item);
    if (b.width <= 0 || b.height <= 0) continue;
    const cells = cellRects(b, rows, cols, gr, gc);
    if (cells.length === 0) continue;

    const rects = cells.map((c) => {
      const rect = makeRect(c.x, c.y, c.width, c.height, 0, 0, {
        fill: cloneDeep(item.fill),
        stroke: cloneDeep(item.stroke),
        appearance: item.appearance,
      });
      if (item.brush) rect.brush = cloneDeep(item.brush);
      if (item.evenOdd !== undefined) rect.evenOdd = item.evenOdd;
      if (item.overprintFill !== undefined) rect.overprintFill = item.overprintFill;
      if (item.overprintStroke !== undefined) rect.overprintStroke = item.overprintStroke;
      return rect;
    });
    const group = carryItemState(makeGroup(rects), item);
    group.transform = { ...item.transform };
    // Replace the object in place with its grid (Illustrator swaps the original).
    loc.container.splice(loc.index, 1, group);
    newIds.push(group.id);
  }
  return newIds;
};
