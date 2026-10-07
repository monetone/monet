// ─────────────────────────────────────────────────────────────
// Matte → outline — turns a segmentation alpha matte (e.g. U2-Net's subject
// mask) into a closed polygon outline for the Camera Raw develop recipe
// (mask kind 7). The recipe is the deterministic replay contract: the model
// runs ONCE at mask creation, the polygon is what persists. Engine-free.
//
// Pipeline: threshold → largest 4-connected component (BFS) → Moore-neighbor
// boundary trace → Douglas-Peucker simplification to a point budget.
// ─────────────────────────────────────────────────────────────

export interface OutlinePoint { x: number; y: number }

/** The develop recipe's mask-point budget (mirrors DEV_MAX_MASK_POINTS). */
export const MAX_OUTLINE_POINTS = 4096;

const THRESHOLD = 127;

/** Extract the outline of the matte's largest blob as normalized [0..1]
 *  points (closed polygon, first ≠ last). Null when the matte is empty or
 *  degenerate (< 3 boundary points). */
export function matteToOutline(
  matte: Uint8Array,
  w: number,
  h: number,
  maxPoints = MAX_OUTLINE_POINTS,
  tolerancePx = 1.25,
): OutlinePoint[] | null {
  if (w < 2 || h < 2 || matte.length < w * h) return null;

  // Largest 4-connected component via BFS over a visited plane.
  const visited = new Uint8Array(w * h);
  let bestStart = -1;
  let bestSize = 0;
  const queue = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (visited[i] || matte[i] <= THRESHOLD) continue;
    let head = 0, tail = 0, size = 0;
    queue[tail++] = i;
    visited[i] = 1;
    while (head < tail) {
      const p = queue[head++];
      size++;
      const x = p % w, y = (p / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        const np = ny * w + nx;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && !visited[np] && matte[np] > THRESHOLD) {
          visited[np] = 1;
          queue[tail++] = np;
        }
      }
    }
    if (size > bestSize) { bestSize = size; bestStart = i; }
  }
  if (bestStart < 0) return null;

  // Re-flood the winning component so the tracer ignores other blobs.
  const blob = new Uint8Array(w * h);
  {
    let head = 0, tail = 0;
    queue[tail++] = bestStart;
    blob[bestStart] = 1;
    while (head < tail) {
      const p = queue[head++];
      const x = p % w, y = (p / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        const np = ny * w + nx;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && !blob[np] && matte[np] > THRESHOLD) {
          blob[np] = 1;
          queue[tail++] = np;
        }
      }
    }
  }
  const inBlob = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && blob[y * w + x] === 1;

  // Start pixel: topmost-leftmost of the blob (guaranteed on the boundary).
  let sx = -1, sy = -1;
  outer: for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (inBlob(x, y)) { sx = x; sy = y; break outer; }
    }
  }

  // Moore-neighbor boundary tracing (Jacob's stopping criterion light: stop
  // when back at the start heading the same way, or after a safety budget).
  const N8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
  const trace: OutlinePoint[] = [];
  let cx = sx, cy = sy;
  // Entered the topmost-leftmost seed heading east, i.e. backtracking to the
  // west neighbour (always outside the blob) — the first scan index is then
  // (0+5)%8 = NW. Seeding it as "came from above" made the first scan start at
  // SW, which is INSIDE any non-axis-aligned blob, so the trace stepped into
  // the interior and closed after 3 px (#157).
  let dir = 0;
  const budget = w * h * 4;
  for (let step = 0; step < budget; step++) {
    trace.push({ x: cx, y: cy });
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 5 + k) % 8; // backtrack-relative scan (Moore)
      const nx = cx + N8[d][0], ny = cy + N8[d][1];
      if (inBlob(nx, ny)) {
        cx = nx; cy = ny; dir = d;
        found = true;
        break;
      }
    }
    if (!found) break; // single-pixel blob
    if (cx === sx && cy === sy) break;
  }
  if (trace.length < 3) return null;

  // Douglas-Peucker simplification, then hard-cap by uniform decimation.
  let simplified = douglasPeucker(trace, tolerancePx);
  if (simplified.length > maxPoints) {
    const stride = simplified.length / maxPoints;
    simplified = Array.from({ length: maxPoints }, (_, i) => simplified[Math.floor(i * stride)]);
  }
  if (simplified.length < 3) return null;
  return simplified.map((p) => ({ x: (p.x + 0.5) / w, y: (p.y + 0.5) / h }));
}

/** Classic Douglas-Peucker on an open point chain (iterative stack form). */
export function douglasPeucker(points: OutlinePoint[], tolerance: number): OutlinePoint[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = points[a], pb = points[b];
    const dx = pb.x - pa.x, dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy) || 1;
    let worst = 0, at = -1;
    for (let i = a + 1; i < b; i++) {
      const p = points[i];
      const dist = Math.abs((p.x - pa.x) * dy - (p.y - pa.y) * dx) / len;
      if (dist > worst) { worst = dist; at = i; }
    }
    if (at >= 0 && worst > tolerance) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}
