// ─────────────────────────────────────────────────────────────
// ops/liquify — brush-based local deformation of path anchors
// ─────────────────────────────────────────────────────────────
// A liquify brush moves the anchors of a path that fall within `radius` of a
// `center` (all in the path's LOCAL space), with a linear falloff. Handles are
// relative deltas, so moving a point carries its handles along.

import type { Point } from "../geometry/vec";
import { findItem } from "../model/query";
import type { Document, ID } from "../model/types";

/** Returns the displaced point given the original point, brush center, and
 * falloff `t` (1 at the center, 0 at the radius edge). */
export type LiquifyFn = (pt: Point, center: Point, t: number) => Point;

export const liquify = (doc: Document, id: ID, center: Point, radius: number, fn: LiquifyFn): void => {
  const loc = findItem(doc, id);
  if (!loc || (loc.item.type !== "path" && loc.item.type !== "compound")) return;
  const r2 = radius * radius;
  const paths = loc.item.type === "path" ? [loc.item.geometry] : loc.item.subpaths;
  for (const path of paths) {
    for (const a of path.anchors) {
      const dx = a.point.x - center.x;
      const dy = a.point.y - center.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2) {
        const t = 1 - Math.sqrt(d2) / radius;
        a.point = fn(a.point, center, t);
      }
    }
  }
};

// ── Per-kind displacement builders ───────────────────────────
export const warpFn = (delta: Point, strength = 1): LiquifyFn => (pt, _c, t) => ({
  x: pt.x + delta.x * t * strength,
  y: pt.y + delta.y * t * strength,
});

export const twirlFn = (anglePerTick: number): LiquifyFn => (pt, c, t) => {
  const a = anglePerTick * t;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = pt.x - c.x;
  const dy = pt.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
};

export const puckerFn = (rate = 0.18): LiquifyFn => (pt, c, t) => ({
  x: pt.x + (c.x - pt.x) * rate * t,
  y: pt.y + (c.y - pt.y) * rate * t,
});

export const bloatFn = (rate = 0.18): LiquifyFn => (pt, c, t) => ({
  x: pt.x + (pt.x - c.x) * rate * t,
  y: pt.y + (pt.y - c.y) * rate * t,
});

/** Crystallize: push outward from the center with a random per-point magnitude. */
export const crystallizeFn = (rate = 0.3): LiquifyFn => (pt, c, t) => {
  const f = rate * t * (0.4 + Math.random());
  return { x: pt.x + (pt.x - c.x) * f, y: pt.y + (pt.y - c.y) * f };
};

/** Scallop: carve wavy, scalloped edges — radial displacement modulated by a
 *  sine of the angle around the brush center, so lobes alternate in/out. This
 *  is deliberately distinct from Pucker (uniform inward pull). */
export const scallopFn = (rate = 0.5, lobes = 5): LiquifyFn => (pt, c, t) => {
  const dx = pt.x - c.x;
  const dy = pt.y - c.y;
  const wave = Math.sin(Math.atan2(dy, dx) * lobes); // -1..1 around the center
  const f = rate * t * wave;
  return { x: pt.x + dx * f, y: pt.y + dy * f };
};

/** Wrinkle: random jitter around the point. */
export const wrinkleFn = (amp = 6): LiquifyFn => (pt, _c, t) => ({
  x: pt.x + (Math.random() - 0.5) * amp * t,
  y: pt.y + (Math.random() - 0.5) * amp * t,
});
