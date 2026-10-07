// History panel flyout (VIS-HIS-01): History Options, per-state Delete and New
// Document From State. Engine-free (node) — the panel wiring is e2e-covered, so
// this pins the store logic: preference validation/persistence, the undo-log
// suppression behind "Make Layer Visibility Changes Undoable", and the engine
// call sequences Delete / New Document depend on.
import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store, normalizeHistoryOptions, DEFAULT_HISTORY_OPTIONS, HISTORY_STATES_MAX } from "./store";

// Minimal Storage stand-in — the unit suite runs in node, which has none.
function installStorage(): Map<string, string> {
  const cells = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return cells.size; },
    clear: () => cells.clear(),
    key: (i: number) => [...cells.keys()][i] ?? null,
    getItem: (k: string) => cells.get(k) ?? null,
    setItem: (k: string, v: string) => { cells.set(k, v); },
    removeItem: (k: string) => { cells.delete(k); },
  } as Storage;
  return cells;
}

// A fake engine that models just the undo bookkeeping this feature reads: a
// stack depth, the History-States cap, and a log of the calls made against it.
function fakeEngine() {
  const calls: string[] = [];
  // `pushes` mirrors the engine's monotonic push counter, which is what the store
  // reads: at the History-States cap a push evicts an older entry so `depth` stops
  // changing, and a depth-only model cannot express that.
  const state = { depth: 0, pushes: 0, cap: 50, visibilityPushes: true };
  const push = () => {
    state.pushes++;
    if (state.depth < state.cap) state.depth++;
  };
  return {
    calls,
    state,
    set_history_states(n: number) { state.cap = n; calls.push(`cap:${n}`); },
    undo_depth() { return state.depth; },
    undo_pushes() { return state.pushes; },
    drop_last_undo() { state.depth = Math.max(0, state.depth - 1); calls.push("drop"); },
    push_history(label: string) { push(); calls.push(`push:${label}`); },
    history_seek(applied: number) { calls.push(`seek:${applied}`); },
    // A seek reads the print resolution around itself, since a Bitmap step it
    // crosses carries one (#442); this timeline never changes it.
    resolution_ppi() { return 72; },
    set_layer_visible(id: number, v: boolean) {
      if (state.visibilityPushes) push();
      calls.push(`vis:${id}:${v}`);
    },
  };
}

type Fake = ReturnType<typeof fakeEngine>;

function newStore(): { store: Store; engine: Fake } {
  const engine = fakeEngine();
  const client = { onCommit: null as null | (() => void), engine, e: engine, sync: () => {}, commit: () => {} };
  return { store: new Store(client as never), engine };
}

/** The History timeline is engine-synced through syncFromEngine, which a node
 *  fake cannot drive — seed the snapshot the panel reads directly instead. */
function seedTimeline(store: Store, history: string[], historyIndex: number) {
  (store as unknown as { set(patch: unknown): void }).set({ history, historyIndex });
}

beforeEach(() => { installStorage(); });

describe("normalizeHistoryOptions", () => {
  it("falls back to the Photoshop defaults for anything non-boolean", () => {
    expect(normalizeHistoryOptions(null)).toEqual(DEFAULT_HISTORY_OPTIONS);
    expect(normalizeHistoryOptions("nope")).toEqual(DEFAULT_HISTORY_OPTIONS);
    expect(normalizeHistoryOptions([true, true])).toEqual(DEFAULT_HISTORY_OPTIONS);
    expect(normalizeHistoryOptions({ autoFirstSnapshot: "yes", layerVisibilityUndoable: 1 }))
      .toEqual(DEFAULT_HISTORY_OPTIONS);
  });

  it("keeps valid flags and drops unknown keys", () => {
    expect(normalizeHistoryOptions({ autoFirstSnapshot: false, autoSnapshotOnSave: true, bogus: true }))
      .toEqual({ ...DEFAULT_HISTORY_OPTIONS, autoFirstSnapshot: false, autoSnapshotOnSave: true });
  });
});

