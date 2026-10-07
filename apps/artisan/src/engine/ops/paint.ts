// ─────────────────────────────────────────────────────────────
// ops/paint — apply fill / stroke to items (recursing into groups)
// ─────────────────────────────────────────────────────────────

import { cloneDeep } from "../clone";
import { paintedFill, paintedStroke, setPrimaryFill, setPrimaryStroke, syncPrimaryFromAppearance } from "../model/appearance";
import { eachItem } from "../model/query";
import type { RGBA } from "../color";
import type { AppearanceStack, BlendMode, Document, GradientStop, ID, Item, Paint, Stroke } from "../model/types";
import { regenerate } from "./envelope";
import { mapMeshColors } from "./mesh";

const applyToItem = (doc: Document, item: Item, fn: (it: Item) => void, meshColor?: (color: RGBA) => RGBA) => {
  if (item.type === "group") {
    if (item.envelope) {
      item.envelope.sourceItems.forEach((child) => applyToItem(doc, child, fn, meshColor));
      regenerate(doc, item);
    } else if (item.mesh) {
      if (meshColor) mapMeshColors(doc, item.id, meshColor);
    } else {
      item.children.forEach((child) => applyToItem(doc, child, fn, meshColor));
    }
  } else {
    fn(item);
  }
};

const forSelection = (doc: Document, ids: Iterable<ID>, fn: (it: Item) => void, meshColor?: (color: RGBA) => RGBA) => {
  const set = new Set(ids);
  eachItem(doc, (item) => {
    if (set.has(item.id)) applyToItem(doc, item, fn, meshColor);
  });
};

const solidMeshColor = (paint: Paint): (() => RGBA) | undefined => {
  if (paint.type !== "solid") return undefined;
  const color = paint.color;
  return () => ({ ...color });
};

export const applyFill = (doc: Document, ids: Iterable<ID>, paint: Paint): void =>
  forSelection(doc, ids, (it) => {
    setPrimaryFill(it, paint);
  }, solidMeshColor(paint));

export const applyStroke = (doc: Document, ids: Iterable<ID>, patch: Partial<Stroke>): void =>
  forSelection(doc, ids, (it) => {
    setPrimaryStroke(it, { ...paintedStroke(it), ...cloneDeep(patch) });
  });

/** The appearance attributes the Eyedropper samples/applies by default
 *  (fill + stroke + transparency). */
export interface Appearance {
  fill: Paint;
  stroke: Stroke;
  appearance?: AppearanceStack;
  opacity?: number;
  blendMode?: BlendMode;
}

/**
 * Copy a full appearance onto each target — Illustrator's Eyedropper default
 * (colour, stroke weight + attributes, AND transparency). Mirrors applyFill in
 * recursing into groups so a group's leaves all take the sampled look.
 */
export const applyAppearance = (doc: Document, ids: Iterable<ID>, a: Appearance): void =>
  forSelection(doc, ids, (it) => {
    if (a.appearance) {
      it.appearance = cloneDeep(a.appearance);
      syncPrimaryFromAppearance(it);
    } else {
      delete it.appearance;
      it.fill = cloneDeep(a.fill);
      it.stroke = cloneDeep(a.stroke);
    }
    if (a.opacity != null) it.opacity = a.opacity;
    if (a.blendMode != null) it.blendMode = a.blendMode;
  }, solidMeshColor(a.fill));

export const applyStrokePaint = (doc: Document, ids: Iterable<ID>, paint: Paint): void =>
  forSelection(doc, ids, (it) => {
    setPrimaryStroke(it, { ...paintedStroke(it), paint: cloneDeep(paint) });
  });

export const setStrokeWidth = (doc: Document, ids: Iterable<ID>, width: number): void =>
  forSelection(doc, ids, (it) => {
    setPrimaryStroke(it, { ...paintedStroke(it), width: Math.max(0, width) });
  });

/** Swap fill and stroke paints on each selected object. */
export const swapFillStroke = (doc: Document, ids: Iterable<ID>): void =>
  forSelection(doc, ids, (it) => {
    const fill = cloneDeep(paintedFill(it));
    const stroke = cloneDeep(paintedStroke(it));
    setPrimaryFill(it, stroke.paint);
    setPrimaryStroke(it, { ...stroke, paint: fill });
  });

// Reverse a stop list: mirror each offset (1 − offset) and reverse the order so
// the colours run the other way. A stop's midpoint biases the blend toward the
// NEXT stop, so after reversing it moves to the stop on the other side and flips
// (1 − midpoint). A midpoint on the LAST stop describes no segment and is dropped.
// (Reverse is its own inverse, modulo IEEE-754 rounding of 1 − (1 − x).)
const reverseStops = (stops: GradientStop[]): GradientStop[] => {
  const n = stops.length;
  const out: GradientStop[] = [];
  for (let k = 0; k < n; k++) {
    const src = stops[n - 1 - k];
    const stop: GradientStop = { offset: 1 - src.offset, color: { ...src.color } };
    const before = stops[n - 2 - k]; // the stop that now follows `src` in the reversed order
    if (k < n - 1 && before?.midpoint != null) stop.midpoint = 1 - before.midpoint;
    out.push(stop);
  }
  return out;
};

/** Gradient panel "Reverse" — reverse the stop order of each selected object's
 *  gradient fill AND/OR stroke (recursing into selected groups). Returns the leaf
 *  ids actually reversed. */
export const reverseGradient = (doc: Document, ids: Iterable<ID>): ID[] => {
  const done: ID[] = [];
  forSelection(doc, ids, (it) => {
    let changed = false;
    if (it.fill.type === "gradient") {
      it.fill.gradient.stops = reverseStops(it.fill.gradient.stops);
      changed = true;
    }
    if (it.stroke.paint.type === "gradient") {
      it.stroke.paint.gradient.stops = reverseStops(it.stroke.paint.gradient.stops);
      changed = true;
    }
    if (it.appearance?.entries.length) {
      for (const entry of it.appearance.entries) {
        const paint = entry.kind === "fill" ? entry.paint : entry.stroke.paint;
        if (paint.type === "gradient") {
          paint.gradient.stops = reverseStops(paint.gradient.stops);
          changed = true;
        }
      }
      syncPrimaryFromAppearance(it);
    }
    if (changed) done.push(it.id);
  });
  return done;
};
