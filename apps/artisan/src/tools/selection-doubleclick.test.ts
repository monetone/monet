// ─────────────────────────────────────────────────────────────
// tools/selection-doubleclick.test — double-click dives into a group
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator — single-clicking a grouped object with the
// Selection tool selects the whole GROUP; double-clicking it enters the group and
// selects the individual object under the pointer.

import { describe, it, expect } from "vitest";
import { createSelectionTool } from "./selection";
import { ArtisanStore, makeDocument, makeRect, makeGroup, solid, rgba } from "../engine";
import type { ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;
const sel = (store: ArtisanStore) => store.getState().selection;

// a top-level group of two rects: A center (20,20), B center (120,20)
const grouped = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const a = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  const b = makeRect(100, 0, 40, 40, 0, 0, { fill: solid(rgba(0, 0, 220)) });
  const g = makeGroup([a, b]);
  doc.layers[0].items.push(g);
  store.replaceDoc(doc, { markClean: true });
  return { store, g: g.id, a: a.id, b: b.id };
};

describe("Selection tool — double-click dive into group", () => {
  it("single-click a grouped object selects the GROUP", () => {
    const { store, g } = grouped();
    const tool = createSelectionTool();
    const ctx = ctxOf(store);
    tool.onPointerDown!(ptr(20, 20), ctx); // on rect A
    tool.onPointerUp!(ptr(20, 20), ctx);
    expect(sel(store)).toEqual([g]); // the whole group
  });

  it("double-click selects the object INSIDE the group (dive in)", () => {
    const { store, a, b } = grouped();
    const tool = createSelectionTool();
    const ctx = ctxOf(store);
    tool.onDoubleClick!(ptr(20, 20), ctx); // double-click rect A
    expect(sel(store)).toEqual([a]); // the leaf, not the group
    tool.onDoubleClick!(ptr(120, 20), ctx); // double-click rect B
    expect(sel(store)).toEqual([b]);
  });

  it("double-click an ungrouped object just selects it", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const r = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(0, 180, 80)) });
    doc.layers[0].items.push(r);
    store.replaceDoc(doc, { markClean: true });
    createSelectionTool().onDoubleClick!(ptr(20, 20), ctxOf(store));
    expect(sel(store)).toEqual([r.id]);
  });

  it("double-click empty canvas is a no-op", () => {
    const { store, g } = grouped();
    store.setSelection([g]);
    createSelectionTool().onDoubleClick!(ptr(400, 400), ctxOf(store)); // nothing there
    expect(sel(store)).toEqual([g]); // selection unchanged
  });
});
