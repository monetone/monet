// ─────────────────────────────────────────────────────────────
// ops/layers — layer-level lock / visibility operations
// ─────────────────────────────────────────────────────────────
// Object ▸ Lock ▸ Other Layers and Object ▸ Hide ▸ Other Layers act on whole
// LAYERS (the layer's own lock / visible flag, distinct from per-object locking):
// every layer except the ones to `keep` (the selection's layers, or the active
// layer) is locked or hidden.

import { makeLayer } from "../model/factory";
import type { Document, ID, Item, Layer } from "../model/types";
import { cloneItemDeep } from "./items";

/** First unused "Layer N" name (N starts at the next ordinal). */
const nextLayerName = (doc: Document): string => {
  const taken = new Set(doc.layers.map((l) => l.name));
  let n = doc.layers.length + 1;
  while (taken.has(`Layer ${n}`)) n++;
  return `Layer ${n}`;
};

/** Insert a new empty layer directly ABOVE `aboveId` (the top layer by default).
 *  Returns the new layer's id. */
/** Layers panel ▸ Reverse Order — flip the stacking order of every layer
 *  (index 0 = bottom). Mutates in place. */
export const reverseLayers = (doc: Document): void => {
  doc.layers.reverse();
};

export const addLayer = (doc: Document, aboveId?: ID, name?: string): ID => {
  const layer = makeLayer(name ?? nextLayerName(doc));
  const idx = aboveId ? doc.layers.findIndex((l) => l.id === aboveId) : doc.layers.length - 1;
  doc.layers.splice((idx < 0 ? doc.layers.length - 1 : idx) + 1, 0, layer);
  return layer.id;
};

/**
 * Layers panel ▸ Collect in New Layer — move the selected objects into a fresh
 * layer on top, preserving their relative document z-order (independent of the
 * order `ids` are given in) and leaving their source layers behind. Only items
 * that are direct children of a layer are collected (items nested inside groups
 * stay put). Returns the new layer id, or null when nothing qualifies.
 */
export const collectInNewLayer = (doc: Document, ids: Iterable<ID>): ID | null => {
  const idset = new Set(ids);
  if (!idset.size) return null;
  const targets: { layer: Layer; item: Item }[] = [];
  for (const layer of doc.layers) {
    for (const item of layer.items) if (idset.has(item.id)) targets.push({ layer, item });
  }
  if (!targets.length) return null;
  const layerId = addLayer(doc); // fresh layer on top
  const dest = doc.layers.find((l) => l.id === layerId)!;
  for (const { layer, item } of targets) {
    item.visible = item.visible && layer.visible;
    item.locked = item.locked || layer.locked;
    const i = layer.items.indexOf(item);
    if (i >= 0) layer.items.splice(i, 1);
  }
  for (const { item } of targets) dest.items.push(item);
  return layerId;
};

/** Duplicate a layer (deep-cloning its items with fresh ids) directly above the
 *  original, copying its flags. Returns the clone's id, or null if not found. */
export const duplicateLayer = (doc: Document, layerId: ID): ID | null => {
  const idx = doc.layers.findIndex((l) => l.id === layerId);
  if (idx < 0) return null;
  const src = doc.layers[idx];
  const copy = makeLayer(`${src.name} copy`, src.items.map(cloneItemDeep));
  copy.visible = src.visible;
  copy.locked = src.locked;
  copy.opacity = src.opacity;
  copy.blendMode = src.blendMode;
  copy.template = src.template;
  doc.layers.splice(idx + 1, 0, copy);
  return copy.id;
};

/** Delete a layer and its items. Refuses to remove the last remaining layer.
 *  Returns the id of the layer that should become active, or null on no-op. */
export const removeLayer = (doc: Document, layerId: ID): ID | null => {
  if (doc.layers.length <= 1) return null; // a document always keeps ≥1 layer
  const idx = doc.layers.findIndex((l) => l.id === layerId);
  if (idx < 0) return null;
  doc.layers.splice(idx, 1);
  return doc.layers[Math.min(idx, doc.layers.length - 1)].id; // neighbour at/under the gap
};

/** Merge every layer's artwork into one (Illustrator "Flatten Artwork"). All items
 *  collapse into the survivor layer — the active one, else the bottom — keeping the
 *  global bottom-to-top stacking order; the other layers are removed. Hidden/locked
 *  non-survivors fold those flags into their items, and a hidden requested survivor
 *  falls back to the topmost visible layer. Returns the survivor's id, or null when
 *  there is nothing to flatten (≤1 layer). */
export const flattenArtwork = (doc: Document, survivorId?: ID): ID | null => {
  if (doc.layers.length <= 1) return null;
  const requested = doc.layers.find((l) => l.id === survivorId);
  const survivor = requested && !requested.visible
    ? [...doc.layers].reverse().find((l) => l.visible) ?? requested
    : requested ?? doc.layers[0];
  const merged = doc.layers.flatMap((l) => l === survivor || (l.visible && !l.locked)
    ? l.items
    : l.items.map((item) => ({ ...item, visible: item.visible && l.visible, locked: item.locked || l.locked })));
  survivor.items = merged;
  doc.layers = [survivor];
  return survivor.id;
};

/**
 * Layers panel ▸ Release to Layers (Sequence) — distribute the layer's top-level
 * items onto their own new layers, one per item, preserving stacking order. The
 * source layer is kept (emptied); each item's new layer is inserted directly
 * above it (index 0 = bottom), so the global z-order is unchanged. A group counts
 * as one item → one layer. Returns the new layer ids (bottom→top), or [] when the
 * layer has fewer than two items (nothing meaningful to release) or is unknown.
 */
export const releaseToLayers = (doc: Document, layerId: ID): ID[] => {
  const idx = doc.layers.findIndex((l) => l.id === layerId);
  if (idx < 0) return [];
  const layer = doc.layers[idx];
  if (layer.items.length < 2) return [];
  const newLayers = layer.items.map((item) => {
    const next = makeLayer(item.name || "Layer", [item]);
    next.visible = layer.visible;
    next.locked = layer.locked;
    next.opacity = layer.opacity;
    next.blendMode = layer.blendMode;
    next.template = layer.template;
    return next;
  });
  layer.items = []; // the source layer is kept, now empty
  doc.layers.splice(idx + 1, 0, ...newLayers); // directly above the source, z-order preserved
  return newLayers.map((l) => l.id);
};

/** Lock every layer NOT in `keep`; returns the ids it newly locked. */
export const lockOtherLayers = (doc: Document, keep: Set<ID>): ID[] => {
  const out: ID[] = [];
  for (const layer of doc.layers) {
    if (!keep.has(layer.id) && !layer.locked) {
      layer.locked = true;
      out.push(layer.id);
    }
  }
  return out;
};

/** Hide every layer NOT in `keep`; returns the ids it newly hid. */
export const hideOtherLayers = (doc: Document, keep: Set<ID>): ID[] => {
  const out: ID[] = [];
  for (const layer of doc.layers) {
    if (!keep.has(layer.id) && layer.visible) {
      layer.visible = false;
      out.push(layer.id);
    }
  }
  return out;
};
