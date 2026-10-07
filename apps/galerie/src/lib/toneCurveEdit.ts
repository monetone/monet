// toneCurveEdit — pure editing math for the Develop Tone Curve point editor.
// Points are normalized (x=input, y=output, both 0..1); the compiled LUT is a
// derived cache (monet-photo buildLut). Kept DOM-free so the curve logic is
// unit-tested independently of the SVG view (ToneCurvePanel.tsx maps pixels ↔
// this normalized space). Endpoints (first/last) slide only vertically; interior
// points stay strictly between their neighbours so the curve remains a function.

import type { CurvePoint } from "@monet-ui/monet-photo";

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
/** Minimum x-gap kept between adjacent points so the curve stays single-valued. */
export const MIN_GAP = 1e-3;

/** Index of the point nearest (x,y) within `tol` (Euclidean), or -1 if none. */
export function nearestPoint(points: readonly CurvePoint[], x: number, y: number, tol = 0.05): number {
  let best = -1;
  let bestD = tol * tol;
  for (let i = 0; i < points.length; i++) {
    const dx = points[i].x - x;
    const dy = points[i].y - y;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Insert a new point at (x,y) (clamped to the unit square) and return the new
 *  sorted array plus the inserted point's index. */
export function insertPoint(
  points: readonly CurvePoint[],
  x: number,
  y: number,
): { points: CurvePoint[]; index: number } {
  const np: CurvePoint = { x: clamp01(x), y: clamp01(y) };
  const arr = points.map((p) => ({ ...p }));
  arr.push(np);
  arr.sort((a, b) => a.x - b.x);
  return { points: arr, index: arr.indexOf(np) };
}

/** Move the point at `index` to (x,y). Endpoints keep their x (only y moves);
 *  interior points are constrained strictly between their neighbours. */
export function movePoint(points: readonly CurvePoint[], index: number, x: number, y: number): CurvePoint[] {
  const out = points.map((p) => ({ ...p }));
  if (index < 0 || index >= out.length) return out;
  const ny = clamp01(y);
  if (index === 0 || index === out.length - 1) {
    out[index].y = ny; // endpoint: x fixed, slides vertically
  } else {
    const lo = out[index - 1].x + MIN_GAP;
    const hi = out[index + 1].x - MIN_GAP;
    out[index].x = Math.max(lo, Math.min(hi, clamp01(x)));
    out[index].y = ny;
  }
  return out;
}

/** Remove an interior point; endpoints are never removed. */
export function removePoint(points: readonly CurvePoint[], index: number): CurvePoint[] {
  if (index <= 0 || index >= points.length - 1) return points.map((p) => ({ ...p }));
  return points.slice(0, index).concat(points.slice(index + 1)).map((p) => ({ ...p }));
}
