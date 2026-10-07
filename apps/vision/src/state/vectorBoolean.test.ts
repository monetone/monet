import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store, sceneComponentIds } from "./store";

// The engine's kind-3 discriminator (LAYER_KIND.vector); 0 is a pixel layer.
const VECTOR = 3;
const PIXEL = 0;

const twoComponents = JSON.stringify({
  layers: [{ items: [
    { type: "path", id: "mv-path-1" },
    { type: "group", id: "g1", children: [{ type: "path", id: "mv-path-2" }] },
  ] }],
});

describe("sceneComponentIds", () => {
  it("returns TOP-LEVEL ids only — a group is one component, not its children", () => {
    expect(sceneComponentIds(twoComponents)).toEqual(["mv-path-1", "g1"]);
  });

  it("survives an empty or unparsable scene", () => {
    expect(sceneComponentIds("")).toEqual([]);
    expect(sceneComponentIds("{not json")).toEqual([]);
    expect(sceneComponentIds(JSON.stringify({}))).toEqual([]);
  });
});

function fakeEngine(kind: number, sceneJson = twoComponents) {
  return {
    layer_kind: vi.fn<(...args: unknown[]) => number>(() => kind),
    vector_scene_json: vi.fn<(...args: unknown[]) => string>(() => sceneJson),
    vector_boolean: vi.fn<(...args: unknown[]) => void>(),
    combine_shapes: vi.fn<(...args: unknown[]) => void>(),
  };
}

function storeWith(eng: ReturnType<typeof fakeEngine>) {
  const client = { engine: eng, onCommit: null as null | (() => void), commit: vi.fn(() => true) };
  return new Store(client as never);
}

describe("Store.combineShapes", () => {
  it("runs a REAL path boolean on a shape layer, not the raster alpha combine", () => {
    const eng = fakeEngine(VECTOR);
    storeWith(eng).combineShapes(1); // Subtract Front Shape
    expect(eng.combine_shapes).not.toHaveBeenCalled();
    const [, idsJson, op] = eng.vector_boolean.mock.calls[0] as [number, string, string];
    expect(JSON.parse(idsJson)).toEqual(["mv-path-1", "g1"]);
    expect(op).toBe("minus-front");
  });

  it("maps every Combine Shapes menu mode to its pathfinder op", () => {
    const ops = [0, 1, 2, 3, 99].map((mode) => {
      const eng = fakeEngine(VECTOR);
      storeWith(eng).combineShapes(mode);
      return (eng.vector_boolean.mock.calls[0] as [number, string, string])[2];
    });
    // 99 is not a menu mode; unite is the safe default (never a destructive op).
    expect(ops).toEqual(["unite", "minus-front", "intersect", "exclude", "unite"]);
  });

  it("falls back to the raster combine only when the layer is not vector", () => {
    const eng = fakeEngine(PIXEL);
    storeWith(eng).combineShapes(2);
    expect(eng.vector_boolean).not.toHaveBeenCalled();
    expect(eng.combine_shapes).toHaveBeenCalledWith(2);
  });

  it("does nothing on a shape layer with a single component", () => {
    const eng = fakeEngine(VECTOR, JSON.stringify({ layers: [{ items: [{ type: "path", id: "mv-path-1" }] }] }));
    storeWith(eng).combineShapes(0);
    expect(eng.vector_boolean).not.toHaveBeenCalled();
    expect(eng.combine_shapes).not.toHaveBeenCalled();
  });
});

describe("Store.mergeShapeComponents", () => {
  it("unites the components of a shape layer", () => {
    const eng = fakeEngine(VECTOR);
    storeWith(eng).mergeShapeComponents();
    expect((eng.vector_boolean.mock.calls[0] as [number, string, string])[2]).toBe("unite");
  });

  it("never touches a pixel layer — the raster fallback would eat the layer below", () => {
    const eng = fakeEngine(PIXEL);
    storeWith(eng).mergeShapeComponents();
    expect(eng.combine_shapes).not.toHaveBeenCalled();
    expect(eng.vector_boolean).not.toHaveBeenCalled();
  });
});

describe("Layer ▸ Combine Shapes menu wiring", () => {
  const appSource = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");

  it("routes the path operations through the store, Merge Shape Components on its own", () => {
    expect(appSource).toContain("uniteshapes: () => store.combineShapes(0)");
    expect(appSource).toContain("subtractfrontshape: () => store.combineShapes(1)");
    expect(appSource).toContain("uniteshapesoverlap: () => store.combineShapes(2)");
    expect(appSource).toContain("subtractshapesoverlap: () => store.combineShapes(3)");
    expect(appSource).toContain("mergeshapecomponents: () => store.mergeShapeComponents()");
  });
});
