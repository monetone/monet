// ─────────────────────────────────────────────────────────────
// ops/path-edit — anchor / handle editing + live-shape → path conversion
// ─────────────────────────────────────────────────────────────

import { dist, type Point } from "../geometry/vec";
import { cloneDeep } from "../clone";
import { type Matrix, applyToPoint, applyToVector, invert } from "../geometry/matrix";
import { type Anchor, type PathGeometry, type PathHit, insertAnchor, nearest, removeAnchor, segments, transform as transformGeometry, widthOutlines } from "../geometry/path";
import { type ItemLocation, eachItem, findItem, parentTransform, selectionLeaves, worldTransformAt } from "../model/query";
import { localPaths } from "../model/shapes";
import { clipGeometry } from "./pathfinder";
import { defaultStroke, makeCompound, makeGroup, makePath, noPaint } from "./../model/factory";
import { LIVE_SHAPES, type Document, type ID, type Item, type PathItem } from "../model/types";
import { paintedFill, paintedStroke } from "../model/appearance";

/** Convert a live shape (rect/ellipse/polygon/star/line) into an editable path,
 * preserving id + all common attributes. No-op for path/compound/group/text/image. */
export const convertToPath = (doc: Document, id: ID): void => {
  const loc = findItem(doc, id);
  if (!loc) return;
  const it = loc.item;
  if (it.type === "path" || it.type === "compound" || it.type === "group" || it.type === "text" || it.type === "image") return;
  const paths = localPaths(it);
  if (!paths.length) return;
  const path: PathItem = {
    ...it,
    type: "path",
    geometry: cloneDeep(paths[0]),
  };
  loc.container[loc.index] = path;
};

/**
 * The transform a WORLD-baked result needs so that re-parenting it under
 * `ancestors` does not apply their transform a second time. `+ 0` normalizes the
 * signed zeros `invert` produces, so an un-nested result gets a clean identity.
 */
export const cancelAncestors = (ancestors: ItemLocation["ancestors"]): Matrix => {
  const m = invert(parentTransform(ancestors));
  return { a: m.a + 0, b: m.b + 0, c: m.c + 0, d: m.d + 0, e: m.e + 0, f: m.f + 0 };
};

const editablePaths = (doc: Document, id: ID): PathGeometry[] => {
  const loc = findItem(doc, id);
  if (loc?.item.type === "path") return [loc.item.geometry];
  return loc?.item.type === "compound" ? loc.item.subpaths : [];
};

export interface EditableAnchorRef {
  anchor: Anchor;
  geometry: PathGeometry;
  index: number;
  pathIndex: number;
}

/** Path/compound anchors in the same flat order used by anchorSelection. */
export const editableAnchorRefs = (doc: Document, id: ID): EditableAnchorRef[] =>
  editablePaths(doc, id).flatMap((geometry, pathIndex) =>
    geometry.anchors.map((anchor, index) => ({ anchor, geometry, index, pathIndex })),
  );

/** Nearest editable segment, retaining the compound subpath it belongs to. */
export const nearestEditableSegment = (doc: Document, id: ID, local: Point): (PathHit & { pathIndex: number }) | null => {
  let best: (PathHit & { pathIndex: number }) | null = null;
  editablePaths(doc, id).forEach((geometry, pathIndex) => {
    const hit = nearest(geometry, local);
    if (hit && (!best || hit.dist < best.dist)) best = { ...hit, pathIndex };
  });
  return best;
};

/** Translate the given anchor points (local-space delta). */
export const moveAnchors = (doc: Document, id: ID, indices: number[], ldx: number, ldy: number): void => {
  const anchors = editableAnchorRefs(doc, id);
  for (const i of indices) {
    const a = anchors[i]?.anchor;
    if (a) {
      a.point.x += ldx;
      a.point.y += ldy;
    }
  }
};

