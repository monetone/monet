// ─────────────────────────────────────────────────────────────
// store.ts — Monet Jouer's reactive document + UI state.
//
// A small, dependency-free reactive store in the Monet house style: it holds
// the immutable Project plus editor UI state, exposes an immutable AppSnapshot
// to React via useSyncExternalStore, and makes every structural edit a single
// undo step. Editing flows through `mutate(label, fn)`, which clones the project
// on write so undo/redo is trivial and React always sees fresh references.
//
// Non-undoable view changes (selection, tool, playhead, zoom, active scene) set
// their fields and `bump()` to notify subscribers.
// ─────────────────────────────────────────────────────────────

import { useSyncExternalStore } from "react";
import type { Id, Project } from "../model/types";
import { createProject } from "../model/factory";
import { activeScene, activeTimeline, flattenObjects, type HierarchySort } from "../model/query";
import { timelineExtent } from "../model/sample";

export type ToolId = "select" | "hand" | "rectangle" | "ellipse" | "sprite" | "image" | "text";

export interface AppSnapshot {
  ready: boolean;
  project: Project;
  /** Selected object ids within the active scene. */
  selection: Id[];
  /** Named selection sets (Unity "Save/Load Selection"), keyed by slot "1".."9".
   *  Editor-session state — not saved in the `.jouer` document. */
  selectionSets: Record<string, Id[]>;
  tool: ToolId;

  // Timeline transport (seconds).
  playhead: number;
  playing: boolean;
  loopPlayback: boolean;
  /** Animation "Record" mode (Unity's red Record button): while true, transform
   *  edits auto-key the changed properties at the playhead. Editor-session
   *  state — not saved in the document. */
  recording: boolean;

  // Viewport.
  zoom: number;
  showGrid: boolean;
  snap: boolean;
  gridSize: number;
  /** Rotation-snap increment in degrees (Unity's "Grid and Snap → Rotate"): the
   *  step the Shift-rotate gizmo and "Snap Rotation of Selection" round to. A
   *  persistent view preference, not in the document. */
  rotationSnap: number;
  /** Scale-snap increment (Unity's "Grid and Snap → Scale"): the step the
   *  Shift-scale gizmo and "Snap Scale of Selection" round each axis to. A
   *  persistent view preference, not in the document. */
  scaleSnap: number;
  /** Constrain Proportions (Unity's Transform scale aspect-lock): when true, an
   *  inspector edit to one scale axis scales the other to keep the ratio. A
   *  persistent view preference, not in the document. */
  constrainProportions: boolean;
  /** Scene-view "Isolate Selection": when non-null, only these object ids are
   *  shown in the editor (editor-only — the model + export are untouched). */
  isolatedIds: Id[] | null;
  /** Scene-view "Lock View to Selected": when true, the editor camera follows
   *  the selected object as it moves. */
  followSelection: boolean;
  /** Hierarchy-window search query (Unity's Hierarchy search bar). Filters the
   *  scene tree by name + `t:type`; editor-session state — not in the document. */
  hierarchyFilter: string;
  /** Hierarchy display sort (Unity's Transform vs Alphabetical sort). A persistent
   *  view preference; not in the document. */
  hierarchySort: HierarchySort;
  /** Collapsed container ids in the Hierarchy panel (Unity's expand/collapse
   *  twirl + Collapse/Expand All). Editor view state — per scene, not in the
   *  document; a container is open unless its id is in this set. */
  collapsed: ReadonlySet<Id>;
  /** Inspector lock (Unity's Inspector padlock): when set, the Inspector stays
   *  pinned to this object regardless of the current selection. Editor view
   *  state; cleared if the object is deleted. */
  lockedInspectorId: Id | null;
  /** Hierarchy row being renamed in place (Unity's F2 / double-click rename).
   *  Editor view state; cleared if the object is deleted and reset per scene. */
  renamingId: Id | null;
  /** Scene-list row being renamed in place (Unity inline scene rename). Editor
   *  view state; cleared if the scene is deleted and reset per document. */
  renamingSceneId: Id | null;
  /** Asset-list row being renamed in place (Unity Project-window rename). Editor
   *  view state; cleared if the asset is deleted and reset per document. */
  renamingAssetId: Id | null;

  // Document meta.
  dirty: boolean;
  filePath: string | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Bumped on every notify so identity-based memo always re-renders. */
  rev: number;
}

