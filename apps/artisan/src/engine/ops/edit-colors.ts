// ─────────────────────────────────────────────────────────────
// ops/edit-colors — Edit ▸ Edit Colors (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Adobe Illustrator's Edit ▸ Edit Colors menu adjusts the colours of selected
// artwork in place. This covers the deterministic, lossless members:
//   • Invert Colors        — r,g,b → 255−r, 255−g, 255−b (alpha kept)
//   • Convert to Grayscale — replace each colour with its luminance
//   • Saturate / Desaturate — push each channel away from / toward its luminance
// The transform applies to every fill and stroke colour (solid paints and each
// gradient stop), recursing into groups and per-run text fills. Pattern and
// "none" paints are left unchanged.

import { type RGBA, invert } from "../color";
import { findItem } from "../model/query";
import type { Document, ID, Item, Paint } from "../model/types";
import { regenerate } from "./envelope";
import { mapMeshColors } from "./mesh";

export type EditColorsMode = "invert" | "grayscale" | "saturate" | "desaturate";

type ColorTransform = (c: RGBA) => RGBA;

/** Rec. 601 luma of a colour. */
const luma = (c: RGBA): number => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;

/** Scale each channel around the colour's luma by (1 + amount): amount > 0
 *  saturates (away from grey), amount < 0 desaturates (toward grey). */
const saturateBy = (amount: number): ColorTransform => (c) => {
  const l = luma(c);
  const f = 1 + amount;
  const adj = (v: number) => Math.max(0, Math.min(255, Math.round(l + (v - l) * f)));
  return { r: adj(c.r), g: adj(c.g), b: adj(c.b), a: c.a };
};

const TRANSFORMS: Record<EditColorsMode, ColorTransform> = {
  invert,
  grayscale: (c) => {
    const l = Math.round(luma(c)); // Rec. 601 luma
    return { r: l, g: l, b: l, a: c.a };
  },
  saturate: saturateBy(0.5), // +50%
  desaturate: saturateBy(-0.5), // −50%
};

const mapPaint = (p: Paint, f: ColorTransform): Paint => {
  if (p.type === "solid") return { type: "solid", color: f(p.color) };
  if (p.type === "gradient") {
    return { type: "gradient", gradient: { ...p.gradient, stops: p.gradient.stops.map((s) => ({ ...s, color: f(s.color) })) } };
  }
  return p; // none / pattern: unchanged
};

const applyToItem = (doc: Document, item: Item, f: ColorTransform): void => {
  item.fill = mapPaint(item.fill, f);
  item.stroke = { ...item.stroke, paint: mapPaint(item.stroke.paint, f) };
  if (item.appearance) {
    item.appearance.entries = item.appearance.entries.map((entry) =>
      entry.kind === "fill"
        ? { ...entry, paint: mapPaint(entry.paint, f) }
        : { ...entry, stroke: { ...entry.stroke, paint: mapPaint(entry.stroke.paint, f) } },
    );
  }
  if (item.type === "group") {
    if (item.envelope) {
      item.envelope.sourceItems.forEach((child) => applyToItem(doc, child, f));
      regenerate(doc, item);
    } else if (item.mesh) {
      mapMeshColors(doc, item.id, f);
    } else {
      item.children.forEach((child) => applyToItem(doc, child, f));
    }
  }
  if (item.type === "text" && item.runs) {
    item.runs = item.runs.map((r) => (r.fill ? { ...r, fill: mapPaint(r.fill, f) } : r));
  }
};

/**
 * Edit ▸ Edit Colors ▸ {Invert Colors | Convert to Grayscale} — recolour each
 * selected object (and its group children) in place. Returns the touched ids.
 */
export const editColors = (doc: Document, ids: ID[], mode: EditColorsMode): ID[] => {
  const f = TRANSFORMS[mode];
  const done: ID[] = [];
  for (const id of ids) {
    const loc = findItem(doc, id);
    if (!loc) continue;
    applyToItem(doc, loc.item, f);
    done.push(id);
  }
  return done;
};
