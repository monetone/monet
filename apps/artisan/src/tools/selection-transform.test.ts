// ─────────────────────────────────────────────────────────────
// tools/selection-transform.test — the Selection bounding-box handles
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator's selection BOUNDING BOX — drag a corner/edge
// handle to scale (the OPPOSITE handle is the fixed pivot), Shift-drag a corner
// to scale proportionally, drag just outside a corner (the rotate handle) to
// rotate around the box center. Each is one undoable step.

import { describe, it, expect } from "vitest";
import { createSelectionTool } from "./selection";
import { ArtisanStore, makeDocument, makeRect, solid, rgba, Query, type Item } from "../engine";
import type { ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number, o: { shift?: boolean } = {}): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: !!o.shift, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;

const bounds = (store: ArtisanStore, id: string) => Query.selectionBounds(store.getState().doc, [id])!;

const setup = (rect: Item) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  doc.layers[0].items.push(rect);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([rect.id]);
  return { store, id: rect.id };
};
const square = () => makeRect(0, 0, 100, 100, 0, 0, { fill: solid(rgba(220, 0, 0)) });

describe("Selection bounding box — scale", () => {
  it("dragging the SE corner scales from the NW pivot", () => {
    const { store, id } = setup(square());
    const tool = createSelectionTool();
    const ctx = ctxOf(store);
    tool.onPointerDown!(ptr(100, 100), ctx); // SE handle
    tool.onPointerMove!(ptr(150, 150), ctx); // 1.5× from NW (0,0)
    tool.onPointerUp!(ptr(150, 150), ctx);
    const b = bounds(store, id);
    expect(b.x).toBeCloseTo(0, 4); // NW pivot fixed
    expect(b.y).toBeCloseTo(0, 4);
    expect(b.width).toBeCloseTo(150, 4);
    expect(b.height).toBeCloseTo(150, 4);
  });

  it("dragging an EDGE handle scales only that axis", () => {
    const { store, id } = setup(square());
    const tool = createSelectionTool();
    const ctx = ctxOf(store);
    tool.onPointerDown!(ptr(100, 50), ctx); // E handle
    tool.onPointerMove!(ptr(150, 50), ctx);
    tool.onPointerUp!(ptr(150, 50), ctx);
    const b = bounds(store, id);
    expect(b.width).toBeCloseTo(150, 4); // X grew
    expect(b.height).toBeCloseTo(100, 4); // Y unchanged
  });

  it("Shift-dragging a corner scales PROPORTIONALLY (uniform)", () => {
    const { store, id } = setup(square());
    const tool = createSelectionTool();
    const ctx = ctxOf(store);
    tool.onPointerDown!(ptr(100, 100), ctx); // SE
    tool.onPointerMove!(ptr(200, 150, { shift: true }), ctx); // sx=2, sy=1.5 → uniform max=2
    tool.onPointerUp!(ptr(200, 150), ctx);
    const b = bounds(store, id);
    expect(b.width).toBeCloseTo(200, 3);
    expect(b.height).toBeCloseTo(200, 3); // forced equal to width
  });

  it("a scale is one undoable step", () => {
    const { store, id } = setup(square());
    const tool = createSelectionTool();
    const ctx = ctxOf(store);
    tool.onPointerDown!(ptr(100, 100), ctx);
    tool.onPointerMove!(ptr(150, 150), ctx);
    tool.onPointerUp!(ptr(150, 150), ctx);
    expect(bounds(store, id).width).toBeCloseTo(150, 4);
    store.undo();
    expect(bounds(store, id).width).toBeCloseTo(100, 4);
  });
});

describe("Selection bounding box — rotate", () => {
  it("dragging the rotate handle rotates the selection around its center", () => {
    // a wide 100×40 rect → a 90° rotation swaps its AABB dims to 40×100
    const { store, id } = setup(makeRect(0, 0, 100, 40, 0, 0, { fill: solid(rgba(0, 120, 220)) }));
    const tool = createSelectionTool();
    const ctx = ctxOf(store);
    // rotate handle is 22px above the top-center (n=(50,0)) → screen (50,−22)
    tool.onPointerDown!(ptr(50, -22), ctx); // startAngle points straight up (−π/2)
    tool.onPointerMove!(ptr(100, 20), ctx); // angle 0 → Δ = +90°
    tool.onPointerUp!(ptr(100, 20), ctx);
    const b = bounds(store, id);
    expect(b.width).toBeCloseTo(40, 2); // dims swapped
    expect(b.height).toBeCloseTo(100, 2);
    // centered where it started (50,20)
    expect(b.x + b.width / 2).toBeCloseTo(50, 2);
    expect(b.y + b.height / 2).toBeCloseTo(20, 2);
  });
});
