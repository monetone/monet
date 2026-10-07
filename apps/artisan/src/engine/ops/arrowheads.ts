// ─────────────────────────────────────────────────────────────
// ops/arrowheads — Effect ▸ Stylize ▸ Add Arrowheads (Illustrator legacy parity)
// ─────────────────────────────────────────────────────────────
// Adobe Illustrator's "Add Arrowheads" (Effect ▸ Stylize, the pre-CS5 effect)
// stamps an arrowhead onto the start and/or end of an open, stroked path. The
// arrowhead is filled with the stroke colour, scales with the stroke weight, and
// points outward along the path's end tangent.
//
// This bakes the result: each chosen end gets a filled arrowhead in one of four
// styles — Triangle (the classic Arrowhead 2 silhouette), Circle (a round dot),
// Square, or Bar (a perpendicular tick) — and the original path + its head(s) are
// wrapped in one "Arrowheads" group, taking the path's z-order. Deviations from
// Illustrator (documented): four styles rather than its ~39, the visible stroke
// is not trimmed back under the head, and only `path` items with a painted stroke
// are eligible (closed paths have no ends). The triangle points outward (apex at
// the tip, body set back); the circle / square / bar are centred on the tip (a
// dot / box / tick straddling the end), which reads correctly for a terminator.

import { cloneDeep } from "../clone";
import { anchor, type PathGeometry } from "../geometry/path";
import { add, normalize, perp, scale, sub, type Point } from "../geometry/vec";
import { defaultStroke, makeGroup, makePath, noPaint } from "../model/factory";
import { findItem } from "../model/query";
import type { Document, ID, PathItem } from "../model/types";
import { paintedStroke } from "../model/appearance";

/** Which end(s) of a path receive an arrowhead. */
export type ArrowEnd = "start" | "end" | "both";

/** Arrowhead silhouette. A faithful subset of Illustrator's ~39 styles. */
export type ArrowheadStyle = "triangle" | "circle" | "square" | "bar";

// Arrowhead size as a multiple of the stroke width:
// LEN = distance the triangle base sits back from the tip; HALF = half-extent
// (triangle half-base, square half-side, bar half-length, circle radius).
// BAR_HALF = half the bar's thickness along the tangent (so it is one stroke
// width thick). KAPPA builds the circle from four cubic-bezier quarter arcs.
const LEN = 4;
const HALF = 2;
const BAR_HALF = 0.5;
const KAPPA = 0.5522847498307936;

/**
 * A filled arrowhead in one of four `style`s, sized by stroke `width` × `scale`:
 * Triangle (apex at `tip`, base set back along `dir`), or a Square / Bar / Circle
 * centred on `tip`. Square and Bar orient to the tangent `dir` (which need not be
 * unit length); the rotation-symmetric Circle ignores it.
 */
export const arrowheadGeometry = (
  tip: Point,
  dir: Point,
  width: number,
  scale_ = 1,
  style: ArrowheadStyle = "triangle",
): PathGeometry => {
  const u = normalize(dir);
  const W = width * scale_;

  if (style === "circle") {
    const r = HALF * W;
    const k = r * KAPPA; // bezier handle length for a quarter arc
    return {
      closed: true,
      anchors: [
        anchor({ x: tip.x + r, y: tip.y }, { x: 0, y: -k }, { x: 0, y: k }),
        anchor({ x: tip.x, y: tip.y + r }, { x: k, y: 0 }, { x: -k, y: 0 }),
        anchor({ x: tip.x - r, y: tip.y }, { x: 0, y: k }, { x: 0, y: -k }),
        anchor({ x: tip.x, y: tip.y - r }, { x: -k, y: 0 }, { x: k, y: 0 }),
      ],
    };
  }

  // Square + Bar are quads centred on the tip: half-extents along the tangent
  // (hu) and across it (hp). A square is HALF·W both ways; a bar is a thin tick.
  if (style === "square" || style === "bar") {
    const hu = scale(u, (style === "bar" ? BAR_HALF : HALF) * W);
    const hp = scale(perp(u), HALF * W);
    return {
      closed: true,
      anchors: [
        anchor(add(add(tip, hu), hp)),
        anchor(add(sub(tip, hu), hp)),
        anchor(sub(sub(tip, hu), hp)),
        anchor(sub(add(tip, hu), hp)),
      ],
    };
  }

  // Triangle (default): apex at the tip, base LEN·W back, ±HALF·W across.
  const back = sub(tip, scale(u, LEN * W));
  const wing = scale(perp(u), HALF * W);
  return { closed: true, anchors: [anchor(tip), anchor(add(back, wing)), anchor(sub(back, wing))] };
};

