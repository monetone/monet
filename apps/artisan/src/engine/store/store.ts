// ─────────────────────────────────────────────────────────────
// store — observable editor state with snapshot undo/redo
// ─────────────────────────────────────────────────────────────
// One immutable `EditorState` object, replaced wholesale on every change so it
// drives React's useSyncExternalStore cleanly. Document edits flow through
// transactions; only the `doc` participates in undo/redo (selection, view, tool
// are ephemeral editor state).

import { produce } from "immer";
import type { Document, ID, Layer, Paint, Stroke } from "../model/types";
import { allItemIds, type SameCriterion } from "../model/query";
import type { SelectKind } from "../ops/select-objects";
import type { TransformEachOptions } from "../ops/transform-each";
import { defaultStroke, makeDocument, newId, solid } from "../model/factory";
import { BLACK, WHITE } from "../color";

export type ToolId = string;

export interface ViewState {
  /** Screen = rotateAround(world * zoom + (tx, ty), viewportCenter, angle). */
  tx: number;
  ty: number;
  zoom: number;
  /** Canvas view rotation in radians (Rotate View tool). */
  angle: number;
}

export interface GridSettings {
  show: boolean;
  size: number;
  subdivisions: number;
}

export interface SnapSettings {
  enabled: boolean;
  toGrid: boolean;
  toPoint: boolean;
  toObject: boolean;
  /** View ▸ Snap to Pixel — round world coordinates to whole document units, so
   *  artwork lands on the pixel grid for screen output. */
  toPixel: boolean;
  tolerance: number;
}

export interface Guide {
  id: ID;
  orientation: "h" | "v";
  /** World position (x for vertical, y for horizontal). */
  pos: number;
}

/** A repeatable Select menu query, remembered for Select ▸ Reselect. */
export type SelectQuery = { kind: "same"; criterion: SameCriterion } | { kind: "object"; k: SelectKind } | { kind: "same-layers" };

/** The last Object ▸ Transform op, remembered for Object ▸ Transform ▸ Transform Again. */
export type TransformOp =
  | { kind: "rotate90cw" }
  | { kind: "rotate90ccw" }
  | { kind: "reflect-h" }
  | { kind: "reflect-v" }
  | { kind: "transform-each"; opts: Partial<TransformEachOptions> };

/** A named selection saved via Select ▸ Save Selection, re-applied from the Select menu. */
export interface SavedSelection {
  id: ID;
  name: string;
  ids: ID[];
}

/** Where newly drawn art is inserted (Illustrator's drawing modes): "normal"
 *  on top, "behind" at the back, "inside" clipped into the target object. */
export type DrawingMode = "normal" | "behind" | "inside";

