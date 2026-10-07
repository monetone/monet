// ─────────────────────────────────────────────────────────────
// commands.ts — the editor's high-level, undo-wrapped verbs. Every structural
// change the UI, menus, shortcuts or the e2e hook performs goes through here.
// Each verb reads/writes via the store (clone-on-write undo) and keeps the
// selection sensible. Pure traversal/mutation lives in ops/ and model/.
// ─────────────────────────────────────────────────────────────

import { store } from "./state/app";
import type { ToolId } from "./state/store";
import {
  createGameObject,
  createScene,
  createTimeline,
  createTrack,
  createKeyframe,
  createTransition,
  createSpriteAnimation,
  createAsset,
  uid,
  slugKey,
} from "./model/factory";
import type {
  Asset,
  GameObject,
  GameObjectKind,
  Id,
  EaseId,
  Keyframe,
  PhysicsBody,
  Project,
  Scene,
  SpriteAnimation,
  Timeline,
  AnimTrack,
  Transform,
  Transition,
  TrackProperty,
} from "./model/types";
import {
  activeScene,
  activeTimeline,
  findObject,
  findParent,
  flattenObjects,
  hierarchyOrder,
  collapsibleContainerIds,
  rangeBetween,
  readProperty,
} from "./model/query";
import { allObjectIds, invertedIds, descendantIds, isolationSet } from "./model/selection";
import { centerDelta } from "./model/frame";
import { flipTransforms, type FlipAxis } from "./model/flip";
import { snapToGrid, snapValue } from "./model/snap";
import { stepPlayhead, nextKeyframeTime, prevKeyframeTime } from "./model/transport";
import { DEFAULT_SORTING_LAYER } from "./model/sorting";
import { DEFAULT_TAG } from "./model/tags";
import { resetTransformValues, pickTransformValues, applyTransformValues, constrainScale, ORIGIN_PRESETS, type OriginPreset, type ResetTarget, type ScalePatch, type TransformValues } from "./model/transform";
import {
  detachObject,
  insertObject,
  mutObject,
  reorderObject,
  reparentObject,
  upsertKeyframe,
  removeKeyframe,
  sortKeyframes,
  cloneWithNewIds,
  topLevelIds,
  pasteKeyframeOnto,
} from "./ops/edits";
import { autoKeyTracks, transformTrackProps } from "./ops/autokey";
import { bodyForPaste } from "./model/body";

// ── helpers ───────────────────────────────────────────────────
function curScene(d: Project): Scene | undefined {
  return activeScene(d);
}

// ── object creation ───────────────────────────────────────────
export interface AddObjectOpts {
  x?: number;
  y?: number;
  assetId?: Id | null;
  parentId?: Id | null;
  patch?: Partial<GameObject>;
  select?: boolean;
}

export function addObject(kind: GameObjectKind, opts: AddObjectOpts = {}): Id {
  const id = uid(kind);
  store.mutate(`Add ${kind}`, (d) => {
    const scene = curScene(d);
    if (!scene) return;
    const x = opts.x ?? scene.width / 2;
    const y = opts.y ?? scene.height / 2;
    const obj = createGameObject(kind, {
      assetId: opts.assetId ?? null,
      transform: { x, y, scaleX: 1, scaleY: 1, angle: 0, originX: 0.5, originY: 0.5, alpha: 1 },
      depth: nextDepth(scene),
      ...opts.patch,
    });
    obj.id = id;
    // Default-name uniquely, e.g. "Sprite 2".
    obj.name = uniqueName(scene, opts.patch?.name ?? obj.name);
    insertObject(scene, obj, opts.parentId ?? null);
  });
  if (opts.select !== false) store.selectOne(id);
  return id;
}

function nextDepth(scene: Scene): number {
  let max = 0;
  flattenObjects(scene).forEach((o) => (max = Math.max(max, o.depth)));
  return max + 1;
}

