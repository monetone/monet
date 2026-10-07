// ─────────────────────────────────────────────────────────────
// ops/blend — Object ▸ Blend ▸ Make (Illustrator parity, Specified Steps)
// ─────────────────────────────────────────────────────────────
// Builds a blend between ≥2 selected objects: between each consecutive pair (in
// stacking order) it inserts `steps` intermediate shapes whose geometry and
// appearance (fill / stroke colour / stroke width / opacity) are linearly
// interpolated from one object to the next. The originals + the interpolated
// steps are wrapped in a single "Blend" group, replacing the selection — exactly
// the visual result of Illustrator's Object ▸ Blend ▸ Make with Specified Steps.
//
// Geometry: when two paths have the same number of anchors they interpolate
// point-by-point (handles ride along, so curves blend smoothly); when the counts
// differ both are resampled to a common number of evenly arc-length-spaced points
// first (as Illustrator does to make mismatched shapes blendable).

import { cloneDeep } from "../clone";
import { type Anchor, type PathGeometry, anchor, flatten, transform as transformGeometry } from "../geometry/path";
import { type Point, lerp } from "../geometry/vec";
import { mul } from "../geometry/matrix";
import { mix } from "../color";
import { type ItemLocation, eachItem, worldTransformAt } from "../model/query";
import { localPaths } from "../model/shapes";
import { makeGroup, makePath } from "../model/factory";
import type { Document, GroupItem, ID, Item, Paint, Stroke } from "../model/types";

export interface BlendOptions {
  /** Intermediate shapes inserted between each consecutive pair. Default 8. */
  steps?: number;
}

/**
 * Blend spacing (Object ▸ Blend ▸ Blend Options). "smooth" auto-picks a step count
 * per consecutive pair so the colour transition is imperceptible (à la Illustrator's
 * Smooth Color); "steps" inserts a fixed number of intermediate objects.
 */
export type BlendSpacing = { mode: "smooth" } | { mode: "steps"; steps: number };

interface Snapshot {
  geom: PathGeometry; // baked into world space
  fill: Paint;
  stroke: Stroke;
  opacity: number;
}

const mixPaint = (a: Paint, b: Paint, t: number): Paint =>
  a.type === "solid" && b.type === "solid"
    ? { type: "solid", color: mix(a.color, b.color, t) }
    : cloneDeep(t < 0.5 ? a : b);

const mixStroke = (a: Stroke, b: Stroke, t: number): Stroke => ({
  ...cloneDeep(a),
  paint: mixPaint(a.paint, b.paint, t),
  width: a.width + (b.width - a.width) * t,
});

/** Resample a (closed) path outline to `n` points spaced evenly by arc length. */
const resample = (geom: PathGeometry, n: number): Point[] => {
  let poly = flatten(geom, 0.4);
  if (poly.length > 1) {
    const f = poly[0];
    const l = poly[poly.length - 1];
    if (Math.hypot(f.x - l.x, f.y - l.y) < 1e-6) poly = poly.slice(0, -1); // drop the closing seam dup
  }
  const m = poly.length;
  if (m === 0) return [];
  if (m === 1) return Array.from({ length: n }, () => ({ ...poly[0] }));

  const segLen: number[] = [];
  let total = 0;
  for (let i = 0; i < m; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % m];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    segLen.push(L);
    total += L;
  }
  const out: Point[] = [];
  for (let k = 0; k < n; k++) {
    let d = (k / n) * total;
    let i = 0;
    while (i < m && d > segLen[i]) {
      d -= segLen[i];
      i++;
    }
    if (i >= m) i = m - 1;
    const a = poly[i];
    const b = poly[(i + 1) % m];
    const f = segLen[i] > 1e-12 ? d / segLen[i] : 0;
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  return out;
};

/** Aligned anchor arrays for two paths (resampled to a common count if needed). */
const correspond = (a: PathGeometry, b: PathGeometry): { a: Anchor[]; b: Anchor[]; closed: boolean } => {
  if (a.anchors.length === b.anchors.length) return { a: a.anchors, b: b.anchors, closed: a.closed };
  const n = Math.max(a.anchors.length, b.anchors.length);
  return { a: resample(a, n).map((p) => anchor(p)), b: resample(b, n).map((p) => anchor(p)), closed: a.closed || b.closed };
};

