// Paths-panel helpers (pure; engine-free, node-testable).
//
// A path is the Pen tool's flat point list [x0, y0, x1, y1, …]. The Paths panel
// lists the current Work Path + any saved named paths and runs the path ops
// (Make Selection / Fill) through the engine's select_polygon / fill_selection.

import type { FillContent, RGB } from "./fillContents";

export interface SavedPath {
  name: string;
  path: number[];
  /** Bezier form when the path has curves (see AnchorPath); absent = corner path. */
  anchors?: number[];
  /** Anchor count of each closed loop when `anchors` holds several (glyph
   *  outlines); absent = one loop. */
  contours?: number[];
  /** Photoshop clipping path flatness in device pixels (0.2–100). Set on at most
   *  one path: the one a PSD export names in image resource 2999. */
  clipFlatness?: number;
}

export const MAX_PERSISTED_SAVED_PATHS = 512;
export const MIN_CLIP_FLATNESS = 0.2;
export const MAX_CLIP_FLATNESS = 100;

// ── Bezier work paths ────────────────────────────────────────────
// An AnchorPath is the curve-capable work path: 6 floats per anchor
// [x, y, inX, inY, outX, outY] with RELATIVE in/out handles — the same model as
// the vector engine's Anchor (geom.rs Cubic::from_handles) and the Artisan scene
// JSON ({ point, handleIn, handleOut }). Zero handles on both ends of a segment
// make it a straight line, so a pure corner path flattens to exactly its points.
export const ANCHOR_STRIDE = 6;

/** A bezier path needs at least 3 anchors (18 numbers) to enclose an area. */
export function hasAnchorPath(a: number[]): boolean {
  return a.length >= 3 * ANCHOR_STRIDE;
}

/** True when a path carries at least one complete bezier segment. */
export function hasAnchorForm(a: number[]): boolean {
  return a.length >= 2 * ANCHOR_STRIDE && a.length % ANCHOR_STRIDE === 0;
}

/** Corner anchors (zero handles) from a flat [x0,y0,…] point list. */
export function anchorsFromPoints(flat: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push(flat[i], flat[i + 1], 0, 0, 0, 0);
  return out;
}

/** Adaptive-flatten one cubic (absolute control points), pushing points AFTER
 *  (x0,y0) — the caller seeds the first point. Mirrors geom.rs flatten_into. */
function flattenCubic(
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, x3: number, y3: number,
  tol: number, depth: number, out: number[],
) {
  const dx = x3 - x0, dy = y3 - y0;
  const len = Math.hypot(dx, dy);
  // Max distance of the control points from the p0→p3 chord.
  const dev = (px: number, py: number) =>
    len < 1e-6 ? Math.hypot(px - x0, py - y0) : Math.abs((px - x0) * dy - (py - y0) * dx) / len;
  if (depth >= 18 || Math.max(dev(x1, y1), dev(x2, y2)) <= tol) {
    out.push(x3, y3);
    return;
  }
  // de Casteljau split at t = 0.5.
  const abx = (x0 + x1) / 2, aby = (y0 + y1) / 2;
  const bcx = (x1 + x2) / 2, bcy = (y1 + y2) / 2;
  const cdx = (x2 + x3) / 2, cdy = (y2 + y3) / 2;
  const abcx = (abx + bcx) / 2, abcy = (aby + bcy) / 2;
  const bcdx = (bcx + cdx) / 2, bcdy = (bcy + cdy) / 2;
  const mx = (abcx + bcdx) / 2, my = (abcy + bcdy) / 2;
  flattenCubic(x0, y0, abx, aby, abcx, abcy, mx, my, tol, depth + 1, out);
  flattenCubic(mx, my, bcdx, bcdy, cdx, cdy, x3, y3, tol, depth + 1, out);
}

/** Flatten an AnchorPath into the flat [x0,y0,…] polyline every existing path
 *  consumer takes (overlay, select_polygon, fill, stroke). `tol` is the max
 *  deviation in doc px — the default is sub-pixel, so curves rasterize smooth.
 *  `closed` also walks the wrap segment (last anchor → anchor 0); pass false for
 *  a path still being authored, whose preview must not draw a closing edge. */
