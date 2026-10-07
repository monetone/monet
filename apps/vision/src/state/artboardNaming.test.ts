// Artboard names are not cosmetic: Export Artboards To Files writes one file per
// name (`${name}.png`), so two artboards sharing a name overwrite each other on
// disk. `nextArtboardName()` exists to prevent exactly that — and only the
// Artboard tool was calling it. Layer ▸ New ▸ Artboard and Artboard from Layers
// both hardcoded "Artboard 1". The sibling Frame constructors had the same
// defect with "Frame 1".
//
// Driven for real: a fake engine keeps the artboard/layer lists the store's
// name helpers read back, so each creation path is called and the NAME it
// handed the engine is asserted — and the export path is run to show what a
// collision costs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store, type AppSnapshot, type ArtboardInfo, type LayerInfo } from "./store";
import { engine, exportArtboardsToFiles } from "./app";

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

const patch = (store: Store, p: Partial<AppSnapshot>) =>
  (store as unknown as { set(patch: Partial<AppSnapshot>): void }).set(p);

const layer = (id: number, name: string): LayerInfo => ({
  id, name, visible: true, locked: false, opacity: 100, fillOpacity: 100,
  blendMode: "normal", thumb: "", hasMask: false, hasFx: false, kind: 6, group: 0,
});
const board = (id: number, name: string): ArtboardInfo => ({ id, name, x: 0, y: 0, w: 100, h: 100 });

/** The document model the naming helpers read back: `snap.artboards` for
 *  artboards, `snap.layers` for frames. Every constructor records the name it
 *  was handed and appends to the model, so successive calls see their
 *  predecessors — which is the whole point of "lowest free index". */
function newStore() {
  let nextId = 10;
  const model = { boards: [] as ArtboardInfo[], layers: [] as LayerInfo[] };
  const held: { store?: Store } = {};
  const sync = () => patch(held.store!, { artboards: [...model.boards], layers: [...model.layers] });
  const addBoard = (name: string) => { const id = nextId++; model.boards.push(board(id, name)); return id; };
  const addFrame = (name: string) => { const id = nextId++; model.layers.push(layer(id, name)); return id; };
  const e = {
    new_artboard: (_x: number, _y: number, _w: number, _h: number, name: string) => addBoard(name),
    new_artboard_rect: (_x: number, _y: number, _w: number, _h: number, name: string) => addBoard(name),
    artboard_from_layers: (name: string) => addBoard(name),
    new_frame: (name: string) => addFrame(name),
    new_frame_rect: (_x: number, _y: number, _w: number, _h: number, name: string) => addFrame(name),
    new_frame_ellipse: (_x: number, _y: number, _w: number, _h: number, name: string) => addFrame(name),
    delete_artboard: (id: number) => { model.boards = model.boards.filter((b) => b.id !== id); },
    width: () => 0,
    height: () => 0,
  };
  const client = { onCommit: null, engine: e, e, sync, commit: () => sync() };
  const store = new Store(client as never);
  held.store = store;
  return { store, model };
}

const boardNames = (m: { boards: ArtboardInfo[] }) => m.boards.map((b) => b.name);
const frameNames = (m: { layers: LayerInfo[] }) => m.layers.map((l) => l.name);

beforeEach(() => { installStorage(); });

describe("every frame creation path names uniquely", () => {
  // Same defect as the artboards below, in the sibling feature: all three engine
  // constructors hardcoded "Frame 1", so drawing three frames with the Frame
  // tool left three identically-named layers in the Layers panel.
  it("newFrame numbers successive frames", () => {
    const { store, model } = newStore();
    store.newFrame();
    store.newFrame();
    store.newFrame();
    expect(frameNames(model)).toEqual(["Frame 1", "Frame 2", "Frame 3"]);
  });

  it("createFrame numbers successive frames, rectangular and elliptical alike", () => {
    const { store, model } = newStore();
    expect(store.createFrame(0, 0, 10, 10)).toBeGreaterThan(0);
    patch(store, { frameMode: "ellipse" });
    store.createFrame(0, 0, 10, 10);
    store.createFrame(0, 0, 10, 10);
    expect(frameNames(model)).toEqual(["Frame 1", "Frame 2", "Frame 3"]);
  });

  it("the two paths share one counter, so mixing them still never collides", () => {
    const { store, model } = newStore();
    store.newFrame();
    store.createFrame(0, 0, 10, 10);
    store.newFrame();
    expect(frameNames(model)).toEqual(["Frame 1", "Frame 2", "Frame 3"]);
  });

  it("derives the free index from the live layer names", () => {
    const { store, model } = newStore();
    // A document already holding Frame 1 and Frame 3 (Frame 2 deleted/renamed):
    // the next frame fills the gap rather than blindly appending.
    patch(store, { layers: [layer(1, "Frame 1"), layer(2, "Frame 3"), layer(3, "Background")] });
    store.newFrame();
    expect(frameNames(model)).toEqual(["Frame 2"]);
  });
});

