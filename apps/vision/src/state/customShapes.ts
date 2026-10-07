// ─────────────────────────────────────────────────────────────
// Custom shapes — pure geometry for Edit ▸ Define Custom Shape. Engine-free so it
// unit-tests in node; the Store and the Shape-tool commit delegate to it.
//
// Photoshop's Define Custom Shape captures the current work path as a reusable
// vector preset; the Shape tool then scales it into the drag rectangle. Vision
// captures the Pen tool's path (a flat [x0,y0,x1,y1,…] polyline), stores it
// normalized to its bounding box (0..1), and on draw maps it back into the drag
// rect — then fills the polygon exactly like the Pen tool's close-path fill.
// ─────────────────────────────────────────────────────────────

/** A path needs at least a triangle to enclose an area. */
export const MIN_SHAPE_POINTS = 3;

/** A defined custom shape: a name + a flat path normalized to its bounding box. */
export interface CustomShape {
  name: string;
  path: number[];
}

/** The next "Custom Shape N" auto-name, one past the highest existing "Custom
 *  Shape <int>" (max-based, so it stays unique after a delete). */
export function defaultCustomShapeName(names: string[]): string {
  let max = 0;
  for (const n of names) {
    const m = /^Custom Shape (\d+)$/.exec(n);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `Custom Shape ${max + 1}`;
}

/** Remove the shape at index `i`; out-of-range is a same-ref no-op. */
export function removeCustomShapeAt(list: CustomShape[], i: number): CustomShape[] {
  if (i < 0 || i >= list.length) return list;
  return list.filter((_, j) => j !== i);
}

/** Parse a persisted custom-shape library (localStorage JSON) → the list, or null
 *  when the payload is missing/empty/malformed. Validates each entry's name +
 *  path (a real enclosable polyline) so a corrupt store can't break boot. */
export function parseCustomShapes(json: string | null): CustomShape[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v) || v.length === 0) return null;
    if (!v.every((s) =>
      s && typeof s.name === "string" &&
      Array.isArray(s.path) && s.path.every((n: unknown) => typeof n === "number") && isValidPath(s.path))) return null;
    return v as CustomShape[];
  } catch { return null; }
}

/** Normalize a flat [x,y,…] path to its bounding box, returning 0..1 coords in
 *  the same order. A zero-width/height axis collapses to 0 (guarded divide). */
export function normalizePath(points: number[]): number[] {
  const n = Math.floor(points.length / 2);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = points[i * 2], y = points[i * 2 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const out = new Array<number>(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = (points[i * 2] - minX) / w;
    out[i * 2 + 1] = (points[i * 2 + 1] - minY) / h;
  }
  return out;
}

/** Map a normalized (0..1) path into the rect (x0,y0,w,h), returning parallel
 *  xs/ys arrays ready for the engine's select_polygon. */
export function denormalizePath(
  norm: number[],
  x0: number,
  y0: number,
  w: number,
  h: number,
): { xs: Float32Array; ys: Float32Array } {
  const n = Math.floor(norm.length / 2);
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = x0 + norm[i * 2] * w;
    ys[i] = y0 + norm[i * 2 + 1] * h;
  }
  return { xs, ys };
}

/** True when a flat path has enough points to enclose an area. */
export function isValidPath(points: number[]): boolean {
  return Math.floor(points.length / 2) >= MIN_SHAPE_POINTS;
}

// ── The built-in library ──────────────────────────────────────────────────────
// Photoshop's Custom Shape picker is stocked on a fresh install (arrows, banners,
// ornaments), so a new user can draw a decorated shape without authoring one.
// These are written in whatever coordinates read best and pushed through
// normalizePath, so a built-in is byte-for-byte the shape defineCustomShape would
// have captured from a Pen path — the Shape tool needs no second code path.
// ponytail: polylines, like every custom shape here; the curved ones are sampled
// densely enough to read clean at picker and canvas size. Bezier control points
// would be the upgrade, and would need the draw path (denormalizePath →
// select_polygon) to learn curves first.

/** Author a built-in: normalized to the unit box, rounded so the persisted
 *  library stays small (0 and 1 survive rounding, so the box stays exact). */
const builtin = (name: string, points: number[]): CustomShape => ({
  name,
  path: normalizePath(points).map((v) => Math.round(v * 1000) / 1000),
});

/** A closed polygon sampled from a polar radius r(i, angle). Angle 0 points up,
 *  so stars and bursts sit on a point rather than a valley. */
function polar(n: number, r: (i: number, a: number) => number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(Math.sin(a) * r(i, a), -Math.cos(a) * r(i, a));
  }
  return pts;
}

/** A parametric curve sampled into a polygon; `at` gets 0..1 along the curve. */
function sampled(n: number, at: (u: number) => [number, number]): number[] {
  const pts: number[] = [];
  for (let i = 0; i < n; i++) pts.push(...at(i / n));
  return pts;
}

export const BUILTIN_CUSTOM_SHAPES: readonly CustomShape[] = [
  builtin("Arrow", [0, 32, 60, 32, 60, 8, 100, 50, 60, 92, 60, 68, 0, 68]),
  builtin("Double Arrow", [0, 50, 30, 10, 30, 32, 70, 32, 70, 10, 100, 50, 70, 90, 70, 68, 30, 68, 30, 90]),
  // Ribbon banner: a bar with a deep swallowtail notched into each end — the
  // notch has to be a good third of the width to still read once the shape is
  // stretched into the drag rectangle.
  builtin("Banner", [0, 0, 100, 0, 68, 50, 100, 100, 0, 100, 32, 50]),
  // Talk bubble: an ellipse body left open at the bottom for the tail.
  builtin("Talk Bubble", [
    ...sampled(30, (u) => {
      const a = Math.PI * (0.75 + u * 1.86); // sweeps to ~2.55π, leaving the gap the tail closes
      return [50 + 50 * Math.cos(a), 45 + 45 * Math.sin(a)];
    }),
    24, 100, // tail tip
  ]),
  builtin("Star", polar(10, (i) => (i % 2 ? 0.382 : 1))),
  builtin("Burst", polar(24, (i) => (i % 2 ? 0.76 : 1))),
  // Rosette ornament: a six-lobed polar flower.
  builtin("Ornament", polar(72, (_i, a) => 0.68 + 0.32 * Math.cos(6 * a))),
  // The textbook heart curve, flipped because canvas y grows downward.
  builtin("Heart", sampled(48, (u) => {
    const t = u * Math.PI * 2;
    return [16 * Math.sin(t) ** 3,
      -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))];
  })),
  builtin("Check Mark", [0, 55, 14, 41, 36, 63, 86, 5, 100, 19, 36, 92]),
  builtin("Lightning", [55, 0, 15, 58, 42, 58, 28, 100, 85, 38, 55, 38, 75, 0]),
];

/** Append the built-ins the library is missing, matched by name — Preset Manager
 *  ▸ Restore Defaults, after a user deleted one. Same ref when nothing is
 *  missing, so a redundant restore neither renames nor re-persists anything. */
export function withBuiltinCustomShapes(list: CustomShape[]): CustomShape[] {
  const missing = BUILTIN_CUSTOM_SHAPES.filter((b) => !list.some((s) => s.name === b.name));
  return missing.length ? [...list, ...missing] : list;
}