const clone = <T>(v: T): T => structuredClone(v);
const UNDO_LIMIT = 200;

export class Store {
  private _project: Project;
  private _undo: Project[] = [];
  private _redo: Project[] = [];

  private ui = {
    ready: false,
    selection: [] as Id[],
    selectionAnchor: null as Id | null,
    selectionSets: {} as Record<string, Id[]>,
    tool: "select" as ToolId,
    playhead: 0,
    playing: false,
    loopPlayback: true,
    recording: false,
    zoom: 1,
    showGrid: true,
    snap: true,
    gridSize: 16,
    rotationSnap: 15,
    scaleSnap: 0.25,
    constrainProportions: false,
    isolatedIds: null as Id[] | null,
    followSelection: false,
    hierarchyFilter: "",
    hierarchySort: "transform" as HierarchySort,
    collapsed: new Set<Id>(),
    lockedInspectorId: null as Id | null,
    renamingId: null as Id | null,
    renamingSceneId: null as Id | null,
    renamingAssetId: null as Id | null,
    dirty: false,
    filePath: null as string | null,
  };

  private _rev = 0;
  private _snapshot: AppSnapshot;
  private listeners = new Set<() => void>();

  constructor(project: Project = createProject()) {
    this._project = project;
    this._snapshot = this.build();
  }

  // ── React glue ───────────────────────────────────────────────
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  /** The current immutable snapshot (stable identity until the next bump). */
  get state(): AppSnapshot {
    return this._snapshot;
  }

  getProject(): Project {
    return this._project;
  }

  private build(): AppSnapshot {
    return {
      ready: this.ui.ready,
      project: this._project,
      selection: this.ui.selection,
      selectionSets: this.ui.selectionSets,
      tool: this.ui.tool,
      playhead: this.ui.playhead,
      playing: this.ui.playing,
      loopPlayback: this.ui.loopPlayback,
      recording: this.ui.recording,
      zoom: this.ui.zoom,
      showGrid: this.ui.showGrid,
      snap: this.ui.snap,
      gridSize: this.ui.gridSize,
      rotationSnap: this.ui.rotationSnap,
      scaleSnap: this.ui.scaleSnap,
      constrainProportions: this.ui.constrainProportions,
      isolatedIds: this.ui.isolatedIds,
      followSelection: this.ui.followSelection,
      hierarchyFilter: this.ui.hierarchyFilter,
      hierarchySort: this.ui.hierarchySort,
      collapsed: this.ui.collapsed,
      lockedInspectorId: this.ui.lockedInspectorId,
      renamingId: this.ui.renamingId,
      renamingSceneId: this.ui.renamingSceneId,
      renamingAssetId: this.ui.renamingAssetId,
      dirty: this.ui.dirty,
      filePath: this.ui.filePath,
      canUndo: this._undo.length > 0,
      canRedo: this._redo.length > 0,
      rev: this._rev,
    };
  }

  private bump(): void {
    this._rev++;
    this._snapshot = this.build();
    for (const l of this.listeners) l();
  }

  /** Adopt a project received from a collaborator: swap it in + repaint, WITHOUT
   *  an undo step or re-broadcast (the collab binding guards the echo). */
  applyRemoteProject(project: Project): void {
    this._project = project;
    this.bump();
  }

  // ── Editing (undoable) ───────────────────────────────────────
  /** Run a structural edit against a deep-cloned draft of the project. The edit
   *  becomes one undo step. Returns nothing — read fresh state after. */
  mutate(_label: string, fn: (draft: Project) => void): void {
    this._undo.push(this._project);
    if (this._undo.length > UNDO_LIMIT) this._undo.shift();
    this._redo = [];
    const draft = clone(this._project);
    fn(draft);
    this._project = draft;
    this.ui.dirty = true;
    this.clampSelection();
    this.clampPlayhead();
    this.bump();
  }

  /** A project change that does NOT create an undo step (active scene/timeline,
   *  pure view-of-document toggles, live drag previews). Still clones for fresh
   *  references. */
  patch(fn: (draft: Project) => void): void {
    const draft = clone(this._project);
    fn(draft);
    this._project = draft;
    this.bump();
  }