describe("every artboard creation path names uniquely", () => {
  it("newArtboard numbers successive artboards", () => {
    const { store, model } = newStore();
    store.newArtboard(400, 300);
    store.newArtboard(400, 300);
    store.newArtboard(400, 300);
    expect(boardNames(model), 'a hardcoded "Artboard 1" collides on Export Artboards To Files')
      .toEqual(["Artboard 1", "Artboard 2", "Artboard 3"]);
  });

  it("createArtboardRect numbers successive artboards and selects the new one", () => {
    const { store, model } = newStore();
    const first = store.createArtboardRect(0, 0, 100, 100);
    const second = store.createArtboardRect(10, 10, 100, 100);
    expect(boardNames(model)).toEqual(["Artboard 1", "Artboard 2"]);
    expect(store.state.selectedArtboard).toBe(second);
    expect(second).not.toBe(first);
  });

  it("artboardFromLayers numbers successive artboards", () => {
    const { store, model } = newStore();
    store.artboardFromLayers();
    store.artboardFromLayers();
    expect(boardNames(model)).toEqual(["Artboard 1", "Artboard 2"]);
  });

  it("all three paths share one counter and refill deleted indices", () => {
    const { store, model } = newStore();
    store.newArtboard(400, 300);            // Artboard 1
    const second = store.createArtboardRect(0, 0, 100, 100); // Artboard 2
    store.artboardFromLayers();             // Artboard 3
    expect(boardNames(model)).toEqual(["Artboard 1", "Artboard 2", "Artboard 3"]);

    patch(store, { selectedArtboard: second });
    store.deleteSelectedArtboard();
    store.newArtboard(400, 300);
    expect(boardNames(model)).toEqual(["Artboard 1", "Artboard 3", "Artboard 2"]);
  });
});

describe("Export Artboards To Files derives the filename from the name", () => {
  // If this stops being true the guards above are still correct, but the
  // severity claim in their comment no longer holds — worth failing on.
  let onSync: typeof engine.onSync;
  let saved: string[];

  function exportEngine(names: string[]) {
    saved = [];
    const g = globalThis as Record<string, unknown>;
    g.URL = { createObjectURL: () => "blob:test", revokeObjectURL: () => {} };
    g.document = {
      body: { appendChild() {} },
      createElement: () => {
        const a = { href: "", download: "", click: () => saved.push(a.download), remove() {} };
        return a;
      },
    };
    engine.engine = {
      artboard_count: () => names.length,
      artboard_name: (i: number) => names[i],
      export_artboard_png: () => new Uint8Array([1, 2, 3]),
    } as never;
  }

  beforeEach(() => { onSync = engine.onSync; engine.onSync = null; });
  afterEach(() => { engine.onSync = onSync; engine.engine = null; vi.restoreAllMocks(); });

  it("writes one file per artboard NAME (path-sanitized)", () => {
    exportEngine(["Artboard 1", "Artboard 2", "Artboard 3"]);
    exportArtboardsToFiles();
    expect(saved).toEqual(["Artboard_1.png", "Artboard_2.png", "Artboard_3.png"]);
  });

  it("so duplicate names overwrite each other on disk — the bug the naming fixes", () => {
    exportEngine(["Artboard 1", "Artboard 1"]);
    exportArtboardsToFiles();
    expect(saved).toEqual(["Artboard_1.png", "Artboard_1.png"]);
    expect(new Set(saved).size, "two artboards, one file").toBe(1);
  });
});