describe("History Options preference", () => {
  it("persists a partial change and reloads it in a fresh store", () => {
    const { store } = newStore();
    store.setHistoryOptions({ autoSnapshotOnSave: true });
    expect(store.state.historyOptions.autoSnapshotOnSave).toBe(true);
    expect(store.state.historyOptions.autoFirstSnapshot).toBe(true); // untouched default

    expect(newStore().store.state.historyOptions.autoSnapshotOnSave).toBe(true);
  });

  it("survives corrupt storage without blocking the other preferences", () => {
    localStorage.setItem("mv.historyOptions", "{not json");
    localStorage.setItem("mv.gridPrefs", JSON.stringify({ spacing: 24 }));
    const { store } = newStore();
    expect(store.state.historyOptions).toEqual(DEFAULT_HISTORY_OPTIONS);
    expect(store.state.gridSpacing).toBe(24);
  });
});

describe("Make Layer Visibility Changes Undoable", () => {
  it("drops the engine's Visibility state while the option is off (Photoshop default)", () => {
    const { store, engine } = newStore();
    store.setLayerVisible(3, false);
    expect(engine.state.depth).toBe(0);
    expect(engine.calls).toEqual([`cap:${HISTORY_STATES_MAX}`, "vis:3:false", "drop", "cap:50"]);
  });

  it("keeps the state — and never touches the cap — once the option is on", () => {
    const { store, engine } = newStore();
    store.setHistoryOptions({ layerVisibilityUndoable: true });
    store.setLayerVisible(3, false);
    expect(engine.state.depth).toBe(1);
    expect(engine.calls).toEqual(["vis:3:false"]);
  });

  it("never eats the previous edit when the toggle pushed nothing", () => {
    const { store, engine } = newStore();
    engine.state.depth = 2; // two real edits already on the stack
    engine.state.visibilityPushes = false; // no-op change / read-only Photoshop source
    store.setLayerVisible(3, false);
    expect(engine.state.depth).toBe(2);
    expect(engine.calls).not.toContain("drop");
  });

  it("lifts the cap first, so a push at the limit cannot evict the oldest state", () => {
    const { store, engine } = newStore();
    store.setHistoryStates(2);
    engine.state.depth = 2; // at the cap
    engine.calls.length = 0;
    store.setLayerVisible(3, true);
    expect(engine.calls[0]).toBe(`cap:${HISTORY_STATES_MAX}`);
    expect(engine.calls.at(-1)).toBe("cap:2");
    expect(engine.state.depth).toBe(2);
  });
});

describe("History panel ▸ Delete", () => {
  it("seeks to the state before the selection and clears the redo branch", () => {
    const { store, engine } = newStore();
    seedTimeline(store, ["Brush", "Levels", "Crop"], 3);
    engine.calls.length = 0;
    store.deleteHistoryFrom(2); // delete "Levels" and everything after it
    // push_history clears the engine's redo stack; the throwaway state is dropped
    // again, and the cap dance keeps the oldest state safe.
    expect(engine.calls).toEqual(["seek:1", `cap:${HISTORY_STATES_MAX}`, "push:Delete State", "drop", "cap:50"]);
  });

  it("refuses to delete the opened state or a state off the end of the timeline", () => {
    const { store, engine } = newStore();
    seedTimeline(store, ["Brush", "Levels"], 2);
    engine.calls.length = 0;
    store.deleteHistoryFrom(0);
    store.deleteHistoryFrom(3);
    expect(engine.calls).toEqual([]);
  });
});

describe("History panel ▸ New Document", () => {
  it("seeks to the picked state and names the copy after it", () => {
    const { store, engine } = newStore();
    seedTimeline(store, ["Brush", "Levels", "Crop"], 3);
    const names: (string | undefined)[] = [];
    store.duplicateDocument = (name?: string) => { names.push(name); };
    engine.calls.length = 0;

    store.newDocumentFromHistory(1);
    expect(engine.calls).toContain("seek:1");
    expect(names).toEqual(["Brush"]);
  });

  it("defaults to the current state and calls the opened state 'Open'", () => {
    const { store, engine } = newStore();
    seedTimeline(store, ["Brush"], 0);
    const names: (string | undefined)[] = [];
    store.duplicateDocument = (name?: string) => { names.push(name); };
    engine.calls.length = 0;

    store.newDocumentFromHistory();
    expect(engine.calls).toEqual([]); // already on state 0 — no needless seek
    expect(names).toEqual(["Open"]);
  });
});
