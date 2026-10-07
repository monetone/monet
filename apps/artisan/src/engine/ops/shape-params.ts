// ─────────────────────────────────────────────────────────────
// ops/shape-params — edit LIVE shape parameters (mutate a doc in place)
// ─────────────────────────────────────────────────────────────
// Live shapes (rect/polygon/star) store their defining parameters; the geometry
// is regenerated from them by Shapes.localPaths. These setters mirror Adobe
// Illustrator's contextual shape properties (rounded-rect corner radius, polygon
// side count, star point count). Callers run them inside a store transaction.

import { findItem } from "../model/query";
import type { Document, ID } from "../model/types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Rounded-rectangle corner radius (uniform rx = ry). Clamped to ≤ half the
 *  shorter side, matching Illustrator's live rectangle (corners can't overlap). */
export const setCornerRadius = (doc: Document, ids: Iterable<ID>, r: number): void => {
  for (const id of ids) {
    const it = findItem(doc, id)?.item;
    if (it?.type === "rect") {
      const max = Math.min(it.width, it.height) / 2;
      it.rx = it.ry = clamp(r, 0, max);
    }
  }
};

/** Polygon side count (integer, 3..1000), à la Illustrator's polygon "Sides". */
export const setPolygonSides = (doc: Document, ids: Iterable<ID>, n: number): void => {
  const sides = clamp(Math.round(n), 3, 1000);
  for (const id of ids) {
    const it = findItem(doc, id)?.item;
    if (it?.type === "polygon") it.sides = sides;
  }
};

/** Star point count (integer, 3..1000), à la Illustrator's star "Points". */
export const setStarPoints = (doc: Document, ids: Iterable<ID>, n: number): void => {
  const points = clamp(Math.round(n), 3, 1000);
  for (const id of ids) {
    const it = findItem(doc, id)?.item;
    if (it?.type === "star") it.points = points;
  }
};

/** Live line Length (Illustrator): keep the start (x1,y1), move the end along the
 *  current direction so the segment is `length` long. Preserves angle; non-lines
 *  ignored. A degenerate (zero-length) line stays at its start. */
export const setLineLength = (doc: Document, ids: Iterable<ID>, length: number): void => {
  const len = Math.max(0, length);
  for (const id of ids) {
    const it = findItem(doc, id)?.item;
    if (it?.type !== "line") continue;
    const dx = it.x2 - it.x1;
    const dy = it.y2 - it.y1;
    const d = Math.hypot(dx, dy) || 1; // avoid /0 on a degenerate line
    it.x2 = it.x1 + (dx / d) * len;
    it.y2 = it.y1 + (dy / d) * len;
  }
};

/** Live line Angle in degrees (Illustrator): keep the start fixed and rotate the
 *  end to `deg` measured CCW from east (y-down screen → end = start + len·(cos,
 *  −sin)). Preserves length; non-lines ignored. */
export const setLineAngle = (doc: Document, ids: Iterable<ID>, deg: number): void => {
  const rad = (deg * Math.PI) / 180;
  for (const id of ids) {
    const it = findItem(doc, id)?.item;
    if (it?.type !== "line") continue;
    const len = Math.hypot(it.x2 - it.x1, it.y2 - it.y1);
    it.x2 = it.x1 + len * Math.cos(rad);
    it.y2 = it.y1 - len * Math.sin(rad);
  }
};

/** Live rectangle corner style (Illustrator "Corners"): round / chamfer /
 *  inverted. Only affects rounded rects (rx,ry > 0); ignores non-rects. */
export const setRectCornerStyle = (doc: Document, ids: Iterable<ID>, style: "round" | "chamfer" | "inverted"): void => {
  for (const id of ids) {
    const it = findItem(doc, id)?.item;
    if (it?.type === "rect") it.cornerStyle = style;
  }
};

/** Live ellipse "Pie" angles (degrees) — Illustrator's Pie Start / Pie End. A
 *  sweep below a full turn renders the ellipse as a wedge. */
export const setEllipsePie = (doc: Document, ids: Iterable<ID>, start: number, end: number): void => {
  for (const id of ids) {
    const it = findItem(doc, id)?.item;
    if (it?.type === "ellipse") {
      it.pieStart = start;
      it.pieEnd = end;
    }
  }
};

/** Star inner-radius ratio (radius2 / radius1), Illustrator's "Radius 2" relative
 *  to "Radius 1" — the spikiness. Clamped to 0.05..1 (inner stays > 0 and ≤ outer);
 *  the outer radius and point count are preserved. */
export const setStarInnerRatio = (doc: Document, ids: Iterable<ID>, ratio: number): void => {
  const r = clamp(ratio, 0.05, 1);
  for (const id of ids) {
    const it = findItem(doc, id)?.item;
    if (it?.type === "star") it.radius2 = it.radius1 * r;
  }
};