/** Set one handle of an anchor (local vector); mirror keeps the opposite symmetric. */
export const setHandle = (
  doc: Document,
  id: ID,
  index: number,
  which: "in" | "out",
  localVec: Point,
  mirror: boolean,
): void => {
  const a = editableAnchorRefs(doc, id)[index]?.anchor;
  if (!a) return;
  if (which === "in") {
    a.handleIn = { ...localVec };
    if (mirror) a.handleOut = { x: -localVec.x, y: -localVec.y };
  } else {
    a.handleOut = { ...localVec };
    if (mirror) a.handleIn = { x: -localVec.x, y: -localVec.y };
  }
};

/** Delete flat-indexed anchors; removes invalid subpaths, then the item if none remain. */
export const deleteAnchors = (doc: Document, id: ID, indices: number[]): void => {
  const loc = findItem(doc, id);
  if (!loc || (loc.item.type !== "path" && loc.item.type !== "compound")) return;
  const paths = loc.item.type === "path" ? [loc.item.geometry] : loc.item.subpaths;
  const anchors = editableAnchorRefs(doc, id);
  const byPath = new Map<number, number[]>();
  for (const flatIndex of new Set(indices)) {
    const ref = anchors[flatIndex];
    if (ref) byPath.set(ref.pathIndex, [...(byPath.get(ref.pathIndex) ?? []), ref.index]);
  }
  const next = paths.map((geometry, pathIndex) => {
    let result = geometry;
    for (const index of [...(byPath.get(pathIndex) ?? [])].sort((a, b) => b - a)) result = removeAnchor(result, index);
    return result;
  });
  if (loc.item.type === "path" && next[0].anchors.length >= 2) {
    loc.item.geometry = next[0];
  } else if (loc.item.type === "compound" && next.some((geometry) => geometry.anchors.length >= 2)) {
    loc.item.subpaths = next.filter((geometry) => geometry.anchors.length >= 2);
  } else {
    loc.container.splice(loc.index, 1);
  }
};

/** Whether an anchor carries handle(s) — i.e. is a smooth/curve point, not a corner. */
const hasHandles = (a: Anchor): boolean => !!(a.handleIn.x || a.handleIn.y || a.handleOut.x || a.handleOut.y);

// Smooth tangent for `index`: handleOut along (next − prev)/6, handleIn its mirror.
// Closed paths wrap; open-path endpoints clamp to themselves (one-sided tangent).
// Returns null when the tangent is degenerate (zero length ⇒ cannot smooth).
const smoothTangent = (g: PathGeometry, index: number): { hOut: Point; hIn: Point } | null => {
  const n = g.anchors.length;
  const prev = g.anchors[g.closed ? (index - 1 + n) % n : Math.max(0, index - 1)];
  const next = g.anchors[g.closed ? (index + 1) % n : Math.min(n - 1, index + 1)];
  const tx = (next.point.x - prev.point.x) / 6;
  const ty = (next.point.y - prev.point.y) / 6;
  if (!tx && !ty) return null;
  return { hOut: { x: tx, y: ty }, hIn: { x: -tx, y: -ty } };
};

/** Make an anchor a corner point (remove its handles). No-op if already a corner.
 *  This is the Convert-Anchor tool's CLICK action (one-way: smooth → corner). */
export const cornerAnchor = (doc: Document, id: ID, index: number): boolean => {
  const a = editableAnchorRefs(doc, id)[index]?.anchor;
  if (!a) return false;
  if (!hasHandles(a)) return false; // already a corner
  a.handleIn = { x: 0, y: 0 };
  a.handleOut = { x: 0, y: 0 };
  return true;
};

/** Make an anchor a smooth point (handles tangent to its neighbours). One-way.
 *  No-op (returns false) if it already has handles or the tangent is degenerate. */
export const smoothAnchor = (doc: Document, id: ID, index: number): boolean => {
  const ref = editableAnchorRefs(doc, id)[index];
  if (!ref) return false;
  const a = ref.anchor;
  if (!a || hasHandles(a)) return false; // missing, or already smooth
  const t = smoothTangent(ref.geometry, ref.index);
  if (!t) return false;
  a.handleOut = t.hOut;
  a.handleIn = t.hIn;
  return true;
};

