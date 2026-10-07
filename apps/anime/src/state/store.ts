// ─────────────────────────────────────────────────────────────
// state/store — observable editor state with clone-on-write undo + transport.
//
// `mutate(label, fn)` clones the project, applies fn, and pushes one undo step
// (drag gestures collapse via coalesceKey). `patch()` updates non-undoable UI
// (playhead, playing, selection, zoom). React binds via useSyncExternalStore.
// ─────────────────────────────────────────────────────────────

import { useSyncExternalStore } from "react";
import { createProject } from "../model/factory";
import type { AnimeProject, Id } from "../model/types";

export interface EditorState {
  project: AnimeProject;
  playhead: number; // seconds
  playing: boolean;
  loop: boolean;
  selection: Id[]; // selected layer ids
  selectedKeyframes: Id[];
  pixelsPerSecond: number; // timeline zoom
  dirty: boolean;
  filePath: string | null;
  ready: boolean;
  rev: number;
}

interface UndoEntry {
  project: AnimeProject;
  playhead: number;
  selection: Id[];
  label: string;
}

const clone = <T>(v: T): T => structuredClone(v);

class AnimeStore {
  private state: EditorState;
  private listeners = new Set<() => void>();
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private lastCoalesce: string | null = null;
  private readonly maxUndo = 200;

  constructor() {
    this.state = {
      project: createProject("Untitled"),
      playhead: 0,
      playing: false,
      loop: true,
      selection: [],
      selectedKeyframes: [],
      pixelsPerSecond: 90,
      dirty: false,
      filePath: null,
      ready: false,
      rev: 0,
    };
  }

  getState = (): EditorState => this.state;
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private emit() {
    for (const l of this.listeners) l();
  }
  private set(patch: Partial<EditorState>) {
    this.state = { ...this.state, ...patch, rev: this.state.rev + 1 };
    this.emit();
  }

  /** Undoable structural / keyframe edit. */
  mutate(label: string, fn: (project: AnimeProject) => void, opts: { coalesceKey?: string } = {}): void {
    const coalesce = opts.coalesceKey != null && opts.coalesceKey === this.lastCoalesce;
    if (!coalesce) {
      this.undoStack.push({ project: this.state.project, playhead: this.state.playhead, selection: this.state.selection.slice(), label });
      if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
      this.redoStack = [];
    }
    this.lastCoalesce = opts.coalesceKey ?? null;
    const next = clone(this.state.project);
    fn(next);
    this.set({ project: next, dirty: true });
  }

  /** Non-undoable update (transport, selection, view). */
  patch(patch: Partial<EditorState>): void {
    this.lastCoalesce = null;
    this.set(patch);
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push({ project: this.state.project, playhead: this.state.playhead, selection: this.state.selection.slice(), label: entry.label });
    this.lastCoalesce = null;
    this.set({ project: entry.project, playhead: entry.playhead, selection: entry.selection, dirty: true });
  }
  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push({ project: this.state.project, playhead: this.state.playhead, selection: this.state.selection.slice(), label: entry.label });
    this.lastCoalesce = null;
    this.set({ project: entry.project, playhead: entry.playhead, selection: entry.selection, dirty: true });
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // transport
  setPlayhead(t: number): void {
    this.patch({ playhead: Math.max(0, t) });
  }
  setPlaying(p: boolean): void {
    this.patch({ playing: p });
  }
  setLoop(l: boolean): void {
    this.patch({ loop: l });
  }
  setZoom(pps: number): void {
    this.patch({ pixelsPerSecond: Math.max(10, Math.min(600, pps)) });
  }
  // selection
  setSelection(ids: Id[]): void {
    this.patch({ selection: ids });
  }
  setSelectedKeyframes(ids: Id[]): void {
    this.patch({ selectedKeyframes: ids });
  }

  // document lifecycle
  replaceProject(project: AnimeProject, opts: { filePath?: string | null; markClean?: boolean } = {}): void {
    this.undoStack = [];
    this.redoStack = [];
    this.lastCoalesce = null;
    this.set({
      project,
      selection: [],
      selectedKeyframes: [],
      playhead: 0,
      playing: false,
      dirty: !opts.markClean,
      filePath: opts.filePath ?? null,
    });
  }
  markClean(filePath?: string): void {
    this.set({ dirty: false, filePath: filePath ?? this.state.filePath });
  }
  setReady(r: boolean): void {
    this.set({ ready: r });
  }
}

export type { AnimeStore };
export const store = new AnimeStore();

/** Subscribe to the whole editor state (re-renders on any change). */
export function useEditor(): EditorState {
  return useSyncExternalStore(store.subscribe, store.getState);
}

/** Subscribe to a derived value. Selector must return a primitive or a stable ref. */
export function useSelector<T>(selector: (s: EditorState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