function uniqueName(scene: Scene, base: string): string {
  const names = new Set(flattenObjects(scene).map((o) => o.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

// ── object editing ────────────────────────────────────────────
export function updateObject(id: Id, patch: Partial<GameObject>, label = "Edit object"): void {
  store.mutate(label, (d) => {
    const scene = curScene(d);
    const o = scene && mutObject(scene, id);
    if (o) Object.assign(o, patch);
  });
}

export function updateTransform(id: Id, patch: Partial<Transform>, label = "Transform"): void {
  store.mutate(label, (d) => {
    const scene = curScene(d);
    const o = scene && mutObject(scene, id);
    if (!o) return;
    Object.assign(o.transform, patch);
    recordKeys(d, o, transformTrackProps(patch));
  });
}

/** Apply a scale-axis edit, expanding it to keep the aspect ratio when Constrain
 *  Proportions is on (Unity's scale lock). Routes through updateTransform so
 *  record-mode auto-key still fires on the resulting (possibly two-axis) patch. */
export function constrainedScale(id: Id, patch: ScalePatch): void {
  const o = findObject(activeScene(store.getProject()), id);
  if (!o) return;
  updateTransform(id, store.state.constrainProportions ? constrainScale(o.transform, patch) : patch);
}

/** Apply a transform patch to EVERY selected object (Unity multi-object edit) in
 *  one undo step; record-mode auto-keys each changed object. No-op with no
 *  selection. Like the single-object inspector field path (updateTransform), it
 *  edits locked objects too (the lock guards canvas drag, not inspector edits). */
export function setSelectionTransform(patch: Partial<Transform>): void {
  const ids = [...store.selection];
  if (ids.length === 0) return;
  store.mutate("Edit selection", (d) => {
    const scene = curScene(d);
    if (!scene) return;
    const props = transformTrackProps(patch);
    for (const id of ids) {
      const o = mutObject(scene, id);
      if (!o) continue;
      Object.assign(o.transform, patch);
      recordKeys(d, o, props);
    }
  });
}

/** Animation "Record" mode hook: when recording is on and there's an active
 *  timeline, auto-key the given (already-applied) properties of `o` at the
 *  playhead — inside the caller's mutate, so the edit + keys are one undo step.
 *  Scoped (by design, like Unity) to the interactive transform paths —
 *  `updateTransform` (inspector + scale/rotate gizmo), `translateSelection`
 *  (drag / arrow-nudge) and `setOriginPreset` (the pivot picker, which is a
 *  direct origin edit). Bulk menu ops (reset/flip/align/snap/paste) do not
 *  auto-key. */
function recordKeys(d: Project, o: GameObject, props: TrackProperty[]): void {
  if (!store.state.recording || props.length === 0) return;
  const tl = activeTimeline(curScene(d));
  if (tl) autoKeyTracks(tl, o, props, store.state.playhead);
}

export function renameObject(id: Id, name: string): void {
  updateObject(id, { name }, "Rename");
}

/** Translate every selected object by (dx, dy), optionally snapping each result
 *  to a grid. One undo step — used by the viewport drag-to-move. */
export function translateSelection(dx: number, dy: number, grid = 0): void {
  const ids = [...store.selection];
  if (ids.length === 0) return;
  const snap = (v: number) => (grid >= 2 ? Math.round(v / grid) * grid : Math.round(v * 100) / 100);
  store.mutate("Move", (d) => {
    const scene = curScene(d);
    if (!scene) return;
    for (const id of ids) {
      const o = mutObject(scene, id);
      if (o && !o.locked) {
        o.transform.x = snap(o.transform.x + dx);
        o.transform.y = snap(o.transform.y + dy);
        recordKeys(d, o, ["x", "y"]);
      }
    }
  });
}

/** Reset the (unlocked) selection's transform to identity — Unity's Transform
 *  "Reset" and its per-property variants. Position → 0, rotation → 0, scale → 1;
 *  origin and alpha are preserved. One undo step; skips locked; no-op when
 *  nothing is selected. */
export function resetTransform(target: ResetTarget = "all"): void {
  const ids = [...store.selection];
  if (ids.length === 0) return;
  store.mutate(target === "all" ? "Reset Transform" : `Reset ${target}`, (d) => {
    const scene = curScene(d);
    if (!scene) return;
    for (const id of ids) {
      const o = mutObject(scene, id);
      if (o && !o.locked) Object.assign(o.transform, resetTransformValues(o.transform, target));
    }
  });
}

// ── transform-values clipboard (Unity Copy/Paste Component Values) ──
let _transformClipboard: TransformValues | null = null;

/** Copy the sole-selected object's transform values — Unity's "Copy Component"
 *  for the Transform (position/rotation/scale). */
export function copyTransform(): void {
  const id = store.soleSelection();
  const scene = activeScene(store.getProject());
  const o = id && scene ? findObject(scene, id) : null;
  if (o) _transformClipboard = pickTransformValues(o.transform);
}

/** Whether a transform is on the clipboard (menu enable-state). */
export function canPasteTransform(): boolean {
  return _transformClipboard !== null;
}

/** Paste the copied transform values onto every (unlocked) selected object —
 *  Unity's "Paste Component Values". One undo step; preserves each object's
 *  origin + alpha; no-op when nothing is selected or the clipboard is empty. */
export function pasteTransform(): void {
  const v = _transformClipboard;
  if (!v) return;
  const ids = [...store.selection];
  if (ids.length === 0) return;
  store.mutate("Paste Transform", (d) => {
    const scene = curScene(d);
    if (!scene) return;
    for (const id of ids) {
      const o = mutObject(scene, id);
      if (o && !o.locked) Object.assign(o.transform, applyTransformValues(o.transform, v));
    }
  });
}

// ── physics-body clipboard (Unity Copy/Paste Component Values) ──
let _bodyClipboard: PhysicsBody | null = null;

/** Copy the sole-selected object's physics body — Unity's "Copy Component" for
 *  the Rigidbody2D/Collider2D. No-op when the object has no body. */
export function copyBody(): void {
  const id = store.soleSelection();
  const scene = activeScene(store.getProject());
  const o = id && scene ? findObject(scene, id) : null;
  if (o?.body) _bodyClipboard = structuredClone(o.body);
}

/** Whether a physics body is on the clipboard (menu enable-state). */
export function canPasteBody(): boolean {
  return _bodyClipboard !== null;
}

/** Paste the copied physics body onto every (unlocked, non-container) selected
 *  object — Unity's "Paste Component Values". Each target gets an independent
 *  clone. One undo step; no-op when nothing is selected or the clipboard is
 *  empty. */
export function pasteBody(): void {
  const v = _bodyClipboard;
  if (!v) return;
  const ids = [...store.selection];
  if (ids.length === 0) return;
  store.mutate("Paste Physics Body", (d) => {
    const scene = curScene(d);
    if (!scene) return;
    for (const id of ids) {
      const o = mutObject(scene, id);
      if (!o || o.locked) continue;
      const nb = bodyForPaste(o, v);
      if (nb) o.body = nb;
    }
  });
}

/** Set the origin/pivot of every (unlocked) selected object to a preset — Unity's
 *  Sprite Editor pivot dropdown. One undo step; auto-keys originX/originY at the
 *  playhead when Record mode is on (matching the Origin number-field path);
 *  no-op when nothing is selected. */
export function setOriginPreset(preset: OriginPreset): void {
  const ids = [...store.selection];
  if (ids.length === 0) return;
  const p = ORIGIN_PRESETS[preset];
  store.mutate("Set pivot", (d) => {
    const scene = curScene(d);
    if (!scene) return;
    for (const id of ids) {
      const o = mutObject(scene, id);
      if (o && !o.locked) {
        o.transform.originX = p.x;
        o.transform.originY = p.y;
        recordKeys(d, o, ["originX", "originY"]);
      }
    }
  });
}

export function setVisible(id: Id, visible: boolean): void {
  updateObject(id, { visible }, visible ? "Show" : "Hide");
}

/** Toggle a GameObject's active state (Unity's SetActive / the inspector +
 *  hierarchy checkbox). Inactive objects + their subtree are excluded from the
 *  running/exported game; distinct from `visible`. */
export function setActive(id: Id, active: boolean): void {
  updateObject(id, { active }, active ? "Activate" : "Deactivate");
}

export function setLocked(id: Id, locked: boolean): void {
  updateObject(id, { locked }, locked ? "Lock" : "Unlock");
}

export function deleteSelection(): void {
  const ids = [...store.selection];
  if (ids.length === 0) return;
  store.mutate("Delete", (d) => {
    const scene = curScene(d);
    if (!scene) return;
    ids.forEach((id) => detachObject(scene, id));
  });
  store.clearSelection();
}

export function duplicateSelection(): void {
  const ids = [...store.selection];
  if (ids.length === 0) return;
  const newIds: Id[] = [];
  store.mutate("Duplicate", (d) => {
    const scene = curScene(d);
    if (!scene) return;
    ids.forEach((id) => {
      const o = mutObject(scene, id);
      if (!o) return;
      const copy = cloneWithNewIds(o);
      copy.name = uniqueName(scene, o.name);
      copy.transform.x += 16;
      copy.transform.y += 16;
      copy.depth = nextDepth(scene);
      const parent = findParent(scene, id);
      insertObject(scene, copy, parent?.id ?? null);
      newIds.push(copy.id);
    });
  });
  if (newIds.length) store.select(newIds);
}

// ── clipboard (Cut / Copy / Paste — Unity Edit-menu parity) ───
// Module-level so the clipboard outlives selection + active-scene changes:
// Unity (and Jouer) paste a copied object into whatever scene is active, which
// is what Duplicate can't do. Holds detached deep clones; paste regenerates ids
// so the same clipboard can be pasted repeatedly without collisions.
let _clipboard: GameObject[] = [];

/** Copy the selection's top-level objects to the clipboard. Not a document
 *  edit — no undo step. */
export function copySelection(): void {
  const ids = [...store.selection];
  const scene = activeScene(store.getProject());
  if (!scene || ids.length === 0) return;
  _clipboard = topLevelIds(scene, ids)
    .map((id) => findObject(scene, id))
    .filter((o): o is GameObject => !!o)
    .map((o) => structuredClone(o));
}

/** Whether the clipboard holds anything (menu enable-state). */
export function canPaste(): boolean {
  return _clipboard.length > 0;
}

/** Cut = copy the selection, then delete it. */
export function cutSelection(): void {
  if (store.selection.length === 0) return;
  copySelection();
  if (_clipboard.length) deleteSelection();
}

/** Shared paste: insert fresh-id clones of the clipboard into `parentId` (a
 *  container) or the scene root, on top, named uniquely, selected — one undo
 *  step. Unity's Paste keeps each object's stored position. */
function pasteInto(parentId: Id | null, label: string): void {
  if (_clipboard.length === 0) return;
  const newIds: Id[] = [];
  store.mutate(label, (d) => {
    const scene = curScene(d);
    if (!scene) return;
    const target = parentId && mutObject(scene, parentId)?.kind === "container" ? parentId : null;
    for (const item of _clipboard) {
      const copy = cloneWithNewIds(item);
      copy.name = uniqueName(scene, item.name);
      copy.depth = nextDepth(scene);
      insertObject(scene, copy, target);
      newIds.push(copy.id);
    }
  });
  if (newIds.length) store.select(newIds);
}

/** Paste the clipboard at the scene root (Unity's Ctrl+V pastes at the same
 *  hierarchy level as the selection, not as a child). */
export function paste(): void {
  pasteInto(null, "Paste");
}

/** Paste the clipboard as children of the sole selected container (Unity's
 *  Ctrl+Shift+V "Paste as Child"); falls back to a root paste otherwise. */
export function pasteAsChild(): void {
  const sole = store.soleSelection();
  const scene = activeScene(store.getProject());
  const obj = sole && scene ? findObject(scene, sole) : null;
  pasteInto(obj?.kind === "container" ? sole : null, "Paste as child");
}

// ── selection commands (Unity Edit ▸ Select All / Deselect / Invert) ──
/** Select every object in the active scene (Unity's Ctrl+A). */
export function selectAll(): void {
  const scene = activeScene(store.getProject());
  if (scene) store.select(allObjectIds(scene));
}

/** Clear the selection (Unity's Deselect All). */
export function deselectAll(): void {
  store.clearSelection();
}

/** Select everything that isn't currently selected (Unity's Invert Selection). */
export function invertSelection(): void {
  const scene = activeScene(store.getProject());
  if (scene) store.select(invertedIds(scene, store.selection));
}

/** Unity "Save Selection N": stash the current selection in slot "1".."9". */
export function saveSelectionSet(slot: string): void {
  store.saveSelectionSet(slot);
}

/** Unity "Load Selection N": restore the selection saved in slot "1".."9"
 *  (objects that still exist in the active scene). */
export function loadSelectionSet(slot: string): void {
  store.loadSelectionSet(slot);
}

/** Toggle Unity's "Isolate Selection" scene-view mode (Shift+H): when off,
 *  capture the selection plus its ancestors + descendants so only those show in
 *  the editor; when on, exit. Editor-only — the model and export are untouched.
 *  No-op when turning it on with nothing selected. */
export function toggleIsolateSelection(): void {
  if (store.state.isolatedIds !== null) {
    store.setIsolation(null);
    return;
  }
  const scene = activeScene(store.getProject());
  if (!scene || store.selection.length === 0) return;
  store.setIsolation(isolationSet(scene, store.selection));
}

/** Toggle Unity's "Lock View to Selected": when on, the editor camera follows
 *  the selected object as it moves; when off, it stops. */
export function toggleFollowSelection(): void {
  store.setFollowSelection(!store.state.followSelection);
}

/** Set the Hierarchy search query (Unity's Hierarchy search bar) — filters the
 *  scene tree by name + `t:type`. Editor-only view state; no undo step. */
export function setHierarchyFilter(query: string): void {
  store.setHierarchyFilter(query);
}

/** Clear the Hierarchy search query (Unity's clear-search "×"). */
export function clearHierarchyFilter(): void {
  store.setHierarchyFilter("");
}

/** Set Animation "Record" mode (Unity's red Record button): while on, transform
 *  edits auto-key the changed properties at the playhead. No undo step. */
export function setRecording(v: boolean): void {
  store.setRecording(v);
}

/** Toggle Animation "Record" mode. */
export function toggleRecording(): void {
  store.setRecording(!store.state.recording);
}

/** Replace the selection with the descendants of the selected containers
 *  (Unity's "Select Children"). No-op when nothing selected has children. */
export function selectChildren(): void {
  const scene = activeScene(store.getProject());
  if (!scene) return;
  const kids = descendantIds(scene, store.selection);
  if (kids.length) store.select(kids);
}

/** Select the contiguous range of hierarchy rows from the selection anchor to
 *  `targetId`, in display order (Unity's Shift+click). With no anchor, selects
 *  just the target and sets it as the anchor. Keeps the anchor for further
 *  Shift+clicks. */
export function selectHierarchyRange(targetId: Id): void {
  const scene = activeScene(store.getProject());
  if (!scene) return;
  const anchor = store.selectionAnchor;
  if (!anchor) {
    store.selectOne(targetId);
    store.setSelectionAnchor(targetId);
    return;
  }
  const order = hierarchyOrder(scene.objects, store.state.hierarchySort);
  const ids = rangeBetween(order, anchor, targetId);
  if (ids.length) store.select(ids);
}

/** Collapse every container with children in the active scene (Unity Hierarchy
 *  "Collapse All"). Editor view state — not an undo step. */
export function collapseAllHierarchy(): void {
  const scene = activeScene(store.getProject());
  if (!scene) return;
  store.collapseAll(collapsibleContainerIds(scene.objects));
}

/** Expand every collapsed container (Unity Hierarchy "Expand All"). */
export function expandAllHierarchy(): void {
  store.expandAll();
}

/** Translate the (unlocked) selection so its bounding-box centre lands on the
 *  world point (cx, cy) — the model half of Unity's "Move to View". Preserves
 *  the selection's relative layout; one undo step; no-op when nothing movable
 *  is selected or it's already centred. */
export function moveSelectionToPoint(cx: number, cy: number): void {
  const scene = activeScene(store.getProject());
  if (!scene) return;
  const movable = store.selection
    .map((id) => findObject(scene, id))
    .filter((o): o is GameObject => !!o && !o.locked);
  if (movable.length === 0) return;
  const { dx, dy } = centerDelta(movable.map((o) => ({ x: o.transform.x, y: o.transform.y })), { x: cx, y: cy });
  if (dx === 0 && dy === 0) return;
  const ids = movable.map((o) => o.id);
  store.mutate("Move to view", (d) => {
    const s = curScene(d);
    if (!s) return;
    for (const id of ids) {
      const o = mutObject(s, id);
      if (o && !o.locked) {
        o.transform.x += dx;
        o.transform.y += dy;
      }
    }
  });
}

/** Flip the (unlocked) selection horizontally or vertically — the Edit-menu
 *  "Flip Horizontal/Vertical", realised as a negative-scale mirror (Unity's
 *  transform-level flip: negate the transform scale). Mirrors each object across
 *  the selection's shared centre, so a multi-object selection flips as a whole.
 *  Distinct from the per-object render-only SpriteRenderer Flip X/Y (`flipX`/
 *  `flipY`, set in the Texture inspector). One undo step; skips locked objects;
 *  no-op when nothing movable is selected. */
export function flipSelection(axis: FlipAxis): void {
  const scene = activeScene(store.getProject());
  if (!scene) return;
  const movable = store.selection
    .map((id) => findObject(scene, id))
    .filter((o): o is GameObject => !!o && !o.locked);
  if (movable.length === 0) return;
  const flipped = flipTransforms(
    movable.map((o) => ({ id: o.id, x: o.transform.x, y: o.transform.y, scaleX: o.transform.scaleX, scaleY: o.transform.scaleY })),
    axis,
  );
  store.mutate(axis === "horizontal" ? "Flip Horizontal" : "Flip Vertical", (d) => {
    const s = curScene(d);
    if (!s) return;
    for (const f of flipped) {
      const o = mutObject(s, f.id);
      if (o && !o.locked) {
        o.transform.x = f.x;
        o.transform.y = f.y;
        o.transform.scaleX = f.scaleX;
        o.transform.scaleY = f.scaleY;
      }
    }
  });
}

/** Snap each (unlocked) selected object's position to the grid — Unity's "Grid
 *  and Snap → Snap All Axes". Uses the current grid size; one undo step; a no-op
 *  when the grid is off (< 2), nothing movable is selected, or everything is
 *  already aligned. */
export function snapSelectionToGrid(): void {
  const grid = store.state.gridSize;
  if (grid < 2) return;
  const scene = activeScene(store.getProject());
  if (!scene) return;
  const movable = store.selection
    .map((id) => findObject(scene, id))
    .filter((o): o is GameObject => !!o && !o.locked);
  if (movable.length === 0) return;
  const changes = movable.map((o) => ({ id: o.id, x: snapToGrid(o.transform.x, grid), y: snapToGrid(o.transform.y, grid), from: o.transform }));
  if (changes.every((c) => c.x === c.from.x && c.y === c.from.y)) return; // already aligned
  store.mutate("Snap to Grid", (d) => {
    const s = curScene(d);
    if (!s) return;
    for (const c of changes) {
      const o = mutObject(s, c.id);
      if (o && !o.locked) {
        o.transform.x = c.x;
        o.transform.y = c.y;
      }
    }
  });
}

/** Snap each (unlocked) selected object's rotation to the rotation-snap increment
 *  — Unity's "Grid and Snap → Rotate". One undo step; a no-op when nothing movable
 *  is selected or every angle is already aligned. */
export function snapSelectionRotation(): void {
  const step = store.state.rotationSnap;
  if (step < 1) return; // always >= 1 after clamp; a 1° step is valid (unlike grid < 2 px)
  const scene = activeScene(store.getProject());
  if (!scene) return;
  const movable = store.selection
    .map((id) => findObject(scene, id))
    .filter((o): o is GameObject => !!o && !o.locked);
  if (movable.length === 0) return;
  const changes = movable.map((o) => ({ id: o.id, angle: snapToGrid(o.transform.angle, step), from: o.transform.angle }));
  if (changes.every((c) => c.angle === c.from)) return; // already aligned
  store.mutate("Snap Rotation", (d) => {
    const s = curScene(d);
    if (!s) return;
    for (const c of changes) {
      const o = mutObject(s, c.id);
      if (o && !o.locked) o.transform.angle = c.angle;
    }
  });
}

/** Snap each (unlocked) selected object's scale to the scale-snap increment —
 *  Unity's "Grid and Snap → Scale". One undo step; a no-op when nothing movable
 *  is selected or every scale is already aligned. Snapped scales are rounded to
 *  3 decimals (the editor's scale-commit precision) to avoid float drift. */
export function snapSelectionScale(): void {
  const step = store.state.scaleSnap;
  if (step <= 0) return;
  const scene = activeScene(store.getProject());
  if (!scene) return;
  const movable = store.selection
    .map((id) => findObject(scene, id))
    .filter((o): o is GameObject => !!o && !o.locked);
  if (movable.length === 0) return;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const changes = movable.map((o) => ({ id: o.id, scaleX: r3(snapValue(o.transform.scaleX, step)), scaleY: r3(snapValue(o.transform.scaleY, step)), from: o.transform }));
  if (changes.every((c) => c.scaleX === c.from.scaleX && c.scaleY === c.from.scaleY)) return; // already aligned
  store.mutate("Snap Scale", (d) => {
    const s = curScene(d);
    if (!s) return;
    for (const c of changes) {
      const o = mutObject(s, c.id);
      if (o && !o.locked) {
        o.transform.scaleX = c.scaleX;
        o.transform.scaleY = c.scaleY;
      }
    }
  });
}

// ── sorting layers (Unity 2D render ordering) ─────────────────
/** Assign an object to a sorting layer (Unity's "Sorting Layer"). */
export function setSortingLayer(id: Id, layer: string): void {
  updateObject(id, { sortingLayer: layer }, "Set sorting layer");
}

/** Add a new (unique, non-empty) sorting layer to the project's ordered list. */
export function addSortingLayer(name: string): void {
  const clean = name.trim();
  if (!clean) return;
  store.mutate("Add sorting layer", (d) => {
    if (!d.sortingLayers.includes(clean)) d.sortingLayers.push(clean);
  });
}

/** Remove a sorting layer (never "Default") and reassign any objects that were
 *  on it back to Default so nothing points at a missing layer. */
export function removeSortingLayer(name: string): void {
  if (name === DEFAULT_SORTING_LAYER) return;
  store.mutate("Remove sorting layer", (d) => {
    d.sortingLayers = d.sortingLayers.filter((l) => l !== name);
    for (const scene of d.scenes) {
      flattenObjects(scene).forEach((o) => {
        if (o.sortingLayer === name) o.sortingLayer = DEFAULT_SORTING_LAYER;
      });
    }
  });
}

/** Move a sorting layer within the render order: dir -1 toward the back (lower
 *  index), dir +1 toward the front (higher index). */
export function moveSortingLayer(name: string, dir: -1 | 1): void {
  store.mutate("Reorder sorting layer", (d) => {
    const i = d.sortingLayers.indexOf(name);
    if (i < 0) return;
    const j = Math.max(0, Math.min(d.sortingLayers.length - 1, i + dir));
    if (j === i) return;
    const [item] = d.sortingLayers.splice(i, 1);
    d.sortingLayers.splice(j, 0, item);
  });
}

/** Rename a sorting layer (never "Default") in place — Unity's Sorting Layers
 *  editor rename. The entry keeps its index (render order is unchanged) and every
 *  object on it, across all scenes, is reassigned to the new name. A no-op on an
 *  empty/unchanged/unknown name or a collision with an existing layer (no merge);
 *  guards are checked before the mutate so a no-op adds no undo step. */
export function renameSortingLayer(name: string, to: string): void {
  if (name === DEFAULT_SORTING_LAYER) return;
  const clean = to.trim();
  if (!clean || clean === name) return;
  const layers = store.getProject().sortingLayers ?? [];
  if (!layers.includes(name) || layers.includes(clean)) return;
  store.mutate("Rename sorting layer", (d) => {
    const i = d.sortingLayers.indexOf(name);
    if (i < 0) return;
    d.sortingLayers[i] = clean;
    for (const scene of d.scenes) {
      flattenObjects(scene).forEach((o) => {
        if (o.sortingLayer === name) o.sortingLayer = clean;
      });
    }
  });
}

// ── tags (Unity object identification) ────────────────────────
/** Assign an object's tag (Unity's "Tag" dropdown). */
export function setTag(id: Id, tag: string): void {
  updateObject(id, { tag }, "Set tag");
}

/** Add a new (unique, non-empty) tag to the project's tag list. */
export function addTag(name: string): void {
  const clean = name.trim();
  if (!clean) return;
  store.mutate("Add tag", (d) => {
    if (!d.tags.includes(clean)) d.tags.push(clean);
  });
}

/** Remove a tag (never "Untagged") and reassign any objects that carried it back
 *  to Untagged so nothing points at a missing tag. */
export function removeTag(name: string): void {
  if (name === DEFAULT_TAG) return;
  store.mutate("Remove tag", (d) => {
    d.tags = d.tags.filter((t) => t !== name);
    for (const scene of d.scenes) {
      flattenObjects(scene).forEach((o) => {
        if (o.tag === name) o.tag = DEFAULT_TAG;
      });
    }
  });
}

export function reorder(id: Id, dir: -1 | 1): void {
  store.mutate(dir < 0 ? "Move up" : "Move down", (d) => {
    const scene = curScene(d);
    if (scene) reorderObject(scene, id, { dir });
  });
}

export function bringToFront(id: Id): void {
  store.mutate("Bring to front", (d) => {
    const scene = curScene(d);
    const o = scene && mutObject(scene, id);
    if (scene && o) o.depth = nextDepth(scene);
  });
}

export function sendToBack(id: Id): void {
  store.mutate("Send to back", (d) => {
    const scene = curScene(d);
    const o = scene && mutObject(scene, id);
    if (!scene || !o) return;
    let min = 0;
    flattenObjects(scene).forEach((x) => (min = Math.min(min, x.depth)));
    o.depth = min - 1;
  });
}

export function reparent(id: Id, parentId: Id | null): void {
  store.mutate("Reparent", (d) => {
    const scene = curScene(d);
    if (scene) reparentObject(scene, id, parentId);
  });
}

/** Wrap the current selection into a new container, preserving world positions. */
export function groupSelection(): void {
  const ids = [...store.selection];
  if (ids.length === 0) return;
  let containerId: Id | null = null;
  store.mutate("Group", (d) => {
    const scene = curScene(d);
    if (!scene) return;
    const objs = ids.map((id) => mutObject(scene, id)).filter(Boolean) as GameObject[];
    if (objs.length === 0) return;
    // Centroid of selection → container position.
    const cx = objs.reduce((s, o) => s + o.transform.x, 0) / objs.length;
    const cy = objs.reduce((s, o) => s + o.transform.y, 0) / objs.length;
    const container = createGameObject("container", {
      name: uniqueName(scene, "Group"),
      transform: { x: cx, y: cy, scaleX: 1, scaleY: 1, angle: 0, originX: 0.5, originY: 0.5, alpha: 1 },
      depth: nextDepth(scene),
    });
    // Detach selected (top-level order preserved) and re-add relative to container.
    const detached = ids.map((id) => detachObject(scene, id)).filter(Boolean) as GameObject[];
    detached.forEach((o) => {
      o.transform.x -= cx;
      o.transform.y -= cy;
      container.children!.push(o);
    });
    scene.objects.push(container);
    containerId = container.id;
  });
  if (containerId) store.selectOne(containerId);
}

/** Dissolve a container, lifting children back to its parent at world positions. */
export function ungroup(id: Id): void {
  const lifted: Id[] = [];
  store.mutate("Ungroup", (d) => {
    const scene = curScene(d);
    if (!scene) return;
    const container = mutObject(scene, id);
    if (!container || container.kind !== "container" || !container.children) return;
    const parent = findParent(scene, id);
    const list = parent?.children ?? scene.objects;
    const at = list.findIndex((o) => o.id === id);
    const kids = container.children;
    kids.forEach((k, i) => {
      k.transform.x += container.transform.x;
      k.transform.y += container.transform.y;
      list.splice(at + 1 + i, 0, k);
      lifted.push(k.id);
    });
    const ci = list.findIndex((o) => o.id === id);
    if (ci >= 0) list.splice(ci, 1);
  });
  if (lifted.length) store.select(lifted);
}

export function alignSelection(edge: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom"): void {
  const ids = [...store.selection];
  if (ids.length < 2) return;
  store.mutate(`Align ${edge}`, (d) => {
    const scene = curScene(d);
    if (!scene) return;
    const objs = ids.map((id) => mutObject(scene, id)).filter(Boolean) as GameObject[];
    const xs = objs.map((o) => o.transform.x);
    const ys = objs.map((o) => o.transform.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    for (const o of objs) {
      if (edge === "left") o.transform.x = minX;
      else if (edge === "right") o.transform.x = maxX;
      else if (edge === "hcenter") o.transform.x = (minX + maxX) / 2;
      else if (edge === "top") o.transform.y = minY;
      else if (edge === "bottom") o.transform.y = maxY;
      else if (edge === "vcenter") o.transform.y = (minY + maxY) / 2;
    }
  });
}

// ── scenes ────────────────────────────────────────────────────
export function addScene(): Id {
  const id = uid("scene");
  store.mutate("Add scene", (d) => {
    const n = d.scenes.length + 1;
    const scene = createScene(`Scene ${n}`, { width: d.width, height: d.height });
    scene.id = id;
    scene.key = uniqueSceneKey(d, scene.key);
    d.scenes.push(scene);
    d.activeSceneId = id;
  });
  store.select([]);
  return id;
}

export function duplicateScene(id: Id): Id {
  const newId = uid("scene");
  store.mutate("Duplicate scene", (d) => {
    const src = d.scenes.find((s) => s.id === id);
    if (!src) return;
    const copy: Scene = structuredClone(src);
    copy.id = newId;
    copy.name = `${src.name} copy`;
    copy.key = uniqueSceneKey(d, slugKey(copy.name));
    // Fresh ids throughout so nothing collides.
    copy.objects.forEach((o) => regenSceneObjIds(o, copy));
    copy.timelines = copy.timelines.map((t) => ({ ...t, id: uid("tl") }));
    copy.activeTimelineId = copy.timelines[0]?.id ?? null;
    d.scenes.push(copy);
    d.activeSceneId = newId;
  });
  return newId;
}

function regenSceneObjIds(o: GameObject, _scene: Scene): void {
  o.id = uid(o.kind);
  if (o.children) o.children.forEach((c) => regenSceneObjIds(c, _scene));
}

export function deleteScene(id: Id): void {
  store.mutate("Delete scene", (d) => {
    if (d.scenes.length <= 1) return; // always keep one
    const i = d.scenes.findIndex((s) => s.id === id);
    if (i < 0) return;
    d.scenes.splice(i, 1);
    d.transitions = d.transitions.filter((t) => t.fromSceneId !== id && t.toSceneId !== id);
    if (d.activeSceneId === id) d.activeSceneId = d.scenes[0]?.id ?? null;
    if (d.startSceneId === id) d.startSceneId = null; // deleted start scene → fall back to active
  });
}

export function updateScene(id: Id, patch: Partial<Scene>, label = "Edit scene"): void {
  store.mutate(label, (d) => {
    const s = d.scenes.find((x) => x.id === id);
    if (s) Object.assign(s, patch);
  });
}

/** Set (or clear, with null) the scene the exported game boots into — Unity's
 *  "Set as Start Scene" / Scenes In Build. A non-existent id is ignored. */
export function setStartScene(sceneId: Id | null): void {
  store.mutate("Set start scene", (d) => {
    if (sceneId === null || d.scenes.some((s) => s.id === sceneId)) d.startSceneId = sceneId;
  });
}

export function renameScene(id: Id, name: string): void {
  store.mutate("Rename scene", (d) => {
    const s = d.scenes.find((x) => x.id === id);
    if (!s) return;
    s.name = name;
    s.key = uniqueSceneKey(d, slugKey(name), id);
  });
}

function uniqueSceneKey(d: Project, base: string, exceptId?: Id): string {
  const keys = new Set(d.scenes.filter((s) => s.id !== exceptId).map((s) => s.key));
  if (!keys.has(base)) return base;
  let i = 2;
  while (keys.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

// ── timelines ─────────────────────────────────────────────────
export function addTimeline(): Id {
  const id = uid("tl");
  store.mutate("Add timeline", (d) => {
    const s = curScene(d);
    if (!s) return;
    const tl = createTimeline(`Timeline ${s.timelines.length + 1}`);
    tl.id = id;
    s.timelines.push(tl);
    s.activeTimelineId = id;
  });
  return id;
}

export function deleteTimeline(id: Id): void {
  store.mutate("Delete timeline", (d) => {
    const s = curScene(d);
    if (!s || s.timelines.length <= 1) return;
    const i = s.timelines.findIndex((t) => t.id === id);
    if (i < 0) return;
    s.timelines.splice(i, 1);
    if (s.activeTimelineId === id) s.activeTimelineId = s.timelines[0]?.id ?? null;
  });
}

export function updateTimeline(id: Id, patch: Partial<Timeline>, label = "Edit timeline"): void {
  store.mutate(label, (d) => {
    const s = curScene(d);
    const tl = s?.timelines.find((t) => t.id === id);
    if (tl) Object.assign(tl, patch);
  });
}

// ── animation tracks + keyframes ──────────────────────────────
/** Add a track for (object, property) if one doesn't exist; key the current
 *  value at the playhead. Returns the track id. */
export function addTrack(targetId: Id, property: TrackProperty): Id {
  let trackId = "";
  const playhead = store.state.playhead;
  store.mutate(`Add ${property} track`, (d) => {
    const s = curScene(d);
    const tl = activeTimeline(s);
    const obj = s && findObject(s, targetId);
    if (!s || !tl || !obj) return;
    let track = tl.tracks.find((t) => t.targetId === targetId && t.property === property);
    if (track?.locked) { trackId = track.id; return; } // can't add a key to a locked track
    if (!track) {
      track = createTrack(targetId, property);
      tl.tracks.push(track);
    }
    trackId = track.id;
    upsertKeyframe(track, createKeyframe(playhead, readProperty(obj, property)));
  });
  return trackId;
}

export function removeTrack(trackId: Id): void {
  store.mutate("Remove track", (d) => {
    const tl = activeTimeline(curScene(d));
    if (!tl) return;
    const i = tl.tracks.findIndex((t) => t.id === trackId);
    if (i >= 0 && !tl.tracks[i].locked) tl.tracks.splice(i, 1); // a locked track can't be removed
  });
}

/** Mute/unmute a track (Unity Timeline track mute): a muted track keeps its
 *  keyframes but drives nothing. The flag is deleted when unmuted so an active
 *  track stays clean. One undo step. */
export function setTrackMuted(trackId: Id, muted: boolean): void {
  store.mutate(muted ? "Mute track" : "Unmute track", (d) => {
    const tl = activeTimeline(curScene(d));
    const track = tl?.tracks.find((t) => t.id === trackId);
    if (!track) return;
    if (muted) track.muted = true;
    else delete track.muted;
  });
}

/** Solo/unsolo a track (Unity Timeline track solo): while any track is soloed,
 *  only soloed (non-muted) tracks drive their targets. The flag is deleted when
 *  unsoloed so an unaffected track stays clean. One undo step. */
export function setTrackSolo(trackId: Id, solo: boolean): void {
  store.mutate(solo ? "Solo track" : "Unsolo track", (d) => {
    const tl = activeTimeline(curScene(d));
    const track = tl?.tracks.find((t) => t.id === trackId);
    if (!track) return;
    if (solo) track.solo = true;
    else delete track.solo;
  });
}

/** Lock/unlock a track (Unity Timeline track lock): a locked track still plays
 *  but is read-only — every keyframe/track edit becomes a no-op until unlocked.
 *  The flag is deleted when unlocked so an unlocked track stays clean. One undo step. */
export function setTrackLocked(trackId: Id, locked: boolean): void {
  store.mutate(locked ? "Lock track" : "Unlock track", (d) => {
    const tl = activeTimeline(curScene(d));
    const track = tl?.tracks.find((t) => t.id === trackId);
    if (!track) return;
    if (locked) track.locked = true;
    else delete track.locked;
  });
}

/** Key every transform property of an object at the playhead (one undo step). */
export function keyAllTransform(targetId: Id): void {
  const props: TrackProperty[] = ["x", "y", "scaleX", "scaleY", "angle", "alpha"];
  const playhead = store.state.playhead;
  store.mutate("Key transform", (d) => {
    const s = curScene(d);
    const tl = activeTimeline(s);
    const obj = s && findObject(s, targetId);
    if (!s || !tl || !obj) return;
    for (const property of props) {
      let track = tl.tracks.find((t) => t.targetId === targetId && t.property === property);
      if (track?.locked) continue; // skip a locked track
      if (!track) {
        track = createTrack(targetId, property);
        tl.tracks.push(track);
      }
      upsertKeyframe(track, createKeyframe(playhead, readProperty(obj, property)));
    }
  });
}

/** Insert/overwrite a keyframe on a track at the playhead with a value (or the
 *  object's current property value if omitted). */
export function keyframeAtPlayhead(trackId: Id, value?: number): void {
  const playhead = store.state.playhead;
  store.mutate("Add keyframe", (d) => {
    const s = curScene(d);
    const tl = activeTimeline(s);
    const track = tl?.tracks.find((t) => t.id === trackId);
    if (!s || !track || track.locked) return;
    const obj = findObject(s, track.targetId);
    const v = value ?? (obj ? readProperty(obj, track.property) : 0);
    upsertKeyframe(track, createKeyframe(playhead, v));
  });
}

export function deleteKeyframe(trackId: Id, kfId: Id): void {
  store.mutate("Delete keyframe", (d) => {
    const tl = activeTimeline(curScene(d));
    const track = tl?.tracks.find((t) => t.id === trackId);
    if (track && !track.locked) removeKeyframe(track, kfId);
  });
}

export function updateKeyframe(trackId: Id, kfId: Id, patch: Partial<Keyframe>): void {
  store.mutate("Edit keyframe", (d) => {
    const tl = activeTimeline(curScene(d));
    const track = tl?.tracks.find((t) => t.id === trackId);
    const kf = track?.keyframes.find((k) => k.id === kfId);
    if (track && !track.locked && kf) {
      Object.assign(kf, patch);
      sortKeyframes(track);
    }
  });
}

// ── keyframe clipboard (Unity Animation Copy/Paste Keys) ──
let _keyframeClipboard: { value: number; ease: EaseId } | null = null;

/** Copy a keyframe's value + easing — Unity Animation "Copy Keys". Snapshots the
 *  primitives (not the keyframe ref) so later edits to the source can't leak into
 *  the clipboard. */
export function copyKeyframe(trackId: Id, kfId: Id): void {
  const tl = activeTimeline(activeScene(store.getProject()));
  const kf = tl?.tracks.find((t) => t.id === trackId)?.keyframes.find((k) => k.id === kfId);
  if (kf) _keyframeClipboard = { value: kf.value, ease: kf.ease };
}

/** Whether a keyframe is on the clipboard (menu/button enable-state). */
export function canPasteKeyframe(): boolean {
  return _keyframeClipboard !== null;
}

/** Paste the copied keyframe at the playhead on `trackId` — Unity Animation
 *  "Paste Keys". Overwrites any keyframe already at that time. One undo step;
 *  no-op when the clipboard is empty or the track is gone. */
export function pasteKeyframe(trackId: Id): void {
  const clip = _keyframeClipboard;
  if (!clip) return;
  const playhead = store.state.playhead;
  store.mutate("Paste keyframe", (d) => {
    const track = activeTimeline(curScene(d))?.tracks.find((t) => t.id === trackId);
    if (track && !track.locked) pasteKeyframeOnto(track, clip, playhead);
  });
}

/** Sort keyframes by time and collapse any that land within `eps` of each other
 *  (keeping the one-keyframe-per-time invariant `upsertKeyframe` enforces). */
function sortDedupe(keyframes: Keyframe[], eps = 1e-4): Keyframe[] {
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  const out: Keyframe[] = [];
  for (const k of sorted) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.time - k.time) <= eps) out[out.length - 1] = k;
    else out.push(k);
  }
  return out;
}

function applyTrackKeyframes(d: Project, trackId: Id, keyframes: Keyframe[]): void {
  const tl = activeTimeline(curScene(d));
  const track = tl?.tracks.find((t) => t.id === trackId);
  // Guards the keyframe drag (live/commit) + setTrackKeyframes paths against a
  // locked track (Unity Timeline lock) — the shared choke point for all three.
  if (track && !track.locked) track.keyframes = sortDedupe(keyframes);
}

/** Replace a whole track's keyframes as a single undo step (programmatic use). */
export function setTrackKeyframes(trackId: Id, keyframes: Keyframe[]): void {
  store.mutate("Move keyframes", (d) => applyTrackKeyframes(d, trackId, keyframes));
}

// Keyframe drag coalescing: the timeline fires onChange on every pointer move
// (a live, non-undoable preview) and onChange*End* once on release (the single
// undo step, rewindable to the pre-drag state captured on the first move).
let _kfDragBaseline: Project | null = null;

export function liveTrackKeyframes(trackId: Id, keyframes: Keyframe[]): void {
  if (!_kfDragBaseline) _kfDragBaseline = store.getProject();
  store.patch((d) => applyTrackKeyframes(d, trackId, keyframes));
}

export function commitTrackKeyframes(trackId: Id, keyframes: Keyframe[]): void {
  const baseline = _kfDragBaseline ?? store.getProject();
  _kfDragBaseline = null;
  store.commitFrom(baseline, "Edit keyframes", (d) => applyTrackKeyframes(d, trackId, keyframes));
}

// ── assets ────────────────────────────────────────────────────
export function addAsset(asset: Asset): Id {
  store.mutate("Add asset", (d) => {
    // Ensure a unique loader key.
    const names = new Set(d.assets.map((a) => a.name));
    let name = asset.name;
    let i = 2;
    while (names.has(name)) name = `${asset.name}_${i++}`;
    d.assets.push({ ...asset, name });
  });
  return asset.id;
}

export function addImageAsset(name: string, src: string, kind: "image" | "spritesheet" = "image", over: Partial<Asset> = {}): Id {
  return addAsset(createAsset(kind, slugKey(name), src, over));
}

export function removeAsset(id: Id): void {
  store.mutate("Remove asset", (d) => {
    d.assets = d.assets.filter((a) => a.id !== id);
    // Detach references.
    d.animations = d.animations.filter((an) => an.assetId !== id);
    d.scenes.forEach((s) => flattenObjects(s).forEach((o) => { if (o.assetId === id) o.assetId = null; }));
  });
}

export function updateAsset(id: Id, patch: Partial<Asset>): void {
  store.mutate("Edit asset", (d) => {
    const a = d.assets.find((x) => x.id === id);
    if (a) Object.assign(a, patch);
  });
}

// ── sprite-sheet animations ───────────────────────────────────
export function addAnimation(key: string, assetId: Id, over: Partial<SpriteAnimation> = {}): Id {
  const id = uid("anim");
  store.mutate("Add animation", (d) => {
    const keys = new Set(d.animations.map((a) => a.key));
    let k = slugKey(key);
    let i = 2;
    while (keys.has(k)) k = `${slugKey(key)}_${i++}`;
    const an = createSpriteAnimation(k, assetId, over);
    an.id = id;
    d.animations.push(an);
  });
  return id;
}

export function removeAnimation(id: Id): void {
  store.mutate("Remove animation", (d) => {
    d.animations = d.animations.filter((a) => a.id !== id);
  });
}

export function updateAnimation(id: Id, patch: Partial<SpriteAnimation>): void {
  store.mutate("Edit animation", (d) => {
    const a = d.animations.find((x) => x.id === id);
    if (a) Object.assign(a, patch);
  });
}

// ── transitions ───────────────────────────────────────────────
export function addTransition(fromSceneId: Id, toSceneId: Id, over: Partial<Transition> = {}): Id {
  const id = uid("tr");
  store.mutate("Add transition", (d) => {
    const tr = createTransition(fromSceneId, toSceneId, over);
    tr.id = id;
    tr.name = over.name ?? `${sceneName(d, fromSceneId)} → ${sceneName(d, toSceneId)}`;
    d.transitions.push(tr);
  });
  return id;
}

function sceneName(d: Project, id: Id): string {
  return d.scenes.find((s) => s.id === id)?.name ?? "?";
}

export function removeTransition(id: Id): void {
  store.mutate("Remove transition", (d) => {
    d.transitions = d.transitions.filter((t) => t.id !== id);
  });
}

export function updateTransition(id: Id, patch: Partial<Transition>): void {
  store.mutate("Edit transition", (d) => {
    const t = d.transitions.find((x) => x.id === id);
    if (t) Object.assign(t, patch);
  });
}

// ── project ───────────────────────────────────────────────────
export function updateProject(patch: Partial<Project>, label = "Edit project"): void {
  store.mutate(label, (d) => {
    Object.assign(d, patch);
  });
}

// ── tool + transport convenience (non-undoable view state) ────
export function setTool(t: ToolId): void {
  store.setTool(t);
}

/** Step the playhead one frame forward (dir +1) or back (dir -1) — Unity's Game
 *  view "Step". Pauses playback first so each press advances exactly one frame. */
export function stepFrame(dir: -1 | 1): void {
  store.setPlaying(false);
  const fps = store.state.project.fps || 60;
  store.setPlayhead(stepPlayhead(store.state.playhead, fps, dir, store.timelineExtent()));
}

/** Every keyframe time across the active timeline's tracks (the clip). */
function activeKeyframeTimes(): number[] {
  const tl = activeTimeline(activeScene(store.getProject()));
  return tl ? tl.tracks.flatMap((t) => t.keyframes.map((k) => k.time)) : [];
}

/** Move the playhead to the next keyframe in the clip — Unity's Animation ►|
 *  button. Pauses playback; no-op when there's no later keyframe. */
export function goToNextKeyframe(): void {
  const next = nextKeyframeTime(activeKeyframeTimes(), store.state.playhead);
  if (next === null) return;
  store.setPlaying(false);
  store.setPlayhead(next);
}

/** Move the playhead to the previous keyframe in the clip — Unity's Animation |◄
 *  button. Pauses playback; no-op when there's no earlier keyframe. */
export function goToPrevKeyframe(): void {
  const prev = prevKeyframeTime(activeKeyframeTimes(), store.state.playhead);
  if (prev === null) return;
  store.setPlaying(false);
  store.setPlayhead(prev);
}

/** Whether the active timeline has any keyframe (menu enable-state). */
export function hasKeyframes(): boolean {
  return activeKeyframeTimes().length > 0;
}
export function undo(): void {
  store.undo();
}
export function redo(): void {
  store.redo();
}

/** Reusable: the live AnimTrack for (obj, prop) on the active timeline, if any. */
export function findTrack(targetId: Id, property: TrackProperty): AnimTrack | undefined {
  const tl = activeTimeline(activeScene(store.getProject()));
  return tl?.tracks.find((t) => t.targetId === targetId && t.property === property);
}
