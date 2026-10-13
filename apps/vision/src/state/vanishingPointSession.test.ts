// Filter ▸ Vanishing Point is a modal workspace: everything done inside it is one
// history transaction, OK keeps exactly one step, and Cancel puts the document
// and the plane list back (#447). The fake engine keeps the undo-stack mechanics
// the store relies on (undo_pushes is monotonic, drop_last_undo pops) and
// answers every other engine call with a no-op.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store, defaultVanishingPointPlanes, type AppSnapshot } from "./store";
import { DEFAULT_MEASURE_SCALE } from "./measureScale";
import { DEFAULT_DOCUMENT_RESOLUTION_PPI } from "./docPresets";

function fakeEngine() {
  let pushes = 0;
  let depth: number | null = null;
  const e = {
    undo: [] as string[],
    calls: [] as string[],
    locked: false,
    stamped: null as null | { x: number; y: number; w: number; h: number },
    width: () => 160,
    height: () => 120,
    has_clipboard: () => true,
    clipboard_profile: () => 0,
    begin_history_transaction() {
      if (depth !== null) return false;
      depth = e.undo.length;
      return true;
    },
    cancel_history_transaction() {
      if (depth === null) return false;
      e.undo.splice(depth);
      depth = null;
      e.calls.push("cancel");
      return true;
    },
    commit_history_transaction() {
      // mod.rs: an undo stack below the mark refuses and stays open; one at the
      // mark cancels as "nothing changed".
      if (depth === null || e.undo.length < depth) return false;
      if (e.undo.length === depth) return !e.cancel_history_transaction();
      depth = null;
      e.calls.push("commit");
      return true;
    },
    history_transaction_active: () => depth !== null,
    push_history(label: string) { e.undo.push(label); pushes++; },
    undo_pushes: () => pushes,
    drop_last_undo() { e.undo.pop(); e.calls.push("drop"); },
    set_layer_visible() { e.push_history("Visibility"); }, // the engine always pushes; the store drops it
    stamp_image(x: number, y: number, w: number, h: number) {
      if (e.locked) return; // mod.rs stamp_image: a locked layer returns before pushing
      e.push_history("Paste");
      e.stamped = { x, y, w, h };
    },
  };
  return new Proxy(e, {
    get: (target, key) => (key in target ? target[key as keyof typeof target] : key === "then" ? undefined : () => undefined),
  });
}

function seedDoc(id: number, engine: unknown) {
  return {
    id, name: `doc-${id}`, engine, savedPath: null,
    zoom: 1, panX: 0, panY: 0, rotationAngle: 0, historyLabels: [], dirty: false,
    contentRevision: 0, pristineBlank: false, colorProfileAssigned: true,
    iccProfileBytes: null, iccProfileName: null,
    notes: [], activeNoteId: 0, nextNoteId: 1, layerComps: [], guides: [], layerColorLabels: {},
    resolutionPpi: DEFAULT_DOCUMENT_RESOLUTION_PPI, pixelAspect: 1, pixelAspectCorrection: true,
    measureScale: { ...DEFAULT_MEASURE_SCALE },
    savedPaths: [], penPath: [], penAnchors: [], penContours: [],
    vanishingPointPlanes: defaultVanishingPointPlanes(160, 120), vanishingPointActivePlane: 0, vanishingPointSource: null,
    duotone: null, cameraRaw: null, cameraRawLayerId: null,
  };
}

function setup() {
  const engine = fakeEngine();
  const client = {
    engine, e: engine, docGen: 1, onCommit: null, lastBrush: [] as number[],
    onEditError: vi.fn(), commit: vi.fn(() => true), refreshFromEngine: vi.fn(), consumeEditError: vi.fn(() => false),
    sync: vi.fn(), activate: vi.fn(), deactivate: vi.fn(), blit: vi.fn(),
  };
  const store = new Store(client as never);
  const internal = store as unknown as { docs: unknown[]; activeDocId: number; set(patch: Partial<AppSnapshot>): void };
  internal.docs = [seedDoc(1, engine), seedDoc(2, fakeEngine())];
  internal.activeDocId = 1;
  internal.set({
    doc: { width: 160, height: 120, name: "doc-1" },
    vanishingPointPlanes: defaultVanishingPointPlanes(160, 120),
    vanishingPointActivePlane: 0,
    vanishingPointSource: { x: 3, y: 4 },
    documents: [{ id: 1, name: "doc-1", dirty: false, hasFile: false }, { id: 2, name: "doc-2", dirty: false, hasFile: false }],
  });
  return { store, engine, client, internal };
}

const FLOAT = { rgba: new Uint8Array(4 * 4 * 4).fill(255), w: 4, h: 4, quad: [0, 0, 4, 0, 4, 4, 0, 4] };
const RECT = { plane: 0, u0: 0.25, v0: 0.25, u1: 0.75, v1: 0.75 };

