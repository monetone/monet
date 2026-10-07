// ─────────────────────────────────────────────────────────────
// ops/blend-colors — Edit ▸ Edit Colors ▸ Blend … (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Adobe Illustrator's Edit Colors "Blend Front to Back / Horizontally /
// Vertically" recolours three or more selected objects with an even colour
// gradient between the two end objects: the ends keep their solid fills and the
// in-between objects are interpolated. "Front to Back" orders by stacking order;
// "Horizontally" / "Vertically" order by the objects' position. Needs ≥3 solidly
// filled objects.

import { type RGBA, mix } from "../color";
import { paintedFill, setPrimaryFill } from "../model/appearance";
import { eachItem, worldBounds } from "../model/query";
import type { Document, ID, Item } from "../model/types";

export type ColorBlendMode = "front-to-back" | "horizontal" | "vertical";

interface Entry {
  item: Item;
  color: RGBA;
  key: number;
}

export const blendColors = (doc: Document, ids: ID[], mode: ColorBlendMode): ID[] => {
  const idset = new Set(ids);
  const entries: Entry[] = [];
  let z = 0;
  eachItem(doc, (item) => {
    const zIndex = z++;
    const fill = paintedFill(item);
    if (!idset.has(item.id) || fill.type !== "solid") return;
    const b = worldBounds(doc, item.id);
    const key =
      mode === "front-to-back" ? zIndex
      : mode === "horizontal" ? (b ? b.x + b.width / 2 : 0)
      : b ? b.y + b.height / 2 : 0;
    entries.push({ item, color: fill.color, key });
  });
  if (entries.length < 3) return []; // a blend needs both ends plus a middle

  entries.sort((a, b) => a.key - b.key);
  const c0 = entries[0].color;
  const c1 = entries[entries.length - 1].color;
  const minK = entries[0].key;
  const span = entries[entries.length - 1].key - minK || 1;

  entries.forEach((e, i) => {
    // even steps by rank for front-to-back; by actual position otherwise.
    const t = mode === "front-to-back" ? i / (entries.length - 1) : (e.key - minK) / span;
    setPrimaryFill(e.item, { type: "solid", color: mix(c0, c1, t) });
  });
  return entries.map((e) => e.item.id);
};
