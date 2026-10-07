// ─────────────────────────────────────────────────────────────
// tools/path-shape-tool.test — Arc + Spiral tools integration (parity)
// ─────────────────────────────────────────────────────────────
// Drives the real Arc/Spiral tools: dragging creates one open bezier path,
// selected, in a single undoable transaction.

import { describe, it, expect } from "vitest";
import { createPathShapeTool } from "./path-shapes";
import { ArtisanStore, makeDocument, type PathItem } from "../engine";
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

describe("path-shape tools — integration", () => {
  it("arc: dragging makes an open 2-anchor curved path, selected", () => {
    const store = newStore();
    dragOut(createPathShapeTool("arc"), ctxOf(store), [50, 50], [150, 110]);
    expect(items(store).length).toBe(1);
    const it = items(store)[0] as PathItem;
    expect(it.type).toBe("path");
    expect(it.geometry.closed).toBe(false);
    expect(it.geometry.anchors.length).toBe(2);
    const curved = it.geometry.anchors.some((a) => Math.abs(a.handleOut.y) > 1 || Math.abs(a.handleIn.x) > 1);
    expect(curved).toBe(true); // it has bezier handles
    expect(store.getState().selection).toEqual([it.id]);
  });

  it("spiral: dragging makes an open path with many anchors", () => {
    const store = newStore();
    dragOut(createPathShapeTool("spiral"), ctxOf(store), [200, 200], [300, 200]);
    const it = items(store)[0] as PathItem;
    expect(it.type).toBe("path");
    expect(it.geometry.closed).toBe(false);
    expect(it.geometry.anchors.length).toBeGreaterThan(10);
  });

  it("the arc is one undoable transaction", () => {
    const store = newStore();
    dragOut(createPathShapeTool("arc"), ctxOf(store), [50, 50], [150, 110]);
    expect(items(store).length).toBe(1);
    store.undo();
    expect(items(store).length).toBe(0);
  });
});
