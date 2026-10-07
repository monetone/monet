// Shape tool Mode (Photoshop's Shape/Path/Pixels dropdown) — the Shape-mode
// scene-item builders and the Store commit routing they share with the Pen.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store, lineShapeItems, shapeBBoxItem, shapeOutlineVerts, type ShapeToolOptions } from "./store";

const RED = { h: 0, s: 1, v: 1, a: 1 }; // → rgba(255,0,0,255)
const WHITE = { h: 0, s: 0, v: 1, a: 1 }; // → rgba(255,255,255,255)

const base: ShapeToolOptions = {
  shapeKind: "rect",
  roundRectRadius: 12,
  polygonSides: 5,
  polygonStar: true,
  polygonIndent: 0.5,
  customShapes: [],
  activeCustomShape: 0,
  shapeStrokeWidth: 0,
  shapeStrokeAlign: 1,
  lineWeight: 3,
  lineArrowStart: false,
  lineArrowEnd: false,
  lineArrowWidth: 15,
  lineArrowLength: 30,
  lineArrowConcavity: 0,
  fg: RED,
  bg: WHITE,
};

const SOLID_RED = { type: "solid", color: { r: 255, g: 0, b: 0, a: 1 } };

type AnyItem = ReturnType<typeof shapeBBoxItem> & {
  transform?: Record<string, number>;
  width?: number; height?: number; rx?: number; ry?: number;
  fill?: unknown;
  stroke?: { width: number; align?: string; paint: unknown };
  geometry?: { closed: boolean; anchors: { point: { x: number; y: number } }[] };
  x1?: number; y1?: number; x2?: number; y2?: number;
};

describe("shapeBBoxItem", () => {
  it("rect → a native live rect item positioned by its transform, no stroke by default", () => {
    const item = shapeBBoxItem(base, 10, 20, 100, 50) as AnyItem;
    expect(item.type).toBe("rect");
    expect(item.transform).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 });
    expect(item.width).toBe(100);
    expect(item.height).toBe(50);
    expect(item.fill).toEqual(SOLID_RED);
    expect(item.stroke).toBeUndefined();
  });

  it("maps the Stroke option onto a live vector stroke in the bg colour", () => {
    const item = shapeBBoxItem({ ...base, shapeStrokeWidth: 6, shapeStrokeAlign: 2 }, 0, 0, 40, 40) as AnyItem;
    expect(item.stroke).toEqual({
      paint: { type: "solid", color: { r: 255, g: 255, b: 255, a: 1 } },
      width: 6,
      align: "outside",
    });
  });

  it("roundrect → a rect item carrying the corner radius (re-editable later)", () => {
    const item = shapeBBoxItem({ ...base, shapeKind: "roundrect" }, 0, 0, 100, 100) as AnyItem;
    expect(item.type).toBe("rect");
    expect(item.rx).toBe(12);
    expect(item.ry).toBe(12);
  });

  it("ellipse → a native ellipse item (true bezier arcs, not a sampled polygon)", () => {
    const item = shapeBBoxItem({ ...base, shapeKind: "ellipse" }, 5, 5, 60, 30) as AnyItem;
    expect(item.type).toBe("ellipse");
    expect(item.width).toBe(60);
    expect(item.height).toBe(30);
  });

  it("polygon/star → a closed path item with the exact raster-parity vertices", () => {
    const item = shapeBBoxItem({ ...base, shapeKind: "polygon" }, 0, 0, 100, 100) as AnyItem;
    expect(item.type).toBe("path");
    expect(item.geometry!.closed).toBe(true);
    expect(item.geometry!.anchors).toHaveLength(10); // 5-point star = outer+inner
    expect(item.fill).toEqual(SOLID_RED);
  });

  it("custom shape → a path item denormalized into the dragged bbox", () => {
    const s = { ...base, shapeKind: "custom" as const, customShapes: [{ name: "Tri", path: [0, 0, 1, 0, 0.5, 1] }] };
    const item = shapeBBoxItem(s, 10, 20, 100, 100) as AnyItem;
    expect(item.geometry!.anchors.map((a) => a.point)).toEqual([
      { x: 10, y: 20 }, { x: 110, y: 20 }, { x: 60, y: 120 },
    ]);
  });
});

