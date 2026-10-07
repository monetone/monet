// ─────────────────────────────────────────────────────────────
// engine/store/store — the observable editor store + undo/redo
// ─────────────────────────────────────────────────────────────
// RythmeStore now EXTENDS the shared @monet-ui/monet-timeline `TimelineStore`,
// so every Monet app shares one store base (subscribe / undo stacks /
// clone-on-write / drag-coalescing / undoable-UI hooks). Rythme keeps its
// ergonomic `dispatch(command)` API — where a Command is a pure `(state) =>
// state` transform with structural sharing — as a thin facade over the base's
// history machinery: `dispatch` snapshots via the base `pushUndo` (with
// coalescing), and undo/redo restore the project + the rich selection/active
// track via the base's capture/restore hooks. Rythme's richer editor state
// (selection range, audio transport, view, clipboard) lives alongside the
// base's project.

import { TimelineStore } from "@monet-ui/monet-timeline";
import { emptyProject, normalizeEditorPreferences } from "../model/factory";
import type { Clipboard, EditorMode, EditorState, Project, Selection, ToolId, Transport, ViewState } from "../model/types";
import type { NoiseProfile } from "../dsp/noise-reduction";

export type Command = (state: EditorState) => EditorState;

export interface DispatchOptions {
  /** Push an undo snapshot before applying (default: true). */
  history?: boolean;
  /** Mark the document dirty (default: same as `history`). */
  dirty?: boolean;
  /** Human label for the History panel. */
  label?: string;
  /**
   * Consecutive dispatches sharing a coalesce key collapse into one undo step
   * (e.g. dragging a fader emits many sets but undoes once).
   */
  coalesceKey?: string;
}

export function emptySelection(): Selection {
  return { clipIds: [], trackIds: [], range: null, spectral: null };
}

export function defaultTransport(): Transport {
  return { playing: false, recording: false, recordingInput: null, playhead: 0, loop: null, loopEnabled: false, metronome: false };
}

export function defaultView(project?: Project): ViewState {
  const preferences = project ? normalizeEditorPreferences(project.editorPreferences, project.sampleRate) : undefined;
  return { pxPerSecond: 120, scrollSec: 0, scrollY: 0, viewportPx: 800, snap: preferences?.snap ?? true };
}

export function initialState(project: Project): EditorState {
  const preferences = normalizeEditorPreferences(project.editorPreferences, project.sampleRate);
  return {
    project,
    mode: preferences.editorMode,
    selection: emptySelection(),
    transport: defaultTransport(),
    view: defaultView(project),
    tool: preferences.tool,
    activeTrackId: project.tracks[0]?.id ?? null,
    clipboard: null,
    dirty: false,
  };
}

/** Rythme's editor UI that lives alongside the base store's project. */
interface RythmeUi {
  mode: EditorMode;
  selection: Selection;
  transport: Transport;
  view: ViewState;
  tool: ToolId;
  activeTrackId: string | null;
  clipboard: Clipboard | null;
}

export class RythmeStore extends TimelineStore<Project, EditorState> {
  private ext: RythmeUi = {
    mode: "multitrack",
    selection: emptySelection(),
    transport: defaultTransport(),
    view: defaultView(),
    tool: "select",
    activeTrackId: null,
    clipboard: null,
  };

  /** The captured noise print (Audition-style). App state, not part of undo
   *  history or the document — like a copy buffer for the Noise Reduction
   *  effect. Null until "Capture Noise Print" runs. */
  private noiseProfile: NoiseProfile | null = null;

  constructor(project?: Project) {
    super(project ?? emptyProject());
    this.applyProjectPreferencesToUi(this.getProject());
    this.ext.activeTrackId = this.getProject().tracks[0]?.id ?? null;
  }

  /** The reactive EditorState (assembled from the base project + Rythme UI). */
  getState = (): EditorState => this.state;

