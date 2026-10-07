// ─────────────────────────────────────────────────────────────
// store.ts — a generic observable timeline store with clone-on-write undo.
//
// React-free (useSyncExternalStore-compatible): apps bind it to React with a
// tiny `useSyncExternalStore(store.subscribe, () => selector(store.state))`
// hook of their own. Holds the document `P` plus the editing UI common to every
// NLE — playhead, selection, tool, zoom/scroll, snapping, in/out, transport —
// and snapshot-based undo/redo. Apps subclass to add domain UI (preview quality,
// audio mixer view, …) by overriding `snapshot()`; structural edits go through
// `mutate(label, fn)`, which clones the project so each change is one undo step.
// ─────────────────────────────────────────────────────────────

import type { Id } from "./model";

export interface TimelineBaseSnapshot<P> {
  project: P;
  playhead: number;
  playing: boolean;
  inPoint: number | null;
  outPoint: number | null;
  selection: Id[];
  tool: string;
  pxPerFrame: number;
  scrollFrame: number;
  snapping: boolean;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  rev: number;
}

interface UndoEntry<P> {
  label: string;
  project: P;
  playhead: number;
  selection: Id[];
  /** App-specific extra undoable UI captured via `captureUiSnapshot()`. */
  ui?: unknown;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

/**
 * Generic timeline store. `P` is the document type; `S` is the snapshot the host
 * exposes to its views — defaults to {@link TimelineBaseSnapshot}, but apps pass
 * a wider snapshot type and override `snapshot()` to add domain UI fields.
 */
export class TimelineStore<P, S = TimelineBaseSnapshot<P>> {
  protected project: P;
  protected listeners = new Set<() => void>();
  protected undoStack: UndoEntry<P>[] = [];
  protected redoStack: UndoEntry<P>[] = [];
  protected rev = 0;
  protected maxHistory = 200;
  /** Last coalesce key — consecutive edits with the same key collapse into one
   *  undo step (drag scrubbers/faders/clips). Reset by any non-coalesced edit. */
  protected lastCoalesceKey: string | null = null;

  /** Override to capture extra undoable UI (e.g. a rich selection) into the
   *  history entry; the default captures nothing. Paired with `restoreUiSnapshot`. */
  protected captureUiSnapshot(): unknown {
    return undefined;
  }
  protected restoreUiSnapshot(_snap: unknown): void {
    /* default: nothing extra to restore */
  }

  /** Common editor UI state. Subclasses keep their extra fields separately and
   *  merge them in `snapshot()`. */
  protected ui = {
    playhead: 0,
    playing: false,
    inPoint: null as number | null,
    outPoint: null as number | null,
    selection: [] as Id[],
    tool: "select",
    pxPerFrame: 12,
    scrollFrame: 0,
    snapping: true,
    dirty: false,
  };

  /** Lazily-built immutable snapshot, recomputed only on `bump()` (so it stays
   *  referentially stable between bumps for useSyncExternalStore). Lazy init
   *  avoids the subclass field-initialization-order trap: `snapshot()` is first
   *  called on `state` access AFTER the subclass is fully constructed. */
  protected _state: S | null = null;

  constructor(initial: P) {
    this.project = initial;
  }

  get state(): S {
    return (this._state ??= this.snapshot());
  }

  // ── observable plumbing ───────────────────────────────────────
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): S => this.state;

  /** The base snapshot. Subclasses override `snapshot()` to widen it to `S`. */
  protected baseSnapshot(): TimelineBaseSnapshot<P> {
    const a = this.undoStack[this.undoStack.length - 1];
    const r = this.redoStack[this.redoStack.length - 1];
    return {
      ...this.ui,
      project: this.project,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: a ? a.label : null,
      redoLabel: r ? r.label : null,
      rev: this.rev,
    };
  }

  protected snapshot(): S {
    return this.baseSnapshot() as unknown as S;
  }

  /** Recompute the snapshot reference and notify subscribers. */
  bump(): void {
    this.rev += 1;
    this._state = this.snapshot();
    this.listeners.forEach((l) => l());
  }

  // ── document ──────────────────────────────────────────────────
  getProject(): P {
    return this.project;
  }