export function flattenAnchorPath(anchors: number[], tol = 0.25, closed = true): number[] {
  const n = Math.floor(anchors.length / ANCHOR_STRIDE);
  if (n === 0) return [];
  const A = (i: number, k: number) => anchors[(i % n) * ANCHOR_STRIDE + k];
  const out: number[] = [A(0, 0), A(0, 1)];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const j = i + 1; // wraps (closed only): the last segment closes back to anchor 0
    const x0 = A(i, 0), y0 = A(i, 1), x3 = A(j, 0), y3 = A(j, 1);
    const ox = A(i, 4), oy = A(i, 5), ix = A(j, 2), iy = A(j, 3);
    if (ox === 0 && oy === 0 && ix === 0 && iy === 0) out.push(x3, y3);
    else flattenCubic(x0, y0, x0 + ox, y0 + oy, x3 + ix, y3 + iy, x3, y3, tol, 0, out);
  }
  if (closed) out.length -= 2; // drop the duplicated closing point (polygon fill closes implicitly)
  return out;
}

// ── Multi-loop work paths (#452) ─────────────────────────────────
/** Direct Selection's item id for the host work path. Scene ids never start
 *  with "@", so it cannot collide with a vector layer's item. */
export const WORK_PATH_ITEM = "@work-path";

/** Split an AnchorPath into its closed loops. `contours` is each loop's anchor
 *  count; empty, malformed or stale counts (an entry below 2, a non-integer, or
 *  a total that does not cover the anchors) mean one loop. */
export function anchorLoops(anchors: number[], contours: number[]): number[][] {
  let total = 0;
  for (const n of contours) {
    if (!Number.isInteger(n) || n < 2) return [anchors];
    total += n;
  }
  if (!contours.length || total * ANCHOR_STRIDE !== anchors.length) return [anchors];
  const loops: number[][] = [];
  let o = 0;
  for (const n of contours) {
    loops.push(anchors.slice(o, o + n * ANCHOR_STRIDE));
    o += n * ANCHOR_STRIDE;
  }
  return loops;
}

/** The work path as ONE fill polygon. One loop is exactly its flattening. With
 *  several, each loop is followed by a bridge out from and back to loop 0's
 *  first point; a bridge walked both ways adds nothing under an even-odd fill.
 *  ponytail: relies on the even-odd rule of both engine fills (selection.rs
 *  select_polygon, tiny-skia EvenOdd); overlapping glyph loops become holes.
 *  Upgrade path: a multi-contour select_polygons. */
export function workPathPolygon(anchors: number[], contours: number[]): number[] {
  const loops = anchorLoops(anchors, contours);
  if (loops.length === 1) return flattenAnchorPath(anchors);
  const out = flattenAnchorPath(loops[0]);
  const x0 = out[0], y0 = out[1];
  out.push(x0, y0);
  for (const loop of loops.slice(1)) {
    const flat = flattenAnchorPath(loop);
    out.push(...flat, flat[0], flat[1], x0, y0);
  }
  return out;
}

/** A saved path in the shape the engine's Photoshop path courier takes
 *  (`set_photoshop_paths`) and returns (`photoshop_paths_json`). */
export interface PhotoshopPath {
  name: string;
  anchors: number[];
  clip: number | null;
  /** Anchor count of each closed loop when the path has several (#452); the
   *  engine writes each loop as its own subpath. Absent = one loop. */
  contours?: number[];
}

/** Saved paths for a PSD export: always in anchor form, corner paths included. */
export function toPhotoshopPaths(paths: SavedPath[]): PhotoshopPath[] {
  return paths.map((p) => {
    const anchors = p.anchors && hasAnchorPath(p.anchors) ? p.anchors : anchorsFromPoints(p.path);
    return {
      name: p.name,
      anchors,
      clip: p.clipFlatness ?? null,
      ...(p.contours && anchorLoops(anchors, p.contours).length > 1 ? { contours: p.contours } : {}),
    };
  });
}

/** The paths a PSD import read, as saved paths: the flat path is re-flattened
 *  from the anchors, and a one-loop path with no handles keeps no bezier form.
 *  Anything but a JSON array reads as no paths; normalizeSavedPaths validates
 *  each entry when the store adopts them. */
