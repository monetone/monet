// ─────────────────────────────────────────────────────────────
// tools/slice.test — Slice + Slice Selection tools integration (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Slice tool drags out a rectangular export region
// (normalized bbox), selected; the Slice Selection tool clicks/moves a slice.

import { describe, it, expect } from "vitest";
import { createSliceTool, createSliceSelectionTool } from "./slice";
import { ArtisanStore, makeDocument } from "../engine";
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
const slices = (store: ArtisanStore) => store.getState().doc.slices ?? [];
const bbox = (s: { x: number; y: number; width: number; height: number }) => ({ x: s.x, y: s.y, w: s.width, h: s.height });

describe("Slice tool — integration", () => {
  it("dragging creates a normalized slice region, selected", () => {
    const store = newStore();
    dragOut(createSliceTool(), ctxOf(store), [100, 100], [220, 180]);
    expect(slices(store).length).toBe(1);
    expect(bbox(slices(store)[0])).toEqual({ x: 100, y: 100, w: 120, h: 80 });
    expect(store.getState().selectedSlice).toBe(slices(store)[0].id);
  });

  it("normalizes a reversed drag (cur above-left of start)", () => {
    const store = newStore();
    dragOut(createSliceTool(), ctxOf(store), [220, 180], [100, 100]);
    expect(bbox(slices(store)[0])).toEqual({ x: 100, y: 100, w: 120, h: 80 });
  });

  it("the slice creation is one undoable transaction", () => {
    const store = newStore();
    dragOut(createSliceTool(), ctxOf(store), [100, 100], [220, 180]);
    expect(slices(store).length).toBe(1);
    store.undo();
    expect(slices(store).length).toBe(0);
  });
});

describe("Slice Selection tool — integration", () => {
  const withSlice = () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    doc.slices = [{ id: "S1", name: "Slice", x: 50, y: 50, width: 100, height: 60 }];
    store.replaceDoc(doc, { markClean: true });
    return store;
  };

  it("clicking inside a slice selects it; dragging moves it", () => {
    const store = withSlice();
    const tool = createSliceSelectionTool();
    const ctx = ctxOf(store);
    tool.onPointerDown!(ptr(80, 70), ctx); // inside (50,50)-(150,110)
    expect(store.getState().selectedSlice).toBe("S1");
    tool.onPointerMove!(ptr(110, 90), ctx); // drag +30,+20
    tool.onPointerUp!(ptr(110, 90), ctx);
    const s = slices(store)[0];
    expect({ x: s.x, y: s.y }).toEqual({ x: 80, y: 70 }); // moved by (30,20)
  });

  it("clicking outside any slice deselects", () => {
    const store = withSlice();
    store.setSelectedSlice("S1");
    createSliceSelectionTool().onPointerDown!(ptr(500, 500), ctxOf(store));
    expect(store.getState().selectedSlice).toBeUndefined();
  });
});
