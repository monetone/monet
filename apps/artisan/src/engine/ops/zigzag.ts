// ─────────────────────────────────────────────────────────────
// ops/zigzag — Object ▸ Path ▸ Zig Zag (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Adobe Illustrator's Zig Zag (Effect ▸ Distort & Transform ▸ Zig Zag) turns a
// path into a zig-zag / wave: between each pair of anchors it inserts `ridges`
// new points, each pushed off the path perpendicular by `size`, alternating side
// to side. "Corner" points make sharp zig-zags; "Smooth" points make waves.
//
// The ridge points are sampled ON the real path (via the cubic segments), so a
// curved span zig-zags along its curve rather than its chord. The original
// anchors stay on the path as the zig-zag's nodes; the rebuilt path is all corner
// anchors (Corner) or carries tangent handles through every point (Smooth).

import { type Point, normalize, perp, scale } from "../geometry/vec";
import { type Anchor, type PathGeometry, anchor, segments } from "../geometry/path";
import { derivative, evaluate } from "../geometry/bezier";
import { convertToPath, leafIds } from "./path-edit";
import { findItem } from "../model/query";
import { LIVE_SHAPES, type Document, type ID } from "../model/types";

export interface ZigZagOptions {
  /** Displacement amplitude in user units (absolute). */
  size: number;
  /** Ridges (extra points) added per segment; clamped to ≥ 1. */
  ridges: number;
  /** true ⇒ smooth waves (tangent handles); false ⇒ sharp corners. */
  smooth?: boolean;
}

/** On-curve ridge points (+ original nodes) for one subpath. */
const ridgePoints = (g: PathGeometry, size: number, ridges: number): Point[] => {
  const segs = segments(g);
  if (segs.length === 0) return g.anchors.map((a) => ({ ...a.point }));
  const pts: Point[] = [];
  let sign = 1;
  for (const seg of segs) {
    pts.push({ ...seg.p0 }); // original anchor (stays on the path)
    for (let j = 1; j <= ridges; j++) {
      const t = j / (ridges + 1);
      const base = evaluate(seg, t);
      const nrm = perp(normalize(derivative(seg, t)));
      pts.push({ x: base.x + nrm.x * size * sign, y: base.y + nrm.y * size * sign });
      sign = -sign;
    }
  }
  if (!g.closed) pts.push({ ...segs[segs.length - 1].p3 }); // final open endpoint
  return pts;
};

/** Build path geometry from the rebuilt point list. */
const toGeometry = (pts: Point[], closed: boolean, smooth: boolean): PathGeometry => {
  if (!smooth) return { closed, anchors: pts.map((p) => anchor(p)) };
  const m = pts.length;
  const anchors: Anchor[] = pts.map((p, i) => {
    const prev = !closed && i === 0 ? p : pts[(i - 1 + m) % m];
    const next = !closed && i === m - 1 ? p : pts[(i + 1) % m];
    const tan = normalize({ x: next.x - prev.x, y: next.y - prev.y });
    const inLen = Math.hypot(p.x - prev.x, p.y - prev.y) / 3;
    const outLen = Math.hypot(next.x - p.x, next.y - p.y) / 3;
    return { point: { ...p }, handleIn: scale(tan, -inLen), handleOut: scale(tan, outLen) };
  });
  return { closed, anchors };
};

/**
 * Object ▸ Path ▸ Zig Zag — distort each selected path / compound / live shape
 * into a zig-zag (Corner) or wave (Smooth). Mutates in place; returns modified ids.
 */
export const zigZag = (doc: Document, ids: ID[], options: ZigZagOptions): ID[] => {
  const { size } = options;
  const ridges = Math.max(1, Math.round(options.ridges));
  const smooth = !!options.smooth;
  if (!size) return []; // a zero size leaves the path unchanged

  const apply = (g: PathGeometry): PathGeometry =>
    g.anchors.length < 2 ? g : toGeometry(ridgePoints(g, size, ridges), g.closed, smooth);

  const done: ID[] = [];
  for (const id of leafIds(doc, ids)) {
    let loc = findItem(doc, id);
    if (!loc) continue;
    if (LIVE_SHAPES.includes(loc.item.type)) {
      convertToPath(doc, id);
      loc = findItem(doc, id);
      if (!loc) continue;
    }
    const it = loc.item;
    if (it.type === "path") {
      it.geometry = apply(it.geometry);
      done.push(id);
    } else if (it.type === "compound") {
      it.subpaths = it.subpaths.map(apply);
      done.push(id);
    }
  }
  return done;
};
