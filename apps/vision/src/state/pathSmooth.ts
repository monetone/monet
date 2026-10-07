/** Catmull-Rom → cubic bezier: smooth anchors (relative in/out handles, see
 *  paths.ts AnchorPath) through every input point — the exact same curve as
 *  `catmullRomResample`, but kept as true curves instead of a dense polyline.
 *  The standard equivalence: for the P1→P2 segment, c1 = P1 + (P2−P0)/6 and
 *  c2 = P2 − (P3−P1)/6. `closed` wraps the neighbour lookup so the loop is
 *  smooth through the join (Curvature Pen); open paths clamp at the ends
 *  (Freeform Pen mid-draw). */
export function catmullRomAnchors(pts: number[], closed = false): number[] {
  const n = Math.floor(pts.length / 2);
  const P = (i: number): [number, number] => {
    const j = closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
    return [pts[j * 2], pts[j * 2 + 1]];
  };
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const [px, py] = P(i - 1);
    const [x, y] = P(i);
    const [nx, ny] = P(i + 1);
    // Tangent (P_{i+1} − P_{i−1}); handles are ±tangent/6, relative to the anchor.
    const tx = (nx - px) / 6, ty = (ny - py) / 6;
    out.push(x, y, -tx, -ty, tx, ty);
  }
  return out;
}

// Catmull-Rom resampling for the Freeform Pen: turn a sparse freehand point list
// (flat [x0,y0,x1,y1,…] doc-space) into a denser, smooth polyline that passes
// through every original point. The Freeform Pen feeds the result to the pen's
// polygon fill so the drawn shape has soft, rounded edges rather than jagged ones.
export function catmullRomResample(pts: number[], perSeg = 6): number[] {
  const n = Math.floor(pts.length / 2);
  if (n < 3 || perSeg < 1) return pts.slice();
  const P = (i: number): [number, number] => {
    const j = Math.max(0, Math.min(n - 1, i));
    return [pts[j * 2], pts[j * 2 + 1]];
  };
  const out: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = P(i - 1);
    const [x1, y1] = P(i);
    const [x2, y2] = P(i + 1);
    const [x3, y3] = P(i + 2);
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      // Standard centripetal-ish Catmull-Rom (uniform), 0.5 tension.
      const x = 0.5 * (2 * x1 + (-x0 + x2) * t + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (-x0 + 3 * x1 - 3 * x2 + x3) * t3);
      const y = 0.5 * (2 * y1 + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3);
      out.push(x, y);
    }
  }
  const [lx, ly] = P(n - 1);
  out.push(lx, ly); // always include the final anchor
  return out;
}
