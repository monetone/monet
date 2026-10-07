// ─────────────────────────────────────────────────────────────
// snap.ts — pure grid-snapping maths for "Snap to Grid".
//
// Unity's Grid and Snap window has a "Snap All Axes" action that pushes the
// selected objects onto the grid. Jouer already snaps a live drag to the grid;
// this is the one-shot version that aligns existing objects. The grid lines sit
// at integer multiples of the grid size from the origin, so snapping rounds to
// the nearest multiple.
//
// Nothing in this module imports React, Phaser, or the DOM.
// ─────────────────────────────────────────────────────────────

/** Round `value` to the nearest multiple of `step`. A non-positive step is
 *  treated as "off" and the value passes through unchanged. Unlike snapToGrid
 *  this allows fractional steps (e.g. a 0.25 scale increment). */
export function snapValue(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

/** Round `value` to the nearest multiple of `grid`. A grid smaller than 1 is
 *  treated as "off" (a sub-pixel grid is meaningless) and the value passes
 *  through unchanged. */
export function snapToGrid(value: number, grid: number): number {
  return grid < 1 ? value : snapValue(value, grid);
}

/** Snap a point to the grid on both axes. */
export function snapPointToGrid(p: { x: number; y: number }, grid: number): { x: number; y: number } {
  return { x: snapToGrid(p.x, grid), y: snapToGrid(p.y, grid) };
}
