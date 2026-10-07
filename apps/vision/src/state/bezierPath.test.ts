import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { anchorsFromPoints, flattenAnchorPath, hasAnchorForm, hasAnchorPath, ANCHOR_STRIDE } from "./paths";
import { catmullRomAnchors } from "./pathSmooth";
import { Store, shapeSceneFromPath } from "./store";

const KAPPA = 0.5522847;
// A radius-10 circle around (20,20) as 4 smooth anchors (relative handles).
const k = 10 * KAPPA;
const CIRCLE = [
  30, 20, 0, -k, 0, k, // right (handles vertical)
  20, 30, k, 0, -k, 0, // bottom
  10, 20, 0, k, 0, -k, // left
  20, 10, -k, 0, k, 0, // top
];

describe("flattenAnchorPath", () => {
  it("flattens a pure corner path to exactly its points", () => {
    const pts = [2, 2, 10, 2, 10, 10, 2, 10];
    expect(flattenAnchorPath(anchorsFromPoints(pts))).toEqual(pts);
  });

  it("flattens curves densely onto the true bezier (a circle stays round)", () => {
    const flat = flattenAnchorPath(CIRCLE);
    expect(flat.length / 2).toBeGreaterThan(16); // not the 4-gon of its anchors
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const r = Math.hypot(flat[i] - 20, flat[i + 1] - 20);
      expect(Math.abs(r - 10)).toBeLessThan(0.05); // vertices lie on the curve
    }
  });

  it("gates on the 3-anchor minimum", () => {
    expect(hasAnchorPath(CIRCLE)).toBe(true);
    expect(hasAnchorPath(CIRCLE.slice(0, 2 * ANCHOR_STRIDE))).toBe(false);
  });

  it("recognizes a complete two-anchor bezier representation", () => {
    expect(hasAnchorForm(CIRCLE.slice(0, 2 * ANCHOR_STRIDE))).toBe(true);
    expect(hasAnchorForm(CIRCLE.slice(0, ANCHOR_STRIDE))).toBe(false);
  });
});

describe("catmullRomAnchors", () => {
  it("keeps every input point as an anchor with ±tangent/6 handles", () => {
    const pts = [0, 0, 10, 0, 10, 10, 0, 10];
    const a = catmullRomAnchors(pts, true);
    expect(a.length).toBe(4 * ANCHOR_STRIDE);
    for (let i = 0; i < 4; i++) {
      expect(a[i * ANCHOR_STRIDE]).toBe(pts[i * 2]);
      expect(a[i * ANCHOR_STRIDE + 1]).toBe(pts[i * 2 + 1]);
      // Relative handles: out = (next − prev)/6, in = −out (smooth point).
      const px = pts[(((i - 1) % 4) + 4) % 4 * 2], py = pts[(((i - 1) % 4) + 4) % 4 * 2 + 1];
      const nx = pts[((i + 1) % 4) * 2], ny = pts[((i + 1) % 4) * 2 + 1];
      expect(a[i * ANCHOR_STRIDE + 4]).toBeCloseTo((nx - px) / 6);
      expect(a[i * ANCHOR_STRIDE + 5]).toBeCloseTo((ny - py) / 6);
      expect(a[i * ANCHOR_STRIDE + 2]).toBeCloseTo(-(nx - px) / 6);
      expect(a[i * ANCHOR_STRIDE + 3]).toBeCloseTo(-(ny - py) / 6);
    }
  });

  it("clamps neighbours at the ends of an open path", () => {
    const a = catmullRomAnchors([0, 0, 10, 0, 20, 0], false);
    // First anchor: prev clamps to itself → tangent (P1 − P0)/6.
    expect(a[4]).toBeCloseTo(10 / 6);
    expect(a[5]).toBeCloseTo(0);
  });
});