/** Corner (remove handles) vs Smooth (synthesize handles). */
export type AnchorConvert = "corner" | "smooth";

/** Batch-convert the Direct-Selection anchor set to corner or smooth points.
 *  Returns true if any anchor actually changed. */
export const convertAnchors = (doc: Document, anchorSel: Record<ID, number[]>, target: AnchorConvert): boolean => {
  let changed = false;
  for (const id of Object.keys(anchorSel)) {
    for (const index of anchorSel[id] ?? []) {
      const did = target === "corner" ? cornerAnchor(doc, id, index) : smoothAnchor(doc, id, index);
      if (did) changed = true;
    }
  }
  return changed;
};

/** Would converting any selected anchor actually change it? This mirrors the exact
 *  mutation set of {@link convertAnchors} — corner ⇒ the anchor has handles; smooth ⇒
 *  it has none AND a non-degenerate tangent (so smoothAnchor will really act). Lets a
 *  command skip an empty transaction / spurious dirty flag with no false positives. */
export const anchorsNeedConvert = (doc: Document, anchorSel: Record<ID, number[]>, target: AnchorConvert): boolean => {
  for (const id of Object.keys(anchorSel)) {
    const anchors = editableAnchorRefs(doc, id);
    for (const index of anchorSel[id] ?? []) {
      const ref = anchors[index];
      if (!ref) continue;
      const a = ref.anchor;
      const needs = target === "corner" ? hasHandles(a) : !hasHandles(a) && smoothTangent(ref.geometry, ref.index) !== null;
      if (needs) return true;
    }
  }
  return false;
};

const cloneAnchor = (a: Anchor): Anchor => ({
  point: { ...a.point },
  handleIn: { ...a.handleIn },
  handleOut: { ...a.handleOut },
});

/** Insert an anchor into a path or one compound subpath. */
export const insertAnchorAt = (doc: Document, id: ID, pathIndex: number, segIndex: number, t: number): void => {
  const loc = findItem(doc, id);
  if (!loc) return;
  if (loc.item.type === "path") {
    if (pathIndex === 0) loc.item.geometry = insertAnchor(loc.item.geometry, segIndex, t);
  } else if (loc.item.type === "compound" && loc.item.subpaths[pathIndex]) {
    loc.item.subpaths[pathIndex] = insertAnchor(loc.item.subpaths[pathIndex], segIndex, t);
  }
};

/**
 * Cut a path or compound subpath at (segIndex, t). A closed geometry opens at
 * the cut; an open geometry splits into two paths/subpaths.
 */
export const cutPathAt = (doc: Document, id: ID, segIndex: number, t: number, pathIndex = 0): void => {
  const loc = findItem(doc, id);
  if (!loc || (loc.item.type !== "path" && loc.item.type !== "compound")) return;
  const item = loc.item;
  const geometry = item.type === "path" ? (pathIndex === 0 ? item.geometry : null) : item.subpaths[pathIndex];
  if (!geometry) return;
  const wasClosed = geometry.closed;
  const split = insertAnchor(geometry, segIndex, t);
  const anchors = split.anchors;
  const k = (segIndex + 1) % anchors.length;

  if (wasClosed) {
    const reordered = [...anchors.slice(k), ...anchors.slice(0, k)].map(cloneAnchor);
    const tail = cloneAnchor(reordered[0]);
    reordered[0] = { ...reordered[0], handleIn: { x: 0, y: 0 } };
    tail.handleOut = { x: 0, y: 0 };
    const opened = { closed: false, anchors: [...reordered, tail] };
    if (item.type === "path") item.geometry = opened;
    else item.subpaths[pathIndex] = opened;
  } else {
    const first = anchors.slice(0, k + 1).map(cloneAnchor);
    const second = anchors.slice(k).map(cloneAnchor);
    if (item.type === "compound") {
      item.subpaths.splice(pathIndex, 1, ...[first, second].filter((part) => part.length >= 2).map((part) => ({ closed: false, anchors: part })));
    } else {
      if (first.length >= 2) item.geometry = { closed: false, anchors: first };
      if (second.length < 2) return;
      const p2 = makePath({ closed: false, anchors: second }, { fill: cloneDeep(item.fill), stroke: cloneDeep(item.stroke) });
      p2.transform = { ...item.transform };
      loc.container.splice(loc.index + 1, 0, p2);
    }
  }
};

