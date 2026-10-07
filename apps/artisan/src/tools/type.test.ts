// ─────────────────────────────────────────────────────────────
// tools/type.test — the Type (T) tool: point-type create / edit / discard
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Type tool (point type) — click an empty spot to
// create a point-type object at the click and enter edit mode; type to fill it;
// clicking an EXISTING type object re-enters edit on it (no new object); and an
// EMPTY type object is DISCARDED when you finish editing (Illustrator removes
// empty type objects automatically). Creating + typing is ONE undoable step.

import { describe, it, expect } from "vitest";
import { createTypeTool } from "./type";
import { ArtisanStore, makeDocument, makeText, Query, Mat, type TextItem } from "../engine";
import type { ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;

const texts = (store: ArtisanStore): TextItem[] => {
  const out: TextItem[] = [];
  for (const l of store.getState().doc.layers) for (const it of l.items) if (it.type === "text") out.push(it as TextItem);
  return out;
};
// Mirror the inline <textarea> onChange: write the typed string into the editing text.
const typeInto = (store: ArtisanStore, id: string, text: string) =>
  store.mutate((d) => {
    const l = Query.findItem(d, id);
    if (l && l.item.type === "text") {
      l.item.text = text;
      l.item.runs = undefined;
      if (text.trim()) l.item.name = text.slice(0, 24);
    }
  });

const setup = () => {
  const store = new ArtisanStore();
  store.replaceDoc(makeDocument(), { markClean: true });
  return store;
};

describe("Type tool — point type (Illustrator parity)", () => {
  it("click on empty canvas creates a point-type object at the click + enters edit mode", () => {
    const store = setup();
    const tool = createTypeTool();
    const ctx = ctxOf(store);
    tool.onPointerUp!(ptr(100, 120), ctx);

    const t = texts(store);
    expect(t).toHaveLength(1);
    expect(t[0].text).toBe("");
    expect(t[0].fontSize).toBe(48);
    expect(t[0].name).toBe("Type"); // empty placeholder name
    // placed exactly at the click point
    expect(Mat.applyToPoint(t[0].transform, { x: 0, y: 0 })).toEqual({ x: 100, y: 120 });
    // entered edit mode + selected
    expect(store.getState().editingTextId).toBe(t[0].id);
    expect(store.getState().selection).toEqual([t[0].id]);
  });

  it("typing then finishing keeps the text, and create+type is ONE undoable step", () => {
    const store = setup();
    const tool = createTypeTool();
    const ctx = ctxOf(store);
    tool.onPointerUp!(ptr(100, 120), ctx);
    const id = texts(store)[0].id;
    typeInto(store, id, "Hello");
    tool.onDeactivate!(ctx); // finish → endTransaction

    expect(store.getState().editingTextId).toBeUndefined();
    const t = texts(store);
    expect(t).toHaveLength(1);
    expect(t[0].text).toBe("Hello");
    expect(t[0].name).toBe("Hello"); // name tracks the content

    // one transaction: a single undo removes the whole type object
    expect(store.canUndo).toBe(true);
    store.undo();
    expect(texts(store)).toHaveLength(0);
  });

  it("an EMPTY type object is discarded when editing finishes (Illustrator parity)", () => {
    const store = setup();
    const tool = createTypeTool();
    const ctx = ctxOf(store);
    tool.onPointerUp!(ptr(100, 120), ctx);
    expect(texts(store)).toHaveLength(1); // provisionally created while editing

    tool.onDeactivate!(ctx); // finish with empty text → cancelTransaction
    expect(texts(store)).toHaveLength(0); // discarded
    expect(store.getState().editingTextId).toBeUndefined();
    expect(store.canUndo).toBe(false); // nothing was committed to history
  });

  it("whitespace-only text is also discarded (trimmed empty)", () => {
    const store = setup();
    const tool = createTypeTool();
    const ctx = ctxOf(store);
    tool.onPointerUp!(ptr(100, 120), ctx);
    typeInto(store, texts(store)[0].id, "   ");
    tool.onDeactivate!(ctx);
    expect(texts(store)).toHaveLength(0);
  });

  it("clicking an EXISTING type object re-enters edit on it (no new object)", () => {
    const store = setup();
    store.transact("seed", (d) => d.layers[0].items.push(makeText("Hi", 200, 200, { fontSize: 48 })));
    const id0 = texts(store)[0].id;
    const tool = createTypeTool();
    const ctx = ctxOf(store);

    tool.onPointerUp!(ptr(215, 195), ctx); // inside the existing text's bounds
    expect(texts(store)).toHaveLength(1); // did NOT create a second object
    expect(store.getState().editingTextId).toBe(id0);
    expect(store.getState().selection).toEqual([id0]);
  });
});
