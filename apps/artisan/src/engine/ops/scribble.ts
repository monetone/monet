// ─────────────────────────────────────────────────────────────
// ops/scribble — Effect ▸ Stylize ▸ Scribble (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Adobe Illustrator's Scribble effect fills a shape with a single continuous
// back-and-forth stroke. We replicate the core (Angle + Spacing) as a destructive
// op: flatten the shape to polygon rings, hatch its interior with parallel lines
// at `angle`, spaced `spacing` apart, clipped to the outline (a scanline fill with
// the even-odd rule so holes/compound subpaths are respected), then connect the
// line segments end-to-end in a boustrophedon (alternating) order into one open
// path. The result is stroked with the object's former fill colour.
//
// v1 scope vs Illustrator: it models Angle + Spacing + Stroke Width (not Path
// Overlap / Variation / Curviness). As a single continuous polyline it bridges
// gaps and holes (a plotter-pen model — connector strokes can cross empty regions,
// rather than Illustrator's fill-confined hatch), and the object's pre-existing
// stroke is dropped (Illustrator keeps it as a separate appearance).

import { type Point, rotateAround } from "../geometry/vec";
import { type PathGeometry, anchor, flatten } from "../geometry/path";
import { fromPoints } from "../geometry/bbox";
import { cloneDeep } from "../clone";
import { localPaths } from "../model/shapes";
import { convertToPath } from "./path-edit";
import { findItem } from "../model/query";
import { carryItemState, makePath, noPaint, defaultStroke } from "../model/factory";
import { LIVE_SHAPES, type Document, type ID, type Item } from "../model/types";
import { paintedFill } from "../model/appearance";

export interface ScribbleOptions {
  /** Hatch direction in degrees. */
  angle: number;
  /** Distance between hatch lines, in user units (clamped to ≥ 0.5). */
  spacing: number;
  /** Width of the scribble stroke. */
  strokeWidth: number;
}

// x-crossings of every ring edge with the horizontal line y, paired into inside
// segments (even-odd). Rings are treated as closed.
const scanline = (rings: Point[][], y: number): [number, number][] => {
  const xs: number[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      // Half-open rule (y1 ≤ y < y2 on exactly one orientation) so a vertex shared
      // by two edges is counted once.
      if ((a.y <= y && y < b.y) || (b.y <= y && y < a.y)) {
        xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
  }
  xs.sort((p, q) => p - q);
  const segs: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) segs.push([xs[i], xs[i + 1]]);
  return segs;
};

const scribbleGeometry = (rings: Point[][], center: Point, angle: number, spacing: number): PathGeometry => {
  // Work in a frame where the hatch lines are horizontal.
  const rot = rings.map((ring) => ring.map((p) => rotateAround(p, center, -angle)));
  const bb = fromPoints(rot.flat());
  const out: Point[] = [];
  let forward = true;
  for (let y = bb.y + spacing / 2; y < bb.y + bb.height; y += spacing) {
    const segs = scanline(rot, y);
    if (segs.length === 0) continue;
    const ordered = forward ? segs : segs.slice().reverse();
    for (const [x0, x1] of ordered) {
      if (forward) out.push({ x: x0, y }, { x: x1, y });
      else out.push({ x: x1, y }, { x: x0, y });
    }
    forward = !forward;
  }
  return { closed: false, anchors: out.map((p) => anchor(rotateAround(p, center, angle))) };
};

/**
 * Effect ▸ Stylize ▸ Scribble — replace each filled path / compound / live shape
 * with a hatched scribble stroked in its former fill colour. Mutates in place;
 * returns the ids actually scribbled.
 */
export const scribble = (doc: Document, ids: ID[], options: ScribbleOptions): ID[] => {
  const angle = (options.angle * Math.PI) / 180;
  const spacing = Math.max(0.5, options.spacing);
  const width = Math.max(0, options.strokeWidth);
  const done: ID[] = [];
  for (const id of ids) {
    let loc = findItem(doc, id);
    if (!loc) continue;
    const fill = paintedFill(loc.item);
    if (fill.type === "none") continue; // nothing to scribble
    if (LIVE_SHAPES.includes(loc.item.type)) {
      convertToPath(doc, id);
      loc = findItem(doc, id);
      if (!loc) continue;
    }
    const it = loc.item;
    if (it.type !== "path" && it.type !== "compound") continue;

    const rings = localPaths(it)
      .map((g) => flatten(g, 0.4))
      .filter((r) => r.length >= 2);
    if (rings.length === 0) continue;
    const bb = fromPoints(rings.flat());
    const center: Point = { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
    const geom = scribbleGeometry(rings, center, angle, spacing);
    if (geom.anchors.length < 2) continue;

    const result: Item = carryItemState(makePath(geom), it);
    result.fill = noPaint();
    result.stroke = { ...defaultStroke(cloneDeep(fill)), width };
    result.id = it.id; // keep the id stable so the selection survives
    result.transform = { ...it.transform };
    loc.container[loc.index] = result;
    done.push(it.id);
  }
  return done;
};
