// ─────────────────────────────────────────────────────────────
// query.ts — pure, read-only queries over the document model. No mutation, no
// React, no Phaser. The store, commands, the Phaser runtime and the panels all
// read through these so traversal logic lives in exactly one place.
// ─────────────────────────────────────────────────────────────

import type {
  GameObject,
  Id,
  Project,
  Scene,
  Timeline,
  TrackProperty,
} from "./types";

export function activeScene(p: Project): Scene | undefined {
  return p.scenes.find((s) => s.id === p.activeSceneId) ?? p.scenes[0];
}

export function findScene(p: Project, id: Id): Scene | undefined {
  return p.scenes.find((s) => s.id === id);
}

/** The scene the exported game boots into (Unity "Scenes In Build" first entry):
 *  the explicit startSceneId when it points at a real scene, else the active
 *  scene. Tolerant of a stale/absent start id. */
export function bootSceneId(p: Project): Id | null {
  const sid = p.startSceneId;
  if (sid && p.scenes.some((s) => s.id === sid)) return sid;
  return p.activeSceneId;
}

/** Depth-first walk of a scene's object tree (parents before children). */
export function walkObjects(objects: GameObject[], visit: (o: GameObject, parent: GameObject | null, depth: number) => void): void {
  const rec = (list: GameObject[], parent: GameObject | null, depth: number) => {
    for (const o of list) {
      visit(o, parent, depth);
      if (o.children && o.children.length) rec(o.children, o, depth + 1);
    }
  };
  rec(objects, null, 0);
}

/** Flat list of every object in the scene (containers + descendants). */
export function flattenObjects(scene: Scene | undefined): GameObject[] {
  const out: GameObject[] = [];
  if (scene) walkObjects(scene.objects, (o) => out.push(o));
  return out;
}

export function findObject(scene: Scene | undefined, id: Id | null): GameObject | undefined {
  if (!scene || !id) return undefined;
  let found: GameObject | undefined;
  walkObjects(scene.objects, (o) => {
    if (o.id === id) found = o;
  });
  return found;
}

/** The container holding `id`, or null if it's a top-level object. */
export function findParent(scene: Scene | undefined, id: Id): GameObject | null {
  if (!scene) return null;
  let parent: GameObject | null = null;
  walkObjects(scene.objects, (o, p) => {
    if (o.id === id) parent = p;
  });
  return parent;
}

/** The sibling array that directly contains `id` (the scene root list if top-level). */
export function siblingList(scene: Scene, id: Id): GameObject[] {
  const p = findParent(scene, id);
  return p?.children ?? scene.objects;
}

export function activeTimeline(scene: Scene | undefined): Timeline | undefined {
  if (!scene) return undefined;
  return scene.timelines.find((t) => t.id === scene.activeTimelineId) ?? scene.timelines[0];
}

/** Read a tween-able numeric property off an object. */
export function readProperty(o: GameObject, prop: TrackProperty): number {
  switch (prop) {
    case "x": return o.transform.x;
    case "y": return o.transform.y;
    case "scaleX": return o.transform.scaleX;
    case "scaleY": return o.transform.scaleY;
    case "angle": return o.transform.angle;
    case "alpha": return o.transform.alpha;
    case "originX": return o.transform.originX;
    case "originY": return o.transform.originY;
    case "width": return o.width ?? 0;
    case "height": return o.height ?? 0;
  }
}

/** Whether the project has at least one usable scene. */
export function sceneCount(p: Project): number {
  return p.scenes.length;
}

/** A short human label for an object (kind + name). */
export function objectLabel(o: GameObject): string {
  return o.name || o.kind;
}

/** Hierarchy-window display sort mode (Unity's Transform vs Alphabetical sort). */
export type HierarchySort = "transform" | "name";

/** Order one sibling level for the Hierarchy panel (returns a new array, never
 *  mutates). "transform" = render order (depth descending, front-most first —
 *  Jouer's default); "name" = case-insensitive natural compare on name, ties
 *  broken by depth descending so the order is deterministic. */
export function sortForHierarchy(objects: GameObject[], mode: HierarchySort): GameObject[] {
  const out = [...objects];
  if (mode === "name") {
    out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) || b.depth - a.depth);
  } else {
    out.sort((a, b) => b.depth - a.depth);
  }
  return out;
}

/** Flat list of object ids in the Hierarchy panel's top-to-bottom order
 *  (depth-first, each sibling level ordered by `mode`). Used for range-select.
 *  Includes every descendant regardless of per-row collapse state (collapse is a
 *  view concern, not in the model), so a range can span a collapsed container's
 *  children. */
export function hierarchyOrder(objects: GameObject[], mode: HierarchySort): Id[] {
  const out: Id[] = [];
  const rec = (list: GameObject[]): void => {
    for (const o of sortForHierarchy(list, mode)) {
      out.push(o.id);
      if (o.children && o.children.length) rec(o.children);
    }
  };
  rec(objects);
  return out;
}

/** The numeric value every item shares via `read`, or null when they differ
 *  ("mixed", for Unity-style multi-object inspector fields). Empty ⇒ null. */
export function sharedValue<T>(items: T[], read: (t: T) => number): number | null {
  if (items.length === 0) return null;
  const first = read(items[0]);
  return items.every((it) => read(it) === first) ? first : null;
}

/** Ids of every container that has children (DFS, nested included) — the rows
 *  that show an expand/collapse twirl. Used by Hierarchy "Collapse All". Leaf or
 *  childless containers and non-containers are skipped (nothing to collapse). */
export function collapsibleContainerIds(objects: GameObject[]): Id[] {
  const out: Id[] = [];
  walkObjects(objects, (o) => {
    if (o.kind === "container" && o.children && o.children.length > 0) out.push(o.id);
  });
  return out;
}

/** The inclusive slice of `order` between ids `a` and `b` (either direction) —
 *  a Hierarchy Shift+click range. Returns [b] when the anchor `a` isn't present,
 *  or [] when `b` isn't present. */
export function rangeBetween(order: Id[], a: Id, b: Id): Id[] {
  const ib = order.indexOf(b);
  if (ib < 0) return [];
  const ia = order.indexOf(a);
  if (ia < 0) return [b];
  const lo = Math.min(ia, ib), hi = Math.max(ia, ib);
  return order.slice(lo, hi + 1);
}
