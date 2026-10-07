// ─────────────────────────────────────────────────────────────
// Path Blur strokes — the user-drawn paths behind Blur Gallery ▸ Path Blur.
// Adobe draws one or more Bezier paths over the image, each with a draggable
// End Point Speed handle at either end, and varies the blur direction per
// region along them. The engine only ever sees a flattened polyline, so all the
// curve maths lives here (and stays testable); filters.rs `path_blur_paths`
// owns the per-pixel direction field. Coordinates are document pixels.
// ─────────────────────────────────────────────────────────────

export interface BlurPathStroke {
  /** Anchors the user placed, in document px. Two anchors = a straight path. */
  points: { x: number; y: number }[];
  /** Adobe's End Point Speed handles: a multiplier on the workspace Speed at
   *  each end, lerped along the path by arc length. 1 = the full Speed. */
  speedStart: number;
  speedEnd: number;
}

/** A fresh horizontal path across the middle of the document. */
export const defaultBlurPath = (w: number, h: number): BlurPathStroke => ({
  points: [{ x: w * 0.25, y: h / 2 }, { x: w * 0.75, y: h / 2 }],
  speedStart: 1,
  speedEnd: 1,
});

/** Flattening resolution: samples per anchor span. */
const CURVE_STEPS = 12;

/** The drawn curve as a polyline. Three or more anchors bend into a smooth
 *  Catmull-Rom curve (the endpoints are duplicated so the curve reaches them);
 *  two anchors stay the straight segment they already are. */
export function samplePath(p: BlurPathStroke): { x: number; y: number }[] {
  const a = p.points;
  if (a.length <= 2) return a.slice();
  const at = (i: number) => a[Math.min(a.length - 1, Math.max(0, i))];
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < a.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let s = 0; s < CURVE_STEPS; s++) {
      const t = s / CURVE_STEPS;
      const t2 = t * t;
      const t3 = t2 * t;
      const axis = (v0: number, v1: number, v2: number, v3: number) =>
        0.5 * (2 * v1 + (v2 - v0) * t + (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 + (3 * v1 - v0 - 3 * v2 + v3) * t3);
      out.push({ x: axis(p0.x, p1.x, p2.x, p3.x), y: axis(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push(a[a.length - 1]);
  return out;
}

/** Flat engine records for `filter_path_blur_paths` — per stroke
 *  `[pointCount, speedStart, speedEnd, x0, y0, x1, y1, …]`. Strokes with fewer
 *  than two anchors are dropped: they carry no direction. */
export function flattenBlurPaths(paths: BlurPathStroke[]): Float32Array {
  const out: number[] = [];
  for (const p of paths) {
    const pts = samplePath(p);
    if (pts.length < 2) continue;
    out.push(pts.length, Math.max(0, p.speedStart), Math.max(0, p.speedEnd));
    for (const q of pts) out.push(q.x, q.y);
  }
  return new Float32Array(out);
}

/** Anchor under (x, y) within `tol` doc px — topmost stroke first, so the most
 *  recently drawn path wins where two overlap. */
export function hitTestBlurPaths(
  paths: BlurPathStroke[], x: number, y: number, tol: number,
): { path: number; point: number } | null {
  for (let i = paths.length - 1; i >= 0; i--) {
    const pts = paths[i].points;
    for (let k = pts.length - 1; k >= 0; k--) {
      if (Math.hypot(x - pts[k].x, y - pts[k].y) <= tol) return { path: i, point: k };
    }
  }
  return null;
}
