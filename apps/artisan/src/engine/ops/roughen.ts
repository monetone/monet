// ─────────────────────────────────────────────────────────────
// ops/roughen — Effect ▸ Distort & Transform ▸ Roughen (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Adobe Illustrator's Roughen adds extra anchor points along a path ("Detail")
// and jitters every point by a random amount up to "Size", giving a hand-drawn
// jagged ("Corner") or wavy ("Smooth") edge. Illustrator's jitter is random; this
// uses a SEEDED PRNG (mulberry32) so the result is reproducible and testable —
// the same seed always yields the same roughened path.

import { type Point, normalize, scale } from "../geometry/vec";
import { type Anchor, type PathGeometry, anchor, segments } from "../geometry/path";
import { evaluate } from "../geometry/bezier";
import { mulberry32 } from "../rng";
import { convertToPath, leafIds } from "./path-edit";
import { findItem } from "../model/query";
import { LIVE_SHAPES, type Document, type ID } from "../model/types";

export interface RoughenOptions {
  /** Maximum jitter per point, per axis (user units). */
  size: number;
  /** Extra points added per segment (≥0). */
  detail: number;
  /** true ⇒ smooth (wavy) edge; false ⇒ sharp corners. */
  smooth?: boolean;
  /** PRNG seed for reproducible jitter. Default 1. */
  seed?: number;
}

/** Original anchors + `detail` on-curve points per segment, each jittered. */
const roughenPoints = (g: PathGeometry, size: number, detail: number, rng: () => number): Point[] => {
  const segs = segments(g);
  if (segs.length === 0) return g.anchors.map((a) => ({ ...a.point }));
  const base: Point[] = [];
  for (const seg of segs) {
    base.push({ ...seg.p0 });
    for (let j = 1; j <= detail; j++) base.push(evaluate(seg, j / (detail + 1)));
  }
  if (!g.closed) base.push({ ...segs[segs.length - 1].p3 });
  return base.map((p) => ({ x: p.x + (rng() * 2 - 1) * size, y: p.y + (rng() * 2 - 1) * size }));
};

/** Build geometry from the jittered points (corner anchors or tangent handles). */
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
 * Effect ▸ Distort & Transform ▸ Roughen — jitter each selected path / compound /
 * live shape. One PRNG drives the whole call, so every object jitters differently
 * yet the result is fully determined by `seed`. Mutates in place; returns the ids.
 */
export const roughen = (doc: Document, ids: ID[], opts: RoughenOptions): ID[] => {
  const { size } = opts;
  const detail = Math.max(0, Math.floor(opts.detail));
  const smooth = !!opts.smooth;
  if (size <= 0) return []; // nothing to jitter

  const rng = mulberry32(opts.seed ?? 1);
  const apply = (g: PathGeometry): PathGeometry =>
    g.anchors.length < 2 ? g : toGeometry(roughenPoints(g, size, detail, rng), g.closed, smooth);

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
