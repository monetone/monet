// Guards VIS-SEL-16: Save/Load Selection reach other open documents of the same
// size, Load can invert the channel, and Save can combine into an existing
// channel (Photoshop's Operation). Explicit-mask engine calls keep those
// exchanges to one undoable step without changing the other document's live
// selection or creating hidden scratch channels.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store, combineMasks, type AppSnapshot } from "./store";

interface EngineState {
  active: boolean;
  mask: Uint8Array;
  saved: Map<string, Uint8Array>;
}

/** The engine's selection, channel, capped undo, and redo behaviour. */
class FakeEngine {
  active = false;
  mask: Uint8Array;
  saved = new Map<string, Uint8Array>();
  undoStack: EngineState[] = [];
  redoStack: EngineState[] = [];
  historyStates = 100;
  constructor(readonly w: number, readonly h: number) {
    this.mask = new Uint8Array(w * h).fill(255);
  }
  width() { return this.w; }
  height() { return this.h; }
  private pushes = 0;
  private state(): EngineState {
    return {
      active: this.active,
      mask: this.mask.slice(),
      saved: new Map([...this.saved].map(([name, mask]) => [name, mask.slice()])),
    };
  }
  private restore(state: EngineState) {
    this.active = state.active;
    this.mask = state.mask.slice();
    this.saved = new Map([...state.saved].map(([name, mask]) => [name, mask.slice()]));
  }
  private push() {
    this.undoStack.push(this.state());
    if (this.undoStack.length > this.historyStates) this.undoStack.shift();
    this.redoStack = [];
    this.pushes += 1;
  }
  undo() {
    const state = this.undoStack.pop();
    if (!state) return;
    this.redoStack.push(this.state());
    this.restore(state);
  }
  redo() {
    const state = this.redoStack.pop();
    if (!state) return;
    this.undoStack.push(this.state());
    this.restore(state);
  }
  set_history_states(states: number) {
    this.historyStates = Math.max(1, Math.trunc(states));
    while (this.undoStack.length > this.historyStates) this.undoStack.shift();
  }
  undo_depth() { return this.undoStack.length; }
  redo_depth() { return this.redoStack.length; }
  undo_pushes() { return this.pushes; }
  get_selection_mask() { return this.active ? this.mask.slice() : new Uint8Array(this.w * this.h).fill(255); }
  saved_selection_names() { return [...this.saved.keys()]; }
  saved_selection_mask(name: string) { return this.saved.get(name)?.slice() ?? new Uint8Array(); }
  save_selection(name: string) { this.push(); this.saved.set(name, this.get_selection_mask()); }
  save_selection_mask(name: string, mask: Uint8Array) {
    if (mask.length !== this.mask.length) return;
    this.push();
    this.saved.set(name, mask.slice());
  }
  load_selection(name: string, mode: number) {
    const src = this.saved.get(name);
    if (src) this.apply_selection_mask(src, mode);
  }
  apply_selection_mask(src: Uint8Array, mode: number) {
    if (src.length !== this.mask.length) return;
    this.push();
    if (mode === 0) this.mask.fill(0);
    this.active = true;
    for (let i = 0; i < this.mask.length; i++) {
      const cur = this.mask[i], cov = src[i];
      this.mask[i] = mode === 1 ? Math.max(cur, cov) : mode === 2 ? Math.max(0, cur - cov) : mode === 3 ? Math.min(cur, cov) : cov;
    }
  }
}

interface Seed { id: number; engine: FakeEngine; name: string; dirty: boolean; contentRevision: number; pristineBlank: boolean }

function setup(sizes: [number, number][] = [[2, 2], [2, 2]]) {
  const engines = sizes.map(([w, h]) => new FakeEngine(w, h));
  const client = {
    engine: engines[0],
    e: engines[0],
    sync: vi.fn(),
    commit: vi.fn(() => { client.onCommit?.(); return true; }),
    onCommit: null as null | (() => void),
    lastBrush: [] as number[],
  };
  const store = new Store(client as never);
  const docs: Seed[] = engines.map((engine, i) => ({
    id: i + 1, engine, name: `Doc ${i + 1}`, dirty: false, contentRevision: 0, pristineBlank: false,
  }));
  const internal = store as unknown as { docs: Seed[]; activeDocId: number; set: (p: Partial<AppSnapshot>) => void };
  internal.docs = docs;
  internal.activeDocId = 1;
  internal.set({ activeDocId: 1 });
  return { store, docs, engines, client };
}