describe("shapeOutlineVerts (Path mode work path)", () => {
  it("rect → the four corners", () => {
    expect(shapeOutlineVerts(base, 1, 2, 10, 20)).toEqual([1, 2, 11, 2, 11, 22, 1, 22]);
  });

  it("ellipse → a sampled outline that stays on the ellipse", () => {
    const v = shapeOutlineVerts({ ...base, shapeKind: "ellipse" }, 0, 0, 100, 50);
    expect(v.length).toBe(128); // 64 points
    for (let i = 0; i + 1 < v.length; i += 2) {
      const dx = (v[i] - 50) / 50, dy = (v[i + 1] - 25) / 25;
      expect(dx * dx + dy * dy).toBeCloseTo(1, 5);
    }
  });
});

describe("lineShapeItems", () => {
  it("builds a live line item stroked lineWeight thick in the fg colour", () => {
    const items = lineShapeItems(base, 10, 10, 90, 10) as AnyItem[];
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("line");
    expect([items[0].x1, items[0].y1, items[0].x2, items[0].y2]).toEqual([10, 10, 90, 10]);
    expect(items[0].stroke).toEqual({ paint: SOLID_RED, width: 3 });
  });

  it("adds filled arrowhead path items when arrows are on", () => {
    const items = lineShapeItems({ ...base, lineArrowStart: true, lineArrowEnd: true }, 10, 10, 90, 10) as AnyItem[];
    expect(items.map((i) => i.type)).toEqual(["line", "path", "path"]);
    expect(items[1].geometry!.anchors).toHaveLength(4);
    expect(items[1].fill).toEqual(SOLID_RED);
  });

  it("a zero-length drag yields the bare line item (no degenerate arrowheads)", () => {
    const items = lineShapeItems({ ...base, lineArrowEnd: true }, 10, 10, 10, 10);
    expect(items).toHaveLength(1);
  });
});

// The engine's kind-3 discriminator (LAYER_KIND.vector).
const VECTOR = 3;

type Scene = { layers: { items: { type: string; id: string }[] }[] };

function fakeEngine(kind: number, sceneJson = "") {
  return {
    layer_kind: vi.fn(() => kind),
    layer_count: vi.fn(() => 2),
    vector_scene_json: vi.fn(() => sceneJson),
    vector_set_scene: vi.fn(),
    add_vector_layer: vi.fn(() => 9),
  };
}

function storeWith(eng: ReturnType<typeof fakeEngine>) {
  const client = { engine: eng, onCommit: null as null | (() => void), commit: vi.fn(() => true) };
  return new Store(client as never);
}

describe("Store.addShapeLayerItems", () => {
  it("adds a NEW kind-3 vector layer when the active layer is not one", () => {
    const eng = fakeEngine(0);
    const ok = storeWith(eng).addShapeLayerItems([shapeBBoxItem(base, 0, 0, 10, 10)]);
    expect(ok).toBe(true);
    expect(eng.vector_set_scene).not.toHaveBeenCalled();
    expect(eng.add_vector_layer).toHaveBeenCalledTimes(1);
    const [json, name] = eng.add_vector_layer.mock.calls[0] as unknown as [string, string];
    expect(name).toBe("Shape 2");
    const scene = JSON.parse(json) as Scene;
    expect(scene.layers[0].items.map((i) => [i.type, i.id])).toEqual([["rect", "mv-shape-1"]]);
  });

  it("appends into the ACTIVE vector layer's scene without reusing item ids", () => {
    const taken = JSON.stringify({ layers: [{ items: [{ type: "path", id: "mv-shape-1" }] }] });
    const eng = fakeEngine(VECTOR, taken);
    expect(storeWith(eng).addShapeLayerItems(lineShapeItems(base, 0, 0, 5, 5))).toBe(true);
    expect(eng.add_vector_layer).not.toHaveBeenCalled();
    const [, json] = eng.vector_set_scene.mock.calls[0] as unknown as [number, string];
    expect((JSON.parse(json) as Scene).layers[0].items.map((i) => i.id)).toEqual(["mv-shape-1", "mv-shape-2"]);
  });

  it("ignores an empty item list and reports a refused (read-only) commit", () => {
    const eng = fakeEngine(0);
    expect(storeWith(eng).addShapeLayerItems([])).toBe(false);
    expect(eng.add_vector_layer).not.toHaveBeenCalled();

    const refused = fakeEngine(0);
    const client = { engine: refused, onCommit: null, commit: vi.fn(() => false) };
    expect(new Store(client as never).addShapeLayerItems([shapeBBoxItem(base, 0, 0, 10, 10)])).toBe(false);
  });
});