/** Laplacian smoothing of anchors within `radius` of a local-space center. */
export const smoothNear = (doc: Document, id: ID, center: Point, radius: number, amount = 0.5): void => {
  for (const geometry of editablePaths(doc, id)) {
    const A = geometry.anchors;
    const n = A.length;
    if (n < 3) continue;
    const next: Point[] = A.map((a, i) => {
      const d = dist(a.point, center);
      if (d >= radius) return a.point;
      const t = (1 - d / radius) * amount;
      const prev = A[geometry.closed ? (i - 1 + n) % n : Math.max(0, i - 1)].point;
      const nxt = A[geometry.closed ? (i + 1) % n : Math.min(n - 1, i + 1)].point;
      const avg = { x: (prev.x + nxt.x) / 2, y: (prev.y + nxt.y) / 2 };
      return { x: a.point.x + (avg.x - a.point.x) * t, y: a.point.y + (avg.y - a.point.y) * t };
    });
    A.forEach((a, i) => (a.point = next[i]));
  }
};

const anchorToWorld = (a: Anchor, m: Parameters<typeof applyToPoint>[0]): Anchor => ({
  point: applyToPoint(m, a.point),
  handleIn: applyToVector(m, a.handleIn),
  handleOut: applyToVector(m, a.handleOut),
});

/** Selection flattened to leaf ids in document order, with duplicates removed. */
export const leafIds = (doc: Document, ids: Iterable<ID>): ID[] => {
  return selectionLeaves(doc, ids).map((item) => item.id);
};

/**
 * Join selected open paths: a single open path is closed; two or more are
 * concatenated (in world space) into one open path, connecting consecutive
 * paths at their nearest endpoints. Returns the resulting path id.
 */
const JOIN_EPS = 1e-4;
const reverseAnchors = (as: Anchor[]): Anchor[] =>
  as.slice().reverse().map((a) => ({ point: a.point, handleIn: a.handleOut, handleOut: a.handleIn }));

