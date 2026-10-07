// ─────────────────────────────────────────────────────────────
// ops/items — add / remove / duplicate / reparent (mutate a doc in place)
// ─────────────────────────────────────────────────────────────
// These functions mutate the Document passed in; callers run them inside a
// store transaction (which works on a cloned doc), so in-place mutation is safe.

import { translate, mul } from "../geometry/matrix";
import { cloneDeep } from "../clone";
import { makeGroup, newId } from "../model/factory";
import { eachItem, findItem } from "../model/query";
import type { Document, GroupItem, ID, Item, Layer } from "../model/types";
import { appearancePaints } from "../model/appearance";

/** Reassign a fresh id to an item and every nested item tree it owns — group
 *  children, clip/mask content, and pattern-tile artwork (all nested Item trees
 *  that the core `eachItem` walk does not descend into). Mutates in place. */
export const reidItemTree = (it: Item): void => {
  it.id = newId(it.type[0]);
  if (it.type === "group") {
    const childIdMap = new Map<ID, ID>();
    if (it.graph) it.graph.id = it.id;
    if (it.dimension) it.dimension.id = it.id;
    if (it.mesh) it.mesh.id = it.id;
    it.children.forEach((child) => {
      const oldId = child.id;
      reidItemTree(child);
      childIdMap.set(oldId, child.id);
    });
    if (it.livePaint) {
      it.livePaint.id = it.id;
      it.livePaint.faces = it.livePaint.faces.map((face) => ({
        ...face,
        id: newId("lpf"),
        itemId: childIdMap.get(face.itemId) ?? face.itemId,
      }));
      it.livePaint.edges = it.livePaint.edges.map((edge) => ({
        ...edge,
        id: newId("lpe"),
        itemId: childIdMap.get(edge.itemId) ?? edge.itemId,
      }));
    }
    // Live-object families store ids pointing INTO this subtree, so each needs
    // remapping onto the fresh ids — otherwise the COPY's metadata still names
    // the ORIGINAL's children and its Release/Expand operates on nothing.
    if (it.blendKeyIds) it.blendKeyIds = it.blendKeyIds.map((keyId) => childIdMap.get(keyId) ?? keyId);
    if (it.envelope) {
      it.envelope.id = it.id;
      it.envelope.sourceItems.forEach(reidItemTree);
      it.envelope.sourceIds = it.envelope.sourceItems.map((source) => source.id);
    }
    if (it.perspective) {
      it.perspective.id = it.id;
      it.perspective.sourceItems.forEach((source) => {
        const oldId = source.id;
        reidItemTree(source);
        source.id = childIdMap.get(oldId) ?? source.id;
        if (source.type === "group") {
          if (source.graph) source.graph.id = source.id;
          if (source.dimension) source.dimension.id = source.id;
          if (source.mesh) source.mesh.id = source.id;
          if (source.livePaint) source.livePaint.id = source.id;
          if (source.perspective) source.perspective.id = source.id;
          if (source.envelope) source.envelope.id = source.id;
        }
      });
      it.perspective.sourceIds = it.perspective.sourceItems.map((source) => source.id);
    }
  }
  if (it.mask) it.mask.forEach(reidItemTree);
  if (it.fill.type === "pattern") it.fill.pattern.tile.forEach(reidItemTree);
  if (it.stroke.paint.type === "pattern") it.stroke.paint.pattern.tile.forEach(reidItemTree);
};

/** Recursively deep-clone an item, assigning fresh ids throughout (incl. mask
 *  content and pattern tile artwork, which are nested Item trees). */
export const cloneItemDeep = (item: Item): Item => {
  const copy: Item = cloneDeep(item);
  reidItemTree(copy);
  return copy;
};

/** Reassign fresh, session-unique ids to every item in a document. Imported
 *  documents carry foreign ids authored in another process that may collide
 *  with each other or with live ids; the query layer (`findItem`) returns the
 *  FIRST id match and assumes ids are unique, so re-mint on import. */
export const reidDocument = (doc: Document): void => {
  for (const layer of doc.layers) layer.items.forEach(reidItemTree);
};

