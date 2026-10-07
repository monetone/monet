// ─────────────────────────────────────────────────────────────
// Canvas Size geometry — pure helpers for the Canvas Size dialog's Anchor grid and
// Relative mode (Photoshop). resolveCanvasSize turns the dialog inputs into an
// absolute new size; anchorOffset turns the chosen 3×3 anchor cell into the (dx,dy)
// that the engine's resize_canvas needs (it remaps new (nx,ny) -> old (nx-dx,ny-dy),
// so dx,dy is where the old top-left lands in the new canvas). Engine-free for node.
// ─────────────────────────────────────────────────────────────

import { MAX_DOCUMENT_DIMENSION_PX, MAX_DOCUMENT_PIXELS } from "./docPresets";

/** Anchor column/row: 0 = content pinned to the min edge, 1 = centre, 2 = max edge. */
export type AnchorPos = 0 | 1 | 2;

export interface CanvasOffset {
  dx: number;
  dy: number;
}

export interface CanvasSizeResult {
  w: number;
  h: number;
}

/** Resolve the dialog's Width/Height inputs to an absolute new canvas size.
 *  Relative mode adds the inputs to the current size (negative = crop). Rounded,
 *  clamped to >= 1. */
export function resolveCanvasSize(
  curW: number, curH: number,
  inW: number, inH: number,
  relative: boolean,
): CanvasSizeResult {
  const w = relative ? curW + inW : inW;
  const h = relative ? curH + inH : inH;
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}

/** Whether the resolved canvas fits the engine's document allocation budget. */
export function canvasSizeFits(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height)
    && width >= 1 && height >= 1
    && width <= MAX_DOCUMENT_DIMENSION_PX
    && height <= MAX_DOCUMENT_DIMENSION_PX
    && width * height <= MAX_DOCUMENT_PIXELS;
}

/** Offset of the old content's top-left within the new canvas for an anchor cell.
 *  col/row 0 keeps content at the min edge (new space added after), 1 centres it,
 *  2 pins it to the max edge. Negative when shrinking (the canvas crops). */
export function anchorOffset(
  oldW: number, oldH: number,
  newW: number, newH: number,
  col: AnchorPos, row: AnchorPos,
): CanvasOffset {
  return {
    dx: Math.round((newW - oldW) * col / 2),
    dy: Math.round((newH - oldH) * row / 2),
  };
}
