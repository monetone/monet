// ─────────────────────────────────────────────────────────────
// ops/pathfinder — the full Illustrator Pathfinder panel (10 ops)
// ─────────────────────────────────────────────────────────────
// Operates on the FLATTENED, world-space outlines of the selected items via the
// Martinez polygon-clipping algorithm. Curves are flattened — a deliberate v1
// tradeoff matching how simple boolean tools behave.
//
//   Shape modes (→ one compound path):
//     unite · minus-front · intersect · exclude · minus-back
//   Pathfinders (→ a group of pieces, Illustrator-style):
//     divide · trim · merge · crop · outline
//
// The pathfinders that subdivide art (divide/trim/merge/crop) are built on a
// planar arrangement: every selected outline is overlaid and the plane is cut
// into disjoint "faces", each tagged with the TOPMOST object covering it (its
// visible owner). Divide emits every face; Trim/Merge union faces by owner /
// owner-colour; Crop keeps faces inside the frontmost object. Outline reduces
// each outline to stroked open edges split at every crossing.

import type { MultiPolygon, Pair } from "polygon-clipping";
import * as polygonClippingNs from "polygon-clipping";
import { cloneDeep } from "../clone";

// polygon-clipping ships as a CJS module whose exports object is the default
// (the bundler can't statically see named exports), so reach through `default`.
type ClipFn = (geom: unknown, ...geoms: unknown[]) => MultiPolygon;
const pc = ((polygonClippingNs as unknown as { default?: unknown }).default ?? polygonClippingNs) as {
  union: ClipFn;
  intersection: ClipFn;
  difference: ClipFn;
  xor: ClipFn;
};
import { flatten as flattenPath, transform as transformPath } from "../geometry/path";
import { anchor, type PathGeometry } from "../geometry/path";
import type { Point } from "../geometry/vec";
import { eachItem, findItem, worldTransformAt } from "../model/query";
import { cancelAncestors, leafIds } from "./path-edit";
import { localPaths } from "../model/shapes";
import { makeCompound, makePath, makeGroup, solid, noPaint, defaultStroke } from "../model/factory";
import { BLACK } from "../color";
import { pruneEmptyGroups, removeItems } from "./items";
import type { Document, ID, Item, Paint, Stroke } from "../model/types";
import { paintedFill, paintedStroke } from "../model/appearance";

export type PathfinderOp =
  // shape modes → a single compound path
  | "unite"
  | "minus-front"
  | "intersect"
  | "exclude"
  | "minus-back"
  // pathfinders → a group of pieces
  | "divide"
  | "trim"
  | "merge"
  | "crop"
  | "outline";

/** The five pathfinders that produce a GROUP of pieces (not one compound). */
const GROUP_OPS: ReadonlySet<PathfinderOp> = new Set<PathfinderOp>([
  "divide",
  "trim",
  "merge",
  "crop",
  "outline",
]);

/** Item fill as world-space polygons, including even-odd compound holes. */
const itemMultiPolygon = (doc: Document, id: ID): MultiPolygon => {
  const loc = findItem(doc, id);
  if (!loc) return [];
  const world = worldTransformAt(loc);
  const paths = localPaths(loc.item);
  const polygons = paths
    .map((p) => flattenPath(transformPath(p, world), 0.4).map((pt) => [pt.x, pt.y] as Pair))
    .filter((ring) => ring.length >= 3)
    .map((ring) => [ring]);
  if (!(loc.item.type === "compound" || loc.item.evenOdd) || polygons.length < 2) return polygons;
  try {
    return pc.xor(polygons[0], ...polygons.slice(1));
  } catch {
    return polygons;
  }
};

/** Selected ids ordered bottom→top in document paint order. */
const orderByDoc = (doc: Document, ids: ID[]): ID[] => {
  const set = new Set(ids);
  const out: ID[] = [];
  eachItem(doc, (item) => {
    if (set.has(item.id)) out.push(item.id);
  });
  return out;
};

/** Insert world-baked output where the frontmost source sat, then remove sources. */
const replaceManyInPlace = (doc: Document, ids: ID[], outputs: Item[]): boolean => {
  const ordered = orderByDoc(doc, ids);
  const target = findItem(doc, ordered[ordered.length - 1]);
  if (!target) return false;
  const transform = cancelAncestors(target.ancestors);
  for (const output of outputs) output.transform = { ...transform };
  target.container.splice(target.index, 0, ...outputs);
  removeItems(doc, ordered);
  return true;
};

