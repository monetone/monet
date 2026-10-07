// ─────────────────────────────────────────────────────────────
// ops/group — group / ungroup
// ─────────────────────────────────────────────────────────────

import { invert, mul, type Matrix } from "../geometry/matrix";
import { makeGroup } from "../model/factory";
import { eachItem, findItem, parentTransform } from "../model/query";
import { pruneEmptyGroups, removeItems } from "./items";
import type { Document, ID, Item, Layer } from "../model/types";

/** Envelope/Perspective source snapshots can only be restored by Release. */
export const canUngroup = (doc: Document, ids: Iterable<ID>): boolean => {
  for (const id of ids) {
    const item = findItem(doc, id)?.item;
    if (item?.type === "group" && !item.envelope && !item.perspective) return true;
  }
  return false;
};

/**
 * Group the selected items into a single group placed at the FRONTMOST selected
 * object's z-position (Illustrator parity — objects above the selection stay
 * above the new group). Returns the new group id (or null). Children keep their
 * transforms (the group's transform is identity, in the items' former space).
 */
export const group = (doc: Document, ids: Iterable<ID>): ID | null => {
  const idList = Array.from(new Set(ids));
  // Grouping requires 2+ objects (Illustrator parity); matches the menu's
  // disabled state so the ⌘G shortcut and the menu agree (AR-H6).
  if (idList.length < 2) return null;
  const idSet = new Set(idList);

  // Collect in document order (bottom→top) to preserve stacking.
  const ordered: { item: Item; layer: Layer; container: Item[] }[] = [];
  for (const layer of doc.layers) {
    const walk = (c: Item[]) => {
      for (const it of c) {
        if (idSet.has(it.id)) ordered.push({ item: it, layer, container: c });
        if (it.type === "group") walk(it.children);
      }
    };
    walk(layer.items);
  }
  if (ordered.length < 2) return null;

  // Drop the group where the frontmost selected object sat: its index minus the
  // selected items below it in the same container (which shift away on removal).
  const top = ordered[ordered.length - 1];
  const targetContainer = top.container;
  const topIndex = targetContainer.indexOf(top.item);
  const selectedBelow = targetContainer.slice(0, topIndex).filter((it) => idSet.has(it.id)).length;
  const insertAt = Math.max(0, topIndex - selectedBelow);

  const children = ordered.map((o) => o.item);
  // Defer empty-group pruning until after insertion: when every selected item is
  // a child of one group, that parent is also the destination container.
  removeItems(doc, idList, false);

  const g = makeGroup(children);
  targetContainer.splice(Math.min(insertAt, targetContainer.length), 0, g);
  pruneEmptyGroups(doc);
  return g.id;
};

/** Ungroup the selected groups, splicing children into the parent container and
 * baking the group transform / opacity into each child. */
export const ungroup = (doc: Document, ids: Iterable<ID>): ID[] => {
  const set = new Set(ids);
  const released: ID[] = [];

  const walk = (container: Item[]) => {
    for (let i = container.length - 1; i >= 0; i--) {
      const it = container[i];
      if (it.type === "group") {
        if (set.has(it.id)) {
          if (it.envelope || it.perspective) continue;
          const children = it.children.map((child) => {
            child.transform = mul(it.transform, child.transform);
            child.opacity = child.opacity * it.opacity;
            return child;
          });
          container.splice(i, 1, ...children);
          released.push(...children.map((c) => c.id));
          // do not recurse into the spliced children (single level ungroup)
        } else {
          walk(it.children);
        }
      }
    }
  };
  for (const layer of doc.layers) walk(layer.items);
  return released;
};