export const joinPaths = (doc: Document, ids: ID[]): ID | null => {
  const locs = ids
    .map((id) => findItem(doc, id))
    .filter((l): l is NonNullable<typeof l> => !!l && l.item.type === "path" && !(l.item as PathItem).geometry.closed);
  if (locs.length === 1) {
    const geo = (locs[0].item as PathItem).geometry;
    const as = geo.anchors;
    // Coincident endpoints → merge into one corner anchor before closing
    // (Illustrator joins two points at the same spot into a single anchor).
    if (as.length >= 2 && dist(as[0].point, as[as.length - 1].point) < JOIN_EPS) {
      as[0].handleIn = as[as.length - 1].handleIn;
      as.pop();
    }
    geo.closed = true;
    return locs[0].item.id;
  }
  if (locs.length < 2) return null;

  // World-space anchor lists.
  let chain = (locs[0].item as PathItem).geometry.anchors.map((a) => anchorToWorld(a, worldTransformAt(locs[0])));
  // Orient the FIRST path so its tail is the endpoint nearest the next path —
  // otherwise a path drawn "backwards" joins from its far end (crossing connector).
  const next1 = (locs[1].item as PathItem).geometry.anchors.map((a) => anchorToWorld(a, worldTransformAt(locs[1])));
  const headBest = Math.min(dist(chain[0].point, next1[0].point), dist(chain[0].point, next1[next1.length - 1].point));
  const tailBest = Math.min(dist(chain[chain.length - 1].point, next1[0].point), dist(chain[chain.length - 1].point, next1[next1.length - 1].point));
  if (headBest < tailBest) chain = reverseAnchors(chain);

  for (let i = 1; i < locs.length; i++) {
    let next = (locs[i].item as PathItem).geometry.anchors.map((a) => anchorToWorld(a, worldTransformAt(locs[i])));
    const tail = chain[chain.length - 1].point;
    // Orient `next` so its nearer endpoint connects to the chain tail.
    const dHead = dist(tail, next[0].point);
    const dTail = dist(tail, next[next.length - 1].point);
    if (dTail < dHead) next = reverseAnchors(next);
    // Coincident shared endpoint → merge into a single anchor (no zero-length seg).
    if (next.length && dist(tail, next[0].point) < JOIN_EPS) {
      chain[chain.length - 1].handleOut = next[0].handleOut;
      next = next.slice(1);
    }
    chain = chain.concat(next);
  }

  const container = locs[0].container;
  const insertAt = locs[0].index;
  const style = locs[0].item;
  for (const l of locs) {
    const idx = l.container.indexOf(l.item);
    if (idx >= 0) l.container.splice(idx, 1);
  }
  const joined = makePath({ closed: false, anchors: chain }, { fill: cloneDeep(style.fill), stroke: cloneDeep(style.stroke) });
  // `chain` is in WORLD space but the item lands inside locs[0]'s container,
  // which may sit under transformed ancestors — cancel them, or the ancestor
  // transform is applied a second time and the artwork jumps.
  joined.transform = cancelAncestors(locs[0].ancestors);
  container.splice(Math.min(insertAt, container.length), 0, joined);
  return joined.id;
};

/**
 * Object ▸ Path ▸ Outline Stroke — convert each selected object's stroke into a
 * FILLED compound path (the stroke outline). The original fill (if any) is kept
 * as a separate path and the two are grouped, matching Illustrator. Returns the
 * new item ids. Objects with no stroke are left untouched.
 */
export const outlineStroke = (doc: Document, ids: ID[]): ID[] => {
  const newIds: ID[] = [];
  for (const id of leafIds(doc, ids)) {
    const loc = findItem(doc, id);
    if (!loc || loc.item.type === "group") continue;
    const item = loc.item;
    const fill = paintedFill(item);
    const stroke = paintedStroke(item);
    if (stroke.paint.type === "none" || stroke.width <= 0) continue; // nothing to outline
    const geos = localPaths(item);
    if (geos.length === 0) continue;

    // Align Stroke: SVG strokes straddle the path, so the renderer emulates
    // inside/outside by drawing a 2x-width stroke and clipping it TO the shape
    // (inside) or masking it OUT of it (outside). Outline Stroke has to produce
    // the SAME paint, or converting a stroke to outlines moves every edge by
    // half the stroke width relative to what was on screen.
    const align = stroke.align;
    const widthFor = align === "center" ? stroke.width : stroke.width * 2;
    const profile = stroke.widthProfile ?? new Array(geos.reduce((n, g) => n + g.anchors.length, 0)).fill(1);
    let outline = widthOutlines(geos, profile, widthFor);
    if (outline.length === 0) continue;
    if (align !== "center") {
      const clipped = clipGeometry(outline, geos, align === "inside" ? "intersect" : "subtract");
      // A degenerate clip (open path, self-intersecting outline) would silently
      // delete the stroke; keep the centred ribbon rather than losing the paint.
      if (clipped.length) outline = clipped;
    }

    const pieces: Item[] = [];
    if (fill.type !== "none") {
      const fillItem = makeCompound(geos.map((g) => cloneDeep(g)), { fill: cloneDeep(fill), stroke: defaultStroke(noPaint()), name: item.name });
      fillItem.transform = { ...item.transform };
      fillItem.opacity = item.opacity;
      if (item.evenOdd) fillItem.evenOdd = true;
      pieces.push(fillItem);
    }
    const outlineItem = makeCompound(outline, { fill: cloneDeep(stroke.paint), stroke: defaultStroke(noPaint()), name: "Outline" });
    outlineItem.transform = { ...item.transform };
    outlineItem.opacity = item.opacity;
    outlineItem.evenOdd = true;
    pieces.push(outlineItem);

    if (pieces.length === 1) {
      pieces[0].blendMode = item.blendMode; // opacity is already copied onto the piece above
      loc.container.splice(loc.index, 1, pieces[0]);
      newIds.push(pieces[0].id);
    } else {
      // Carry the source's opacity + blend mode on the GROUP so the expanded
      // result composites identically; keep the children neutral, otherwise the
      // opacity would apply twice.
      pieces.forEach((p) => (p.opacity = 1));
      const grp = makeGroup(pieces, { name: item.name });
      grp.opacity = item.opacity;
      grp.blendMode = item.blendMode;
      loc.container.splice(loc.index, 1, grp);
      newIds.push(grp.id);
    }
  }
  return newIds;
};