const bytes = (...v: number[]) => new Uint8Array(v);

describe("combineMasks", () => {
  it("mirrors the engine's Replace / Add / Subtract / Intersect arithmetic", () => {
    const base = bytes(0, 100, 255, 40), incoming = bytes(255, 50, 60, 40);
    expect([...combineMasks(base, incoming, 0)]).toEqual([255, 50, 60, 40]);
    expect([...combineMasks(base, incoming, 1)]).toEqual([255, 100, 255, 40]);
    expect([...combineMasks(base, incoming, 2)]).toEqual([0, 50, 195, 0]);
    expect([...combineMasks(base, incoming, 3)]).toEqual([0, 50, 60, 40]);
  });
});

describe("Load Selection", () => {
  it("loads a channel from another open document without disturbing it", () => {
    const { store, engines } = setup();
    engines[1].saved.set("Mask", bytes(255, 0, 128, 0));
    const before = engines[1].undo_depth();

    store.loadSelection("Mask", 0, false, 2);

    expect(engines[0].active).toBe(true);
    expect([...engines[0].mask]).toEqual([255, 0, 128, 0]);
    // The source document is only read: same channels, same selection, same history.
    expect(engines[1].active).toBe(false);
    expect(engines[1].saved_selection_names()).toEqual(["Mask"]);
    expect(engines[1].undo_depth()).toBe(before);
  });

  it("inverts the channel before combining when Invert is checked", () => {
    const { store, engines } = setup();
    engines[0].saved.set("Mask", bytes(255, 0, 200, 10));

    store.loadSelection("Mask", 0, true);

    expect([...engines[0].mask]).toEqual([0, 255, 55, 245]);
  });

  it("combines a foreign channel into the live selection with the chosen operation", () => {
    const { store, engines } = setup();
    engines[0].active = true;
    engines[0].mask = bytes(100, 100, 0, 0);
    engines[1].saved.set("Mask", bytes(0, 255, 60, 0));

    store.loadSelection("Mask", 1, false, 2); // Add

    expect([...engines[0].mask]).toEqual([100, 255, 60, 0]);
  });

  it("is one cap-safe undo/redo step with no scratch channel or phantom redo", () => {
    const { store, engines } = setup();
    engines[0].active = true;
    engines[0].mask = bytes(100, 100, 0, 0);
    engines[0].set_history_states(1);
    engines[0].save_selection("Keep"); // saturate the one-state history cap
    engines[1].saved.set("Mask", bytes(0, 255, 60, 0));
    const before = engines[0].get_selection_mask();
    const pushes = engines[0].undo_pushes();

    store.loadSelection("Mask", 1, false, 2);

    expect(engines[0].undo_pushes()).toBe(pushes + 1);
    expect(engines[0].undo_depth()).toBe(1);
    expect(engines[0].redo_depth()).toBe(0);
    expect(engines[0].saved_selection_names()).toEqual(["Keep"]);
    expect([...engines[0].mask]).toEqual([100, 255, 60, 0]);

    engines[0].undo();
    expect(engines[0].get_selection_mask()).toEqual(before);
    expect(engines[0].redo_depth()).toBe(1);
    expect(engines[0].saved_selection_names()).toEqual(["Keep"]);

    engines[0].redo();
    expect([...engines[0].mask]).toEqual([100, 255, 60, 0]);
    expect(engines[0].redo_depth()).toBe(0);
    expect(engines[0].saved_selection_names()).toEqual(["Keep"]);
  });

  it("keeps the plain same-document path on the engine call", () => {
    const { store, engines, client } = setup();
    engines[0].saved.set("Mask", bytes(1, 2, 3, 4));

    store.loadSelection("Mask");

    expect([...engines[0].mask]).toEqual([1, 2, 3, 4]);
    expect(engines[0].undo_depth()).toBe(1);
    expect(client.sync).toHaveBeenCalled();
  });

  it("refuses a channel that is not the active document's size", () => {
    const { store, engines } = setup([[2, 2], [3, 3]]);
    engines[1].saved.set("Mask", new Uint8Array(9).fill(255));

    store.loadSelection("Mask", 0, false, 2);

    expect(engines[0].active).toBe(false);
    expect(engines[0].undo_depth()).toBe(0);
  });
});

