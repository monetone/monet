// ─────────────────────────────────────────────────────────────
// tools/pen.test — the Pen tool integration (parity)
// ─────────────────────────────────────────────────────────────
// Drives the real Pen tool against a live ArtisanStore. Reference: Adobe
// Illustrator Pen (P) — click adds a corner anchor, successive clicks build an
// open path, click-drag sets symmetric (smooth) handles, clicking the first
// anchor closes the path, Enter finishes / Esc cancels, and a path with < 2
// anchors is discarded. The whole path is one undoable transaction.

import { describe, it, expect } from "vitest";
import { createPenTool } from "./pen";
import { ArtisanStore, makeDocument, type PathItem } from "../engine";
import type { Tool, ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;
const key = (k: string) => ({ key: k, preventDefault: () => {}, stopImmediatePropagation: () => {} }) as unknown as KeyboardEvent;

const click = (tool: Tool, ctx: ToolContext, x: number, y: number) => {
  tool.onPointerDown!(ptr(x, y), ctx);
  tool.onPointerUp!(ptr(x, y), ctx);
};
const newStore = () => {
  const store = new ArtisanStore();
  store.replaceDoc(makeDocument(), { markClean: true });
  return store;
};
const items = (store: ArtisanStore) => store.getState().doc.layers[0].items;
const pathOf = (store: ArtisanStore) => items(store)[0] as PathItem;

describe("Pen tool — integration", () => {
  it("successive clicks build an open polyline of corner anchors", () => {
    const store = newStore();
    const tool = createPenTool();
    const ctx = ctxOf(store);
    click(tool, ctx, 100, 100);
    click(tool, ctx, 200, 100);
    click(tool, ctx, 200, 200);
    tool.onKeyDown!(key("Enter"), ctx);

    expect(items(store).length).toBe(1);
    const g = pathOf(store).geometry;
    expect(g.closed).toBe(false);
    expect(g.anchors.map((a) => [a.point.x, a.point.y])).toEqual([[100, 100], [200, 100], [200, 200]]);
    expect(g.anchors.every((a) => a.handleIn.x === 0 && a.handleOut.x === 0)).toBe(true); // corners, no handles
  });

  it("clicking the first anchor closes the path (no extra anchor)", () => {
    const store = newStore();
    const tool = createPenTool();
    const ctx = ctxOf(store);
    click(tool, ctx, 100, 100);
    click(tool, ctx, 200, 100);
    click(tool, ctx, 200, 200);
    click(tool, ctx, 101, 101); // within the close tolerance of the first anchor

    const g = pathOf(store).geometry;
    expect(g.closed).toBe(true);
    expect(g.anchors.length).toBe(3); // closing does not append an anchor
  });

  it("click-drag sets symmetric handles (a smooth point)", () => {
    const store = newStore();
    const tool = createPenTool();
    const ctx = ctxOf(store);
    tool.onPointerDown!(ptr(100, 100), ctx); // start first point
    tool.onPointerMove!(ptr(130, 100), ctx); // drag → handleOut +x, handleIn −x
    tool.onPointerUp!(ptr(130, 100), ctx);
    click(tool, ctx, 200, 100); // second anchor so the path survives
    tool.onKeyDown!(key("Enter"), ctx);

    const a0 = pathOf(store).geometry.anchors[0];
    expect(a0.handleOut.x).toBeCloseTo(30); // (−0 vs 0: assert components, not the object)
    expect(a0.handleOut.y).toBeCloseTo(0);
    expect(a0.handleIn.x).toBeCloseTo(-30);
    expect(a0.handleIn.y).toBeCloseTo(0);
    expect(a0.handleIn.x).toBeCloseTo(-a0.handleOut.x); // symmetric ⇒ smooth
  });

  it("Escape cancels the whole path (one transaction, nothing committed)", () => {
    const store = newStore();
    const tool = createPenTool();
    const ctx = ctxOf(store);
    click(tool, ctx, 100, 100);
    click(tool, ctx, 200, 100);
    tool.onKeyDown!(key("Escape"), ctx);
    expect(items(store).length).toBe(0);
    expect(store.canUndo).toBe(false); // transaction rolled back, not pushed to undo
  });

  it("finishing with fewer than 2 anchors discards the path", () => {
    const store = newStore();
    const tool = createPenTool();
    const ctx = ctxOf(store);
    click(tool, ctx, 100, 100); // a single point
    tool.onKeyDown!(key("Enter"), ctx);
    expect(items(store).length).toBe(0);
  });

  it("a finished open path is a single undoable transaction", () => {
    const store = newStore();
    const tool = createPenTool();
    const ctx = ctxOf(store);
    click(tool, ctx, 100, 100);
    click(tool, ctx, 200, 100);
    tool.onKeyDown!(key("Enter"), ctx);
    expect(items(store).length).toBe(1);
    store.undo();
    expect(items(store).length).toBe(0); // one undo removes the whole path
  });
});