export function fromPhotoshopPaths(json: unknown): SavedPath[] {
  let parsed: unknown;
  try {
    parsed = typeof json === "string" ? JSON.parse(json) : null;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((raw) => {
    const { name, anchors, clip, contours } = (raw ?? {}) as Partial<PhotoshopPath>;
    if (typeof name !== "string" || !Array.isArray(anchors)) return [];
    // Loops need their anchors even when every handle is zero, as a saved work path keeps them.
    const loops = Array.isArray(contours) && anchorLoops(anchors, contours).length > 1 ? contours : null;
    const curved = anchors.some((v, i) => i % ANCHOR_STRIDE >= 2 && v !== 0);
    return [{
      name,
      path: workPathPolygon(anchors, loops ?? []),
      ...(curved || loops ? { anchors } : {}),
      ...(loops ? { contours: loops } : {}),
      ...(typeof clip === "number" ? { clipFlatness: clip } : {}),
    }];
  });
}

/** Pen click-drag: pull anchor `i`'s direction handles toward (x, y) — the out
 *  handle follows the cursor and the in handle mirrors it, so the anchor is
 *  smooth. `mirror` false (Alt held) breaks the pairing and leaves the opposite
 *  side alone, which is how Photoshop authors a cusp. `end` "in" pulls the
 *  incoming handle instead (Direct Selection grabbing that end). Mutates in
 *  place; a no-op for an out-of-range index. */
export function pullAnchorHandles(anchors: number[], i: number, x: number, y: number, mirror = true, end: "in" | "out" = "out"): void {
  const o = i * ANCHOR_STRIDE;
  if (i < 0 || o + ANCHOR_STRIDE > anchors.length) return;
  const dx = x - anchors[o], dy = y - anchors[o + 1];
  const [pulled, opposite] = end === "in" ? [o + 2, o + 4] : [o + 4, o + 2];
  anchors[pulled] = dx;
  anchors[pulled + 1] = dy;
  if (mirror) {
    anchors[opposite] = -dx;
    anchors[opposite + 1] = -dy;
  }
}

/** A path needs at least 3 vertices (6 numbers) to enclose an area. */
export function hasPath(flat: number[]): boolean {
  return flat.length >= 6;
}

/** Split a flat [x0,y0,x1,y1,…] path into separate x / y coordinate lists. */
export function pathXY(flat: number[]): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    xs.push(flat[i]);
    ys.push(flat[i + 1]);
  }
  return { xs, ys };
}

/** First free "Path N" name not already used. */
export function defaultPathName(existing: string[]): string {
  const used = new Set(existing);
  for (let n = 1; ; n++) {
    const name = `Path ${n}`;
    if (!used.has(name)) return name;
  }
}

/** Immutable append, bounded to what document switching can preserve. */
export function addPath(list: SavedPath[], entry: SavedPath): SavedPath[] {
  if (list.length >= MAX_PERSISTED_SAVED_PATHS) return list;
  return [...list, entry];
}

/** Immutable remove by index. */
export function removeAt(list: SavedPath[], i: number): SavedPath[] {
  return list.filter((_, j) => j !== i);
}

// ── Path ops (Fill Path / Stroke Path dialogs) ──────────────────
/** Paths panel ▸ Fill Path options — Photoshop's Fill Path dialog: Contents,
 *  Blending (Mode / Opacity / Preserve Transparency) and Rendering (Feather
 *  Radius / Anti-aliased). Every field is optional; the defaults the store
 *  applies are the dialog's own (Foreground, Normal, 100%, 0 px, anti-aliased). */
export interface FillPathOptions {
  contents?: FillContent;
  /** The Color… swatch, used only when `contents` is "color". */
  custom?: RGB;
  /** Blend mode, kebab id (as `blendIndex` takes). */
  mode?: string;
  /** 0..1, like `Store.fillContents`. */
  opacity?: number;
  preserve?: boolean;
  feather?: number;
  antialias?: boolean;
}

/** Stroke Path ▸ Simulate Pressure: a 0 → 1 → 0 taper across the outline, the
 *  way a hand stroke lifts at both ends. Weighted by arc length (not vertex
 *  index) so a flattened curve's dense vertices don't skew the ramp. Floors at
 *  0.05 so the tapered ends thin out instead of disappearing. */
export function simulatedPressures(xs: number[], ys: number[]): number[] {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return [];
  const at: number[] = [0];
  for (let i = 1; i < n; i++) at.push(at[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
  const total = at[n - 1];
  if (total <= 0) return new Array(n).fill(1); // degenerate (all points coincident)
  return at.map((s) => Math.max(0.05, Math.sin(Math.PI * (s / total))));
}
