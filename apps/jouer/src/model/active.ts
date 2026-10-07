// ─────────────────────────────────────────────────────────────
// active.ts — pure helpers for Unity's GameObject active state. An object's
// `active` flag is its `activeSelf`; an object is active *in hierarchy* only when
// it and every ancestor are active. Inactive-in-hierarchy objects are excluded
// from the running/exported game (not rendered, no physics). Framework-free.
// ─────────────────────────────────────────────────────────────

import type { GameObject, Id } from "./types";

/** An object's own active flag (Unity's activeSelf). Defaults to true so older
 *  documents (and any object missing the field) read as active. */
export function isSelfActive(o: GameObject): boolean {
  return o.active !== false;
}

/** The set of ids that are inactive *in hierarchy* (Unity's `!activeInHierarchy`):
 *  every object that is itself inactive, plus every descendant of an inactive
 *  object (the cascade), regardless of the descendant's own `active`. */
export function collectInactiveIds(objects: GameObject[]): Set<Id> {
  const out = new Set<Id>();
  const rec = (list: GameObject[], parentInactive: boolean): void => {
    for (const o of list) {
      const inactive = parentInactive || !isSelfActive(o);
      if (inactive) out.add(o.id);
      if (o.children && o.children.length) rec(o.children, inactive);
    }
  };
  rec(objects, false);
  return out;
}
