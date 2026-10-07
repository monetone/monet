// ─────────────────────────────────────────────────────────────
// Layers panel "Filter for layer type" (Photoshop). Maps the kind dropdown to the
// engine's LayerKind numbering (raster/mod.rs): 0 pixel · 1 adjustment · 2 text ·
// 3 shape · 4 fill · 6 group · 7 smart object. Fill layers share Photoshop's
// adjustment/fill filter. Engine-free so it unit-tests in node; the
// LayersPanel feeds it each layer's kind.
// ─────────────────────────────────────────────────────────────

import { BLEND_ORDER, LAYER_KIND } from "./engineContracts";
import { FX_DEFS } from "./effects";

export type LayerKindFilter = "all" | "pixel" | "adjustment" | "type" | "shape" | "smart";

export interface LayerKindOption {
  value: LayerKindFilter;
  label: string;
}

export const LAYER_KIND_FILTERS: LayerKindOption[] = [
  { value: "all", label: "All" },
  { value: "pixel", label: "Pixel" },
  { value: "adjustment", label: "Adjustment" },
  { value: "type", label: "Type" },
  { value: "shape", label: "Shape" },
  { value: "smart", label: "Smart Object" },
];

const KIND_OF: Record<Exclude<LayerKindFilter, "all">, number> = {
  pixel: LAYER_KIND.pixel,
  adjustment: LAYER_KIND.adjustment,
  type: LAYER_KIND.text,
  shape: LAYER_KIND.vector,
  smart: LAYER_KIND.smartObject,
};

/** Does a layer of the given engine kind pass the filter? "all" passes everything;
 *  a group (kind 6) only passes "all" (it has no dedicated kind pill). */
export function layerKindMatches(kind: number, filter: LayerKindFilter): boolean {
  return filter === "all" || KIND_OF[filter] === kind || (filter === "adjustment" && kind === LAYER_KIND.fill);
}

// ─────────────────────────────────────────────────────────────
// Photoshop's "Filter for layer attribute" — the second filter type in the same
// Layers-panel bar. A single-choice dropdown like Kind (not multi-select like
// Color), so "all" is the pass-through. Photoshop also offers Empty, Linked and
// Advanced Blending; LayerInfo carries no input for those, so they are absent
// rather than silently wrong.
// ─────────────────────────────────────────────────────────────

export type LayerAttributeFilter =
  | "all" | "visible" | "hidden" | "locked" | "unlocked" | "clipped" | "masked" | "fx";

export interface LayerAttributeOption {
  value: LayerAttributeFilter;
  label: string;
}

export const LAYER_ATTRIBUTE_FILTERS: LayerAttributeOption[] = [
  { value: "all", label: "All" },
  { value: "visible", label: "Visible" },
  { value: "hidden", label: "Hidden" },
  { value: "locked", label: "Locked" },
  { value: "unlocked", label: "Unlocked" },
  { value: "clipped", label: "Clipped" },
  { value: "masked", label: "Masked" },
  { value: "fx", label: "Layer Effects" },
];

/** The `LayerInfo` fields the attribute filter reads. Structural so this module
 *  stays store-free (a `LayerInfo` is assignable as-is). */
export interface LayerAttributes {
  visible: boolean;
  locked: boolean;
  hasMask: boolean;
  hasFx: boolean;
  clipped?: boolean;
}

/** Does a layer pass the attribute filter? "all" passes everything. "masked"
 *  means a layer mask is attached — a disabled mask is still a mask, matching
 *  Photoshop, which filters on presence and not on the enable flag. */
export function layerAttributeMatches(layer: LayerAttributes, filter: LayerAttributeFilter): boolean {
  switch (filter) {
    case "all": return true;
    case "visible": return layer.visible;
    case "hidden": return !layer.visible;
    case "locked": return layer.locked;
    case "unlocked": return !layer.locked;
    case "clipped": return layer.clipped === true;
    case "masked": return layer.hasMask;
    case "fx": return layer.hasFx;
  }
}

// ─────────────────────────────────────────────────────────────
// Photoshop's "Filter for blending mode" (#423) — every layer blend mode in the
// engine's BLEND_ORDER, Pass Through included (groups carry it). Single-choice
// like Kind/Attribute, so "all" is the pass-through.
// ─────────────────────────────────────────────────────────────

export type LayerModeFilter = "all" | (typeof BLEND_ORDER)[number];

export const LAYER_MODE_FILTERS: { value: LayerModeFilter; label: string }[] = [
  { value: "all", label: "All" },
  ...BLEND_ORDER.map((k) => ({ value: k, label: k.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") })),
];

/** Does a layer with the given kebab blend mode (LayerInfo.blendMode) pass? */
export function layerModeMatches(blendMode: string, filter: LayerModeFilter): boolean {
  return filter === "all" || blendMode === filter;
}

// ─────────────────────────────────────────────────────────────
// Photoshop's "Filter for effect" (#423) — one option per layer-style type
// (effects.ts FX_DEFS). The Attribute filter's "Layer Effects" stays the
// any-effect switch; this one narrows to layers carrying a specific effect.
// ─────────────────────────────────────────────────────────────

export type LayerEffectFilter = "all" | number; // an FX id

export const LAYER_EFFECT_FILTERS: { value: LayerEffectFilter; label: string }[] = [
  { value: "all", label: "All" },
  ...FX_DEFS.map((d) => ({ value: d.id, label: d.name })),
];

/** Does a layer pass the effect filter? `fxMask` is LayerInfo.fxMask — bit `id`
 *  set when an enabled instance of effect `id` is on the layer (a disabled effect
 *  does not count, matching the Attribute filter's "Layer Effects"). */
export function layerEffectMatches(fxMask: number, filter: LayerEffectFilter): boolean {
  return filter === "all" || ((fxMask >> filter) & 1) === 1;
}
