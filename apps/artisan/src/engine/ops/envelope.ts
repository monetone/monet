// ─────────────────────────────────────────────────────────────
// ops/envelope — Object ▸ Envelope Distort (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// An envelope is a group whose CHILDREN are regenerated distorted artwork while
// the undistorted originals live on in `envelope.sourceItems`. Two envelope
// kinds, matching Illustrator's two non-mesh commands:
//
//   Make with Warp        bend the contents inside one shared bounding box with
//                         the Warp styles (arc/flag/wave/bulge/rise…).
//   Make with Top Object  the frontmost selected object becomes the envelope
//                         OUTLINE and the rest are mapped into it.
//
// "Make with Top Object" uses a **Coons patch**: the envelope outline is split at
// its four extreme points into top / right / bottom / left boundary curves, and a
// source point at normalized (u,v) inside the contents' bounding box lands at
//   S(u,v) = (1−v)·T(u) + v·B(u) + (1−u)·L(v) + u·R(v) − bilinear(corners)
// — the standard bilinearly-blended Coons surface, which reproduces the boundary
// exactly (a rectangular envelope is the identity) and bends the interior with it.
//
// Because the source is kept, changing the envelope always re-derives from the
// originals: distortion never compounds. Release restores them; Expand just drops
// the metadata and keeps the distorted art.

import { cloneDeep } from "../clone";
import { type Rect, union } from "../geometry/bbox";
import { type PathGeometry, bounds as pathBounds, flatten, transform as transformGeometry } from "../geometry/path";
import { IDENTITY, type Matrix, mul } from "../geometry/matrix";
import { type Point } from "../geometry/vec";
import { carryItemState, makeGroup, makePath } from "../model/factory";
import { eachItem, findItem, worldTransformAt } from "../model/query";
import { localPaths } from "../model/shapes";
import type { Document, EnvelopeObject, GroupItem, ID, Item, WarpStyle } from "../model/types";
import { group as groupItems, ungroup } from "./group";
import { warp } from "./warp";

export interface EnvelopeWarpOptions {
  style: WarpStyle;
  /** Bend amount, −1..1 (Illustrator's −100%..100%). */
  bend: number;
}

const asEnvelopeGroup = (item: Item | null | undefined): GroupItem | null =>
  item && item.type === "group" && item.envelope ? item : null;

const envelopeGroup = (doc: Document, id: ID): GroupItem | null => asEnvelopeGroup(findItem(doc, id)?.item ?? null);

/** True for any selected group that carries envelope metadata. */
export const hasEnvelope = (doc: Document, ids: Iterable<ID>): boolean => {
  const set = new Set(ids);
  let found = false;
  eachItem(doc, (item) => {
    if (set.has(item.id) && asEnvelopeGroup(item)) {
      found = true;
      return false;
    }
  });
  return found;
};

// ── Baking source artwork into flat world-space paths ─────────
// Items carry their placement in `transform` (a live rect is (0,0)→(w,h) with the
// position in its matrix), so the contents must be flattened into world space
// before they can share one envelope box.
const bakeToWorldPaths = (items: Item[], parent: Matrix = IDENTITY): Item[] => {
  const out: Item[] = [];
  for (const item of items) {
    const m = mul(parent, item.transform);
    if (item.type === "group") {
      out.push(...bakeToWorldPaths(item.children, m));
      continue;
    }
    const paths = localPaths(item);
    if (!paths.length) continue; // text / image carry no outline to distort
    for (const p of paths) {
      const baked = carryItemState(makePath(transformGeometry(p, m)), item);
      out.push(baked);
    }
  }
  return out;
};

const worldBox = (items: Item[]): Rect | null => {
  let r: Rect | null = null;
  for (const it of items) if (it.type === "path") r = union(r, pathBounds(it.geometry));
  return r;
};

// ── Coons patch over an envelope outline ──────────────────────
interface Boundary {
  /** Point at arc-length parameter t ∈ [0,1]. */
  at: (t: number) => Point;
}

const polyline = (pts: Point[]): Boundary => {
  if (pts.length < 2) {
    const only = pts[0] ?? { x: 0, y: 0 };
    return { at: () => only };
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  const total = cum[cum.length - 1] || 1;
  return {
    at: (t: number) => {
      const d = Math.max(0, Math.min(1, t)) * total;
      let i = 1;
      while (i < cum.length - 1 && cum[i] < d) i++;
      const span = cum[i] - cum[i - 1] || 1;
      const f = (d - cum[i - 1]) / span;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f };
    },
  };
};

interface Patch {
  top: Boundary;
  bottom: Boundary;
  left: Boundary;
  right: Boundary;
  tl: Point;
  tr: Point;
  br: Point;
  bl: Point;
}

/** Split a closed envelope outline into its four boundary curves at the vertices
 *  nearest the outline's bbox corners, in TL → TR → BR → BL order. */
