// ─────────────────────────────────────────────────────────────
// edits.ts — pure structural operations on a *draft* Project (a deep clone the
// store hands to `mutate`). These mutate the draft in place and are framework-
// free, so they're unit-tested directly. Higher-level, selection-aware verbs
// live in src/commands.ts and call these.
// ─────────────────────────────────────────────────────────────

import type { AnimTrack, EaseId, GameObject, Id, Keyframe, Project, Scene } from "../model/types";
import { findParent, findScene, walkObjects } from "../model/query";
import { uid, createKeyframe } from "../model/factory";

/** Find the live (mutable) scene inside a draft. */
export function mutScene(draft: Project, sceneId: Id): Scene | undefined {
  return findScene(draft, sceneId);
}

/** Find the live (mutable) object inside a draft scene. */
export function mutObject(scene: Scene, id: Id): GameObject | undefined {
  let found: GameObject | undefined;
  walkObjects(scene.objects, (o) => {
    if (o.id === id) found = o;
  });
  return found;
}

/** Remove an object by id from anywhere in the scene tree; returns it (detached). */
export function detachObject(scene: Scene, id: Id): GameObject | null {
  const fromList = (list: GameObject[]): GameObject | null => {
    const i = list.findIndex((o) => o.id === id);
    if (i >= 0) return list.splice(i, 1)[0];
    for (const o of list) {
      if (o.children) {
        const hit = fromList(o.children);
        if (hit) return hit;
      }
    }
    return null;
  };
  return fromList(scene.objects);
}

/** Insert an object into a parent container (or scene root when parentId null). */
export function insertObject(scene: Scene, obj: GameObject, parentId: Id | null, index?: number): void {
  const list = parentId ? mutObject(scene, parentId)?.children : scene.objects;
  if (!list) {
    scene.objects.push(obj);
    return;
  }
  if (index == null || index < 0 || index > list.length) list.push(obj);
  else list.splice(index, 0, obj);
}

/** Reorder an object within its current sibling list. dir: -1 up (toward front
 *  in list order), +1 down; or pass an absolute toIndex. */
export function reorderObject(scene: Scene, id: Id, opts: { dir?: -1 | 1; toIndex?: number }): void {
  const owner = ownerList(scene, id);
  if (!owner) return;
  const { list } = owner;
  const i = list.findIndex((o) => o.id === id);
  if (i < 0) return;
  let j = opts.toIndex != null ? opts.toIndex : i + (opts.dir ?? 0);
  j = Math.max(0, Math.min(list.length - 1, j));
  if (j === i) return;
  const [item] = list.splice(i, 1);
  list.splice(j, 0, item);
}

/** Move an object under a new parent (or to the scene root). Refuses to nest an
 *  object inside its own descendant. */
export function reparentObject(scene: Scene, id: Id, newParentId: Id | null, index?: number): boolean {
  if (id === newParentId) return false;
  if (newParentId && isAncestor(scene, id, newParentId)) return false;
  const obj = detachObject(scene, id);
  if (!obj) return false;
  insertObject(scene, obj, newParentId, index);
  return true;
}

/** Is `maybeAncestorId` an ancestor of `id` (or equal)? */
export function isAncestor(scene: Scene, maybeAncestorId: Id, id: Id): boolean {
  const anc = mutObject(scene, maybeAncestorId);
  if (!anc) return false;
  let hit = maybeAncestorId === id;
  if (anc.children) walkObjects(anc.children, (o) => { if (o.id === id) hit = true; });
  return hit;
}

function ownerList(scene: Scene, id: Id): { list: GameObject[] } | null {
  if (scene.objects.some((o) => o.id === id)) return { list: scene.objects };
  let res: { list: GameObject[] } | null = null;
  walkObjects(scene.objects, (o) => {
    if (o.children && o.children.some((c) => c.id === id)) res = { list: o.children };
  });
  return res;
}

// ── Clipboard helpers (Cut / Copy / Paste) ────────────────────
/** Deep-clone an object subtree, assigning a brand-new id to every node so the
 *  clone can sit alongside the original (or be pasted repeatedly) without id
 *  collisions. */
export function cloneWithNewIds(o: GameObject): GameObject {
  const copy = structuredClone(o);
  const rec = (n: GameObject) => {
    n.id = uid(n.kind);
    n.children?.forEach(rec);
  };
  rec(copy);
  return copy;
}

/** Reduce a selection to its "roots": drop any id whose ancestor is also in the
 *  set, so an operation over the selection never processes a node twice (e.g.
 *  copying a container together with one of its own children). Returns the
 *  survivors in document (tree) order. */
export function topLevelIds(scene: Scene, ids: Id[]): Id[] {
  const set = new Set(ids);
  const out: Id[] = [];
  walkObjects(scene.objects, (o) => {
    if (!set.has(o.id)) return;
    for (let p = findParent(scene, o.id); p; p = findParent(scene, p.id)) {
      if (set.has(p.id)) return; // an ancestor is selected → skip this node
    }
    out.push(o.id);
  });
  return out;
}

// ── Keyframes ─────────────────────────────────────────────────
export function sortKeyframes(track: AnimTrack): void {
  track.keyframes.sort((a, b) => a.time - b.time);
}

/** Insert a keyframe, replacing any existing one within `eps` seconds (so a
 *  re-record at the same time overwrites rather than duplicates). Keeps sorted. */
export function upsertKeyframe(track: AnimTrack, kf: Keyframe, eps = 1e-4): void {
  const i = track.keyframes.findIndex((k) => Math.abs(k.time - kf.time) <= eps);
  if (i >= 0) track.keyframes[i] = { ...track.keyframes[i], value: kf.value, ease: kf.ease };
  else track.keyframes.push(kf);
  sortKeyframes(track);
}

export function removeKeyframe(track: AnimTrack, kfId: Id): void {
  const i = track.keyframes.findIndex((k) => k.id === kfId);
  if (i >= 0) track.keyframes.splice(i, 1);
}

/** Paste a copied keyframe (value + ease) at `time` on `track` — Unity Animation
 *  "Paste Keys". Overwrites any keyframe already at that time (upsert) and keeps
 *  the track sorted. Distinct from keying the playhead, which captures the
 *  object's current value with a default ease. */
export function pasteKeyframeOnto(track: AnimTrack, clip: { value: number; ease: EaseId }, time: number): void {
  upsertKeyframe(track, createKeyframe(time, clip.value, { ease: clip.ease }));
}
