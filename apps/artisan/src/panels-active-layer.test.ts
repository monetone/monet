// ─────────────────────────────────────────────────────────────
// panels-active-layer.test — the active/target layer (Layers panel)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator — clicking a layer in the Layers panel makes it
// the TARGET layer; newly drawn art is placed on the active layer. Here a shape
// drawn with the tool lands on `activeLayerId`.

import { describe, it, expect } from "vitest";
import { createShapeTool } from "./tools/shapes";
import { ArtisanStore, makeDocument, makeLayer } from "./engine";
import type { ToolContext, ToolPointer } from "./tools/types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;

const twoLayers = () => {
  const store = new ArtisanStore();
  const doc = makeDocument(); // L1 (active by default)
  doc.layers.push(makeLayer("Layer 2"));
  store.replaceDoc(doc, { markClean: true });
  const [L1, L2] = store.getState().doc.layers.map((l) => l.id);
  return { store, L1, L2 };
};
const layerItems = (store: ArtisanStore, id: string) => store.getState().doc.layers.find((l) => l.id === id)!.items;

const drawRect = (store: ArtisanStore, start: [number, number], end: [number, number]) => {
  const tool = createShapeTool("rect");
  const ctx = ctxOf(store);
  tool.onPointerDown!(ptr(start[0], start[1]), ctx);
  tool.onPointerMove!(ptr(end[0], end[1]), ctx);
  tool.onPointerUp!(ptr(end[0], end[1]), ctx);
};

describe("Active/target layer", () => {
  it("new art is drawn onto the active layer", () => {
    const { store, L1, L2 } = twoLayers();
    store.setActiveLayer(L2);
    drawRect(store, [10, 10], [60, 60]);
    expect(layerItems(store, L1)).toHaveLength(0); // L1 untouched
    expect(layerItems(store, L2)).toHaveLength(1); // landed on the active layer
  });

  it("switching the active layer redirects placement", () => {
    const { store, L1, L2 } = twoLayers();
    store.setActiveLayer(L1);
    drawRect(store, [10, 10], [60, 60]); // → L1
    store.setActiveLayer(L2);
    drawRect(store, [200, 200], [260, 260]); // → L2
    expect(layerItems(store, L1)).toHaveLength(1);
    expect(layerItems(store, L2)).toHaveLength(1);
  });

  it("the drawn item is selected after placement", () => {
    const { store, L2 } = twoLayers();
    store.setActiveLayer(L2);
    drawRect(store, [10, 10], [40, 40]);
    const item = layerItems(store, L2)[0];
    expect(item.type).toBe("rect");
    expect(store.getState().selection).toEqual([item.id]); // active after drawing
  });
});