/** Make the TOP-MOST selected object a clipping mask over the rest (clip group). */
export const makeClipGroup = (doc: Document, ids: Iterable<ID>): ID | null => {
  const gid = group(doc, ids);
  if (!gid) return null;
  const loc = findItem(doc, gid);
  if (loc && loc.item.type === "group") {
    loc.item.clip = true;
    // Top-most child becomes the mask (rendered first as the clip path).
    const children = loc.item.children;
    const mask = children.pop();
    if (mask) {
      // Illustrator: the clipping path loses its appearance (no fill / no stroke)
      // and stays unpainted even after the mask is released.
      mask.fill = { type: "none" };
      mask.stroke = { ...mask.stroke, paint: { type: "none" } };
      delete mask.appearance;
      children.unshift(mask);
    }
  }
  return gid;
};

/** Release selected clip groups back to normal items (ungroup; drops clip). The
 *  former clip shape (children[0]) is moved to the top so it stays visible. */
export const releaseClipGroup = (doc: Document, ids: Iterable<ID>): ID[] => {
  const clipIds: ID[] = [];
  for (const id of ids) {
    const loc = findItem(doc, id);
    if (loc && loc.item.type === "group" && loc.item.clip) {
      loc.item.clip = false;
      if (loc.item.children.length) loc.item.children.push(loc.item.children.shift()!); // clip shape → top
      clipIds.push(id);
    }
  }
  return clipIds.length ? ungroup(doc, clipIds) : [];
};

/** Make the top-most selected object a luminance (opacity) mask of the one below
 *  it. The mask item leaves the layer and is stored on target.mask, re-expressed
 *  in the target's local space so it stays visually put. */
export const makeOpacityMask = (doc: Document, ids: Iterable<ID>): ID | null => {
  const set = new Set(ids);
  const ordered: { item: Item; parentM: Matrix }[] = [];
  eachItem(doc, (item, loc) => {
    if (set.has(item.id)) ordered.push({ item, parentM: parentTransform(loc.ancestors) });
  });
  if (ordered.length < 2) return null;
  const maskEntry = ordered[ordered.length - 1]; // top-most = the mask
  const mask = maskEntry.item;
  const maskWorld = mul(maskEntry.parentM, mask.transform); // stable: mask isn't grouped below

  // An opacity mask applies to ONE object, so everything below the mask becomes
  // the masked content — grouped when there's more than one (Illustrator parity).
  const contentIds = ordered.slice(0, ordered.length - 1).map((e) => e.item.id);
  let targetId: ID;
  if (contentIds.length === 1) {
    targetId = contentIds[0];
  } else {
    const gid = group(doc, contentIds);
    if (!gid) return null;
    targetId = gid;
  }
  const targetLoc = findItem(doc, targetId);
  if (!targetLoc) return null;
  const target = targetLoc.item;
  const targetWorld = mul(parentTransform(targetLoc.ancestors), target.transform);

  mask.transform = mul(invert(targetWorld), maskWorld); // mask in target-local space
  removeItems(doc, [mask.id]);
  target.mask = [...(target.mask ?? []), mask];
  return target.id;
};

/** Release opacity masks on selected items: restore the mask content as a
 *  sibling of the target and clear .mask. Returns the restored item ids. */
export const releaseOpacityMask = (doc: Document, ids: Iterable<ID>): ID[] => {
  const set = new Set(ids);
  // Mask content is stored in the TARGET's local space, and is restored into the
  // target's own container — so re-express it with the target's LOCAL transform
  // (using the full world transform would double-apply any ancestor transform).
  const targets: { item: Item; container: Item[]; local: Matrix }[] = [];
  eachItem(doc, (item, loc) => {
    if (set.has(item.id) && item.mask?.length) {
      targets.push({ item, container: loc.container, local: item.transform });
    }
  });
  const released: ID[] = [];
  for (const t of targets) {
    for (const m of t.item.mask ?? []) {
      m.transform = mul(t.local, m.transform);
      t.container.push(m);
      released.push(m.id);
    }
    t.item.mask = undefined;
    t.item.maskType = undefined; // clear interpretation with the mask it described
  }
  return released;
};

export { parentTransform };
