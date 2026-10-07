// ─────────────────────────────────────────────────────────────
// Line shape — pure geometry for the Shape tool's "line" kind (Photoshop's Line
// tool). Engine-free so it unit-tests in node; CanvasView fills the returned quad
// via select_polygon + fill_selection.
//
// A line of thickness `weight` is the rectangle swept along the segment p0→p1:
// offset each endpoint by weight/2 along the segment normal to get four corners.
// ─────────────────────────────────────────────────────────────

/** Four corners (flat [x,y × 4], in order) of a `weight`-thick line from
 *  (x0,y0) to (x1,y1), centred on the segment. Weight is clamped to >= 1; a
 *  zero-length segment returns [] (nothing to fill). */
export function lineQuad(x0: number, y0: number, x1: number, y1: number, weight: number): number[] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len === 0) return [];
  const hw = Math.max(1, weight) / 2; // half-width; minimum 1px line
  const nx = (-dy / len) * hw; // unit normal × half-width
  const ny = (dx / len) * hw;
  return [x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny];
}