const interpolate = (a: Anchor[], b: Anchor[], closed: boolean, t: number): PathGeometry => ({
  closed,
  anchors: a.map((an, i) => ({
    point: lerp(an.point, b[i].point, t),
    handleIn: lerp(an.handleIn, b[i].handleIn, t),
    handleOut: lerp(an.handleOut, b[i].handleOut, t),
  })),
});

/** The `steps` intermediate path items interpolated between two consecutive ends. */
const interpolatedSteps = (A: Snapshot, B: Snapshot, steps: number): Item[] => {
  const { a, b, closed } = correspond(A.geom, B.geom);
  const out: Item[] = [];
  for (let k = 1; k <= steps; k++) {
    const t = k / (steps + 1);
    const p = makePath(interpolate(a, b, closed, t), {
      fill: mixPaint(A.fill, B.fill, t),
      stroke: mixStroke(A.stroke, B.stroke, t),
      name: "Path",
    });
    p.opacity = A.opacity + (B.opacity - A.opacity) * t;
    out.push(p);
  }
  return out;
};

/**
 * Illustrator "Smooth Color" spacing: choose the step count from the largest
 * per-channel (r/g/b, 0-255) difference between two solid fills — so a black→white
 * blend gets the full ~255 smooth steps and near-identical colours get only a few.
 * Falls back to the default density when there is no solid-fill colour to measure.
 */
const colorSteps = (a: Paint, b: Paint): number => {
  if (a.type === "solid" && b.type === "solid") {
    const d = Math.max(Math.abs(a.color.r - b.color.r), Math.abs(a.color.g - b.color.g), Math.abs(a.color.b - b.color.b));
    return Math.max(1, Math.min(255, Math.round(d)));
  }
  return 8;
};

const stepsBetween = (A: Snapshot, B: Snapshot, spacing: BlendSpacing): number =>
  spacing.mode === "steps" ? Math.max(1, Math.round(spacing.steps)) : colorSteps(A.fill, B.fill);

/**
 * Object ▸ Blend ▸ Make. Returns the new blend group's id, or null when fewer
 * than two selected objects carry path geometry.
 */
export const blend = (doc: Document, ids: ID[], options: BlendOptions = {}): ID | null => {
  const steps = Math.max(1, Math.round(options.steps ?? 8));

  // Illustrator lets you add an object to an EXISTING blend. A blend group has
  // no outline of its own, so it would otherwise be skipped below and the whole
  // command would silently no-op; release it back to its key objects first and
  // blend the flattened run.
  const idset = new Set(ids);
  const existingBlends: ID[] = [];
  eachItem(doc, (item) => {
    if (idset.has(item.id) && item.type === "group" && item.blendKeyIds?.length) existingBlends.push(item.id);
  });
  if (existingBlends.length) {
    for (const id of releaseBlend(doc, existingBlends)) idset.add(id);
    for (const id of existingBlends) idset.delete(id);
  }

  // Selected path-bearing objects in stacking order (eachItem walks bottom→top).
  const ends: { loc: ItemLocation; snap: Snapshot }[] = [];
  eachItem(doc, (item, loc) => {
    if (!idset.has(item.id)) return;
    const paths = localPaths(item);
    if (paths.length === 0) return; // group / text / image carry no single outline
    ends.push({
      loc,
      snap: {
        geom: transformGeometry(paths[0], worldTransformAt(loc)),
        fill: cloneDeep(item.fill),
        stroke: cloneDeep(item.stroke),
        opacity: item.opacity,
      },
    });
  });
  if (ends.length < 2) return null;

  const worldPath = (s: Snapshot): Item => {
    const p = makePath(cloneDeep(s.geom), { fill: cloneDeep(s.fill), stroke: cloneDeep(s.stroke), name: "Path" });
    p.opacity = s.opacity;
    return p;
  };

  const children: Item[] = [];
  const keyIds: ID[] = []; // the baked originals, so Blend ▸ Release can restore them
  for (let i = 0; i < ends.length; i++) {
    const original = worldPath(ends[i].snap); // baked original end
    keyIds.push(original.id);
    children.push(original);
    if (i === ends.length - 1) break;
    children.push(...interpolatedSteps(ends[i].snap, ends[i + 1].snap, steps));
  }

  const group = makeGroup(children, { name: "Blend" });
  group.blendKeyIds = keyIds;
  // Replace the topmost original (front of the stack) with the blend group, and
  // remove the other originals — the blend takes the frontmost object's z-order.
  const top = ends[ends.length - 1].loc;
  for (const { loc } of ends) {
    if (loc.item === top.item) continue;
    const idx = loc.container.indexOf(loc.item);
    if (idx >= 0) loc.container.splice(idx, 1);
  }
  const topIdx = top.container.indexOf(top.item);
  top.container.splice(topIdx, 1, group);
  return group.id;
};

