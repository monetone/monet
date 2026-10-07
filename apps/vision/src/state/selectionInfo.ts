// Photoshop's Info-panel selection readout: the active marquee's geometry. The
// engine reports selection_bounds() as [x, y, w, h]; an empty/inactive selection
// has a non-positive width or height (cf. store.guidesFromShape's guard). Pure /
// engine-free so it can be unit-tested in node.

export interface SelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Convert an engine [x, y, w, h] tuple to a rect, or null when there is no real
// selection (width or height not > 0 — also rejects NaN/undefined).
export function selectionRect(bounds: ArrayLike<number>): SelRect | null {
  const x = bounds[0], y = bounds[1], w = bounds[2], h = bounds[3];
  if (!(w > 0) || !(h > 0)) return null;
  return { x, y, w, h };
}
