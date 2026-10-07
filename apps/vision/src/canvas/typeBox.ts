// ─────────────────────────────────────────────────────────────
// Type tool area-type gesture — pure helpers for CanvasView.
// A Type-tool drag past a small slop creates a paragraph ("area type") box;
// the box resizes via the shared 8-handle rect math (state/slices) and shows
// Photoshop's ⊞ overset badge when a fixed height clips the text.
// ─────────────────────────────────────────────────────────────

import type { Slice } from "../state/slices";
import type { TextSpec } from "../text/spec";

/** Minimum drag extent (screen px) before a Type-tool drag becomes an
 *  area-type box instead of a point-text click. Screen px so zoom doesn't
 *  change the feel of the gesture. */
export const TYPE_DRAG_SLOP = 4;

/** Interpret a Type-tool drag from (x0,y0) to (x1,y1) in doc space.
 *  Returns null when the drag stayed within the slop (→ point text at the
 *  click), else the normalized integer paragraph box. */
export function typeBoxFromDrag(x0: number, y0: number, x1: number, y1: number, zoom: number): Slice | null {
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  if (w * zoom < TYPE_DRAG_SLOP && h * zoom < TYPE_DRAG_SLOP) return null;
  return {
    x: Math.round(Math.min(x0, x1)),
    y: Math.round(Math.min(y0, y1)),
    w: Math.max(1, Math.round(w)),
    h: Math.max(1, Math.round(h)),
  };
}

/** True when a fixed-height paragraph box clips its content (the overset ⊞).
 *  contentH = the natural (unclipped) block height in doc px; +1 tolerance
 *  absorbs sub-px measurement rounding. */
export function isOverset(kind: TextSpec["kind"], boxH: number, contentH: number): boolean {
  return kind === "paragraph" && boxH > 0 && contentH > boxH + 1;
}

/** Resize cursors per handle, ordered like sliceHandles:
 *  TL, T, TR, R, BR, B, BL, L. */
export const TYPE_BOX_CURSORS = [
  "nwse-resize", "ns-resize", "nesw-resize", "ew-resize",
  "nwse-resize", "ns-resize", "nesw-resize", "ew-resize",
] as const;