/**
 * Object ▸ Blend ▸ Release — undo a blend, restoring its original key objects in
 * place (same container + z-position) and discarding the interpolated steps.
 * Operates on each selected Blend group (a group carrying `blendKeyIds`). Returns
 * the ids of the restored key objects.
 */
export const releaseBlend = (doc: Document, ids: Iterable<ID>): ID[] => {
  const idset = new Set(ids);
  // Collect the targets first — we splice their containers afterwards so we never
  // mutate a container while eachItem is still walking it.
  const targets: { container: Item[]; group: GroupItem }[] = [];
  eachItem(doc, (item, loc) => {
    if (idset.has(item.id) && item.type === "group" && item.blendKeyIds && item.blendKeyIds.length) {
      targets.push({ container: loc.container, group: item });
    }
  });
  const restored: ID[] = [];
  for (const { container, group } of targets) {
    const idx = container.indexOf(group);
    if (idx < 0) continue;
    const keySet = new Set(group.blendKeyIds);
    const keys = group.children.filter((c) => keySet.has(c.id)); // originals, in order
    if (keys.length < 2) continue; // malformed/legacy blend: never replace live artwork with nothing
    // The keys live in the GROUP's space; leaving the group means composing its
    // transform into each of them, or every move/rotate/scale the user applied
    // to the blend is silently discarded on release.
    for (const k of keys) k.transform = mul(group.transform, k.transform);
    container.splice(idx, 1, ...keys);
    restored.push(...keys.map((k) => k.id));
  }
  return restored;
};

/**
 * Object ▸ Blend ▸ Reverse Front to Back — reverse the paint (z) order of the
 * objects inside each selected Blend group, so the front-most becomes back-most.
 * The spine and the key objects are unchanged (only their stacking flips), and
 * blendKeyIds is preserved so Release still restores them. Returns the affected
 * Blend group ids.
 */
export const reverseBlendFrontToBack = (doc: Document, ids: Iterable<ID>): ID[] => {
  const idset = new Set(ids);
  const groups: GroupItem[] = [];
  eachItem(doc, (item) => {
    if (idset.has(item.id) && item.type === "group" && item.blendKeyIds && item.blendKeyIds.length) {
      groups.push(item);
    }
  });
  for (const g of groups) g.children.reverse(); // in place; child set + blendKeyIds unchanged
  return groups.map((g) => g.id);
};

/** A blend group's key path as a Snapshot — its baked geometry / appearance. */
const keySnapshot = (it: Item): Snapshot | null =>
  it.type === "path" ? { geom: it.geometry, fill: it.fill, stroke: it.stroke, opacity: it.opacity } : null;

/**
 * Object ▸ Blend ▸ Blend Options — re-space each selected Blend group with a new
 * spacing (Smooth Color or Specified Steps), rebuilding the interpolated steps
 * between its key objects. The key objects (their ids), `blendKeyIds`, the group id
 * and its z-position are preserved, so Blend ▸ Release still restores the originals.
 * Returns the affected Blend group ids.
 */
export const reblend = (doc: Document, ids: Iterable<ID>, spacing: BlendSpacing): ID[] => {
  const idset = new Set(ids);
  const groups: GroupItem[] = [];
  eachItem(doc, (item) => {
    if (idset.has(item.id) && item.type === "group" && item.blendKeyIds && item.blendKeyIds.length) {
      groups.push(item);
    }
  });
  for (const g of groups) {
    const keySet = new Set(g.blendKeyIds);
    // Fresh clones of the baked key paths (ids preserved → blendKeyIds stays valid),
    // in stacking order; cloning keeps the rebuild off the live draft instances.
    const keys = g.children.filter((c) => keySet.has(c.id)).map(cloneDeep);
    const snaps = keys.map(keySnapshot);
    if (keys.length < 2 || snaps.some((s) => s === null)) continue;
    const children: Item[] = [];
    for (let i = 0; i < keys.length; i++) {
      children.push(keys[i]);
      if (i === keys.length - 1) break;
      const A = snaps[i] as Snapshot;
      const B = snaps[i + 1] as Snapshot;
      children.push(...interpolatedSteps(A, B, stepsBetween(A, B, spacing)));
    }
    g.children = children;
  }
  return groups.map((g) => g.id);
};