  /** Commit one undo step whose "before" image is an explicit `baseline` rather
   *  than the current project — used after a live drag (a run of `patch`es) so
   *  the whole gesture collapses to a single, correctly-rewindable undo step. */
  commitFrom(baseline: Project, _label: string, fn: (draft: Project) => void): void {
    this._undo.push(baseline);
    if (this._undo.length > UNDO_LIMIT) this._undo.shift();
    this._redo = [];
    const draft = clone(this._project);
    fn(draft);
    this._project = draft;
    this.ui.dirty = true;
    this.clampSelection();
    this.clampPlayhead();
    this.bump();
  }

  undo(): void {
    const prev = this._undo.pop();
    if (!prev) return;
    this._redo.push(this._project);
    this._project = prev;
    this.ui.dirty = true;
    this.clampSelection();
    this.clampPlayhead();
    this.bump();
  }

  redo(): void {
    const next = this._redo.pop();
    if (!next) return;
    this._undo.push(this._project);
    this._project = next;
    this.ui.dirty = true;
    this.clampSelection();
    this.clampPlayhead();
    this.bump();
  }

  // ── Document lifecycle ───────────────────────────────────────
  replaceProject(project: Project, opts: { dirty?: boolean; filePath?: string | null } = {}): void {
    this._project = project;
    this._undo = [];
    this._redo = [];
    this.ui.selection = [];
    this.ui.selectionAnchor = null;
    this.ui.selectionSets = {};
    this.ui.playhead = 0;
    this.ui.playing = false;
    this.ui.isolatedIds = null;
    this.ui.followSelection = false;
    this.ui.hierarchyFilter = "";
    this.ui.collapsed = new Set();
    this.ui.lockedInspectorId = null;
    this.ui.renamingId = null;
    this.ui.renamingSceneId = null;
    this.ui.renamingAssetId = null;
    this.ui.recording = false;
    this.ui.dirty = opts.dirty ?? false;
    if (opts.filePath !== undefined) this.ui.filePath = opts.filePath;
    this.bump();
  }

  setReady(v: boolean): void {
    this.ui.ready = v;
    this.bump();
  }
  markClean(filePath?: string | null): void {
    this.ui.dirty = false;
    if (filePath !== undefined) this.ui.filePath = filePath;
    this.bump();
  }
  setFilePath(p: string | null): void {
    this.ui.filePath = p;
    this.bump();
  }

  // ── Selection ────────────────────────────────────────────────
  private clampSelection(): void {
    const scene = activeScene(this._project);
    const ids = new Set(flattenObjects(scene).map((o) => o.id));
    this.ui.selection = this.ui.selection.filter((id) => ids.has(id));
    // Drop an inspector lock whose object was deleted (Unity unpins it).
    if (this.ui.lockedInspectorId && !ids.has(this.ui.lockedInspectorId)) this.ui.lockedInspectorId = null;
    // Drop a pending inline rename whose object was deleted.
    if (this.ui.renamingId && !ids.has(this.ui.renamingId)) this.ui.renamingId = null;
    // Drop a pending scene-rename whose scene was deleted.
    if (this.ui.renamingSceneId && !this._project.scenes.some((s) => s.id === this.ui.renamingSceneId)) this.ui.renamingSceneId = null;
    // Drop a pending asset-rename whose asset was deleted.
    if (this.ui.renamingAssetId && !this._project.assets.some((a) => a.id === this.ui.renamingAssetId)) this.ui.renamingAssetId = null;
  }
  select(ids: Id[]): void {
    this.ui.selection = [...new Set(ids)];
    this.bump();
  }
  selectOne(id: Id | null): void {
    this.ui.selection = id ? [id] : [];
    this.bump();
  }
  toggleSelect(id: Id): void {
    const s = new Set(this.ui.selection);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    this.ui.selection = [...s];
    this.bump();
  }
  clearSelection(): void {
    if (this.ui.selection.length === 0) return;
    this.ui.selection = [];
    this.bump();
  }
  get selection(): Id[] {
    return this.ui.selection;
  }
  /** The Hierarchy range-select anchor (the last single-clicked row). */
  get selectionAnchor(): Id | null {
    return this.ui.selectionAnchor;
  }
  /** Set the range-select anchor. Not a render-affecting change (no bump). */
  setSelectionAnchor(id: Id | null): void {
    this.ui.selectionAnchor = id;
  }
  /** The single selected object id, or null if 0 or many are selected. */
  soleSelection(): Id | null {
    return this.ui.selection.length === 1 ? this.ui.selection[0] : null;
  }