describe("Save Selection", () => {
  it("writes one cap-safe undo/redo step without changing the destination selection", () => {
    const { store, docs, engines } = setup();
    engines[0].active = true;
    engines[0].mask = bytes(255, 0, 90, 0);
    engines[1].active = true;
    engines[1].mask = bytes(0, 33, 66, 99);
    engines[1].set_history_states(1);
    engines[1].save_selection("Keep"); // saturate the one-state history cap
    const destinationSelection = engines[1].get_selection_mask();
    const pushes = engines[1].undo_pushes();

    store.saveSelection("Copy", 0, 2);

    expect(engines[1].undo_pushes()).toBe(pushes + 1);
    expect(engines[1].undo_depth()).toBe(1);
    expect(engines[1].redo_depth()).toBe(0); // no internal undo left a phantom redo
    expect([...engines[1].saved.get("Copy")!]).toEqual([255, 0, 90, 0]);
    expect(engines[1].get_selection_mask()).toEqual(destinationSelection);
    expect(engines[1].saved_selection_names()).toEqual(["Keep", "Copy"]);
    expect(docs[1].dirty).toBe(true);

    engines[1].undo();
    expect(engines[1].saved_selection_names()).toEqual(["Keep"]);
    expect(engines[1].get_selection_mask()).toEqual(destinationSelection);
    expect(engines[1].redo_depth()).toBe(1);

    engines[1].redo();
    expect(engines[1].saved_selection_names()).toEqual(["Keep", "Copy"]);
    expect(engines[1].get_selection_mask()).toEqual(destinationSelection);
    expect(engines[1].redo_depth()).toBe(0);
  });

  it("combines into an existing channel instead of replacing it", () => {
    const { store, engines } = setup();
    engines[0].active = true;
    engines[0].mask = bytes(255, 255, 0, 0);
    engines[1].saved.set("Mask", bytes(255, 0, 255, 0));

    store.saveSelection("Mask", 2, 2); // Subtract from Channel: channel − selection

    expect([...engines[1].saved.get("Mask")!]).toEqual([0, 0, 255, 0]);
  });

  it("combines into a channel of the active document and restores its selection", () => {
    const { store, engines } = setup();
    engines[0].active = true;
    engines[0].mask = bytes(255, 255, 0, 0);
    engines[0].saved.set("Mask", bytes(0, 255, 255, 0));

    store.saveSelection("Mask", 1); // Add to Channel

    expect([...engines[0].saved.get("Mask")!]).toEqual([255, 255, 255, 0]);
    expect([...engines[0].mask]).toEqual([255, 255, 0, 0]);
    expect(engines[0].undo_depth()).toBe(1);
  });

  it("saves the whole canvas when nothing is selected, like the engine does", () => {
    const { store, engines } = setup();
    engines[0].active = false;

    store.saveSelection("Copy", 0, 2);

    expect([...engines[1].saved.get("Copy")!]).toEqual([255, 255, 255, 255]);
  });

  it("refuses a destination document of a different size", () => {
    const { store, engines } = setup([[2, 2], [3, 3]]);

    store.saveSelection("Copy", 0, 2);

    expect(engines[1].saved_selection_names()).toEqual([]);
    expect(engines[1].undo_depth()).toBe(0);
  });

  it("keeps the plain same-document save on the engine call", () => {
    const { store, engines } = setup();
    engines[0].active = true;
    engines[0].mask = bytes(7, 7, 7, 7);

    store.saveSelection("Alpha 1");

    expect([...engines[0].saved.get("Alpha 1")!]).toEqual([7, 7, 7, 7]);
    // The plain same-document save goes straight to the engine's tracked
    // save_selection, which DOES take a "Save Selection" history step (Photoshop
    // makes it undoable too). The previous expectation of 0 encoded the fake's
    // wrong contract and is what let #81 pass its tests.
    expect(engines[0].undo_depth()).toBe(1);
  });
});

describe("document pickers", () => {
  it("offers only same-size documents and their channels", () => {
    const { store, engines } = setup([[2, 2], [2, 2], [4, 4]]);
    engines[1].saved.set("Mask", bytes(0, 0, 0, 0));

    expect(store.selectionExchangeDocs()).toEqual([{ id: 1, name: "Doc 1" }, { id: 2, name: "Doc 2" }]);
    expect(store.savedSelectionNamesIn(2)).toEqual(["Mask"]);
    expect(store.savedSelectionNamesIn(1)).toEqual([]);
  });
});
