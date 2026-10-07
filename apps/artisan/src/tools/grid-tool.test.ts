// ─────────────────────────────────────────────────────────────
// tools/grid-tool.test — Rectangular / Polar Grid tools integration (parity)
// ─────────────────────────────────────────────────────────────
// Drives the real grid tools: dragging out a bounding box creates one compound
// path holding the grid lines, selected, in a single undoable transaction.

import { describe, it, expect } from "vitest";
import { createGridTool } from "./path-shapes";
import { ArtisanStore, makeDocument, Query, type CompoundPathItem } from "../engine";
import type { Tool, ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;
const dragOut = (tool: Tool, ctx: ToolContext, a: [number, number], b: [number, number]) => {
  tool.onPointerDown!(ptr(a[0], a[1]), ctx);
  tool.onPointerMove!(ptr(b[0], b[1]), ctx);
  tool.onPointerUp!(ptr(b[0], b[1]), ctx);
};
const newStore = () => {
  const store = new ArtisanStore();
  store.replaceDoc(makeDocument(), { markClean: true });
  return store;
};
const items = (store: ArtisanStore) => store.getState().doc.layers[0].items;

describe("grid tools — integration", () => {
  it("rect-grid: dragging makes a compound of 9 grid lines spanning the drag, selected", () => {
    const store = newStore();
    const tool = createGridTool("rect-grid");
    dragOut(tool, ctxOf(store), [100, 100], [340, 300]);
    expect(items(store).length).toBe(1);
    const it = items(store)[0] as CompoundPathItem;
    expect(it.type).toBe("compound");
    expect(it.subpaths.length).toBe(9); // border + 4 + 4
    expect(store.getState().selection).toEqual([it.id]);
    const b = Query.worldBounds(store.getState().doc, it.id)!;
    expect([Math.round(b.width), Math.round(b.height)]).toEqual([240, 200]);
  });

  it("polar-grid: dragging makes a compound of 12 rings+spokes", () => {
    const store = newStore();
    const tool = createGridTool("polar-grid");
    dragOut(tool, ctxOf(store), [200, 200], [300, 200]); // radius 100
    const it = items(store)[0] as CompoundPathItem;
    expect(it.type).toBe("compound");
    expect(it.subpaths.length).toBe(12); // 4 rings + 8 spokes
  });

  it("the grid is one undoable transaction", () => {
    const store = newStore();
    dragOut(createGridTool("rect-grid"), ctxOf(store), [100, 100], [340, 300]);
    expect(items(store).length).toBe(1);
    store.undo();
    expect(items(store).length).toBe(0);
  });
});