  // ── Selection sets (Unity "Save/Load Selection") ─────────────
  /** Stash the current selection under `slot` ("1".."9"). Saving an empty
   *  selection is a no-op (Unity parity — there is nothing to restore). */
  saveSelectionSet(slot: string): void {
    if (this.ui.selection.length === 0) return;
    this.ui.selectionSets = { ...this.ui.selectionSets, [slot]: [...this.ui.selection] };
    this.bump();
  }
  /** Restore the selection saved in `slot`, keeping only objects that still
   *  exist in the active scene. A slot that was never saved — or whose objects
   *  have all since been deleted — is a no-op (never clobbers the live
   *  selection), matching how the menu/`hasSelectionSet` present an empty slot. */
  loadSelectionSet(slot: string): void {
    const saved = this.ui.selectionSets[slot];
    if (!saved) return;
    const ids = new Set(flattenObjects(activeScene(this._project)).map((o) => o.id));
    const next = saved.filter((id) => ids.has(id));
    if (next.length === 0) return;
    this.ui.selection = next;
    this.bump();
  }
  /** Whether `slot` holds a (non-empty) saved selection. */
  hasSelectionSet(slot: string): boolean {
    return (this.ui.selectionSets[slot]?.length ?? 0) > 0;
  }

  // ── Active scene / timeline (non-undoable) ───────────────────
  setActiveScene(id: Id): void {
    this.patch((d) => {
      if (d.scenes.some((s) => s.id === id)) d.activeSceneId = id;
    });
    this.ui.selection = [];
    this.ui.selectionAnchor = null;
    this.ui.playhead = 0;
    this.ui.playing = false;
    this.ui.isolatedIds = null;
    this.ui.recording = false;
    this.ui.collapsed = new Set();
    this.ui.lockedInspectorId = null;
    this.ui.renamingId = null;
    this.bump();
  }
  setActiveTimeline(id: Id): void {
    this.patch((d) => {
      const s = activeScene(d);
      if (s && s.timelines.some((t) => t.id === id)) s.activeTimelineId = id;
    });
    this.ui.playhead = 0;
    this.bump();
  }

  // ── Tool ─────────────────────────────────────────────────────
  setTool(t: ToolId): void {
    this.ui.tool = t;
    this.bump();
  }

  // ── Transport ────────────────────────────────────────────────
  private clampPlayhead(): void {
    const ext = this.timelineExtent();
    if (this.ui.playhead > ext) this.ui.playhead = ext;
    if (this.ui.playhead < 0) this.ui.playhead = 0;
  }
  timelineExtent(): number {
    const tl = activeTimeline(activeScene(this._project));
    return tl ? timelineExtent(tl) : 0;
  }
  setPlayhead(seconds: number): void {
    const ext = this.timelineExtent();
    this.ui.playhead = Math.max(0, Math.min(ext, seconds));
    this.bump();
  }
  setPlaying(v: boolean): void {
    this.ui.playing = v;
    this.bump();
  }
  togglePlaying(): void {
    this.ui.playing = !this.ui.playing;
    this.bump();
  }
  setLoopPlayback(v: boolean): void {
    this.ui.loopPlayback = v;
    this.bump();
  }
  /** Toggle Animation "Record" mode (Unity's red Record button). */
  setRecording(v: boolean): void {
    this.ui.recording = v;
    this.bump();
  }

