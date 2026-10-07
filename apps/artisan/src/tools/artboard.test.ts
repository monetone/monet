// ─────────────────────────────────────────────────────────────
// tools/artboard.test — Artboard tool integration (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Artboard tool (Shift+O) — drag in empty space to
// create a new artboard (normalized bbox, made active); click+drag an existing
// artboard to move it. Multiple artboards live in doc.artboards.

import { describe, it, expect } from "vitest";
import { createArtboardTool } from "./artboard-tool";
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
// One small artboard at (0,0)-(100,100) so there's empty space to draw in.
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  doc.artboards = [{ id: "AB1", name: "Artboard 1", x: 0, y: 0, width: 100, height: 100 }];
  doc.activeArtboard = 0;
  store.replaceDoc(doc, { markClean: true });
  return store;
};
const boards = (store: ArtisanStore) => store.getState().doc.artboards;
const bbox = (a: { x: number; y: number; width: number; height: number }) => ({ x: a.x, y: a.y, w: a.width, h: a.height });

describe("Artboard tool — create", () => {
  it("dragging empty space adds a normalized artboard, made active", () => {
    const store = setup();
    dragOut(createArtboardTool(), ctxOf(store), [200, 200], [350, 300]); // outside AB1
    expect(boards(store).length).toBe(2);
    expect(bbox(boards(store)[1])).toEqual({ x: 200, y: 200, w: 150, h: 100 });
    expect(store.getState().doc.activeArtboard).toBe(1);
  });

  it("normalizes a reversed drag", () => {
    const store = setup();
    dragOut(createArtboardTool(), ctxOf(store), [350, 300], [200, 200]);
    expect(bbox(boards(store)[1])).toEqual({ x: 200, y: 200, w: 150, h: 100 });
  });

  it("creating a new artboard is one undoable transaction", () => {
    const store = setup();
    dragOut(createArtboardTool(), ctxOf(store), [200, 200], [350, 300]);
    expect(boards(store).length).toBe(2);
    store.undo();
    expect(boards(store).length).toBe(1);
  });
});

describe("Artboard tool — move", () => {
  it("clicking inside an artboard then dragging moves it (and makes it active)", () => {
    const store = setup();
    const tool = createArtboardTool();
    const ctx = ctxOf(store);
    tool.onPointerDown!(ptr(50, 50), ctx); // inside AB1
    expect(store.getState().doc.activeArtboard).toBe(0);
    tool.onPointerMove!(ptr(90, 80), ctx); // drag +40,+30
    tool.onPointerUp!(ptr(90, 80), ctx);
    expect(bbox(boards(store)[0])).toEqual({ x: 40, y: 30, w: 100, h: 100 }); // moved, size kept
  });
});
