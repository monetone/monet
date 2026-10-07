// ─────────────────────────────────────────────────────────────
// ops/graphic-styles — Graphic Styles (saved appearance presets)
// ─────────────────────────────────────────────────────────────
// Adobe Illustrator's Graphic Styles panel stores appearance presets — fill,
// stroke, opacity and blend mode — captured from an object and re-applied to
// others. The apply primitive is the Eyedropper's Ops.Paint.applyAppearance; a
// graphic style is just a named, document-stored appearance bundle.

import { cloneDeep } from "../clone";
import { applyAppearance } from "./paint";
import type { Document, GraphicStyle, ID, Item } from "../model/types";

/** Capture an item's appearance (deep-cloned, no shared refs) as a graphic-style payload. */
export const styleAppearance = (it: Item): Pick<GraphicStyle, "fill" | "stroke" | "appearance" | "opacity" | "blendMode"> => ({
  fill: cloneDeep(it.fill),
  stroke: cloneDeep(it.stroke),
  ...(it.appearance ? { appearance: cloneDeep(it.appearance) } : {}),
  opacity: it.opacity,
  blendMode: it.blendMode,
});

/** Apply a saved graphic style's appearance to each selected item (reuses applyAppearance). */
export const applyGraphicStyle = (doc: Document, ids: Iterable<ID>, style: GraphicStyle): void =>
  applyAppearance(doc, ids, { fill: style.fill, stroke: style.stroke, appearance: style.appearance, opacity: style.opacity, blendMode: style.blendMode });
