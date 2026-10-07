// Flows that must not cost the user a history state: a cancelled dialog
// transaction (#170) and a timeline bake (#84). Both are undo-contract bugs that
// only show at the History States cap or across many frames, so the fake engine
// below mirrors the real push/evict/drop mechanics (mod.rs push_undo /
// push_prop_undo / set_history_states / drop_last_undo) rather than counting calls.
import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";
import type { AppSnapshot } from "./store";
import type { TimelineKey } from "./timeline";
import type { SamParams } from "./selectAndMask";

// Minimal Storage stand-in — the unit suite runs in node, which has none.
function installStorage() {
  const cells = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return cells.size; },
    clear: () => cells.clear(),
    key: (i: number) => [...cells.keys()][i] ?? null,
    getItem: (k: string) => cells.get(k) ?? null,
    setItem: (k: string, v: string) => { cells.set(k, v); },
    removeItem: (k: string) => { cells.delete(k); },
  } as Storage;
}

/** The engine's undo stack, faithfully: a push at the cap evicts the OLDEST
 *  entry, `drop_last_undo` pops the newest, `undo_pushes` is monotonic, and
 *  `set_layer_opacity` coalesces only consecutive edits of the same layer. */
function fakeEngine(cap: number) {
  const undo: string[] = [];
  const opacity = new Map<number, number>();
  let pushes = 0;
  let states = cap;
  let transactionDepth: number | null = null;
  let lastProp: string | null = null;
  const trim = () => { while (undo.length > states) undo.shift(); };
  const push = (label: string) => {
    undo.push(label);
    pushes++;
    if (transactionDepth === null) trim();
    lastProp = null;
  };
  return {
    undo,
    frames: 0,
    set_history_states(n: number) { states = n; if (transactionDepth === null) trim(); },
    begin_history_transaction() {
      if (transactionDepth !== null) return false;
      transactionDepth = undo.length;
      return true;
    },
    cancel_history_transaction() {
      if (transactionDepth === null) return false;
      undo.splice(transactionDepth);
      transactionDepth = null;
      trim();
      return true;
    },
    commit_history_transaction() {
      if (transactionDepth === null) return false;
      if (undo.length === transactionDepth) {
        this.cancel_history_transaction();
        return false;
      }
      transactionDepth = null;
      trim();
      return true;
    },
    history_transaction_active() { return transactionDepth !== null; },
    push_history(label: string) { push(label); },
    drop_last_undo() { undo.pop(); lastProp = null; },
    undo_pushes() { return pushes; },
    layer_opacity(id: number) { return opacity.get(id) ?? 1; },
    set_layer_opacity(id: number, o: number) {
      if (Math.abs((opacity.get(id) ?? 1) - o) < 1e-6) return;
      if (lastProp !== `1:${id}`) { push("Opacity"); lastProp = `1:${id}`; }
      opacity.set(id, o);
    },
    layer_offset() { return [0, 0]; },
    set_layer_offset() {}, // untracked, like the engine
    clear_frames() { this.frames = 0; },
    bake_frame() { this.frames++; },
    // Select and Mask: every op below owns its own push in the engine
    // (mod.rs push_sel_undo/push_stack_undo), which is the whole of #172.
    active_layer_id() { return 7; },
    select_and_mask_preview() { return new Uint8Array(0); },
    select_and_mask() { push("Select and Mask"); },
    add_layer_mask_reveal_selection() { push("Reveal Selection"); },
    decontaminate_colors() { push("Decontaminate Colors"); },
    select_none() { push("Deselect"); },
  };
}

const patch = (store: Store, p: Partial<AppSnapshot>) =>
  (store as unknown as { set(patch: Partial<AppSnapshot>): void }).set(p);

/** `sync` mirrors the real one for the two fields the fix reads back: the
 *  History panel's timeline and the applied-op count (= the undo depth). */
function newStore(cap: number) {
  const engine = fakeEngine(cap);
  // `sync` is handed to the constructor but has to reach the Store it builds, so
  // the reference goes through a holder rather than a forward-declared binding.
  const held: { store?: Store } = {};
  const sync = () => patch(held.store!, { history: [...engine.undo], historyIndex: engine.undo.length });
  const client = { onCommit: null, engine, e: engine, sync, commit: vi.fn(), refreshFromEngine: sync };
  const store = new Store(client as never);
  held.store = store;
  store.setHistoryStates(cap);
  return { store, engine, sync, client };
}