const replaceInPlace = (doc: Document, ids: ID[], output: Item): boolean =>
  replaceManyInPlace(doc, ids, [output]);

/** Flattened single-ring polygons for arbitrary local geometry (no doc lookup). */
export const geometryMultiPolygon = (paths: PathGeometry[]): MultiPolygon =>
  paths
    .map((p) => flattenPath(p, 0.4).map((pt) => [pt.x, pt.y] as Pair))
    .filter((ring) => ring.length >= 3)
    .map((ring) => [ring]);

/** Intersection / difference of two geometry sets, as subpaths. */
export const clipGeometry = (a: PathGeometry[], b: PathGeometry[], op: "intersect" | "subtract"): PathGeometry[] => {
  const mpA = geometryMultiPolygon(a);
  const mpB = geometryMultiPolygon(b);
  if (!mpA.length || !mpB.length) return [];
  const fn = op === "intersect" ? pc.intersection : pc.difference;
  return ringsToCompound(safeOp(fn as ClipFn, mpA, mpB, []));
};

const ringsToCompound = (result: MultiPolygon): PathGeometry[] => {
  const subpaths: PathGeometry[] = [];
  for (const poly of result) {
    for (const ring of poly) {
      // polygon-clipping closes rings (last point repeats the first) — drop it.
      const pts = ring.slice(0, ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? -1 : undefined);
      if (pts.length < 3) continue;
      subpaths.push({ closed: true, anchors: pts.map(([x, y]) => anchor({ x, y })) });
    }
  }
  return subpaths;
};

/**
 * Apply a boolean op to the selected items, replacing them with one compound
 * path. Returns the new item id, or null if it could not be computed.
 */
export const pathfinder = (doc: Document, ids: ID[], op: PathfinderOp): ID | null => {
  if (GROUP_OPS.has(op)) return pathfinderGroup(doc, ids, op);
  const ordered = orderByDoc(doc, ids);
  if (ordered.length < 2) return null;
  const mps = ordered.map((id) => itemMultiPolygon(doc, id));
  if (mps.some((m) => m.length === 0)) {
    // tolerate items with no fillable outline by dropping them
  }
  const nonEmpty = ordered.filter((_, i) => mps[i].length > 0);
  const polys = mps.filter((m) => m.length > 0);
  if (polys.length < 2) return null;

  let result: MultiPolygon;
  try {
    switch (op) {
      case "unite":
        result = pc.union(polys[0], ...polys.slice(1));
        break;
      case "intersect":
        result = pc.intersection(polys[0], ...polys.slice(1));
        break;
      case "exclude":
        result = pc.xor(polys[0], ...polys.slice(1));
        break;
      case "minus-front":
        // subtract everything above the back-most from the back-most
        result = pc.difference(polys[0], ...polys.slice(1));
        break;
      case "minus-back":
        // subtract everything below the front-most from the front-most
        result = pc.difference(polys[polys.length - 1], ...polys.slice(0, -1));
        break;
      default:
        // group-producing pathfinders are dispatched earlier; unreachable here.
        return null;
    }
  } catch {
    return null;
  }

  const subpaths = ringsToCompound(result);
  if (subpaths.length === 0) {
    removeItems(doc, ordered);
    return null;
  }

  // Style + placement come from the relevant source object. Illustrator paints
  // the result with the TOPMOST object's attributes for unite/intersect/exclude
  // (and minus-back, whose survivor is the front object); only minus-front keeps
  // the back-most (surviving) object's paint.
  const styleSourceId =
    op === "minus-front" ? nonEmpty[0] : nonEmpty[nonEmpty.length - 1];
  const styleLoc = findItem(doc, styleSourceId);
  const style = styleLoc?.item;
  const compound = makeCompound(subpaths, {
    fill: style ? cloneDeep(paintedFill(style)) : undefined,
    stroke: style ? cloneDeep(paintedStroke(style)) : undefined,
  });
  compound.evenOdd = true;

  return replaceInPlace(doc, ordered, compound) ? compound.id : null;
};

// ─────────────────────────────────────────────────────────────
// Pathfinders that emit a GROUP (divide / trim / merge / crop / outline)
// ─────────────────────────────────────────────────────────────

/** Signed shoelace area of a single ring. */
const ringSignedArea = (ring: Pair[]): number => {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
};

