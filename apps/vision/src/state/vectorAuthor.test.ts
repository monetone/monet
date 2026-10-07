import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store, shapeSceneFromPath } from "./store";

const TRIANGLE = [10, 10, 40, 10, 25, 35];
const FG: [number, number, number, number] = [255, 0, 0, 255];

// The engine's kind-3 discriminator (LAYER_KIND.vector).
const VECTOR = 3;

type Scene = { layers: { items: { type: string; id: string; geometry: { anchors: { point: { x: number; y: number } }[]; closed: boolean } }[] }[] };

describe("shapeSceneFromPath", () => {
  it("builds a one-layer Artisan scene with a closed, filled path item", () => {
    const scene = JSON.parse(shapeSceneFromPath(TRIANGLE, FG)) as Scene;
    expect(scene.layers).toHaveLength(1);
    expect(scene.layers[0].items).toHaveLength(1);
    const item = scene.layers[0].items[0];
    expect(item.type).toBe("path");
    expect(item.geometry.closed).toBe(true);
    expect(item.geometry.anchors.map((a) => a.point)).toEqual([
      { x: 10, y: 10 }, { x: 40, y: 10 }, { x: 25, y: 35 },
    ]);
    // The vector model wants 0..255 channels but 0..1 alpha.
    expect((item as unknown as { fill: unknown }).fill).toEqual({ type: "solid", color: { r: 255, g: 0, b: 0, a: 1 } });
  });

  it("EXTENDS an imported scene instead of replacing it, keeping foreign fields", () => {
    const imported = JSON.stringify({
      name: "Poster",
      swatches: [{ id: "s1" }],
      layers: [{ id: "L1", items: [{ type: "rect", id: "r1" }] }],
    });
    const scene = JSON.parse(shapeSceneFromPath(TRIANGLE, FG, imported)) as Scene & { name: string; swatches: unknown[] };
    expect(scene.name).toBe("Poster");
    expect(scene.swatches).toEqual([{ id: "s1" }]);
    expect(scene.layers).toHaveLength(1);
    expect(scene.layers[0].items.map((i) => i.id)).toEqual(["r1", "mv-path-1"]);
  });

  it("never reuses an item id already in the scene, including inside groups", () => {
    const taken = JSON.stringify({
      layers: [{ items: [
        { type: "path", id: "mv-path-1" },
        { type: "group", id: "g1", children: [{ type: "path", id: "mv-path-2" }] },
      ] }],
    });
    const scene = JSON.parse(shapeSceneFromPath(TRIANGLE, FG, taken)) as Scene;
    expect(scene.layers[0].items.at(-1)!.id).toBe("mv-path-3");
  });
});

function fakeEngine(kind: number, sceneJson = "", hit = "") {
  return {
    layer_kind: vi.fn(() => kind),
    layer_count: vi.fn(() => 2),
    vector_scene_json: vi.fn(() => sceneJson),
    vector_set_scene: vi.fn(),
    add_vector_layer: vi.fn(() => 9),
    vector_hit_test: vi.fn(() => hit),
    vector_begin_edit: vi.fn(),
  };
}

function storeWith(eng: ReturnType<typeof fakeEngine>) {
  const client = {
    engine: eng, onCommit: null as null | (() => void),
    commit: vi.fn(() => true), consumeEditError: () => false,
  };
  return new Store(client as never);
}

describe("Store.addShapeLayerFromPath", () => {
  it("adds a NEW kind-3 vector layer when the active layer is not one", () => {
    const eng = fakeEngine(0);
    expect(storeWith(eng).addShapeLayerFromPath(TRIANGLE)).toBe(true);
    expect(eng.vector_set_scene).not.toHaveBeenCalled();
    expect(eng.add_vector_layer).toHaveBeenCalledTimes(1);
    const [json, name] = eng.add_vector_layer.mock.calls[0] as unknown as [string, string];
    expect(name).toBe("Shape 2");
    expect((JSON.parse(json) as Scene).layers[0].items[0].type).toBe("path");
  });

  it("appends into the ACTIVE vector layer's scene, so an Artisan import grows", () => {
    const eng = fakeEngine(VECTOR, JSON.stringify({ layers: [{ items: [{ type: "rect", id: "r1" }] }] }));
    expect(storeWith(eng).addShapeLayerFromPath(TRIANGLE)).toBe(true);
    expect(eng.add_vector_layer).not.toHaveBeenCalled();
    const [, json] = eng.vector_set_scene.mock.calls[0] as unknown as [number, string];
    expect((JSON.parse(json) as Scene).layers[0].items.map((i) => i.id)).toEqual(["r1", "mv-path-1"]);
  });

  it("ignores a degenerate path and reports a refused (read-only) commit", () => {
    const eng = fakeEngine(0);
    const store = storeWith(eng);
    expect(store.addShapeLayerFromPath([10, 10])).toBe(false); // < 3 points is not a shape
    expect(eng.add_vector_layer).not.toHaveBeenCalled();

    const refused = fakeEngine(0);
    const client = { engine: refused, onCommit: null, commit: vi.fn(() => false) };
    expect(new Store(client as never).addShapeLayerFromPath(TRIANGLE)).toBe(false);
  });
});

