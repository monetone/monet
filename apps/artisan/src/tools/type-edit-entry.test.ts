// ─────────────────────────────────────────────────────────────
// tools/type-edit-entry.test — enter text edit by double-clicking (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator — double-clicking a type object with the Selection
// tool switches to the Type tool and places the cursor in the text for editing.
// Double-clicking a non-text object instead dives into it (selects the leaf).

import { describe, it, expect } from "vitest";
import { createSelectionTool } from "./selection";
import { ArtisanStore, makeDocument, makeRect, makeText, Query } from "../engine";
import type { ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 2 }) as ToolPointer;

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const txt = makeText("Hello", 100, 100, { fontSize: 48 });
  const rect = makeRect(300, 300, 40, 40, 0, 0);
  doc.layers[0].items.push(txt, rect);
  store.replaceDoc(doc, { markClean: true });
  return { store, txt: txt.id, rect: rect.id };
};

describe("Selection tool — double-click to edit type (Illustrator parity)", () => {
  it("double-clicking a type object enters edit mode and switches to the Type tool", () => {
    const { store, txt } = setup();
    const tool = createSelectionTool();
    tool.onDoubleClick!(ptr(110, 95), ctxOf(store)); // inside the text's bounds

    expect(store.getState().editingTextId).toBe(txt);
    expect(store.getState().selection).toEqual([txt]);
    expect(store.getState().tool).toBe("type");
  });

  it("double-clicking a non-text object does NOT enter text edit (dives/selects)", () => {
    const { store, rect } = setup();
    const tool = createSelectionTool();
    tool.onDoubleClick!(ptr(315, 315), ctxOf(store)); // inside the rect

    expect(store.getState().editingTextId).toBeUndefined();
    expect(store.getState().selection).toEqual([rect]);
    expect(store.getState().tool).toBe("selection");
  });

  it("double-clicking empty canvas does nothing", () => {
    const { store } = setup();
    const tool = createSelectionTool();
    tool.onDoubleClick!(ptr(600, 600), ctxOf(store));

    expect(store.getState().editingTextId).toBeUndefined();
    expect(store.getState().tool).toBe("selection");
  });
});