// Outward tip + direction at the START of a path (away from the path body). The
// outgoing handle gives the tangent when present; otherwise the next anchor does.
const startTangent = (g: PathGeometry): { tip: Point; dir: Point } | null => {
  if (g.anchors.length < 2) return null;
  const a0 = g.anchors[0];
  const h = a0.handleOut;
  const inner = h.x !== 0 || h.y !== 0 ? add(a0.point, h) : g.anchors[1].point;
  return { tip: a0.point, dir: sub(a0.point, inner) };
};

// Outward tip + direction at the END of a path. The incoming handle gives the
// tangent when present; otherwise the previous anchor does.
const endTangent = (g: PathGeometry): { tip: Point; dir: Point } | null => {
  const n = g.anchors.length;
  if (n < 2) return null;
  const aN = g.anchors[n - 1];
  const h = aN.handleIn;
  const inner = h.x !== 0 || h.y !== 0 ? add(aN.point, h) : g.anchors[n - 2].point;
  return { tip: aN.point, dir: sub(aN.point, inner) };
};

const nonZero = (d: Point) => d.x !== 0 || d.y !== 0;

/**
 * Effect ▸ Stylize ▸ Add Arrowheads — bake arrowhead(s) onto each selected open,
 * stroked path and wrap the path + head(s) in an "Arrowheads" group. Returns the
 * new group ids (skipping closed/short/unstroked paths and non-path items).
 */
export const addArrowheads = (
  doc: Document,
  ids: Iterable<ID>,
  end: ArrowEnd,
  style: ArrowheadStyle = "triangle",
  scale_ = 1,
): ID[] => {
  const out: ID[] = [];
  for (const id of ids) {
    const loc = findItem(doc, id);
    if (!loc || loc.item.type !== "path") continue;
    const path = loc.item as PathItem;
    const g = path.geometry;
    if (g.closed || g.anchors.length < 2) continue; // no free ends to arrow
    const stroke = paintedStroke(path);
    const width = stroke.paint.type === "none" ? 0 : stroke.width;
    if (width <= 0) continue; // no stroke ⇒ no colour or size reference

    const tangents: { tip: Point; dir: Point }[] = [];
    if (end === "start" || end === "both") {
      const t = startTangent(g);
      if (t && nonZero(t.dir)) tangents.push(t);
    }
    if (end === "end" || end === "both") {
      const t = endTangent(g);
      if (t && nonZero(t.dir)) tangents.push(t);
    }
    if (!tangents.length) continue;

    const heads = tangents.map((t) =>
      makePath(arrowheadGeometry(t.tip, t.dir, width, scale_, style), {
        name: "Arrowhead",
        // Heads live beside the path inside the group, so share its local frame.
        transform: { ...path.transform },
        // Take the stroke colour. A gradient / pattern stroke is object-relative,
        // so the head resolves it within its own (small) bbox, not the line's.
        fill: cloneDeep(stroke.paint),
        stroke: defaultStroke(noPaint()),
      }),
    );
    // Wrap original (bottom) + head(s) (on top) in a group at the path's z-order.
    const group = makeGroup([path, ...heads], { name: "Arrowheads" });
    loc.container.splice(loc.index, 1, group);
    out.push(group.id);
  }
  return out;
};