/** True if any item id repeats across the (traversable) document — exactly the
 *  id space `findItem`/`allItemIds` rely on being unique. Used to re-mint only
 *  malformed imports, leaving well-formed docs (incl. lossless .artisan reopen)
 *  byte-identical. */
export const hasDuplicateItemIds = (doc: Document): boolean => {
  const seen = new Set<ID>();
  let dup = false;
  eachItem(doc, (it) => {
    if (seen.has(it.id)) dup = true;
    seen.add(it.id);
  });
  return dup;
};

export const activeLayer = (doc: Document, activeLayerId?: ID): Layer => {
  if (activeLayerId) {
    const l = doc.layers.find((x) => x.id === activeLayerId);
    if (l) return l;
  }
  return doc.layers[doc.layers.length - 1];
};

/** Append an item to a layer (top of its z-order) and return its id. */
export const addItem = (doc: Document, item: Item, layerId?: ID): ID => {
  const layer = activeLayer(doc, layerId);
  layer.items.push(item);
  return item.id;
};

export const addItems = (doc: Document, items: Item[], layerId?: ID): ID[] => {
  const layer = activeLayer(doc, layerId);
  layer.items.push(...items);
  return items.map((i) => i.id);
};

/** Add items at the BACK (bottom of the z-order) of the active layer. Used by
 *  Paste in Back. Returns the new ids. */
export const addItemsBack = (doc: Document, items: Item[], layerId?: ID): ID[] => {
  const layer = activeLayer(doc, layerId);
  layer.items.unshift(...items);
  return items.map((i) => i.id);
};

/** Insert a freshly drawn item per the current drawing mode: "normal" appends it
 *  on top (the default — byte-identical to addItem), "behind" inserts it at the
 *  back of the active layer, "inside" clips it into `insideTargetId` (wrapping
 *  that object in a clip group on first draw, then appending inside it). Returns
 *  the new id. "inside" with a missing/absent target falls back to "normal". */
export const insertNew = (
  doc: Document,
  item: Item,
  opts: { layerId?: ID; mode: "normal" | "behind" | "inside"; insideTargetId?: ID | null },
): ID => {
  if (opts.mode === "inside" && opts.insideTargetId) {
    const loc = findItem(doc, opts.insideTargetId);
    if (loc) {
      const tgt = loc.item;
      // Target is already a clip group → add the new art on top of its content.
      if (tgt.type === "group" && tgt.clip) {
        tgt.children.push(item);
        return item.id;
      }
      // Target is the clip PATH of an existing clip group → add into that group.
      const parent = loc.ancestors[loc.ancestors.length - 1];
      if (parent && parent.clip && parent.children[0]?.id === tgt.id) {
        parent.children.push(item);
        return item.id;
      }
      // Otherwise wrap the target into a fresh clip group: [clipPath, newArt].
      const idx = loc.container.indexOf(tgt);
      if (idx >= 0) {
        const g = makeGroup([tgt, item], { name: "Clip Group" });
        g.clip = true;
        loc.container.splice(idx, 1, g);
        return item.id;
      }
    }
    // target gone → fall through to a normal insert
  }
  if (opts.mode === "behind") {
    addItemsBack(doc, [item], opts.layerId);
    return item.id;
  }
  return addItem(doc, item, opts.layerId);
};

const repairBlendKeys = (group: GroupItem): void => {
  if (!group.blendKeyIds) return;
  const live = new Set(group.children.map((child) => child.id));
  group.blendKeyIds = group.blendKeyIds.filter((id) => live.has(id));
  if (group.blendKeyIds.length < 2) delete group.blendKeyIds;
};

/** Remove empty groups after an operation has consumed their last child. */
export const pruneEmptyGroups = (doc: Document): void => {
  const prune = (container: Item[], parent?: GroupItem) => {
    for (let i = container.length - 1; i >= 0; i--) {
      const item = container[i];
      if (item.type !== "group") continue;
      prune(item.children, item);
      repairBlendKeys(item);
      if (item.children.length === 0) {
        if (parent?.clip && i === 0) parent.clip = false;
        container.splice(i, 1);
      }
    }
  };
  for (const layer of doc.layers) prune(layer.items);
};

