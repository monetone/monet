// Trace a selection mask into a polygon path — pure & node-safe (no engine/DOM).
//
// Photoshop's Paths panel "Make work path from selection" converts the selection
// border into an editable Work Path, with a Tolerance (px) that loosens it (fewer
// anchor points). Vision's engine exposes the selection mask (coverage bytes); this
// module turns it into the Pen work path (a flat polygon [x0,y0,x1,y1,…]).
//
//   https://helpx.adobe.com/photoshop/using/converting-paths-selection-borders.html

interface Pt {
  x: number;
  y: number;
}

/** Perpendicular distance from p to the infinite line through a→b (the classic
 *  Douglas–Peucker metric); falls back to point distance for a degenerate a==b. */
function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Douglas–Peucker on an OPEN polyline; always keeps the two endpoints. */
function simplifyOpen(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const a = pts[0];
  const b = pts[pts.length - 1];
  let idx = -1;
  let max = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], a, b);
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max > tol) {
    const left = simplifyOpen(pts.slice(0, idx + 1), tol);
    const right = simplifyOpen(pts.slice(idx), tol);
    return left.slice(0, -1).concat(right); // drop the shared split point
  }
  return [a, b];
}

/** Douglas–Peucker on a CLOSED polygon (corners, first not repeated at the end).
 *  Splits the loop at pts[0] and its farthest vertex, simplifies each half. */
function simplifyClosed(pts: Pt[], tol: number): Pt[] {
  const n = pts.length;
  if (n <= 3) return pts.slice();
  let far = 0;
  let fd = -1;
  for (let i = 1; i < n; i++) {
    const d = (pts[i].x - pts[0].x) ** 2 + (pts[i].y - pts[0].y) ** 2;
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  const a = simplifyOpen(pts.slice(0, far + 1), tol); // pts[0]..pts[far]
  const b = simplifyOpen(pts.slice(far).concat([pts[0]]), tol); // pts[far]..pts[0]
  return a.concat(b.slice(1, b.length - 1)); // drop the shared far + start endpoints
}

/** Douglas–Peucker simplify of a closed polygon given as a flat [x0,y0,x1,y1,…]
 *  array (the first vertex is NOT repeated at the end). Returns a flat array. */
export function simplifyPath(points: number[], tolerance: number): number[] {
  if (points.length < 6) return points.slice(); // <3 vertices: nothing to simplify
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) pts.push({ x: points[i], y: points[i + 1] });
  const out: number[] = [];
  for (const p of simplifyClosed(pts, Math.max(0, tolerance))) out.push(p.x, p.y);
  return out;
}

/** Trace the outer boundary of the FIRST inside region (scan order) by
 *  crack-following the inside/outside grid edges. Returns the closed loop of
 *  pixel-edge corners (inside on the right; first corner not repeated). */
function traceContour(inside: (x: number, y: number) => boolean, w: number, h: number): Pt[] {
  // (#158) Walk the cracks straight off `inside` instead of pre-building a
  // corner→segment Map. Where two regions touch only DIAGONALLY, a corner starts
  // TWO segments and the Map kept whichever was written last, so the chain hopped
  // into the other region and never reached the start corner — every anti-aliased
  // lasso/magic-wand selection has such saddles, and they produced a
  // self-overlapping or empty work path. Resolving each saddle by turning RIGHT
  // keeps the walk inside the region it started in (4-connected regions), so the
  // loop always closes.
  let start: Pt | null = null;
  for (let y = 0; y < h && start === null; y++) {
    for (let x = 0; x < w; x++) {
      if (inside(x, y)) {
        start = { x, y }; // top-left inside cell → its top-left corner
        break;
      }
    }
  }
  if (start === null) return [];
  // Directions in right-turn order: 0 right, 1 down, 2 left, 3 up. A crack leaves
  // corner (x,y) in direction d when the cell on its right is inside and the one
  // on its left is outside — that orientation keeps the region on the right.
  const canGo = (x: number, y: number, d: number): boolean => {
    if (d === 0) return inside(x, y) && !inside(x, y - 1);
    if (d === 1) return inside(x - 1, y) && !inside(x, y);
    if (d === 2) return inside(x - 1, y - 1) && !inside(x - 1, y);
    return inside(x, y - 1) && !inside(x - 1, y - 1);
  };
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  const out: Pt[] = [];
  let cur = start;
  let dir = 0; // the first inside cell in scan order always starts a rightward top crack
  const maxSteps = (w + 1) * (h + 1) * 4 + 8; // guard against a malformed (open) chain
  for (let i = 0; i < maxSteps; i++) {
    out.push(cur);
    let next = -1;
    for (const turn of [1, 0, 3, 2]) { // right, straight, left, back
      const d = (dir + turn) % 4;
      if (canGo(cur.x, cur.y, d)) {
        next = d;
        break;
      }
    }
    if (next < 0) return []; // open chain — never surface a partial path
    cur = { x: cur.x + DX[next], y: cur.y + DY[next] };
    dir = next;
    if (cur.x === start.x && cur.y === start.y) return out; // closed the loop
  }
  return []; // budget exhausted: not a closed loop
}

/** Trace a selection mask (w*h coverage bytes, ≥128 = inside) into a polygon path
 *  and Douglas–Peucker-simplify it by `tolerance` (px). Returns a flat
 *  [x0,y0,x1,y1,…] of the first region's outer boundary, or [] when there is no
 *  inside region (or the simplified loop has fewer than 3 corners). */
export function selectionToPath(mask: Uint8Array, w: number, h: number, tolerance: number): number[] {
  if (w <= 0 || h <= 0 || mask.length < w * h) return [];
  const inside = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] >= 128;
  const corners = traceContour(inside, w, h);
  if (corners.length < 3) return [];
  const flat: number[] = [];
  for (const c of corners) flat.push(c.x, c.y);
  const simplified = simplifyPath(flat, tolerance);
  return simplified.length >= 6 ? simplified : [];
}
