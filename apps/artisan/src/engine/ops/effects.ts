// ─────────────────────────────────────────────────────────────
// ops/effects — add / clear live effects on items
// ─────────────────────────────────────────────────────────────

import { cloneDeep } from "../clone";
import { eachItem } from "../model/query";
import type { Document, Effect, ID } from "../model/types";

export const addEffect = (doc: Document, ids: Iterable<ID>, effect: Effect): void => {
  const set = new Set(ids);
  eachItem(doc, (item) => {
    if (!set.has(item.id)) return;
    const existing = (item.effects ?? []).filter((e) => e.type !== effect.type);
    item.effects = [...existing, cloneDeep(effect)];
  });
};

export const clearEffects = (doc: Document, ids: Iterable<ID>): void => {
  const set = new Set(ids);
  eachItem(doc, (item) => {
    if (set.has(item.id)) item.effects = undefined;
  });
};

/** Sensible defaults per effect type. */
export const defaultEffect = (type: Effect["type"]): Effect => {
  switch (type) {
    case "drop-shadow":
      return { type, dx: 6, dy: 6, blur: 6, color: { r: 0, g: 0, b: 0, a: 0.5 } };
    case "blur":
      return { type, radius: 4 };
    case "feather":
      return { type, radius: 8 };
    case "glow":
      return { type, blur: 8, color: { r: 255, g: 240, b: 120, a: 0.9 } };
    case "inner-glow":
      // Illustrator's Inner Glow defaults to a soft white halo on the inside edges.
      return { type, blur: 8, color: { r: 255, g: 255, b: 255, a: 0.75 } };
  }
};
