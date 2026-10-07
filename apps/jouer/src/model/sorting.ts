// ─────────────────────────────────────────────────────────────
// sorting.ts — pure 2D render-ordering maths for Sorting Layers.
//
// Unity orders 2D renderers first by Sorting Layer (a named, ordered list on the
// project), then by Order in Layer (a per-object integer). Jouer mirrors this:
// the project owns an ordered `sortingLayers` list and each object carries an
// optional `sortingLayer` (omitted ⇒ "Default") plus its existing `depth`, which
// is the order in layer. The single effective z-value folds both together so a
// later sorting layer always wins, with `depth` breaking ties inside a layer.
//
// Default-only projects (the common case) fold to `effectiveDepth === depth`, so
// nothing about existing scenes/exports changes.
//
// Nothing in this module imports React, Phaser, or the DOM.
// ─────────────────────────────────────────────────────────────

export const DEFAULT_SORTING_LAYER = "Default";

/** Spacing between sorting layers. Larger than any realistic order-in-layer, so
 *  layers never interleave. */
export const SORTING_LAYER_STRIDE = 1_000_000;

/** The project's sorting layers — always non-empty and containing "Default". */
export function sortingLayers(project: { sortingLayers?: string[] }): string[] {
  const ls = project.sortingLayers;
  if (!ls || ls.length === 0) return [DEFAULT_SORTING_LAYER];
  return ls.includes(DEFAULT_SORTING_LAYER) ? ls : [DEFAULT_SORTING_LAYER, ...ls];
}

/** Index of `name` within the ordered layers; an unknown or omitted name maps to
 *  the Default layer's index. */
export function sortingLayerIndex(layers: string[], name: string | undefined): number {
  const i = name ? layers.indexOf(name) : -1;
  if (i >= 0) return i;
  const d = layers.indexOf(DEFAULT_SORTING_LAYER);
  return d >= 0 ? d : 0;
}

/** Effective render depth: sorting-layer index dominates, order-in-layer
 *  (`depth`) breaks ties. */
export function effectiveDepth(o: { sortingLayer?: string; depth: number }, layers: string[]): number {
  return sortingLayerIndex(layers, o.sortingLayer) * SORTING_LAYER_STRIDE + o.depth;
}