/** Net (outer minus holes) area of a MultiPolygon. */
const mpArea = (mp: MultiPolygon): number => {
  let total = 0;
  for (const poly of mp)
    for (let r = 0; r < poly.length; r++) {
      const a = Math.abs(ringSignedArea(poly[r]));
      total += r === 0 ? a : -a;
    }
  return total;
};

const mpNonEmpty = (mp: MultiPolygon): boolean => mp.length > 0 && mpArea(mp) > 1e-6;

const safeOp = (fn: ClipFn, a: unknown, b: unknown, fallback: MultiPolygon): MultiPolygon => {
  try {
    return fn(a, b);
  } catch {
    return fallback;
  }
};

/** A closed ring (world space) → a closed PathGeometry, dropping the wrap point. */
const ringToGeometry = (ring: Pair[]): PathGeometry | null => {
  const last = ring.length - 1;
  const wraps = ring.length > 1 && ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1];
  const pts = wraps ? ring.slice(0, last) : ring;
  if (pts.length < 3) return null;
  return { closed: true, anchors: pts.map(([x, y]) => anchor({ x, y })) };
};

interface PieceStyle {
  fill: Paint;
  stroke?: Item["stroke"];
}

const paintedStyle = (item: Item): PieceStyle => ({
  fill: cloneDeep(paintedFill(item)),
  stroke: cloneDeep(paintedStroke(item)),
});

/** One polygon (outer + holes) → a single path / compound item. */
const polyToItem = (poly: Pair[][], style: PieceStyle, name: string): Item | null => {
  const subs = poly.map(ringToGeometry).filter((g): g is PathGeometry => g != null);
  if (subs.length === 0) return null;
  if (subs.length === 1) return makePath(subs[0], { ...style, name });
  const c = makeCompound(subs, { ...style, name });
  c.evenOdd = true;
  return c;
};

/** A whole MultiPolygon → a single (compound) item carrying all its rings. */
const mpToItem = (mp: MultiPolygon, style: PieceStyle, name: string): Item | null => {
  const subs: PathGeometry[] = [];
  for (const poly of mp)
    for (const ring of poly) {
      const g = ringToGeometry(ring);
      if (g) subs.push(g);
    }
  if (subs.length === 0) return null;
  if (subs.length === 1) return makePath(subs[0], { ...style, name });
  const c = makeCompound(subs, { ...style, name });
  c.evenOdd = true;
  return c;
};

interface Source {
  id: ID;
  item: Item;
  mp: MultiPolygon;
}

/** Selected, drawable sources in bottom→top paint order, each with its world outline. */
const gatherSources = (doc: Document, ids: ID[]): Source[] => {
  const out: Source[] = [];
  for (const id of orderByDoc(doc, ids)) {
    const loc = findItem(doc, id);
    if (!loc) continue;
    const mp = itemMultiPolygon(doc, id);
    if (mpNonEmpty(mp)) out.push({ id, item: loc.item, mp });
  }
  return out;
};

/** A face of the planar arrangement: a region + the index of its topmost owner. */
interface Face {
  mp: MultiPolygon;
  owner: number;
}

/**
 * Overlay every source outline and cut the plane into disjoint faces, each
 * tagged with the highest-index (topmost / visible) source covering it.
 * Built incrementally bottom→top so the invariant `owner = topmost shape` holds.
 */
const arrangement = (polys: MultiPolygon[]): Face[] => {
  let faces: Face[] = [];
  let covered: MultiPolygon = [];
  for (let k = 0; k < polys.length; k++) {
    const Sk = polys[k];
    const next: Face[] = [];
    for (const f of faces) {
      const inside = safeOp(pc.intersection, f.mp, Sk, []);
      const outside = safeOp(pc.difference, f.mp, Sk, f.mp);
      if (mpNonEmpty(inside)) next.push(...inside.map((poly) => ({ mp: [poly], owner: k }))); // Sk now on top here
      if (mpNonEmpty(outside)) next.push(...outside.map((poly) => ({ mp: [poly], owner: f.owner })));
    }
    const fresh = covered.length ? safeOp(pc.difference, Sk, covered, Sk) : Sk;
    if (mpNonEmpty(fresh)) next.push(...fresh.map((poly) => ({ mp: [poly], owner: k })));
    faces = next;
    covered = covered.length ? safeOp(pc.union, covered, Sk, covered) : Sk;
  }
  return faces;
};

