// The Rust canvas paints the serialized document. While a text item is in the
// HTML editor, omit it here so the textarea is the only copy on screen — the
// SVG renderer hides that same id, and the raster path has to as well.

import type { Document, Item } from "../engine";

export function documentForRaster(doc: Document, hideId?: string): Document {
  if (!hideId) return doc;
  let changed = false;
  const layers = doc.layers.map((layer) => {
    const items = omitItem(layer.items, hideId);
    if (items === layer.items) return layer;
    changed = true;
    return { ...layer, items };
  });
  return changed ? { ...doc, layers } : doc;
}

function omitItem(items: Item[], hideId: string): Item[] {
  let changed = false;
  const next = items.flatMap((item) => {
    if (item.id === hideId) {
      changed = true;
      return [];
    }
    if (item.type === "group") {
      const children = omitItem(item.children, hideId);
      if (children !== item.children) {
        changed = true;
        return [{ ...item, children }];
      }
    }
    return [item];
  });
  return changed ? next : items;
}