/**
 * Object ▸ Expand Appearance — flatten a multi-fill / multi-stroke appearance
 * stack into REAL objects: one path per appearance entry, stacked back-to-front
 * in a group, each carrying that entry's paint (a stroke entry becomes its
 * outline, filled with the stroke's paint), its own opacity / blend mode /
 * effects. Objects with no explicit stack are left alone — plain fill+stroke is
 * Object ▸ Expand's job, not this one. Returns the ids of the expanded results.
 */
export const expandAppearance = (doc: Document, ids: ID[]): ID[] => {
  const newIds: ID[] = [];
  for (const id of leafIds(doc, ids)) {
    const loc = findItem(doc, id);
    if (!loc || loc.item.type === "group") continue;
    const item = loc.item;
    const entries = item.appearance?.entries ?? [];
    if (!entries.length) continue; // nothing live to flatten
    const geos = localPaths(item);
    if (!geos.length) continue;

    // ensureAppearanceStack COPIES item.effects into scope:"object" placements
    // and leaves item.effects in place, so the two sources overlap — take the
    // placements when there are any, else the legacy item.effects, never both.
    const placed = (item.appearance?.effectPlacements ?? []).filter((p) => p.scope === "object").map((p) => cloneDeep(p.effect));
    const objectEffects = placed.length ? placed : cloneDeep(item.effects ?? []);

    // Entries are stored back-to-front, which is also the child order we want.
    const pieces: Item[] = [];
    for (const entry of entries) {
      if (entry.visible === false) continue;
      let piece: Item | null = null;
      if (entry.kind === "fill") {
        if (entry.paint.type === "none") continue;
        piece = makeCompound(geos.map((g) => cloneDeep(g)), { fill: cloneDeep(entry.paint), stroke: defaultStroke(noPaint()), name: item.name });
        if (item.evenOdd) piece.evenOdd = true;
      } else {
        const s = entry.stroke;
        if (s.paint.type === "none" || s.width <= 0) continue;
        const profile = s.widthProfile ?? new Array(geos.reduce((n, g) => n + g.anchors.length, 0)).fill(1);
        const outline = widthOutlines(geos, profile, s.width);
        if (!outline.length) continue;
        piece = makeCompound(outline, { fill: cloneDeep(s.paint), stroke: defaultStroke(noPaint()), name: "Outline" });
        piece.evenOdd = true;
      }
      piece.transform = { ...item.transform };
      piece.opacity = entry.opacity ?? 1;
      if (entry.blendMode) piece.blendMode = entry.blendMode;
      const entryEffects = [
        ...(entry.effects ?? []),
        ...(item.appearance?.effectPlacements ?? []).filter((p) => p.scope === "entry" && p.entryId === entry.id).map((p) => p.effect),
      ];
      if (entryEffects.length) piece.effects = cloneDeep(entryEffects);
      pieces.push(piece);
    }
    if (!pieces.length) continue;

    const grp = makeGroup(pieces, { name: item.name });
    grp.opacity = item.opacity;
    grp.blendMode = item.blendMode;
    if (objectEffects.length) grp.effects = objectEffects;
    loc.container.splice(loc.index, 1, grp);
    newIds.push(grp.id);
  }
  return newIds;
};

