// ─────────────────────────────────────────────────────────────
// selection.ts — pure helpers that compute selection sets over a scene tree.
//
// Unity's Edit menu has Select All, Deselect All, Invert Selection and the
// hierarchy's "Select Children". The set maths is independent of the store and
// the viewport, so it lives here (framework-free, unit-tested); commands.ts
// applies the result via `store.select`.
//
// Nothing in this module imports React, Phaser, or the DOM.
// ─────────────────────────────────────────────────────────────

import type { GameObject, Id, Scene } from "./types";
import { findObject, findParent, flattenObjects, walkObjects } from "./query";

/** Every object id in the scene (containers + descendants), document order. */
export function allObjectIds(scene: Scene): Id[] {
  return flattenObjects(scene).map((o) => o.id);
}

/** The complement of `selected` within the scene's objects (document order) —
 *  i.e. everything that is NOT currently selected. */
export function invertedIds(scene: Scene, selected: Id[]): Id[] {
  const set = new Set(selected);
  return flattenObjects(scene)
    .filter((o) => !set.has(o.id))
    .map((o) => o.id);
}

/** The set of ids made visible by isolating `ids` (Unity's "Isolate Selection"):
 *  each id, all of its ancestors (so the containers it lives in still render)
 *  and all of its descendants (Unity isolates an object "and its children").
 *  Document order, de-duplicated. */
export function isolationSet(scene: Scene, ids: Id[]): Id[] {
  const want = new Set<Id>();
  for (const id of ids) {
    const obj = findObject(scene, id);
    if (!obj) continue;
    want.add(id);
    for (let p = findParent(scene, id); p; p = findParent(scene, p.id)) want.add(p.id);
    if (obj.children) walkObjects(obj.children, (c: GameObject) => want.add(c.id));
  }
  return flattenObjects(scene).filter((o) => want.has(o.id)).map((o) => o.id);
}

/** All descendants (deep) of the given container ids, excluding the ids
 *  themselves — Unity's "Select Children". Document order, de-duplicated; ids
 *  without children contribute nothing. */
export function descendantIds(scene: Scene, ids: Id[]): Id[] {
  const out: Id[] = [];
  const seen = new Set<Id>();
  for (const id of ids) {
    const obj = findObject(scene, id);
    if (!obj?.children) continue;
    walkObjects(obj.children, (c) => {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        out.push(c.id);
      }
    });
  }
  return out;
}