/** Remove items by id from anywhere in the tree. */
export const removeItems = (doc: Document, ids: Iterable<ID>, pruneEmpty = true): void => {
  const set = new Set(ids);
  if (set.size === 0) return;
  const prune = (container: Item[], parent?: GroupItem) => {
    for (let i = container.length - 1; i >= 0; i--) {
      const it = container[i];
      if (set.has(it.id)) {
        if (parent?.clip && i === 0) parent.clip = false;
        container.splice(i, 1);
        continue;
      }
      if (it.type === "group") {
        prune(it.children, it);
        repairBlendKeys(it);
      }
    }
  };
  for (const layer of doc.layers) prune(layer.items);
  if (pruneEmpty) pruneEmptyGroups(doc);
};

/** Duplicate items in place (same container, fresh ids), offset by (dx,dy). Returns new ids. */
export const duplicateItems = (doc: Document, ids: Iterable<ID>, dx = 10, dy = 10): ID[] => {
  const newIds: ID[] = [];
  for (const id of ids) {
    const loc = findItem(doc, id);
    if (!loc) continue;
    const copy = cloneItemDeep(loc.item);
    copy.transform = translate(copy.transform, dx, dy);
    // insert just above the original within the same container
    loc.container.splice(loc.index + 1, 0, copy);
    newIds.push(copy.id);
  }
  return newIds;
};

/** Move items to a target layer (kept at world position; layers don't transform). */
export const moveToLayer = (doc: Document, ids: Iterable<ID>, layerId: ID): void => {
  const set = new Set(ids);
  const target = doc.layers.find((l) => l.id === layerId);
  if (!target) return;
  // Collect the selected items in global bottom-to-top order (layers bottom-first,
  // each container front-to-back), removing them from wherever they live — even out
  // of a nested group — then re-stack them on top of the target layer in that order
  // so their relative stacking is preserved (a plain unshift here inverted it).
  const pulled: Item[] = [];
  const prune = (container: Item[]) => {
    for (let i = 0; i < container.length; ) {
      const it = container[i];
      if (set.has(it.id)) {
        pulled.push(it);
        container.splice(i, 1); // removed → the next item shifts into index i
      } else {
        if (it.type === "group") prune(it.children);
        i++;
      }
    }
  };
  for (const layer of doc.layers) prune(layer.items);
  target.items.push(...pulled);
};

/** Rename an item. */
export const renameItem = (doc: Document, id: ID, name: string): void => {
  const loc = findItem(doc, id);
  if (loc) loc.item.name = name;
};

/** Set a boolean attribute (visible/locked) on items. */
export const setItemFlag = (doc: Document, ids: Iterable<ID>, flag: "visible" | "locked", value: boolean): void => {
  const set = new Set(ids);
  eachItem(doc, (item) => {
    if (set.has(item.id)) item[flag] = value;
  });
};

export const setOpacity = (doc: Document, ids: Iterable<ID>, opacity: number): void => {
  const set = new Set(ids);
  eachItem(doc, (item) => {
    if (set.has(item.id)) item.opacity = Math.max(0, Math.min(1, opacity));
  });
};

export const setBlendMode = (doc: Document, ids: Iterable<ID>, mode: Item["blendMode"]): void => {
  const set = new Set(ids);
  eachItem(doc, (item) => {
    if (set.has(item.id)) item.blendMode = mode;
  });
};

/** Object ▸ Lock — lock the given items (locked objects can't be selected/edited
 *  but stay drawn, à la Illustrator). `setLocked(..., false)` unlocks them. */
export const setLocked = (doc: Document, ids: Iterable<ID>, locked: boolean): void => {
  const set = new Set(ids);
  eachItem(doc, (item) => {
    if (set.has(item.id)) item.locked = locked;
  });
};

/** Object ▸ Hide — hide the given items (`hidden=false` shows them). */
export const setHidden = (doc: Document, ids: Iterable<ID>, hidden: boolean): void => {
  const set = new Set(ids);
  eachItem(doc, (item) => {
    if (set.has(item.id)) item.visible = !hidden;
  });
};