/**
 * Object ▸ Expand — turn live appearance into plain editable geometry. Recurses
 * into selected groups; for each leaf object: a stroked one is outlined (its fill
 * + stroke become filled paths grouped together, via Outline Stroke); an
 * un-stroked live shape (rect/ellipse/polygon/star/line) is converted to an
 * editable path; anything already expanded (a plain path, or text/image we can't
 * expand here) is left untouched. Mutates in place; returns the expanded ids.
 */
export const expand = (doc: Document, ids: ID[]): ID[] => {
  const result: ID[] = [];
  for (const id of leafIds(doc, ids)) {
    const loc = findItem(doc, id);
    if (!loc) continue;
    const it = loc.item;
    const hasGeometry = it.type === "path" || it.type === "compound" || LIVE_SHAPES.includes(it.type);
    const stroke = paintedStroke(it);
    if (hasGeometry && stroke.paint.type !== "none" && stroke.width > 0) {
      const out = outlineStroke(doc, [id]);
      result.push(...(out.length ? out : [id]));
    } else if (LIVE_SHAPES.includes(it.type)) {
      convertToPath(doc, id);
      result.push(id);
    } else {
      result.push(id);
    }
  }
  return result;
};

/** Object ▸ Compound Path ▸ Make (⌘8) — combine ≥2 selected paths/shapes into ONE
 * compound path. Overlapping regions become holes (even-odd fill), and the result
 * adopts the BACKMOST object's paint/opacity — matching Illustrator. Curves are
 * preserved (geometry is baked into world space, not flattened). Returns the new id. */
export const makeCompoundPath = (doc: Document, ids: ID[]): ID | null => {
  const idset = new Set(ids);
  // Only items that actually contribute path geometry (skip group/text/image).
  const locs = ids
    .map((id) => findItem(doc, id))
    .filter((l): l is ItemLocation => !!l && localPaths(l.item).length > 0);
  if (locs.length < 2) return null;

  // Backmost = first contributing item in document (z) order — it lends its paint.
  const valid = new Set(locs.map((l) => l.item));
  let backLoc: ItemLocation | undefined;
  eachItem(doc, (item, loc) => {
    if (valid.has(item)) {
      backLoc = loc;
      return false;
    }
  });
  if (!backLoc) return null;
  const back = backLoc;
  const bm = back.item;
  if (bm.type === "group") return null; // unreachable (groups excluded above); narrows for paint

  // Collect every subpath in world space (no flatten — beziers survive).
  const subpaths: PathGeometry[] = [];
  for (const l of locs) {
    const m = worldTransformAt(l);
    for (const g of localPaths(l.item)) subpaths.push(transformGeometry(g, m));
  }

  const compound = makeCompound(subpaths, {
    fill: cloneDeep(bm.fill),
    stroke: cloneDeep(bm.stroke),
    name: "Compound Path",
  });
  compound.opacity = bm.opacity;
  compound.evenOdd = true; // overlaps → holes (the donut), à la Illustrator
  // Subpaths were baked into WORLD space above, but the compound is spliced into
  // the backmost item's container — cancel that container's ancestor transform
  // so it is not applied twice.
  compound.transform = cancelAncestors(back.ancestors);

  // Replace the backmost in place (keeps its z), then remove the other sources.
  back.container.splice(back.container.indexOf(bm), 1, compound);
  for (const l of locs) {
    if (l.item === bm) continue;
    const i = l.container.indexOf(l.item);
    if (i >= 0) l.container.splice(i, 1);
  }
  return compound.id;
};

/** Object ▸ Compound Path ▸ Release (⌥⌘8) — split each selected compound back into
 * its component paths; every released path keeps the compound's appearance and
 * transform (Illustrator does not restore the originals' individual colours). */