// #450 — a drawn shape stays re-editable: the Properties panel reads its live
// properties off the scene and patches them straight back through the engine.
const RED = { type: "solid", color: { r: 255, g: 0, b: 0, a: 1 } };
const TWO_RECTS = JSON.stringify({
  layers: [{ items: [
    { type: "rect", id: "r1", transform: { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 }, width: 100, height: 50, rx: 0, ry: 0, fill: RED },
    { type: "rect", id: "r2", transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, width: 8, height: 8 },
  ] }],
});
const written = (eng: ReturnType<typeof fakeEngine>) =>
  JSON.parse((eng.vector_set_scene.mock.calls[0] as unknown as [number, string])[1]) as
    { layers: { items: Record<string, unknown>[] }[] };

describe("Store shape properties", () => {
  it("reads the active vector layer's component, and nothing off a raster layer", () => {
    expect(storeWith(fakeEngine(0, TWO_RECTS)).shapeProps()).toBeNull();
    expect(storeWith(fakeEngine(VECTOR, TWO_RECTS)).shapeProps())
      .toMatchObject({ id: "r1", kind: "rect", x: 10, y: 20, w: 100, h: 50, fill: [255, 0, 0, 255] });
  });

  it("writes an edit back as ONE vector_set_scene + commit, leaving the rest alone", () => {
    const eng = fakeEngine(VECTOR, TWO_RECTS);
    expect(storeWith(eng).setShapeProps({ radii: [4, 0, 8, 2] })).toBe(true);
    expect(eng.vector_set_scene).toHaveBeenCalledTimes(1); // one engine undo step
    expect(eng.add_vector_layer).not.toHaveBeenCalled();
    const items = written(eng).layers[0].items;
    expect(items[0].radii).toEqual([4, 0, 8, 2]);
    expect(items[1]).toEqual(JSON.parse(TWO_RECTS).layers[0].items[1]);
  });

  it("spends no undo step when the edit changes nothing", () => {
    const eng = fakeEngine(VECTOR, TWO_RECTS);
    expect(storeWith(eng).setShapeProps({ w: 100, h: 50 })).toBe(false);
    expect(eng.vector_set_scene).not.toHaveBeenCalled();
    // Nor on a component that carries no transform at all: writing X/Y back
    // as-is must not materialise an identity matrix and call THAT an edit.
    const bare = JSON.stringify({ layers: [{ items: [{ type: "rect", id: "b", width: 100, height: 50 }] }] });
    const bareEng = fakeEngine(VECTOR, bare);
    expect(storeWith(bareEng).setShapeProps({ x: 0, y: 0, w: 100, h: 50 })).toBe(false);
    expect(bareEng.vector_set_scene).not.toHaveBeenCalled();
  });

  it("edits the component Path Selection picked — the pick survives the release", () => {
    const eng = fakeEngine(VECTOR, TWO_RECTS, "r2");
    const store = storeWith(eng);
    expect(store.pathSelectAt(2, 2)).toBe(true);
    store.endPathDrag();
    expect(store.state.selectedPaths).toEqual(["r2"]);
    expect(store.shapeProps()!.id).toBe("r2");
    store.setShapeProps({ fill: [0, 0, 255, 255] });
    const items = written(eng).layers[0].items;
    expect(items[1].fill).toEqual({ type: "solid", color: { r: 0, g: 0, b: 255, a: 1 } });
    expect(items[0].fill, "the unpicked component keeps its own fill").toEqual(RED);
  });

  it("keeps Properties on the first component of a multi-selection", () => {
    const eng = fakeEngine(VECTOR, TWO_RECTS);
    const store = storeWith(eng);
    store.setOptions({ selectedPaths: ["r2", "r1"] });
    expect(store.shapeProps()!.id).toBe("r2");
    store.setShapeProps({ fill: [0, 0, 255, 255] });
    const items = written(eng).layers[0].items;
    expect(items[1].fill).toEqual({ type: "solid", color: { r: 0, g: 0, b: 255, a: 1 } });
    expect(items[0].fill).toEqual(RED);
  });
});