const patchOf = (shape: PathGeometry): Patch | null => {
  const pts = flatten(shape, 0.25);
  if (pts.length < 4) return null;
  // flatten() repeats the first point when closed; drop the duplicate so the ring
  // has one entry per vertex.
  const closed = pts.length > 1 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-9;
  let ring = closed ? pts.slice(0, -1) : pts;
  const r = pathBounds(shape);
  const cornersOf = (rg: Point[]): number[] => {
    const nearest = (target: Point): number => {
      let best = 0;
      let bestD = Infinity;
      rg.forEach((p, i) => {
        const d = (p.x - target.x) ** 2 + (p.y - target.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best;
    };
    return [
      nearest({ x: r.x, y: r.y }), // TL
      nearest({ x: r.x + r.width, y: r.y }), // TR
      nearest({ x: r.x + r.width, y: r.y + r.height }), // BR
      nearest({ x: r.x, y: r.y + r.height }), // BL
    ];
  };
  let [tlI, trI, brI, blI] = cornersOf(ring);
  if (new Set([tlI, trI, brI, blI]).size < 4) return null; // degenerate outline

  // Normalize the winding so walking the ring FORWARD visits TL → TR → BR → BL.
  // Then each boundary is simply the ring span between two consecutive corners,
  // and no arc is ever taken the long way round the outline.
  const ahead = (from: number, to: number) => (to - from + ring.length) % ring.length;
  if (ahead(tlI, trI) > ahead(tlI, blI)) {
    ring = ring.slice().reverse();
    [tlI, trI, brI, blI] = cornersOf(ring);
  }

  /** Ring points from `from` forward to `to`, inclusive. */
  const arc = (from: number, to: number): Point[] => {
    const out: Point[] = [];
    for (let i = from; ; i = (i + 1) % ring.length) {
      out.push(ring[i]);
      if (i === to) break;
    }
    return out;
  };

  return {
    top: polyline(arc(tlI, trI)), // left → right
    right: polyline(arc(trI, brI)), // top → bottom
    bottom: polyline(arc(brI, blI).reverse()), // walked BR→BL, reversed to left → right
    left: polyline(arc(blI, tlI).reverse()), // walked BL→TL, reversed to top → bottom
    tl: ring[tlI],
    tr: ring[trI],
    br: ring[brI],
    bl: ring[blI],
  };
};

const coons = (p: Patch, u: number, v: number): Point => {
  const T = p.top.at(u);
  const B = p.bottom.at(u);
  const L = p.left.at(v);
  const R = p.right.at(v);
  const bx = (1 - u) * (1 - v) * p.tl.x + u * (1 - v) * p.tr.x + (1 - u) * v * p.bl.x + u * v * p.br.x;
  const by = (1 - u) * (1 - v) * p.tl.y + u * (1 - v) * p.tr.y + (1 - u) * v * p.bl.y + u * v * p.br.y;
  return {
    x: (1 - v) * T.x + v * B.x + (1 - u) * L.x + u * R.x - bx,
    y: (1 - v) * T.y + v * B.y + (1 - u) * L.y + u * R.y - by,
  };
};

const mapThroughPatch = (g: PathGeometry, box: Rect, p: Patch): PathGeometry => {
  const to = (pt: Point): Point => coons(p, (pt.x - box.x) / box.width, (pt.y - box.y) / box.height);
  return {
    closed: g.closed,
    anchors: g.anchors.map((a) => {
      const point = to(a.point);
      // Handles are absolute endpoints mapped through the same surface, then
      // re-relativized — the surface is non-affine, so a shared linear map would
      // not follow the boundary curvature.
      const inAbs = to({ x: a.point.x + a.handleIn.x, y: a.point.y + a.handleIn.y });
      const outAbs = to({ x: a.point.x + a.handleOut.x, y: a.point.y + a.handleOut.y });
      return {
        point,
        handleIn: { x: inAbs.x - point.x, y: inAbs.y - point.y },
        handleOut: { x: outAbs.x - point.x, y: outAbs.y - point.y },
      };
    }),
  };
};

// ── Regeneration ──────────────────────────────────────────────
export const regenerate = (doc: Document, group: GroupItem): void => {
  const env = group.envelope;
  if (!env) return;
  // `sourceItems` were captured from `group.children`, so they are in the
  // GROUP's local space and baking them yields local geometry. Clearing the
  // group's transform therefore did not "normalize" anything — it discarded
  // every move/scale/rotation the user had applied to the envelope.
  const baked = bakeToWorldPaths(cloneDeep(env.sourceItems));
  group.children = baked;
  const box = worldBox(baked);
  if (!box || box.width < 1e-9 || box.height < 1e-9) return;

  if (env.kind === "warp" && env.warp) {
    warp(doc, baked.map((c) => c.id), { ...env.warp, box });
    return;
  }
  if (env.kind === "top-object" && env.shape) {
    const patch = patchOf(env.shape);
    if (!patch) return;
    for (const child of baked) {
      if (child.type === "path") child.geometry = mapThroughPatch(child.geometry, box, patch);
    }
  }
};

const mark = (group: GroupItem, env: Omit<EnvelopeObject, "id" | "sourceIds">): void => {
  const sourceItems = cloneDeep(env.sourceItems);
  group.name = group.name && group.name !== "Group" ? group.name : "Envelope";
  group.envelope = { ...env, id: group.id, sourceItems, sourceIds: sourceItems.map((i) => i.id) };
};

/** Group the selection (if needed) and return the group, or null. */
const groupFor = (doc: Document, ids: ID[]): GroupItem | null => {
  if (ids.length === 1) {
    const loc = findItem(doc, ids[0]);
    if (!loc) return null;
    if (loc.item.type === "group" && !loc.item.envelope) return loc.item;
    if (loc.item.type === "group") return loc.item; // re-enveloping an envelope: reuse it
    const g = makeGroup([loc.item], { name: "Envelope" });
    loc.container.splice(loc.index, 1, g);
    return g;
  }
  const gid = groupItems(doc, ids);
  const item = gid ? findItem(doc, gid)?.item : null;
  return item?.type === "group" ? item : null;
};

/** The world-space source snapshot for a group about to become an envelope: the
 *  ORIGINALS when it is already an envelope (so nothing compounds), else its
 *  current children. */
const sourceFor = (group: GroupItem): Item[] => cloneDeep(group.envelope?.sourceItems ?? group.children);

/**
 * Object ▸ Envelope Distort ▸ Make with Warp. Returns the envelope group's id.
 */
export const makeWithWarp = (doc: Document, ids: Iterable<ID>, opts: EnvelopeWarpOptions): ID | null => {
  const list = Array.from(new Set(ids));
  if (!list.length) return null;
  const group = groupFor(doc, list);
  if (!group) return null;
  mark(group, { kind: "warp", warp: { ...opts }, sourceItems: sourceFor(group) });
  regenerate(doc, group);
  return group.id;
};

/**
 * Object ▸ Envelope Distort ▸ Make with Top Object. The frontmost selected object
 * becomes the envelope outline and is consumed; everything below is mapped into
 * it. Needs ≥2 objects and a top object with an outline.
 */
export const makeWithTopObject = (doc: Document, ids: Iterable<ID>): ID | null => {
  const set = new Set(ids);
  // eachItem walks bottom→top, so the last match is the frontmost object.
  const hits: { item: Item; container: Item[] }[] = [];
  eachItem(doc, (item, loc) => {
    if (set.has(item.id)) hits.push({ item, container: loc.container });
  });
  if (hits.length < 2) return null;

  const top = hits[hits.length - 1];
  const topLoc = findItem(doc, top.item.id);
  if (!topLoc) return null;
  const outlines = localPaths(top.item);
  if (!outlines.length) return null;
  const shape = transformGeometry(outlines[0], worldTransformAt(topLoc));

  // Consume the envelope object.
  const idx = top.container.indexOf(top.item);
  if (idx >= 0) top.container.splice(idx, 1);

  const contents = hits.slice(0, -1).map((h) => h.item.id);
  const group = groupFor(doc, contents);
  if (!group) return null;
  mark(group, { kind: "top-object", shape, sourceItems: sourceFor(group) });
  regenerate(doc, group);
  return group.id;
};

/**
 * Object ▸ Envelope Distort ▸ Envelope Options — re-warp the selected envelope(s)
 * from their ORIGINAL artwork with new warp parameters (never cumulative).
 */
export const updateWarp = (doc: Document, ids: Iterable<ID>, opts: EnvelopeWarpOptions): ID[] => {
  const done: ID[] = [];
  for (const id of ids) {
    const group = envelopeGroup(doc, id);
    if (!group || group.envelope?.kind !== "warp") continue;
    group.envelope = { ...group.envelope, warp: { ...opts } };
    regenerate(doc, group);
    done.push(group.id);
  }
  return done;
};

/**
 * Object ▸ Envelope Distort ▸ Release — restore the undistorted contents, and for
 * a top-object envelope put its outline back as a path above them.
 */
export const release = (doc: Document, ids: Iterable<ID>): ID[] => {
  const groups: ID[] = [];
  for (const id of ids) {
    const group = envelopeGroup(doc, id);
    if (!group) continue;
    const env = group.envelope!;
    group.children = cloneDeep(env.sourceItems);
    if (env.kind === "top-object" && env.shape) {
      const loc = findItem(doc, group.id);
      const outline = makePath(cloneDeep(env.shape), { name: "Envelope" });
      if (loc) loc.container.splice(loc.index + 1, 0, outline); // back on top
    }
    delete group.envelope;
    groups.push(group.id);
  }
  return groups.length ? ungroup(doc, groups) : [];
};

/**
 * Object ▸ Envelope Distort ▸ Expand — keep the distorted artwork and drop the
 * envelope, so it becomes plain editable geometry.
 */
export const expand = (doc: Document, ids: Iterable<ID>): ID[] => {
  const done: ID[] = [];
  for (const id of ids) {
    const group = envelopeGroup(doc, id);
    if (!group) continue;
    delete group.envelope;
    done.push(group.id);
  }
  return done;
};
