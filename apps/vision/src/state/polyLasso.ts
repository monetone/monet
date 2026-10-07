// ─────────────────────────────────────────────────────────────
// Polygonal Lasso — pure helpers for the click-to-build straight-edge selection.
// Engine-free so they unit-test in node; CanvasView accumulates the clicked
// vertices and, on close, hands the polygon to engine.select_polygon.
//
// Photoshop: click to add vertices, double-click or click the start point to
// close into a selection (needs at least a triangle).
// ─────────────────────────────────────────────────────────────

/** A polygon needs at least a triangle to enclose an area. */
export const MIN_LASSO_POINTS = 3;

/** True when (px,py) is within `tol` of (x,y) (used to detect a start-point click). */
export function nearPoint(px: number, py: number, x: number, y: number, tol: number): boolean {
  return Math.hypot(px - x, py - y) <= tol;
}

/** True once the accumulated flat [x,y,…] list has enough vertices to close. */
export function canClose(pts: number[]): boolean {
  return Math.floor(pts.length / 2) >= MIN_LASSO_POINTS;
}

/** De-interleave a flat [x,y,…] list into parallel xs/ys arrays for select_polygon. */
export function polygonArrays(pts: number[]): { xs: Float32Array; ys: Float32Array } {
  const n = Math.floor(pts.length / 2);
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = pts[i * 2];
    ys[i] = pts[i * 2 + 1];
  }
  return { xs, ys };
}