const fillStyle = (item: Item): PieceStyle => ({
  fill: cloneDeep(paintedFill(item)),
  // Pathfinders (trim/merge/crop) discard strokes — Divide keeps them (see caller).
  stroke: defaultStroke(noPaint()),
});

/** Stable key so Merge unions only same-colour solid fills (others never merge). */
const colorKey = (paint: Paint, idx: number): string =>
  paint.type === "solid"
    ? `s:${Math.round(paint.color.r)},${Math.round(paint.color.g)},${Math.round(paint.color.b)},${paint.color.a}`
    : `u:${idx}`;

/** Commit a set of result pieces as one group in place of the originals. */
const commitGroup = (doc: Document, ids: ID[], pieces: Item[], name: string): ID | null => {
  const ordered = orderByDoc(doc, ids);
  if (pieces.length === 0) {
    removeItems(doc, ordered);
    return null;
  }
  const group = makeGroup(pieces, { name });
  return replaceInPlace(doc, ordered, group) ? group.id : null;
};

/** Dispatch for the group-producing pathfinders. Returns the new group id. */
const pathfinderGroup = (doc: Document, ids: ID[], op: PathfinderOp): ID | null => {
  const srcs = gatherSources(doc, ids);
  if (srcs.length < 2) return null;

  if (op === "outline") return outline(doc, ids, srcs);

  if (op === "crop") {
    // Frontmost object is the crop boundary (removed); keep the divide faces of
    // everything beneath, clipped to it, carrying the underlying fills.
    const clip = srcs[srcs.length - 1].mp;
    const below = srcs.slice(0, -1);
    const pieces: Item[] = [];
    for (const f of arrangement(below.map((s) => s.mp))) {
      const cropped = safeOp(pc.intersection, f.mp, clip, []);
      if (!mpNonEmpty(cropped)) continue;
      const src = below[f.owner];
      for (const poly of cropped) {
        const it = polyToItem(poly, fillStyle(src.item), "Crop");
        if (it) pieces.push(it);
      }
    }
    return commitGroup(doc, ids, pieces, "Crop");
  }

  const faces = arrangement(srcs.map((s) => s.mp));

  if (op === "divide") {
    // Every face becomes its own piece, keeping the topmost owner's fill+stroke.
    const pieces: Item[] = [];
    for (const f of faces) {
      const src = srcs[f.owner];
      const style = paintedStyle(src.item);
      for (const poly of f.mp) {
        const it = polyToItem(poly, style, "Divide");
        if (it) pieces.push(it);
      }
    }
    return commitGroup(doc, ids, pieces, "Divide");
  }

  // trim + merge: each object's VISIBLE region = union of the faces it owns.
  const byOwner = new Map<number, MultiPolygon>();
  for (const f of faces) {
    const prev = byOwner.get(f.owner);
    byOwner.set(f.owner, prev ? safeOp(pc.union, prev, f.mp, prev) : f.mp);
  }

  if (op === "trim") {
    // Keep each owner separate (same colours are NOT merged).
    const pieces: Item[] = [];
    for (let i = 0; i < srcs.length; i++) {
      const region = byOwner.get(i);
      if (!region || !mpNonEmpty(region)) continue;
      const it = mpToItem(region, fillStyle(srcs[i].item), "Trim");
      if (it) pieces.push(it);
    }
    return commitGroup(doc, ids, pieces, "Trim");
  }

  // merge: union the visible regions of objects that share a fill colour.
  const groups = new Map<string, { region: MultiPolygon; fill: Paint }>();
  for (let i = 0; i < srcs.length; i++) {
    const region = byOwner.get(i);
    if (!region || !mpNonEmpty(region)) continue;
    const fill = paintedFill(srcs[i].item);
    const key = colorKey(fill, i);
    const g = groups.get(key);
    if (g) g.region = safeOp(pc.union, g.region, region, g.region);
    else groups.set(key, { region, fill: cloneDeep(fill) });
  }
  const pieces: Item[] = [];
  for (const g of groups.values()) {
    const it = mpToItem(g.region, { fill: g.fill, stroke: defaultStroke(noPaint()) }, "Merge");
    if (it) pieces.push(it);
  }
  return commitGroup(doc, ids, pieces, "Merge");
};

// ── Outline ──────────────────────────────────────────────────
// Reduce every selected outline to stroked OPEN edges, split at each point
// where it crosses another selected outline, painted with the source's fill.

