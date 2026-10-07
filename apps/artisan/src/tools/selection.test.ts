// ─────────────────────────────────────────────────────────────
// tools/selection.test — the Selection (V) tool: pick / toggle / marquee / move
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Selection (black arrow) — click an object to
// select it; a plain click on another object REPLACES the selection; Shift-click
// ADDS an object (or removes an already-selected one); clicking empty canvas
// DESELECTS; a rubber-band marquee selects every crossed object (Shift-marquee
// ADDS to the selection); dragging a selected object moves it (one undo step).

import { describe, it, expect } from "vitest";
import { createSelectionTool } from "./selection";
import { ArtisanStore, makeDocument, makeRect, solid, rgba, Query } from "../engine";
import type { Tool, ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number, o: { shift?: boolean } = {}): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: !!o.shift, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;

const click = (tool: Tool, ctx: ToolContext, x: number, y: number, o: { shift?: boolean } = {}) => {
  tool.onPointerDown!(ptr(x, y, o), ctx);
  tool.onPointerUp!(ptr(x, y, o), ctx);
};
const sel = (store: ArtisanStore) => store.getState().selection;

// A=(0,0,40,40) center (20,20); B=(100,0,40,40) center (120,20); C=(0,100,40,40) center (20,120)
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const A = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  const B = makeRect(100, 0, 40, 40, 0, 0, { fill: solid(rgba(0, 120, 220)) });
  const C = makeRect(0, 100, 40, 40, 0, 0, { fill: solid(rgba(0, 180, 80)) });
  doc.layers[0].items.push(A, B, C);
  store.replaceDoc(doc, { markClean: true });
  return { store, A: A.id, B: B.id, C: C.id };
};

describe("Selection tool — pick & toggle", () => {
  it("clicking an object selects it; clicking another REPLACES the selection", () => {
    const { store, A, B } = setup();
    const tool = createSelectionTool();
    const ctx = ctxOf(store);
    click(tool, ctx, 20, 20);
    expect(sel(store)).toEqual([A]);
    click(tool, ctx, 120, 20);
    expect(sel(store)).toEqual([B]); // replaced, not added
  });

  it("Shift-click ADDS an object to the selection", () => {
    const { store, A, B } = setup();
    const tool = createSelectionTool();
    const ctx = ctxOf(store);
    click(tool, ctx, 20, 20); // A
    click(tool, ctx, 120, 20, { shift: true }); // +B
    expect([...sel(store)].sort()).toEqual([A, B].sort());
  });

  it("Shift-click an already-selected object REMOVES it", () => {
    const { store, A, B } = setup();
    store.setSelection([A, B]);
    const tool = createSelectionTool();
    click(tool, ctxOf(store), 20, 20, { shift: true }); // toggle A off
    expect(sel(store)).toEqual([B]);
  });

  it("clicking empty canvas DESELECTS", () => {
    const { store, A } = setup();
    store.setSelection([A]);
    click(tool(), ctxOf(store), 300, 300);
    expect(sel(store)).toEqual([]);
  });
});

describe("Selection tool — marquee (rubber band)", () => {
  it("a marquee selects every CROSSED object", () => {
    const { store, A, B, C } = setup();
    const tool = createSelectionTool();
    const ctx = ctxOf(store);
    tool.onPointerDown!(ptr(-20, -20), ctx); // empty → marquee
    tool.onPointerMove!(ptr(160, 60), ctx); // covers A & B, not C (y>60)
    tool.onPointerUp!(ptr(160, 60), ctx);
    const s = sel(store);
    expect(s).toContain(A);
    expect(s).toContain(B);
    expect(s).not.toContain(C);
  });

  it("Shift-marquee ADDS the crossed objects to the existing selection", () => {
    const { store, A, B, C } = setup();
    store.setSelection([C]);
    const tool = createSelectionTool();
    const ctx = ctxOf(store);
    tool.onPointerDown!(ptr(-20, -20, { shift: true }), ctx);
    tool.onPointerMove!(ptr(160, 60, { shift: true }), ctx);
    tool.onPointerUp!(ptr(160, 60, { shift: true }), ctx);
    expect([...sel(store)].sort()).toEqual([A, B, C].sort()); // C kept + A,B added
  });
});

describe("Selection tool — move", () => {
  it("dragging a selected object moves it; one undoable step", () => {
    const { store, A } = setup();
    store.setSelection([A]);
    const tool = createSelectionTool();
    const ctx = ctxOf(store);
    tool.onPointerDown!(ptr(20, 20), ctx); // grab A (center)
    tool.onPointerMove!(ptr(50, 60), ctx); // +30,+40
    tool.onPointerUp!(ptr(50, 60), ctx);
    const t = Query.getItem(store.getState().doc, A)!.transform;
    expect(t.e).toBeCloseTo(30, 6);
    expect(t.f).toBeCloseTo(40, 6);
    store.undo();
    expect(Query.getItem(store.getState().doc, A)!.transform.e).toBeCloseTo(0, 6);
  });
});

function tool() {
  return createSelectionTool();
}