export interface EditorState {
  doc: Document;
  /** Selected item ids (top-level selection). */
  selection: ID[];
  /** Direct-selection: item id → selected anchor indices. */
  anchorSelection: Record<ID, number[]>;
  /** Align ▸ "Align to Key Object": the selected item every align/distribute is
   *  measured against (it stays put). Null = align to the selection bounds. */
  keyObjectId: ID | null;
  activeLayerId: ID;
  tool: ToolId;
  view: ViewState;
  /** Current fill applied to new / selected objects. */
  fill: Paint;
  /** Current stroke. */
  stroke: Stroke;
  /** Which of fill/stroke is the active swatch target. */
  activePaint: "fill" | "stroke";
  /** Active Brushes panel definition used by brush tools. */
  activeBrushId: ID | null;
  rulers: boolean;
  grid: GridSettings;
  snap: SnapSettings;
  /** Magic Wand tool: which attribute it matches on, and the colour tolerance. */
  magicWand: { match: "fill" | "stroke"; tolerance: number };
  guides: Guide[];
  showGuides: boolean;
  outlineMode: boolean;
  /** View ▸ Trim View — preview final output: clip artwork to the artboards and hide
   *  all editing chrome (grid, guides, selection edges + handles). View state only. */
  trimView: boolean;
  /** View ▸ Hide Edges — hide the selection chrome (outline + handles) without deselecting. */
  hideEdges: boolean;
  /** View ▸ Hide Bounding Box (⇧⌘B) — hide the transform bounding box + handles only. */
  showBoundingBox: boolean;
  /** View ▸ Show Transparency Grid (⇧⌘D) — checkerboard behind the artwork. */
  transparencyGrid: boolean;
  /** The last Select ▸ Same / Select ▸ Object query run, for Select ▸ Reselect (⌘6). */
  lastSelectQuery: SelectQuery | null;
  /** The last Object ▸ Transform op run, for Object ▸ Transform ▸ Transform Again. */
  lastTransform: TransformOp | null;
  /** Named selections saved via Select ▸ Save Selection (per document). */
  savedSelections: SavedSelection[];
  /** Drawing mode — where the creation tools insert new art (Normal = front, Behind = back). */
  drawingMode: DrawingMode;
  /** Draw Inside target: the object new art is clipped into (captured when the
   *  mode switches to "inside" with a single object selected). */
  drawInsideTarget: ID | null;
  /** Unsaved changes since last save. */
  dirty: boolean;
  /** Bumped whenever the doc structure changes (cheap change signal). */
  revision: number;
  filePath?: string;
  /** Viewport pixel size, mirrored from the canvas for zoom/fit commands. */
  viewport: { width: number; height: number };
  /** Id of the text item currently being edited inline (hidden from the SVG). */
  editingTextId?: ID;
  /** Currently selected export slice (Slice Selection tool). */
  selectedSlice?: ID;
  /** Show the 1-point perspective grid guide. */
  perspectiveGrid?: boolean;
}

interface UndoEntry {
  doc: Document;
  label: string;
  selection: ID[];
}

export const initialState = (doc: Document = makeDocument()): EditorState => ({
  doc,
  selection: [],
  anchorSelection: {},
  keyObjectId: null,
  activeLayerId: doc.layers[doc.layers.length - 1]?.id ?? "",
  tool: "selection",
  view: { tx: 0, ty: 0, zoom: 1, angle: 0 },
  fill: solid(WHITE),
  stroke: defaultStroke(solid(BLACK)),
  activePaint: "fill",
  activeBrushId: doc.brushes?.[0]?.id ?? null,
  rulers: true,
  grid: { show: false, size: 50, subdivisions: 5 },
  snap: { enabled: true, toGrid: false, toPoint: true, toObject: true, toPixel: false, tolerance: 6 },
  magicWand: { match: "fill", tolerance: 32 },
  guides: [],
  showGuides: true,
  outlineMode: false,
  trimView: false,
  hideEdges: false,
  showBoundingBox: true,
  transparencyGrid: false,
  lastSelectQuery: null,
  lastTransform: null,
  savedSelections: [],
  drawingMode: "normal",
  drawInsideTarget: null,
  dirty: false,
  revision: 0,
  viewport: { width: 800, height: 600 },
});

export class ArtisanStore {
  private state: EditorState;
  private listeners = new Set<() => void>();
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private tx: { before: Document; label: string; selection: ID[]; rebased: boolean } | null = null;
  private maxUndo = 250;

  constructor(state: EditorState = initialState()) {
    this.state = state;
  }

