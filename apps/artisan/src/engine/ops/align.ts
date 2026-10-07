// ─────────────────────────────────────────────────────────────
// ops/align — align + distribute selected items to a reference rect
// ─────────────────────────────────────────────────────────────

import { type Rect } from "../geometry/bbox";
import { worldBounds } from "../model/query";
import { translateItems } from "./transform";
import type { Document, ID } from "../model/types";

export type AlignAction =
  | "left" | "center-h" | "right"
  | "top" | "middle-v" | "bottom"
  | "dist-h" | "dist-v"
  | "dist-center-h" | "dist-center-v"
  | "dist-left" | "dist-right" | "dist-top" | "dist-bottom";

export const align = (doc: Document, ids: ID[], action: AlignAction, ref: Rect): void => {
  if (ids.length === 0) return;

  const boundsOf = (id: ID) => worldBounds(doc, id);

  if (action === "dist-h" || action === "dist-v") {
    distribute(doc, ids, action, ref);
    return;
  }
  const distRef = DISTRIBUTE_REF[action];
  if (distRef) {
    distributeReference(doc, ids, distRef[0], distRef[1]);
    return;
  }

  for (const id of ids) {
    const b = boundsOf(id);
    if (!b) continue;
    let dx = 0;
    let dy = 0;
    switch (action) {
      case "left": dx = ref.x - b.x; break;
      case "center-h": dx = ref.x + ref.width / 2 - (b.x + b.width / 2); break;
      case "right": dx = ref.x + ref.width - (b.x + b.width); break;
      case "top": dy = ref.y - b.y; break;
      case "middle-v": dy = ref.y + ref.height / 2 - (b.y + b.height / 2); break;
      case "bottom": dy = ref.y + ref.height - (b.y + b.height); break;
    }
    if (dx || dy) translateItems(doc, [id], dx, dy);
  }
};

// Distribute-spacing: lay the selected items out with EQUAL gaps across the
// reference rect. In "Align to Selection" mode `ref` is the selection bounds,
// which spans exactly the items' own extent — so this is the usual "even the
// gaps within the selection". In "Align to Artboard" mode `ref` is the artboard,
// so the items spread across the whole artboard (Illustrator parity).
const distribute = (doc: Document, ids: ID[], action: "dist-h" | "dist-v", ref: Rect): void => {
  const horizontal = action === "dist-h";
  const entries = ids
    .map((id) => ({ id, b: worldBounds(doc, id) }))
    .filter((e): e is { id: ID; b: Rect } => !!e.b);
  if (entries.length < 3) return; // distribute is meaningful for 3+ objects

  entries.sort((a, b) => (horizontal ? a.b.x - b.b.x : a.b.y - b.b.y));
  const start = horizontal ? ref.x : ref.y;
  const extent = horizontal ? ref.width : ref.height;
  const sumSizes = entries.reduce((s, e) => s + (horizontal ? e.b.width : e.b.height), 0);
  const gap = (extent - sumSizes) / (entries.length - 1);

  let cursor = start;
  for (const e of entries) {
    if (horizontal) {
      const dx = cursor - e.b.x;
      if (dx) translateItems(doc, [e.id], dx, 0);
      cursor += e.b.width + gap;
    } else {
      const dy = cursor - e.b.y;
      if (dy) translateItems(doc, [e.id], 0, dy);
      cursor += e.b.height + gap;
    }
  }
};

/**
 * Distribute the selected items with a FIXED gap between adjacent objects along
 * the axis (Illustrator's "Distribute Spacing" with a value). Items are ordered
 * by position; the first (lowest) stays anchored and each subsequent object is
 * placed so the gap (previous trailing edge → next leading edge) equals `gap`.
 * Differs from `distribute`, which evens gaps to fill a reference rect. ≥2 items.
 */
export const distributeSpacing = (doc: Document, ids: ID[], axis: "h" | "v", gap: number): void => {
  const horizontal = axis === "h";
  const entries = ids
    .map((id) => ({ id, b: worldBounds(doc, id) }))
    .filter((e): e is { id: ID; b: Rect } => !!e.b);
  if (entries.length < 2) return;

  // Stable sort: items sharing a coordinate keep their input order.
  entries.sort((a, b) => (horizontal ? a.b.x - b.b.x : a.b.y - b.b.y));
  // Anchor the first item; advance the cursor to its trailing edge.
  let cursor = horizontal ? entries[0].b.x + entries[0].b.width : entries[0].b.y + entries[0].b.height;
  for (let i = 1; i < entries.length; i++) {
    const e = entries[i];
    const lead = cursor + gap; // where this item's leading edge should land
    if (horizontal) {
      const dx = lead - e.b.x;
      if (dx) translateItems(doc, [e.id], dx, 0);
      cursor = lead + e.b.width;
    } else {
      const dy = lead - e.b.y;
      if (dy) translateItems(doc, [e.id], 0, dy);
      cursor = lead + e.b.height;
    }
  }
};

// Distribute-by-reference (Illustrator's "Distribute Objects" row): space a chosen
// reference point of each object — its left/centre/right edge (horizontal) or its
// top/centre/bottom edge (vertical) — at EQUAL intervals between the two extreme
// objects. The extremes stay put; the rest slide. Unlike distribute-spacing (which
// evens the GAPS), this evens the reference point, so the results differ whenever
// the objects are different sizes.
type Axis = "h" | "v";
type RefPoint = "min" | "center" | "max";

const DISTRIBUTE_REF: Partial<Record<AlignAction, [Axis, RefPoint]>> = {
  "dist-center-h": ["h", "center"],
  "dist-center-v": ["v", "center"],
  "dist-left": ["h", "min"],
  "dist-right": ["h", "max"],
  "dist-top": ["v", "min"],
  "dist-bottom": ["v", "max"],
};

const refCoord = (b: Rect, axis: Axis, ref: RefPoint): number => {
  const start = axis === "h" ? b.x : b.y;
  const size = axis === "h" ? b.width : b.height;
  return ref === "min" ? start : ref === "max" ? start + size : start + size / 2;
};

const distributeReference = (doc: Document, ids: ID[], axis: Axis, ref: RefPoint): void => {
  const horizontal = axis === "h";
  const entries = ids
    .map((id) => ({ id, b: worldBounds(doc, id) }))
    .filter((e): e is { id: ID; b: Rect } => !!e.b)
    .map((e) => ({ id: e.id, c: refCoord(e.b, axis, ref) }));
  if (entries.length < 3) return; // distribute is meaningful for 3+ objects

  entries.sort((a, b) => a.c - b.c);
  const first = entries[0].c;
  const step = (entries[entries.length - 1].c - first) / (entries.length - 1);
  entries.forEach((e, i) => {
    const delta = first + i * step - e.c;
    if (delta) translateItems(doc, [e.id], horizontal ? delta : 0, horizontal ? 0 : delta);
  });
};