/** World-space rings (closed loops of points) of one source, wrap-point stripped. */
const sourceRings = (mp: MultiPolygon): Pair[][] => {
  const rings: Pair[][] = [];
  for (const poly of mp)
    for (const ring of poly) {
      if (ring.length < 3) continue;
      const last = ring.length - 1;
      const clean =
        ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1] ? ring.slice(0, last) : ring.slice();
      if (clean.length >= 3) rings.push(clean);
    }
  return rings;
};

/** Parametric crossing (t along a→b) of segment a→b with c→d, interior to both, or null. */
const segCrossT = (a: Pair, b: Pair, c: Pair, d: Pair): number | null => {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return null; // parallel / degenerate
  const qpx = c[0] - a[0];
  const qpy = c[1] - a[1];
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  if (t < 1e-7 || t > 1 - 1e-7 || u < -1e-7 || u > 1 + 1e-7) return null; // interior of a→b only
  return t;
};

/** True if point p lies within tolerance of segment a→b. */
const onSegment = (p: Pair, a: Pair, b: Pair, eps2 = 1e-6): boolean => {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-12) return false;
  let t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2;
  if (t < -1e-7 || t > 1 + 1e-7) return false;
  t = Math.max(0, Math.min(1, t));
  const dx = p[0] - (a[0] + abx * t);
  const dy = p[1] - (a[1] + aby * t);
  return dx * dx + dy * dy <= eps2;
};

const lerp = (a: Pair, b: Pair, t: number): Pair => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Stroke paint for an outlined edge: the source's fill colour (fallbacks: its stroke, then black). */
const outlinePaint = (item: Item): Paint => {
  const fill = paintedFill(item);
  const stroke = paintedStroke(item);
  if (fill.type === "solid") return solid(fill.color);
  if (stroke.paint.type !== "none") return cloneDeep(stroke.paint);
  return solid(BLACK);
};

const outline = (doc: Document, ids: ID[], srcs: Source[]): ID | null => {
  const ringsOf = srcs.map((s) => sourceRings(s.mp));
  const pieces: Item[] = [];

  for (let si = 0; si < srcs.length; si++) {
    const paint = outlinePaint(srcs[si].item);
    const stroke = { ...defaultStroke(paint), width: Math.max(paintedStroke(srcs[si].item).width || 1, 1) };
    const others: Pair[][] = [];
    for (let sj = 0; sj < srcs.length; sj++) if (sj !== si) others.push(...ringsOf[sj]);

    // Emit one open edge, dropping consecutive-duplicate points and zero-length stubs.
    const emit = (pts: Pair[]) => {
      const clean: Pair[] = [];
      for (const p of pts) {
        const q = clean[clean.length - 1];
        if (!q || Math.abs(p[0] - q[0]) > 1e-7 || Math.abs(p[1] - q[1]) > 1e-7) clean.push(p);
      }
      if (clean.length < 2) return;
      let len = 0;
      for (let i = 1; i < clean.length; i++) len += Math.hypot(clean[i][0] - clean[i - 1][0], clean[i][1] - clean[i - 1][1]);
      if (len < 1e-4) return;
      pieces.push(makePath({ closed: false, anchors: clean.map(([x, y]) => anchor({ x, y })) }, { fill: noPaint(), stroke, name: "Outline" }));
    };

    for (const loop of ringsOf[si]) {
      const m = loop.length;
      // Cut positions s = edgeIndex + t where this loop meets another outline:
      //   (a) transversal crossings interior to an edge, and
      //   (b) vertices that lie ON another outline — degenerate crossings the
      //       interior test misses (flattening often lands a vertex exactly on
      //       the intersection point).
      const cuts: number[] = [];
      for (let e = 0; e < m; e++) {
        const a = loop[e];
        const b = loop[(e + 1) % m];
        for (const o of others) {
          let on = false;
          for (let oe = 0; oe < o.length && !on; oe++) on = onSegment(a, o[oe], o[(oe + 1) % o.length]);
          if (on) {
            cuts.push(e); // vertex `a` sits on another outline
            break;
          }
        }
        const ts: number[] = [];
        for (const o of others)
          for (let oe = 0; oe < o.length; oe++) {
            const t = segCrossT(a, b, o[oe], o[(oe + 1) % o.length]);
            if (t != null) ts.push(t);
          }
        ts.sort((x, y) => x - y);
        for (const t of ts) cuts.push(e + t);
      }

      // Sort + dedupe near-equal positions (wrap-aware).
      cuts.sort((x, y) => x - y);
      const uniq: number[] = [];
      for (const c of cuts) if (!uniq.length || c - uniq[uniq.length - 1] > 1e-6) uniq.push(c);
      if (uniq.length >= 2 && uniq[0] + m - uniq[uniq.length - 1] < 1e-6) uniq.pop();

      if (uniq.length < 2) {
        emit(loop); // no real crossings → the whole outline is one open edge
        continue;
      }

      // Walk the loop, emitting an open edge between each consecutive pair of cuts.
      for (let ci = 0; ci < uniq.length; ci++) {
        const c0 = uniq[ci];
        const c1 = uniq[(ci + 1) % uniq.length];
        const e0 = Math.floor(c0 + 1e-9) % m;
        const t0 = c0 - Math.floor(c0);
        const e1 = Math.floor(c1 + 1e-9) % m;
        const t1 = c1 - Math.floor(c1);
        const pts: Pair[] = [lerp(loop[e0], loop[(e0 + 1) % m], t0)];
        let idx = (e0 + 1) % m;
        for (let guard = 0; guard <= m; guard++) {
          if (idx === (e1 + 1) % m) break;
          pts.push(loop[idx]);
          if (idx === e1) break;
          idx = (idx + 1) % m;
        }
        pts.push(lerp(loop[e1], loop[(e1 + 1) % m], t1));
        emit(pts);
      }
    }
  }

  return commitGroup(doc, ids, pieces, "Outline");
};

