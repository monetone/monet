// ─────────────────────────────────────────────────────────────
// tools/selection-alt-duplicate.test — Alt-drag duplicates (Selection tool)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator — Alt(Option)-dragging an object with the
// Selection tool moves a COPY, leaving the original in place; the copy ends up
// selected. The clone + move is one undoable step.

import { describe, it, expect } from "vitest";
import { createSelectionTool } from "./selection";
import { ArtisanStore, makeDocument, makeRect, solid, rgba } from "../engine";
import type { ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number, o: { alt?: boolean } = {}): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: !!o.alt, mod: false, button: 0, detail: 1 }) as ToolPointer;

const items = (store: ArtisanStore) => store.getState().doc.layers[0].items;

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const a = makeRect(50, 50, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0)) }); // center (70,70)
  doc.layers[0].items.push(a);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([a.id]);
  return { store, A: a.id };
};

describe("Selection tool — Alt-drag duplicate", () => {
  it("Alt-drag moves a COPY and leaves the original in place", () => {
    const { store, A } = setup();
    const tool = createSelectionTool();
    const ctx = ctxOf(store);
    tool.onPointerDown!(ptr(70, 70), ctx); // grab A
    tool.onPointerMove!(ptr(120, 140, { alt: true }), ctx); // Δ (50,70)
    tool.onPointerUp!(ptr(120, 140, { alt: true }), ctx);

    const list = items(store);
    expect(list).toHaveLength(2); // original + copy
    const orig = list.find((i) => i.id === A)!;
    expect(orig.transform.e).toBe(50); // original UNCHANGED
    expect(orig.transform.f).toBe(50);
    const copy = list.find((i) => i.id !== A)!;
    expect(copy.transform.e).toBe(100); // 50 + 50
    expect(copy.transform.f).toBe(120); // 50 + 70
    expect(copy.type).toBe("rect");
    expect(store.getState().selection).toEqual([copy.id]); // the copy is selected
  });

  it("a plain drag (no Alt) moves the original — no copy", () => {
    const { store, A } = setup();
    const tool = createSelectionTool();
    const ctx = ctxOf(store);
    tool.onPointerDown!(ptr(70, 70), ctx);
    tool.onPointerMove!(ptr(120, 140), ctx);
    tool.onPointerUp!(ptr(120, 140), ctx);

    const list = items(store);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(A);
    expect(list[0].transform.e).toBe(100); // original moved
    expect(store.getState().selection).toEqual([A]);
  });

  it("Alt-drag (clone + move) is one undoable step", () => {
    const { store, A } = setup();
    const tool = createSelectionTool();
    const ctx = ctxOf(store);
    tool.onPointerDown!(ptr(70, 70), ctx);
    tool.onPointerMove!(ptr(120, 140, { alt: true }), ctx);
    tool.onPointerUp!(ptr(120, 140, { alt: true }), ctx);
    expect(items(store)).toHaveLength(2);

    store.undo();
    const list = items(store);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(A);
    expect(list[0].transform.e).toBe(50); // back to the start
  });
});
