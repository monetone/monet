// ─────────────────────────────────────────────────────────────
// ops/tweak — Effect ▸ Distort & Transform ▸ Tweak (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Adobe Illustrator's Tweak randomly nudges a path's existing anchor points and
// /or their in/out control handles by up to a Horizontal and Vertical amount —
// WITHOUT adding points (that's Roughen). Each of "Anchor Points", "In Control
// Points" and "Out Control Points" can be toggled. The jitter is seeded here, so
// the result is reproducible and testable.

import type { Point } from "../geometry/vec";
import type { PathGeometry } from "../geometry/path";
import { mulberry32 } from "../rng";
import { convertToPath, leafIds } from "./path-edit";
import { findItem } from "../model/query";
import { LIVE_SHAPES, type Document, type ID } from "../model/types";

export interface TweakOptions {
  /** Max horizontal jitter (user units). */
  horizontal: number;
  /** Max vertical jitter (user units). */
  vertical: number;
  /** Move anchor points. Default true. */
  anchors?: boolean;
  /** Move incoming control handles. Default false. */
  inHandles?: boolean;
  /** Move outgoing control handles. Default false. */
  outHandles?: boolean;
  /** PRNG seed for reproducible jitter. Default 1. */
  seed?: number;
}

const tweakGeometry = (
  g: PathGeometry,
  h: number,
  v: number,
  anchors: boolean,
  inH: boolean,
  outH: boolean,
  rng: () => number,
): PathGeometry => {
  // The handles are relative deltas, so they ride along when the anchor moves;
  // jittering a handle vector therefore moves only that control point.
  const jitter = (p: Point): Point => ({ x: p.x + (rng() * 2 - 1) * h, y: p.y + (rng() * 2 - 1) * v });
  return {
    closed: g.closed,
    anchors: g.anchors.map((a) => ({
      point: anchors ? jitter(a.point) : { ...a.point },
      handleIn: inH ? jitter(a.handleIn) : { ...a.handleIn },
      handleOut: outH ? jitter(a.handleOut) : { ...a.handleOut },
    })),
  };
};

/**
 * Effect ▸ Distort & Transform ▸ Tweak — randomly nudge the selected paths'
 * anchors / handles. Mutates in place; returns the ids it changed. No-op if both
 * amounts are 0 or nothing is enabled to move.
 */
export const tweak = (doc: Document, ids: ID[], opts: TweakOptions): ID[] => {
  const { horizontal, vertical } = opts;
  const anchors = opts.anchors !== false;
  const inH = !!opts.inHandles;
  const outH = !!opts.outHandles;
  if ((horizontal === 0 && vertical === 0) || (!anchors && !inH && !outH)) return [];

  const rng = mulberry32(opts.seed ?? 1);
  const apply = (g: PathGeometry): PathGeometry => tweakGeometry(g, horizontal, vertical, anchors, inH, outH, rng);

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