describe("Vanishing Point workspace session", () => {
  it("opens one labelled history transaction and arms the tool", () => {
    const { store, engine } = setup();
    store.openVanishingPoint();
    expect(store.state.vanishingPointSession).toBe(true);
    expect(store.state.tool).toBe("vanishingpoint");
    expect(engine.history_transaction_active()).toBe(true);
    expect(engine.undo).toEqual(["Vanishing Point"]);
  });

  it("reports why it cannot open inside another edit", () => {
    const { store, engine, client } = setup();
    engine.begin_history_transaction(); // another dialog's preview owns the document
    const tool = store.state.tool;
    store.openVanishingPoint();
    expect(store.state.vanishingPointSession).toBe(false);
    expect(store.state.tool).toBe(tool);
    expect(client.onEditError).toHaveBeenCalledWith(expect.stringContaining("Finish or cancel the current edit"));
  });

  it("keeps one step when a non-undoable visibility toggle runs mid-session", () => {
    for (const toggles of [1, 2]) {
      const { store, engine, internal } = setup();
      internal.set({ historyOptions: { ...store.state.historyOptions, layerVisibilityUndoable: false } });
      engine.push_history("Fill"); // the user's previous step must survive OK
      store.openVanishingPoint();
      engine.push_history("Clone Stamp");
      for (let i = 0; i < toggles; i++) store.setLayerVisible(1, i % 2 === 1);
      store.applyVanishingPoint();
      expect(engine.undo).toEqual(["Fill", "Vanishing Point"]);
      expect(engine.history_transaction_active()).toBe(false);
    }
  });

  it("never leaves the transaction open when OK cannot commit", () => {
    const { store, engine } = setup();
    engine.push_history("Fill");
    store.openVanishingPoint();
    engine.push_history("Clone Stamp");
    for (let i = 0; i < 2; i++) { engine.push_history("Stray"); engine.drop_last_undo(); } // pushes dropped behind the session's back
    store.applyVanishingPoint();
    expect(engine.history_transaction_active()).toBe(false);
    expect(store.state.vanishingPointSession).toBe(false);
  });

  it("applies rather than discards when the tool is left, unless the float is refused", () => {
    const { store, engine } = setup();
    engine.locked = true;
    store.openVanishingPoint();
    engine.push_history("Clone Stamp");
    store.setVanishingFloat(FLOAT.rgba, FLOAT.w, FLOAT.h, FLOAT.quad, RECT);
    store.setTool("brush");
    expect(store.state.tool).toBe("vanishingpoint");
    expect(store.state.vanishingPointSession).toBe(true);

    engine.locked = false;
    store.setTool("brush");
    expect(store.state.tool).toBe("brush");
    expect(store.state.vanishingPointSession).toBe(false);
    expect(engine.undo).toEqual(["Vanishing Point"]);
    expect(engine.stamped).not.toBeNull();
  });

  it("collapses every edit made inside it into the one step on OK", () => {
    const { store, engine, client } = setup();
    store.openVanishingPoint();
    for (const label of ["Clone Stamp", "Clone Stamp", "Paste"]) engine.push_history(label);
    store.applyVanishingPoint();
    expect(engine.calls.filter((c) => c === "drop")).toHaveLength(3);
    expect(engine.calls.filter((c) => c === "commit")).toHaveLength(1);
    expect(engine.undo).toEqual(["Vanishing Point"]);
    expect(client.commit).toHaveBeenCalledTimes(1);
    expect(store.state.vanishingPointSession).toBe(false);
  });

  it("adds no history step when OK only changed planes", () => {
    const { store, engine } = setup();
    store.openVanishingPoint();
    expect(store.tearOffVanishingPlane(0, 1)).toBe(true);
    store.applyVanishingPoint();
    expect(engine.calls).toEqual(["cancel"]);
    expect(engine.undo).toEqual([]);
    expect(store.state.vanishingPointPlanes).toHaveLength(2); // OK keeps the planes
  });

  it("places the float on OK as part of the one step", () => {
    const { store, engine } = setup();
    store.openVanishingPoint();
    store.setVanishingFloat(FLOAT.rgba, FLOAT.w, FLOAT.h, FLOAT.quad, RECT);
    store.applyVanishingPoint();
    expect(engine.stamped).not.toBeNull();
    expect(engine.undo).toEqual(["Vanishing Point"]);
    expect(store.state.vanishingPointFloat).toBeNull();
  });

  it("Cancel restores the planes, the active plane and the source after every kind of edit", () => {
    const { store, engine } = setup();
    const planes = structuredClone(store.state.vanishingPointPlanes);
    store.openVanishingPoint();
    expect(store.tearOffVanishingPlane(0, 1)).toBe(true);
    expect(store.state.vanishingPointActivePlane).toBe(1);
    expect(store.setVanishingRootCorner(0, 12)).toBe(true); // edits plane 1's root
    expect(store.state.vanishingPointPlanes[0].quad[0]).toBe(12);
    store.resetVanishingPlanes();
    expect(store.state.vanishingPointSource).toBeNull();
    store.setVanishingFloat(FLOAT.rgba, FLOAT.w, FLOAT.h, FLOAT.quad, RECT);
    engine.push_history("Clone Stamp");

    store.cancelVanishingPoint();
    expect(engine.calls).toEqual(["cancel"]);
    expect(engine.undo).toEqual([]);
    expect(engine.stamped).toBeNull();
    expect(store.state.vanishingPointPlanes).toEqual(planes);
    expect(store.state.vanishingPointActivePlane).toBe(0);
    expect(store.state.vanishingPointSource).toEqual({ x: 3, y: 4 });
    expect(store.state.vanishingPointFloat).toBeNull();
    expect(store.state.vanishingPointSession).toBe(false);
  });

  it("links a torn-off plane to a settable angle and refuses one that cannot fold", () => {
    const { store, client } = setup();
    store.openVanishingPoint();
    store.tearOffVanishingPlane(0, 1);
    const before = structuredClone(store.state.vanishingPointPlanes);

    expect(store.setVanishingPlaneAngle(0)).toBe(false);
    expect(client.onEditError).toHaveBeenLastCalledWith(expect.stringContaining("Enter an angle between 1° and 359°"));
    expect(store.state.vanishingPointPlanes).toEqual(before);

    expect(store.setVanishingPlaneAngle(120)).toBe(true);
    const child = store.state.vanishingPointPlanes[1];
    expect(child.angle).toBe(120);
    expect([child.quad.slice(0, 2), child.quad.slice(6, 8)]).toEqual([before[1].quad.slice(0, 2), before[1].quad.slice(6, 8)]);
    expect(child.quad.slice(2, 6)).not.toEqual(before[1].quad.slice(2, 6));

    expect(store.setVanishingRootCorner(2, 130)).toBe(true); // TR X moves the shared edge
    expect(store.state.vanishingPointPlanes[1].quad[0]).toBe(130);
    expect(store.setVanishingRootCorner(2, Number.NaN)).toBe(false);
  });

  it("reports a tear-off that cannot fold and leaves the planes unchanged", () => {
    const { store, client, internal } = setup();
    const flat = [{ quad: [10, 10, 10, 10, 10, 10, 10, 10], parent: null, edge: 0, angle: 90 }];
    internal.set({ vanishingPointPlanes: flat });
    expect(store.tearOffVanishingPlane(0, 1)).toBe(false);
    expect(client.onEditError).toHaveBeenCalledWith(expect.stringContaining("Could not tear off a plane"));
    expect(store.state.vanishingPointPlanes).toEqual(flat);
  });

  it("reports a float the locked layer refused and keeps the workspace open to try again", () => {
    const { store, engine, client } = setup();
    engine.locked = true;
    store.openVanishingPoint();
    store.setVanishingFloat(FLOAT.rgba, FLOAT.w, FLOAT.h, FLOAT.quad, RECT);
    store.applyVanishingPoint();
    expect(client.onEditError).toHaveBeenCalledWith(expect.stringContaining("active layer is locked"));
    expect(store.state.vanishingPointSession).toBe(true);
    expect(store.state.vanishingPointFloat).toEqual(RECT);
    expect(engine.history_transaction_active()).toBe(true);

    engine.locked = false; // "Select an unlocked pixel layer and try again"
    store.applyVanishingPoint();
    expect(engine.stamped).not.toBeNull();
    expect(engine.undo).toEqual(["Vanishing Point"]);
    expect(store.state.vanishingPointSession).toBe(false);
  });

  it("closes an open workspace when its document stops being the active one", () => {
    for (const leave of [
      (store: Store) => store.activateDoc(2),
      (store: Store) => store.closeDoc(1),
      (store: Store, engine: unknown) => store.revertActiveDoc(engine as never),
    ]) {
      const { store, engine } = setup();
      store.openVanishingPoint();
      store.tearOffVanishingPlane(0, 1);
      leave(store, engine);
      expect(engine.calls).toContain("cancel");
      expect(engine.history_transaction_active()).toBe(false);
      expect(store.state.vanishingPointSession).toBe(false);
    }
  });

  it("gives Paste into Perspective the same pasteboard preparation as Edit ▸ Paste", async () => {
    const { store, engine } = setup();
    const ready = vi.spyOn(store, "readyClipboardForPaste");
    expect(await store.readyClipboardForPaste()).toBe(engine);
    await store.paste();
    expect(ready).toHaveBeenCalledTimes(2);
  });
});