beforeEach(() => { installStorage(); });

describe("dialog history transaction", () => {
  it("cancelling at the History States cap keeps every real state (#170)", () => {
    const { store, engine, sync } = newStore(3);
    for (const label of ["Levels", "Brush", "Crop"]) engine.push_history(label);
    sync(); // the store is resynced after every edit

    store.beginHistory("Blending Options"); // dialog opens
    store.dropHistory(); // Cancel — the document is unchanged

    expect(engine.undo).toEqual(["Levels", "Brush", "Crop"]);
  });

  it("still leaves exactly the cancelled step behind below the cap", () => {
    const { store, engine, sync } = newStore(50);
    engine.push_history("Levels");
    sync();
    store.beginHistory("Blending Options");
    expect(engine.undo).toEqual(["Levels", "Blending Options"]);
    store.dropHistory();
    expect(engine.undo).toEqual(["Levels"]);
  });

  it("gives the borrowed slot back, so the setting still bounds history (#170)", () => {
    const { store, engine, sync } = newStore(3);
    for (const label of ["Levels", "Brush", "Crop"]) engine.push_history(label);
    sync();
    store.beginHistory("Blending Options");
    store.dropHistory();
    engine.push_history("Curves"); // the next real edit
    expect(engine.undo).toEqual(["Brush", "Crop", "Curves"]); // 3 states, not 4
  });

  it("commits one labelled step at the cap and dirties once", () => {
    const { store, engine, sync, client } = newStore(3);
    for (const label of ["Levels", "Brush", "Crop"]) engine.push_history(label);
    sync();
    expect(store.beginHistory("Blending Options")).toBe(true);
    expect(store.commitHistory()).toBe(true);
    expect(engine.undo).toEqual(["Brush", "Crop", "Blending Options"]);
    expect(client.commit).toHaveBeenCalledTimes(1);
  });
});

describe("Select and Mask commit", () => {
  const params: SamParams = { radius: 0, smartRadius: false, smooth: 0, feather: 0, contrast: 0, shift: 0 };

  it("lands one undo step for an Output To that also mutates the document (#172)", () => {
    const { store, engine } = newStore(50);
    store.selectAndMask(params, new Uint8Array(0), "layermask");
    // Not ["Select and Mask", "Reveal Selection", "Deselect"]: one ⌘Z used to
    // restore the selection and leave the new layer mask attached.
    expect(engine.undo).toEqual(["Select and Mask"]);
  });

  it("keeps the engine's own single step for a plain Selection output", () => {
    const { store, engine } = newStore(50);
    store.selectAndMask(params, new Uint8Array(0));
    expect(engine.undo).toEqual(["Select and Mask"]);
  });

  it("wraps the decontaminated New Layer with Layer Mask route too", () => {
    const { store, engine } = newStore(50);
    store.selectAndMask(params, new Uint8Array(0), "newlayermask", true);
    expect(engine.undo).toEqual(["Select and Mask"]);
  });
});

describe("timelineRender", () => {
  const keys: TimelineKey[] = [
    { layerId: 1, t: 0, opacity: 1, dx: 0, dy: 0 },
    { layerId: 1, t: 1, opacity: 0, dx: 0, dy: 0 },
    { layerId: 2, t: 0, opacity: 0, dx: 0, dy: 0 },
    { layerId: 2, t: 1, opacity: 1, dx: 0, dy: 0 },
  ];

  it("bakes two animated layers without touching history (#84)", () => {
    const { store, engine } = newStore(3);
    for (const label of ["Levels", "Brush", "Crop"]) engine.push_history(label);
    patch(store, { timeline: { fps: 12, durationS: 1, keys } });

    expect(store.timelineRender()).toBe(12);

    expect(engine.frames).toBe(12);
    expect(engine.undo).toEqual(["Levels", "Brush", "Crop"]);
  });

  it("restores the layers' live opacity when it is done", () => {
    const { store, engine } = newStore(50);
    patch(store, { timeline: { fps: 12, durationS: 1, keys } });
    store.timelineRender();
    expect([engine.layer_opacity(1), engine.layer_opacity(2)]).toEqual([1, 1]);
    expect(engine.undo).toEqual([]);
  });
});