/**
 * Subtract an arbitrary polygon region (world space) from each item, replacing
 * it in place with the eroded compound path (or removing it if fully erased).
 * Used by the Eraser tool.
 */
export const subtractRegionFromItems = (doc: Document, ids: ID[], region: MultiPolygon): void => {
  if (region.length === 0) return;
  let removed = false;
  for (const id of leafIds(doc, ids)) {
    const loc = findItem(doc, id);
    if (
      !loc ||
      loc.item.type === "group" ||
      !loc.item.visible ||
      loc.item.locked ||
      loc.ancestors.some((group) => !group.visible || group.locked)
    ) continue;
    const mp = itemMultiPolygon(doc, id);
    if (!mp.length) continue;
    let res: MultiPolygon;
    try {
      res = pc.difference(mp, region);
    } catch {
      continue;
    }
    const subpaths = ringsToCompound(res);
    if (subpaths.length === 0) {
      loc.container.splice(loc.index, 1);
      removed = true;
      continue;
    }
    const style = loc.item;
    const compound = makeCompound(subpaths, paintedStyle(style));
    compound.evenOdd = true;
    compound.name = style.name;
    // `subpaths` are in WORLD space but land back in this item's own container —
    // cancel the ancestors or their transform is applied a second time.
    compound.transform = cancelAncestors(loc.ancestors);
    loc.container.splice(loc.index, 1, compound);
  }
  if (removed) pruneEmptyGroups(doc);
};

/**
 * Object ▸ Path ▸ Divide Objects Below — use the single selected object as a
 * cookie-cutter: every drawable sibling BELOW it in the same container is split
 * into the part inside the cutter and the part outside (each keeping its own
 * full appearance), then the cutter itself is removed. Hidden and locked objects
 * below are left alone (Illustrator treats them as not present). No-op when
 * nothing drawable sits below the cutter (so the stencil is never consumed for
 * nothing). Operates on the cutter's own container (a v1 scope: it does not
 * descend into sibling groups or cross layers). Returns the resulting piece ids;
 * curves flatten, matching the other Pathfinders.
 */