describe("bezier work path in the store", () => {
  function storeWith(combineOk = true) {
    const maskCalls: unknown[][] = [];
    const combineCalls: unknown[][] = [];
    const eng = {
      set_layer_vector_mask_bezier: (...args: unknown[]) => maskCalls.push(args),
      set_layer_vector_mask_bezier_loops: (...args: unknown[]) => maskCalls.push(["loops", ...args]),
      set_layer_vector_mask: (...args: unknown[]) => maskCalls.push(args),
      combine_layer_vector_mask_bezier: (...args: unknown[]) => { combineCalls.push(args); return combineOk; },
      combine_layer_vector_mask: (...args: unknown[]) => { combineCalls.push(args); return combineOk; },
    };
    const client = { engine: eng, e: eng, commit: vi.fn(() => true), onCommit: null };
    return { store: new Store(client as never), maskCalls, combineCalls };
  }

  it("setPenAnchors keeps penPath as the smooth flattening; setPenPath clears the curve form", () => {
    const { store } = storeWith();
    store.setPenAnchors(CIRCLE);
    expect(store.state.penAnchors).toEqual(CIRCLE);
    expect(store.state.penPath.length / 2).toBeGreaterThan(16);
    store.setPenPath([0, 0, 5, 0, 5, 5]);
    expect(store.state.penAnchors).toEqual([]);
  });

  it("saved paths round-trip the bezier form", () => {
    const { store } = storeWith();
    store.setPenAnchors(CIRCLE);
    store.saveWorkPath();
    store.deleteWorkPath();
    expect(store.state.penAnchors).toEqual([]);
    store.loadSavedPath(0);
    expect(store.state.penAnchors).toEqual(CIRCLE);
    expect(store.state.penPath.length / 2).toBeGreaterThan(16);
  });

  it("preserves a two-anchor curve when saving a path", () => {
    const { store } = storeWith();
    const curve = CIRCLE.slice(0, 2 * ANCHOR_STRIDE);
    store.setPenAnchors(curve);
    store.saveWorkPath();
    expect(store.state.savedPaths[0].anchors).toEqual(curve);
  });

  it("addVectorMaskFromPath hands true curves to the engine and clears the work path", () => {
    const { store, maskCalls } = storeWith();
    store.setPenAnchors(CIRCLE);
    store.addVectorMaskFromPath();
    expect(maskCalls).toHaveLength(1);
    expect(maskCalls[0][0]).toBe(store.state.activeLayerId);
    expect(Array.from(maskCalls[0][1] as Float32Array)).toEqual(CIRCLE.map((v) => Math.fround(v)));
    expect(store.state.penPath).toEqual([]);
    expect(store.state.penAnchors).toEqual([]);
  });

  it("addVectorMaskFromPath(op) routes bezier paths through combine_layer_vector_mask_bezier instead of the replace call", () => {
    const { store, maskCalls, combineCalls } = storeWith();
    store.setPenAnchors(CIRCLE);
    store.addVectorMaskFromPath(1); // Subtract Front
    expect(maskCalls).toHaveLength(0);
    expect(combineCalls).toHaveLength(1);
    expect(combineCalls[0][0]).toBe(store.state.activeLayerId);
    expect(Array.from(combineCalls[0][1] as Float32Array)).toEqual(CIRCLE.map((v) => Math.fround(v)));
    expect(combineCalls[0][2]).toBe(1);
    expect(store.state.penPath).toEqual([]);
    expect(store.state.penAnchors).toEqual([]);
  });

  it("addVectorMaskFromPath(op) routes corner paths through combine_layer_vector_mask", () => {
    const { store, maskCalls, combineCalls } = storeWith();
    store.setPenPath([0, 0, 10, 0, 10, 10]);
    store.addVectorMaskFromPath(2); // Intersect
    expect(maskCalls).toHaveLength(0);
    expect(combineCalls).toHaveLength(1);
    expect(combineCalls[0][0]).toBe(store.state.activeLayerId);
    expect(Array.from(combineCalls[0][1] as Float32Array)).toEqual([0, 10, 10]);
    expect(Array.from(combineCalls[0][2] as Float32Array)).toEqual([0, 0, 10]);
    expect(combineCalls[0][3]).toBe(2);
    expect(store.state.penPath).toEqual([]);
  });

  it("addVectorMaskFromPath leaves the work path untouched when the engine rejects the op", () => {
    const { store, combineCalls } = storeWith(false);
    store.setPenPath([0, 0, 10, 0, 10, 10]);
    store.addVectorMaskFromPath(0);
    expect(combineCalls).toHaveLength(1);
    expect(store.state.penPath).toEqual([0, 0, 10, 0, 10, 10]);
  });

  it("addVectorMaskFromPath keeps a multi-loop work path's loops apart (#452)", () => {
    const { store, maskCalls, combineCalls } = storeWith();
    const two = [...CIRCLE, ...CIRCLE.map((v, i) => (i % ANCHOR_STRIDE < 2 ? v + 40 : v))];
    store.setPenAnchors(two, [4, 4]);
    store.addVectorMaskFromPath();
    expect(maskCalls).toHaveLength(1);
    expect(maskCalls[0][0]).toBe("loops");
    expect(maskCalls[0][1]).toBe(store.state.activeLayerId);
    expect(Array.from(maskCalls[0][2] as Float32Array)).toEqual(two.map((v) => Math.fround(v)));
    expect(Array.from(maskCalls[0][3] as Uint32Array)).toEqual([4, 4]);
    expect(store.state.penContours).toEqual([]);
    // A path operation resolves the loops through the even-odd polygon boolean.
    store.setPenAnchors(two, [4, 4]);
    const polygon = store.state.penPath;
    store.addVectorMaskFromPath(1);
    expect(combineCalls).toHaveLength(1);
    expect(combineCalls[0], "polygon form: id, xs, ys, op").toHaveLength(4);
    expect(combineCalls[0][1]).toHaveLength(polygon.length / 2);
    expect(combineCalls[0][3]).toBe(1);
  });

  it("addVectorMaskFromPath ignores an out-of-range op and falls back to replace", () => {
    const { store, maskCalls, combineCalls } = storeWith();
    store.setPenAnchors(CIRCLE);
    store.addVectorMaskFromPath(4);
    expect(combineCalls).toHaveLength(0);
    expect(maskCalls).toHaveLength(1);
  });

  it("shapeSceneFromPath emits bezier scene anchors when given the curve form", () => {
    const scene = JSON.parse(shapeSceneFromPath(flattenAnchorPath(CIRCLE), [255, 0, 0, 255], "", CIRCLE)) as {
      layers: { items: { geometry: { anchors: { point: { x: number }; handleOut?: { x: number; y: number } }[]; closed: boolean } }[] }[];
    };
    const geo = scene.layers[0].items[0].geometry;
    expect(geo.closed).toBe(true);
    expect(geo.anchors).toHaveLength(4);
    expect(geo.anchors[0].handleOut).toEqual({ x: 0, y: k });
  });
});
