// The on-canvas text editor lays out a horizontal block, so vertical type is
// edited through the Type toolbar. editText already refuses to open the caret
// for it; createAt did not, leaving an editor that never rendered (#500).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const backing = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
      clear: () => backing.clear(),
    },
  });
});

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

vi.mock("../text/raster", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../text/raster")>()),
  rasterizeSpec: () => ({ w: 1, h: 1, placeX: 0, placeY: 0, data: new Uint8ClampedArray(4) }),
}));

import { engine, store, text } from "./app";

const specs = new Map<number, string>();
let deleted: number[] = [];

function install() {
  specs.clear();
  deleted = [];
  engine.engine = {
    layer_text_spec: (id: number) => specs.get(id) ?? "",
    set_text_layer_spec: (id: number, _x: number, _y: number, _w: number, _h: number, _b: Uint8Array, json: string) =>
      void specs.set(id, json),
    text_edit_session: () => {},
    set_layer_name_untracked: () => {},
    set_active_layer: () => {},
    active_layer_id: () => store.state.activeLayerId,
    delete_layer: (id: number) => void deleted.push(id),
  } as unknown as typeof engine.engine;
  vi.spyOn(engine, "commit").mockReturnValue(true);
  vi.spyOn(engine, "sync").mockImplementation(() => {});
  vi.spyOn(store, "addLayer").mockImplementation(() => {
    const id = Math.max(0, ...store.state.layers.map((l) => l.id)) + 1;
    store.state.layers = [...store.state.layers, { id, name: `Type ${id}` }] as typeof store.state.layers;
    store.state.activeLayerId = id;
  });
  store.state.layers = [] as typeof store.state.layers;
  store.state.activeLayerId = 0;
  store.state.textEdit = null;
}

beforeEach(() => {
  vi.restoreAllMocks();
  install();
});

describe("the Vertical Type tools", () => {
  it("leaves the in-place caret closed", () => {
    text.createAt(10, 20, { vertical: true });
    expect(store.state.textEdit).toBeNull();
  });

  it("still opens it for horizontal type", () => {
    const id = text.createAt(10, 20);
    expect(store.state.textEdit).toEqual({ id, fresh: true });
  });

  it("still turns a vertical Type Mask into a selection when the edit commits", () => {
    const id = text.createAt(10, 20, { vertical: true });
    store.markTypeMask(id);
    store.endTextEdit(); // what setTool() does on the way out of the tool
    expect(deleted).toEqual([id]); // the temp type layer is consumed
  });
});