export const releaseCompoundPath = (doc: Document, ids: ID[]): ID[] => {
  const newIds: ID[] = [];
  for (const id of ids) {
    const loc = findItem(doc, id);
    if (!loc || loc.item.type !== "compound") continue;
    const comp = loc.item;
    const pieces: Item[] = comp.subpaths.map((sp, k) => {
      const p = makePath(
        { closed: sp.closed, anchors: sp.anchors.map((a) => cloneDeep(a)) },
        {
          fill: cloneDeep(comp.fill),
          stroke: cloneDeep(comp.stroke),
          name: comp.subpaths.length > 1 ? `${comp.name} ${k + 1}` : comp.name,
        },
      );
      p.transform = { ...comp.transform };
      p.opacity = comp.opacity;
      return p;
    });
    loc.container.splice(loc.index, 1, ...pieces);
    for (const p of pieces) newIds.push(p.id);
  }
  return newIds;
};

/** Insert an on-curve anchor at the midpoint (t=0.5) of EVERY segment, leaving the
 * path shape unchanged (de Casteljau split is lossless). Closed paths also split
 * their closing segment. Inserts back-to-front so earlier segment indices stay valid. */
const densifyGeometry = (g: PathGeometry): PathGeometry => {
  let out = g;
  for (let s = segments(g).length - 1; s >= 0; s--) out = insertAnchor(out, s, 0.5);
  return out;
};

/** Object ▸ Path ▸ Add Anchor Points — adds one anchor between every pair of
 * existing anchors on each selected path/compound WITHOUT changing the shape
 * (matches Illustrator). Modifies geometry in place; returns the ids it touched. */
export const addAnchorPoints = (doc: Document, ids: ID[]): ID[] => {
  const done: ID[] = [];
  for (const id of ids) {
    const loc = findItem(doc, id);
    if (!loc) continue;
    const it = loc.item;
    if (it.type === "path") {
      it.geometry = densifyGeometry(it.geometry);
      done.push(id);
    } else if (it.type === "compound") {
      it.subpaths = it.subpaths.map(densifyGeometry);
      done.push(id);
    }
  }
  return done;
};

export type AverageAxis = "horizontal" | "vertical" | "both";

/** Object ▸ Path ▸ Average — move every SELECTED anchor point to the average of
 * the selection (Illustrator's ⌥⌘J). Axis "horizontal" lines them up on a
 * horizontal line (shared average Y, own X); "vertical" → shared average X, own Y;
 * "both" → all collapse onto the single average point. Averaging is done in WORLD
 * space so anchors across differently-transformed paths align correctly; only the
 * on-curve point moves (relative handles ride along). Needs ≥2 anchors. */
export const averageAnchors = (doc: Document, anchorSel: Record<ID, number[]>, axis: AverageAxis): void => {
  const refs: { anchor: Anchor; world: Point; toLocal: Matrix }[] = [];
  for (const id of Object.keys(anchorSel)) {
    const loc = findItem(doc, id);
    if (!loc || loc.item.type !== "path") continue;
    const w = worldTransformAt(loc);
    const w2l = invert(w);
    for (const idx of anchorSel[id]) {
      const a = loc.item.geometry.anchors[idx];
      if (a) refs.push({ anchor: a, world: applyToPoint(w, a.point), toLocal: w2l });
    }
  }
  if (refs.length < 2) return;
  const avgX = refs.reduce((s, r) => s + r.world.x, 0) / refs.length;
  const avgY = refs.reduce((s, r) => s + r.world.y, 0) / refs.length;
  for (const r of refs) {
    const nw = {
      x: axis === "horizontal" ? r.world.x : avgX, // horizontal keeps own X
      y: axis === "vertical" ? r.world.y : avgY, // vertical keeps own Y
    };
    r.anchor.point = applyToPoint(r.toLocal, nw);
  }
};

export type { Item };