export const divideObjectsBelow = (doc: Document, cutterId: ID): ID[] => {
  const cutterLoc = findItem(doc, cutterId);
  if (!cutterLoc) return [];
  const region = itemMultiPolygon(doc, cutterId);
  if (!mpNonEmpty(region)) return [];

  const container = cutterLoc.container;
  const newIds: ID[] = [];
  let hadDrawableBelow = false;

  // Walk the siblings below the cutter from just under it downward, so each
  // splice (1 target → up to 2 pieces) never disturbs the not-yet-visited items
  // at lower indices.
  for (let i = cutterLoc.index - 1; i >= 0; i--) {
    const target = container[i];
    if (target.type === "group" || !target.visible || target.locked) continue; // skip groups + hidden/locked art
    const mp = itemMultiPolygon(doc, target.id);
    if (!mpNonEmpty(mp)) continue;
    hadDrawableBelow = true;

    let inside: MultiPolygon;
    let outside: MultiPolygon;
    try {
      inside = pc.intersection(mp, region);
      outside = pc.difference(mp, region);
    } catch {
      continue;
    }
    if (!mpNonEmpty(inside)) continue; // the cutter doesn't overlap this target

    const style = paintedStyle(target);
    const name = target.name ?? "";
    const pieces = [mpToItem(outside, style, name), mpToItem(inside, style, name)].filter((p): p is Item => p != null);
    if (pieces.length === 0) {
      container.splice(i, 1);
      continue;
    }
    for (const p of pieces) {
      // Pieces keep the object's FULL appearance, not just paint (mpToItem resets
      // opacity/blendMode/effects to the factory defaults).
      p.opacity = target.opacity;
      p.blendMode = target.blendMode;
      if (target.effects) p.effects = cloneDeep(target.effects);
      // World-baked geometry re-parented into the target's container.
      p.transform = cancelAncestors(cutterLoc.ancestors);
    }
    container.splice(i, 1, ...pieces);
    for (const p of pieces) newIds.push(p.id);
  }

  if (!hadDrawableBelow) return []; // nothing to cut → leave the cutter intact
  const after = findItem(doc, cutterId);
  if (after) after.container.splice(after.index, 1);
  return newIds;
};

// ── Shape Builder ────────────────────────────────────────────
const pointInRing = (ring: Pair[], x: number, y: number): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][1];
    const yj = ring[j][1];
    if (yi > y !== yj > y && x < ((ring[j][0] - ring[i][0]) * (y - yi)) / (yj - yi) + ring[i][0]) inside = !inside;
  }
  return inside;
};
/** Is (x,y) inside a MultiPolygon (outer ring minus holes)? */
const pointInMP = (mp: MultiPolygon, x: number, y: number): boolean => {
  for (const poly of mp) {
    if (!pointInRing(poly[0], x, y)) continue;
    let inHole = false;
    for (let h = 1; h < poly.length && !inHole; h++) inHole = pointInRing(poly[h], x, y);
    if (!inHole) return true;
  }
  return false;
};

export type ShapeBuilderMode = "merge" | "delete";

/**
 * Shape Builder: decompose the selected overlapping shapes into their planar
 * faces; the faces the drag passes over are MERGED into one shape (or DELETEd
 * with Alt). Untouched faces survive as separate shapes (Illustrator parity).
 * Returns the new shape ids.
 */
export const shapeBuilder = (doc: Document, ids: ID[], pts: Point[], mode: ShapeBuilderMode = "merge"): ID[] => {
  const srcs = gatherSources(doc, ids);
  if (srcs.length < 1 || pts.length === 0) return [];
  const faces = arrangement(srcs.map((s) => s.mp));
  if (faces.length === 0) return [];
  const touched = faces.map((f) => pts.some((p) => pointInMP(f.mp, p.x, p.y)));
  if (!touched.some(Boolean)) return []; // dragged over empty space — no-op

  const styleOf = (f: Face): PieceStyle => paintedStyle(srcs[f.owner].item);
  const result: Item[] = [];

  if (mode === "merge") {
    const hit = faces.filter((_, i) => touched[i]);
    let merged: MultiPolygon = [];
    for (const f of hit) merged = merged.length ? safeOp(pc.union, merged, f.mp, merged) : f.mp;
    const topOwner = Math.max(...hit.map((f) => f.owner)); // front-most paint among merged faces
    const m = mpToItem(merged, paintedStyle(srcs[topOwner].item), "Shape");
    if (m) result.push(m);
  }
  // surviving (untouched) faces become their own shapes
  faces.forEach((f, i) => {
    if (touched[i]) return;
    const it = mpToItem(f.mp, styleOf(f), "Shape");
    if (it) result.push(it);
  });

  if (result.length) {
    replaceManyInPlace(doc, ids, result);
  } else {
    removeItems(doc, ids);
  }
  return result.map((it) => it.id);
};

/**
 * Knife: cut each item with the straight line a→b into TWO separate pieces that
 * share the cut edge (no gap), like Illustrator's Knife — by intersecting the
 * shape with the half-plane on each side of the (extended) line. Items the line
 * doesn't actually divide are left untouched. Returns the new piece ids.
 */