  protected override snapshot(): EditorState {
    return {
      project: this.getProject(),
      mode: this.ext.mode,
      selection: this.ext.selection,
      transport: this.ext.transport,
      view: this.ext.view,
      tool: this.ext.tool,
      activeTrackId: this.ext.activeTrackId,
      clipboard: this.ext.clipboard,
      dirty: this.ui.dirty,
    };
  }

  // Rythme's undo snapshot also captures selection + active track (the base
  // already captures the project) so undo/redo restore them.
  protected override captureUiSnapshot(): unknown {
    return { mode: this.ext.mode, selection: this.ext.selection, activeTrackId: this.ext.activeTrackId };
  }
  protected override restoreUiSnapshot(snap: unknown): void {
    const s = snap as { mode?: EditorMode; selection: Selection; activeTrackId: string | null } | undefined;
    if (s) {
      this.ext.mode = s.mode ?? this.ext.mode;
      this.ext.selection = s.selection;
      this.ext.activeTrackId = s.activeTrackId;
    }
  }

  // ── command dispatch (facade over the shared base history) ────────────────
  dispatch(cmd: Command, opts: DispatchOptions = {}): void {
    const prev = this.state;
    const next = cmd(prev);
    if (next === prev) return;

    const history = opts.history ?? true;
    if (history) this.pushUndo(opts.label ?? "Edit", opts.coalesceKey);
    else this.lastCoalesceKey = null;

    this.project = next.project;
    this.ext.mode = next.mode;
    this.ext.selection = next.selection;
    this.ext.transport = next.transport;
    this.ext.view = next.view;
    this.ext.tool = next.tool;
    this.ext.activeTrackId = next.activeTrackId;
    this.ext.clipboard = next.clipboard;
    this.ui.dirty = (opts.dirty ?? history) ? true : next.dirty;
    this.bump();
  }

  /** Adopt a project from a collaborator: swap it in + repaint, WITHOUT an undo
   *  step or re-broadcast (the collab binding guards the echo). PCM is restored
   *  by the collab adapter from its local cache before this is called — the
   *  synced document never carries samples (see apps/rythme/src/collab). */
  applyRemoteProject(project: Project): void {
    this.project = project;
    this.applyProjectPreferencesToUi(project);
    this.bump();
  }

  // ── document lifecycle ─────────────────────────────────────────────────────
  /** Replace the whole project (New / Open). Clears history. (`dirty` accepted
   *  for base-signature compatibility; `markClean` is the Rythme idiom.) */
  override replaceProject(project: Project, opts: { markClean?: boolean; dirty?: boolean } = {}): void {
    const preferences = normalizeEditorPreferences(project.editorPreferences, project.sampleRate);
    this.project = project;
    this.ext = {
      mode: preferences.editorMode,
      selection: emptySelection(),
      transport: defaultTransport(),
      view: defaultView(project),
      tool: preferences.tool,
      activeTrackId: project.tracks[0]?.id ?? null,
      clipboard: null,
    };
    this.undoStack = [];
    this.redoStack = [];
    this.lastCoalesceKey = null;
    this.ui.dirty = !opts.markClean;
    this.bump();
  }

  markClean(): void {
    this.markSaved();
  }

  // ── noise print (Noise Reduction effect state) ─────────────────────────────
  /** Read the captured noise print (null until one is captured). */
  getNoiseProfile(): NoiseProfile | null {
    return this.noiseProfile;
  }

  /** Store a captured noise print and repaint subscribers (no undo step). */
  setNoiseProfile(profile: NoiseProfile | null): void {
    this.noiseProfile = profile;
    this.bump();
  }

  private applyProjectPreferencesToUi(project: Project): void {
    const preferences = normalizeEditorPreferences(project.editorPreferences, project.sampleRate);
    this.ext.mode = preferences.editorMode;
    this.ext.tool = preferences.tool;
    this.ext.view = { ...this.ext.view, snap: preferences.snap };
  }
}