  replaceProject(project: P, opts: { dirty?: boolean } = {}): void {
    this.project = project;
    this.undoStack = [];
    this.redoStack = [];
    this.ui.selection = [];
    this.ui.playhead = 0;
    this.ui.scrollFrame = 0;
    this.ui.inPoint = null;
    this.ui.outPoint = null;
    this.ui.dirty = opts.dirty ?? false;
    this.lastCoalesceKey = null;
    this.bump();
  }

  /** Push the CURRENT project + UI onto the undo stack as a history entry,
   *  clearing redo. Consecutive pushes with the same `coalesceKey` collapse
   *  into the first entry (drag operations). Subclasses with a non-`mutate`
   *  edit path (e.g. a command/dispatch facade) call this before applying. */
  protected pushUndo(label: string, coalesceKey?: string): void {
    if (coalesceKey == null || coalesceKey !== this.lastCoalesceKey) {
      this.undoStack.push({ label, project: this.project, playhead: this.ui.playhead, selection: [...this.ui.selection], ui: this.captureUiSnapshot() });
      if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
    }
    this.lastCoalesceKey = coalesceKey ?? null;
    this.redoStack = [];
  }

  /** Apply `fn` to a fresh clone of the project and commit it as one undo step
   *  (coalescing consecutive same-key edits). */
  mutate(label: string, fn: (p: P) => void, opts: { coalesceKey?: string } = {}): void {
    this.pushUndo(label, opts.coalesceKey);
    const draft = clone(this.project);
    fn(draft);
    this.project = draft;
    this.ui.dirty = true;
    this.bump();
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push({ label: entry.label, project: this.project, playhead: this.ui.playhead, selection: [...this.ui.selection], ui: this.captureUiSnapshot() });
    this.project = entry.project;
    this.ui.playhead = entry.playhead;
    this.ui.selection = entry.selection;
    this.restoreUiSnapshot(entry.ui);
    this.ui.dirty = true;
    this.lastCoalesceKey = null;
    this.bump();
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push({ label: entry.label, project: this.project, playhead: this.ui.playhead, selection: [...this.ui.selection], ui: this.captureUiSnapshot() });
    this.project = entry.project;
    this.ui.playhead = entry.playhead;
    this.ui.selection = entry.selection;
    this.restoreUiSnapshot(entry.ui);
    this.ui.dirty = true;
    this.lastCoalesceKey = null;
    this.bump();
  }

  markSaved(): void {
    this.ui.dirty = false;
    this.bump();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  /** Undo-stack labels, oldest → newest (for a History panel). */
  undoLabels(): string[] {
    return this.undoStack.map((e) => e.label);
  }

  // ── transport ─────────────────────────────────────────────────
  setPlayhead(t: number, max = Infinity): void {
    this.ui.playhead = Math.max(0, Math.min(Math.round(t), max));
    this.bump();
  }
  setPlaying(v: boolean): void {
    this.ui.playing = v;
    this.bump();
  }
  setInPoint(t: number | null): void {
    this.ui.inPoint = t;
    this.bump();
  }
  setOutPoint(t: number | null): void {
    this.ui.outPoint = t;
    this.bump();
  }

  // ── selection ─────────────────────────────────────────────────
  get selection(): Id[] {
    return this.ui.selection;
  }
  select(ids: Id[]): void {
    this.ui.selection = [...new Set(ids)];
    this.bump();
  }
  selectOne(id: Id): void {
    this.ui.selection = [id];
    this.bump();
  }
  toggleSelect(id: Id): void {
    const set = new Set(this.ui.selection);
    set.has(id) ? set.delete(id) : set.add(id);
    this.ui.selection = [...set];
    this.bump();
  }
  clearSelection(): void {
    if (this.ui.selection.length === 0) return;
    this.ui.selection = [];
    this.bump();
  }

  // ── tool + view ───────────────────────────────────────────────
  setTool(tool: string): void {
    this.ui.tool = tool;
    this.bump();
  }
  setZoom(pxPerFrame: number): void {
    this.ui.pxPerFrame = Math.max(0.01, Math.min(pxPerFrame, 2000));
    this.bump();
  }
  setScroll(t: number): void {
    this.ui.scrollFrame = Math.max(0, t);
    this.bump();
  }
  setSnapping(v: boolean): void {
    this.ui.snapping = v;
    this.bump();
  }
}