export const knifeCut = (doc: Document, ids: ID[], a: Point, b: Point): ID[] => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return [];
  const dir = { x: dx / len, y: dy / len };
  const perp = { x: -dir.y, y: dir.x };
  const EXT = 1e5; // extend the line + half-plane far past any artwork
  const A = { x: a.x - dir.x * EXT, y: a.y - dir.y * EXT };
  const B = { x: b.x + dir.x * EXT, y: b.y + dir.y * EXT };
  const halfPlane = (s: number): MultiPolygon => [
    [
      [
        [A.x, A.y],
        [B.x, B.y],
        [B.x + perp.x * EXT * s, B.y + perp.y * EXT * s],
        [A.x + perp.x * EXT * s, A.y + perp.y * EXT * s],
      ] as Pair[],
    ],
  ];
  const left = halfPlane(1);
  const right = halfPlane(-1);

  const newIds: ID[] = [];
  for (const id of leafIds(doc, ids)) {
    const loc = findItem(doc, id);
    if (
      !loc ||
      loc.item.type === "group" ||
      !loc.item.visible ||
      loc.item.locked ||
      loc.ancestors.some((group) => !group.visible || group.locked)
    ) continue;
    const mp = itemMultiPolygon(doc, id);
    if (!mp.length) continue;
    let leftMP: MultiPolygon;
    let rightMP: MultiPolygon;
    try {
      leftMP = pc.intersection(mp, left);
      rightMP = pc.intersection(mp, right);
    } catch {
      continue;
    }
    if (!mpNonEmpty(leftMP) || !mpNonEmpty(rightMP)) continue; // line didn't split this shape
    const style = paintedStyle(loc.item);
    const name = loc.item.name;
    const pieces = [...leftMP, ...rightMP]
      .map((poly) => polyToItem(poly, style, name))
      .filter((piece): piece is Item => piece != null);
    if (pieces.length < 2) continue;
    const transform = cancelAncestors(loc.ancestors);
    for (const piece of pieces) piece.transform = { ...transform };
    loc.container.splice(loc.index, 1, ...pieces);
    newIds.push(...pieces.map((piece) => piece.id));
  }
  return newIds;
};

/** Union a region (many polygons) into a merged MultiPolygon. */
export const unionRegion = (region: MultiPolygon): MultiPolygon => {
  if (!region.length) return [];
  try {
    return pc.union(region[0], ...region.slice(1));
  } catch {
    return region;
  }
};

/** Convert a MultiPolygon into closed path subpaths (for compound items). */
export const regionToSubpaths = (mp: MultiPolygon): PathGeometry[] => ringsToCompound(mp);

const sameSolid = (a: Paint, b: Paint): boolean =>
  a.type === "solid" && b.type === "solid" && a.color.r === b.color.r && a.color.g === b.color.g && a.color.b === b.color.b && a.color.a === b.color.a;

/**
 * Commit a Blob Brush stroke: union the painted `region` and, like Illustrator,
 * MERGE it into every existing same-fill, no-stroke shape it touches (those are
 * removed). Returns the resulting (compound) shape id, or null.
 */
export const blobBrushCommit = (doc: Document, region: MultiPolygon, fill: Paint, stroke: Stroke, layerId?: ID): ID | null => {
  let merged = unionRegion(region);
  if (!mpNonEmpty(merged)) return null;
  const toRemove: ID[] = [];
  if (fill.type === "solid") {
    eachItem(doc, (item) => {
      if (item.type === "group" || !item.visible || item.locked) return;
      if (!sameSolid(paintedFill(item), fill) || paintedStroke(item).paint.type !== "none") return; // same fill + no stroke
      const mp = itemMultiPolygon(doc, item.id);
      if (mp.length && mpNonEmpty(safeOp(pc.intersection, merged, mp, []))) {
        merged = safeOp(pc.union, merged, mp, merged);
        toRemove.push(item.id);
      }
    });
  }
  const subs = ringsToCompound(merged);
  if (subs.length === 0) return null;
  if (toRemove.length) removeItems(doc, toRemove);
  const item = makeCompound(subs, { fill: cloneDeep(fill), stroke: cloneDeep(stroke) });
  item.evenOdd = true;
  item.name = "Blob";
  const layer = doc.layers.find((l) => l.id === layerId) ?? doc.layers[doc.layers.length - 1];
  layer.items.push(item);
  return item.id;
};

export type { MultiPolygon, Pair };
export type { Item };