/** Object ▸ Unlock All — unlock every locked item; returns the ids it unlocked. */
export const unlockAll = (doc: Document): ID[] => {
  const out: ID[] = [];
  eachItem(doc, (item) => {
    if (item.locked) {
      item.locked = false;
      out.push(item.id);
    }
  });
  return out;
};

/**
 * Object ▸ Lock ▸ All Artwork Above — lock every object stacked ABOVE the
 * selection within the same container (a group's children or a layer's items):
 * for each container holding a selected item, lock the siblings above the
 * topmost selected one. Returns the ids newly locked.
 */
export const lockAllAbove = (doc: Document, ids: Iterable<ID>): ID[] => {
  const set = new Set(ids);
  // Topmost selected index per container (paint order — higher index = nearer front).
  const topByContainer = new Map<Item[], number>();
  eachItem(doc, (item, loc) => {
    if (!set.has(item.id)) return;
    const cur = topByContainer.get(loc.container);
    if (cur === undefined || loc.index > cur) topByContainer.set(loc.container, loc.index);
  });
  const locked: ID[] = [];
  for (const [container, top] of topByContainer) {
    for (let i = top + 1; i < container.length; i++) {
      if (!container[i].locked) {
        container[i].locked = true;
        locked.push(container[i].id);
      }
    }
  }
  return locked;
};

/**
 * Object ▸ Hide ▸ All Artwork Above — hide every object stacked ABOVE the
 * selection within the same container (a group's children or a layer's items):
 * for each container holding a selected item, hide the siblings above the
 * topmost selected one. Returns the ids newly hidden.
 */
export const hideAllAbove = (doc: Document, ids: Iterable<ID>): ID[] => {
  const set = new Set(ids);
  // Topmost selected index per container (paint order — higher index = nearer front).
  const topByContainer = new Map<Item[], number>();
  eachItem(doc, (item, loc) => {
    if (!set.has(item.id)) return;
    const cur = topByContainer.get(loc.container);
    if (cur === undefined || loc.index > cur) topByContainer.set(loc.container, loc.index);
  });
  const hidden: ID[] = [];
  for (const [container, top] of topByContainer) {
    for (let i = top + 1; i < container.length; i++) {
      if (container[i].visible) {
        container[i].visible = false;
        hidden.push(container[i].id);
      }
    }
  }
  return hidden;
};

/** Object ▸ Show All — show every hidden item; returns the ids it revealed. */
export const showAll = (doc: Document): ID[] => {
  const out: ID[] = [];
  eachItem(doc, (item) => {
    if (!item.visible) {
      item.visible = true;
      out.push(item.id);
    }
  });
  return out;
};

const isStrayPoint = (it: Item): boolean => it.type === "path" && it.geometry.anchors.length < 2;
const isUnpainted = (it: Item): boolean => {
  switch (it.type) {
    case "path":
    case "compound":
    case "rect":
    case "ellipse":
    case "polygon":
    case "star":
    case "line":
      return appearancePaints(it).every((paint) => paint.type === "none");
    default:
      return false;
  }
};
const isEmptyText = (it: Item): boolean => it.type === "text" && (!it.text || it.text.trim() === "");

/** Read-only: the ids Clean Up would delete. A clip group's clip path is unpainted
 *  BY DESIGN, so it is excluded. */
export const cleanUpTargets = (doc: Document): ID[] => {
  const remove: ID[] = [];
  eachItem(doc, (item, loc) => {
    const parent = loc.ancestors[loc.ancestors.length - 1];
    if (parent && parent.clip && parent.children[0]?.id === item.id) return; // keep clip paths
    if (isStrayPoint(item) || isUnpainted(item) || isEmptyText(item)) remove.push(item.id);
  });
  return remove;
};

/** Object ▸ Path ▸ Clean Up — delete stray points (single-anchor paths), unpainted
 *  objects (no fill AND no stroke), and empty text paths (Illustrator's Clean Up).
 *  Returns the ids it deleted. */
export const cleanUp = (doc: Document): ID[] => {
  const remove = cleanUpTargets(doc);
  for (const id of remove) {
    const loc = findItem(doc, id);
    if (loc) loc.container.splice(loc.index, 1);
  }
  return remove;
};

export { mul };