  // ── Viewport ─────────────────────────────────────────────────
  setZoom(z: number): void {
    this.ui.zoom = Math.max(0.1, Math.min(8, z));
    this.bump();
  }
  setShowGrid(v: boolean): void {
    this.ui.showGrid = v;
    this.bump();
  }
  setSnap(v: boolean): void {
    this.ui.snap = v;
    this.bump();
  }
  /** Constrain Proportions toggle (Unity Transform scale aspect-lock). No-op (no
   *  bump) on an unchanged value. */
  setConstrainProportions(v: boolean): void {
    if (this.ui.constrainProportions === v) return;
    this.ui.constrainProportions = v;
    this.bump();
  }
  toggleConstrainProportions(): void {
    this.setConstrainProportions(!this.ui.constrainProportions);
  }
  setGridSize(n: number): void {
    this.ui.gridSize = Math.max(1, Math.round(n));
    this.bump();
  }
  /** Set the rotation-snap increment in degrees (Unity "Grid and Snap → Rotate").
   *  Clamped to a minimum of 1°. */
  setRotationSnap(n: number): void {
    this.ui.rotationSnap = Math.max(1, Math.round(n));
    this.bump();
  }
  /** Set the scale-snap increment (Unity "Grid and Snap → Scale"). Clamped to a
   *  small positive minimum; fractional (not rounded to whole numbers). */
  setScaleSnap(n: number): void {
    this.ui.scaleSnap = Math.max(0.01, n);
    this.bump();
  }
  /** Set (or clear, with null) the scene-view isolation set. */
  setIsolation(ids: Id[] | null): void {
    this.ui.isolatedIds = ids && ids.length ? ids : null;
    this.bump();
  }
  /** Toggle "Lock View to Selected" — the camera follows the selection. */
  setFollowSelection(v: boolean): void {
    this.ui.followSelection = v;
    this.bump();
  }
  /** Set the Hierarchy search query (Unity's Hierarchy search bar). Stores the
   *  raw text so the input stays faithful to what's typed; parsing/trimming
   *  happens in `model/hierarchy-search.ts`. */
  setHierarchyFilter(query: string): void {
    if (this.ui.hierarchyFilter === query) return;
    this.ui.hierarchyFilter = query;
    this.bump();
  }
  /** Set the Hierarchy display sort mode (Unity's Transform vs Alphabetical).
   *  A persistent view preference — not reset when the document is replaced. */
  setHierarchySort(mode: HierarchySort): void {
    if (this.ui.hierarchySort === mode) return;
    this.ui.hierarchySort = mode;
    this.bump();
  }

  // ── Hierarchy expand/collapse (Unity's twirl + Collapse/Expand All) ──
  /** Whether a container row is collapsed (its children hidden). */
  isCollapsed(id: Id): boolean {
    return this.ui.collapsed.has(id);
  }
  /** Toggle one container's collapsed state. Each change assigns a fresh Set so
   *  `useStore((s) => s.collapsed)` re-renders. Not an undo step. */
  toggleCollapsed(id: Id): void {
    const next = new Set(this.ui.collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.ui.collapsed = next;
    this.bump();
  }
  /** Collapse the given container ids (Unity "Collapse All"). */
  collapseAll(ids: Id[]): void {
    this.ui.collapsed = new Set(ids);
    this.bump();
  }
  /** Expand everything (Unity "Expand All"). No-op (no bump) if already empty. */
  expandAll(): void {
    if (this.ui.collapsed.size === 0) return;
    this.ui.collapsed = new Set();
    this.bump();
  }

  // ── Inspector lock (Unity's Inspector padlock) ───────────────
  get lockedInspectorId(): Id | null {
    return this.ui.lockedInspectorId;
  }
  /** Pin the Inspector to `id` (or unpin with null). Not an undo step. */
  setInspectorLock(id: Id | null): void {
    if (this.ui.lockedInspectorId === id) return;
    this.ui.lockedInspectorId = id;
    this.bump();
  }
  /** Lock the Inspector to `id`, or unlock if it is already pinned there. */
  toggleInspectorLock(id: Id): void {
    this.setInspectorLock(this.ui.lockedInspectorId === id ? null : id);
  }

  // ── Hierarchy inline rename (Unity F2 / double-click) ────────
  get renamingId(): Id | null {
    return this.ui.renamingId;
  }
  /** Put a hierarchy row into inline-rename mode (or exit with null). Not an undo step. */
  setRenamingId(id: Id | null): void {
    if (this.ui.renamingId === id) return;
    this.ui.renamingId = id;
    this.bump();
  }

  get renamingSceneId(): Id | null {
    return this.ui.renamingSceneId;
  }
  /** Put a scene-list row into inline-rename mode (or exit with null). Not an undo step. */
  setRenamingSceneId(id: Id | null): void {
    if (this.ui.renamingSceneId === id) return;
    this.ui.renamingSceneId = id;
    this.bump();
  }

  get renamingAssetId(): Id | null {
    return this.ui.renamingAssetId;
  }
  /** Put an asset-list row into inline-rename mode (or exit with null). Not an undo step. */
  setRenamingAssetId(id: Id | null): void {
    if (this.ui.renamingAssetId === id) return;
    this.ui.renamingAssetId = id;
    this.bump();
  }
}

/** Build the React hook bound to a store instance. */
export function makeUseStore(store: Store) {
  return function useStore<T>(selector: (s: AppSnapshot) => T): T {
    return useSyncExternalStore(
      store.subscribe,
      () => selector(store.state),
      () => selector(store.state),
    );
  };
}