  // ── Subscription ───────────────────────────────────────────
  getState = (): EditorState => this.state;
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private emit() {
    for (const l of this.listeners) l();
  }
  private set(patch: Partial<EditorState>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  // ── Ephemeral (non-undo) editor state ──────────────────────
  setTool = (tool: ToolId) => this.set({ tool });
  setView = (view: Partial<ViewState>) => this.set({ view: { ...this.state.view, ...view } });
  setActivePaint = (p: "fill" | "stroke") => this.set({ activePaint: p });
  setFill = (fill: Paint) => this.set({ fill });
  setStroke = (stroke: Stroke) => this.set({ stroke });
  setActiveBrush = (activeBrushId: ID | null) => this.set({ activeBrushId });
  setActiveLayer = (activeLayerId: ID) => this.set({ activeLayerId });
  patchGrid = (g: Partial<GridSettings>) => this.set({ grid: { ...this.state.grid, ...g } });
  patchSnap = (s: Partial<SnapSettings>) => this.set({ snap: { ...this.state.snap, ...s } });
  setMagicWand = (mw: Partial<EditorState["magicWand"]>) => this.set({ magicWand: { ...this.state.magicWand, ...mw } });
  setRulers = (rulers: boolean) => this.set({ rulers });
  setViewport = (viewport: { width: number; height: number }) => {
    const v = this.state.viewport;
    if (v.width !== viewport.width || v.height !== viewport.height) this.set({ viewport });
  };
  setEditingText = (editingTextId?: ID) => this.set({ editingTextId });
  setSelectedSlice = (selectedSlice?: ID) => this.set({ selectedSlice });
  setPerspectiveGrid = (perspectiveGrid: boolean) => this.set({ perspectiveGrid });
  setOutlineMode = (outlineMode: boolean) => this.set({ outlineMode });
  setTrimView = (trimView: boolean) => this.set({ trimView });
  setHideEdges = (hideEdges: boolean) => this.set({ hideEdges });
  setShowBoundingBox = (showBoundingBox: boolean) => this.set({ showBoundingBox });
  setTransparencyGrid = (transparencyGrid: boolean) => this.set({ transparencyGrid });
  setLastSelectQuery = (lastSelectQuery: SelectQuery | null) => this.set({ lastSelectQuery });
  setLastTransform = (lastTransform: TransformOp | null) => this.set({ lastTransform });
  saveSelection = (name: string, ids: ID[]) =>
    this.set({ savedSelections: [...this.state.savedSelections, { id: newId("sel"), name, ids: [...ids] }] });
  // Entering Draw Inside captures the single selected object as the clip target;
  // any other mode clears it. (Drawing into a multi/empty selection is a no-op
  // target — insertNew then falls back to a normal insert.)
  setDrawingMode = (drawingMode: DrawingMode) => {
    const sel = this.state.selection;
    const drawInsideTarget = drawingMode === "inside" && sel.length === 1 ? sel[0] : null;
    this.set({ drawingMode, drawInsideTarget });
  };
  setShowGuides = (showGuides: boolean) => this.set({ showGuides });
  setGuides = (guides: Guide[]) => this.set({ guides });
  /** Drop a ruler guide: a horizontal (orientation "h", world y) or vertical ("v", world x) line. */
  addGuide = (orientation: Guide["orientation"], pos: number) =>
    this.set({ guides: [...this.state.guides, { id: newId("gd"), orientation, pos }] });
  clearGuides = () => this.set({ guides: [] });

  // ── Selection ──────────────────────────────────────────────
  // A brand-new selection drops any Align key object (Illustrator parity).
  setSelection = (ids: ID[]) => this.set({ selection: dedupe(ids), anchorSelection: {}, keyObjectId: null });
  addSelection = (ids: ID[]) => this.set({ selection: dedupe([...this.state.selection, ...ids]) });
  toggleSelection = (id: ID) => {
    const has = this.state.selection.includes(id);
    this.set({
      selection: has ? this.state.selection.filter((s) => s !== id) : [...this.state.selection, id],
      // De-selecting the key object clears it; toggling any other item keeps it.
      ...(has && id === this.state.keyObjectId ? { keyObjectId: null } : {}),
    });
  };
  clearSelection = () => this.set({ selection: [], anchorSelection: {}, keyObjectId: null });
  selectAll = () => this.set({ selection: this.state.doc.layers.flatMap((l) => (l.visible && !l.locked ? l.items.filter((i) => i.visible && !i.locked).map((i) => i.id) : [])), anchorSelection: {}, keyObjectId: null });
  /** Designate (or clear) the Align "Key Object". */
  setKeyObject = (keyObjectId: ID | null) => this.set({ keyObjectId });
  setAnchorSelection = (anchorSelection: Record<ID, number[]>) => this.set({ anchorSelection });

  // ── Document transactions ──────────────────────────────────
  beginTransaction(label: string) {
    if (this.tx) this.endTransaction();
    this.tx = { before: this.state.doc, label, selection: this.state.selection.slice(), rebased: false };
  }

  /**
   * Produce the next doc by structurally sharing the current one (Immer): only
   * the objects on the path to an edited node are copied; untouched subtrees keep
   * their reference identity, which makes per-item render memoization effective
   * and keeps undo snapshots cheap. The recipe `fn` may freely return ops' values
   * (ids, etc.) — we discard them so Immer never treats a return as a replacement.
   */
  mutate(fn: (doc: Document) => void) {
    const next = produce(this.state.doc, (draft) => {
      fn(draft as Document);
    });
    this.set({ doc: next, dirty: true, revision: this.state.revision + 1 });
  }

  /**
   * Like `mutate` but derives from an explicit base doc. Used during interactive
   * drags so each frame recomputes from the drag-start snapshot (non-compounding);
   * Immer never mutates `base`, so repeated frames stay independent. A remote
   * arrival replaces that base, keeping later frames from replaying a stale
   * whole-document snapshot over peer work.
   */
  mutateFrom(base: Document, fn: (doc: Document) => void) {
    const next = produce(this.tx?.rebased ? this.tx.before : base, (draft) => {
      fn(draft as Document);
    });
    this.set({ doc: next, dirty: true, revision: this.state.revision + 1 });
  }

  /** The document snapshot captured at the start of the current transaction. */
  get transactionBase(): Document | null {
    return this.tx?.before ?? null;
  }

  endTransaction() {
    if (!this.tx) return;
    let changed = false;
    if (this.tx.before !== this.state.doc) {
      this.undoStack.push({ doc: this.tx.before, label: this.tx.label, selection: this.tx.selection });
      if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
      this.redoStack = [];
      changed = true;
    }
    this.tx = null;
    // An op that REMOVES items (pathfinder collapsing to nothing, deleting the
    // last anchors of a path, …) leaves the selection pointing at ids that are
    // gone, and every later command then works on phantoms. undo/redo and
    // cancelTransaction already prune; do it once here so every committed edit
    // gets the same guarantee instead of each command remembering to.
    if (changed) this.pruneSelection();
    this.emit();
  }

  /** Drop selection / anchor-selection / key-object entries whose items are gone. */
  private pruneSelection() {
    const valid = new Set(allItemIds(this.state.doc));
    const selection = this.state.selection.filter((id) => valid.has(id));
    const anchorEntries = Object.entries(this.state.anchorSelection).filter(([id]) => valid.has(id));
    const keyObjectId = this.state.keyObjectId && valid.has(this.state.keyObjectId) ? this.state.keyObjectId : null;
    if (
      selection.length === this.state.selection.length &&
      anchorEntries.length === Object.keys(this.state.anchorSelection).length &&
      keyObjectId === this.state.keyObjectId
    ) {
      return; // nothing dangling — keep the identities stable for memoized renders
    }
    this.set({ selection, anchorSelection: Object.fromEntries(anchorEntries), keyObjectId });
  }

  cancelTransaction() {
    if (!this.tx) return;
    const before = this.tx.before;
    const selection = this.tx.selection;
    this.tx = null;
    // Restore the doc AND the selection captured at begin, dropping any ids that
    // don't exist in the restored doc (e.g. a just-created, then-discarded text)
    // so we never leave a dangling selection — mirroring undo()/redo().
    const valid = new Set(allItemIds(before));
    this.set({ doc: before, selection: selection.filter((id) => valid.has(id)), anchorSelection: {}, keyObjectId: null });
  }

  /** Atomic edit: begin → mutate → end. */
  transact(label: string, fn: (doc: Document) => void) {
    this.beginTransaction(label);
    try {
      this.mutate(fn);
    } finally {
      this.endTransaction();
    }
  }

  /** Apply a document received from a collaborator: swap the doc + repaint,
   *  WITHOUT creating an undo step, clearing history, or re-broadcasting. Prunes
   *  a selection that points at items a peer removed. */
  applyRemoteDoc(doc: Document) {
    if (this.tx) {
      this.tx.before = doc;
      this.tx.rebased = true;
    }
    this.set({
      doc,
      dirty: true,
      revision: this.state.revision + 1,
    });
    this.pruneSelection();
  }

  /** Replace the whole document (new / open). Clears history. */
  replaceDoc(doc: Document, opts: { filePath?: string; markClean?: boolean } = {}) {
    this.undoStack = [];
    this.redoStack = [];
    this.tx = null;
    this.set({
      doc,
      selection: [],
      anchorSelection: {},
      keyObjectId: null,
      lastSelectQuery: null,
      lastTransform: null,
      savedSelections: [], // saved selections are per-document
      drawInsideTarget: null,
      activeLayerId: doc.layers[doc.layers.length - 1]?.id ?? "",
      activeBrushId: doc.brushes?.[0]?.id ?? null,
      dirty: !opts.markClean,
      revision: this.state.revision + 1,
      // A different document means a different file: NOT carrying the old path
      // forward is what stops File ▸ New / importing an SVG from making the
      // next ⌘S silently overwrite the previously-open .artisan document.
      filePath: opts.filePath,
    });
  }

  markSaved(filePath?: string) {
    this.set({ dirty: false, filePath: filePath ?? this.state.filePath });
  }

  /** Acknowledge an asynchronous save only if it wrote the current document. */
  markSavedAtRevision(revision: number, filePath?: string): boolean {
    if (this.state.revision !== revision) {
      if (filePath) this.set({ filePath });
      return false;
    }
    this.markSaved(filePath);
    return true;
  }

  // ── Undo / redo ────────────────────────────────────────────
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  undoLabel(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null;
  }
  redoLabel(): string | null {
    return this.redoStack[this.redoStack.length - 1]?.label ?? null;
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push({ doc: this.state.doc, label: entry.label, selection: this.state.selection.slice() });
    const valid = new Set(allItemIds(entry.doc));
    this.set({
      doc: entry.doc,
      selection: entry.selection.filter((id) => valid.has(id)),
      anchorSelection: {},
      keyObjectId: null,
      dirty: true,
      revision: this.state.revision + 1,
    });
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push({ doc: this.state.doc, label: entry.label, selection: this.state.selection.slice() });
    const valid = new Set(allItemIds(entry.doc));
    this.set({
      doc: entry.doc,
      selection: entry.selection.filter((id) => valid.has(id)),
      anchorSelection: {},
      keyObjectId: null,
      dirty: true,
      revision: this.state.revision + 1,
    });
  }

  // ── Convenience accessors ──────────────────────────────────
  get doc(): Document {
    return this.state.doc;
  }
  get selection(): ID[] {
    return this.state.selection;
  }
  get keyObjectId(): ID | null {
    return this.state.keyObjectId;
  }
  /** Path this document was last opened from / saved to, if any (Save writes here). */
  get filePath(): string | undefined {
    return this.state.filePath;
  }
  activeLayer(): Layer {
    const { doc, activeLayerId } = this.state;
    return doc.layers.find((l) => l.id === activeLayerId) ?? doc.layers[doc.layers.length - 1];
  }
}

const dedupe = (ids: ID[]): ID[] => Array.from(new Set(ids));
