// ─────────────────────────────────────────────────────────────
// tools/selection-key-object.test — Selection tool designates the Align Key Object
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator — with 2+ objects selected, clicking an
// already-selected object with the Selection tool makes it the "Key Object"
// (the anchor for "Align To ▸ Key Object"). Clicking with only one object
// selected does nothing special; making a fresh selection leaves no key.

import { describe, it, expect } from "vitest";
import { createSelectionTool } from "./selection";
import { ArtisanStore, makeDocument, makeRect, solid, rgba } from "../engine";
import type { Tool, ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number, o: { shift?: boolean } = {}): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: !!o.shift, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;
const click = (tool: Tool, ctx: ToolContext, x: number, y: number, o: { shift?: boolean } = {}) => {
  tool.onPointerDown!(ptr(x, y, o), ctx);
  tool.onPointerUp!(ptr(x, y, o), ctx);
};

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

describe("Selection tool — Key Object designation", () => {
  it("re-clicking an already-selected object in a multi-selection sets it as the key", () => {
    const { store, A, B } = setup();
    store.setSelection([A, B]);
    expect(store.keyObjectId).toBeNull();
    click(createSelectionTool(), ctxOf(store), 120, 20); // click B (already selected)
    expect(store.keyObjectId).toBe(B);
    // selection is unchanged by the key click
    expect([...store.selection].sort()).toEqual([A, B].sort());
  });

  it("clicking an already-selected object when only ONE is selected sets no key", () => {
    const { store, A } = setup();
    store.setSelection([A]);
    click(createSelectionTool(), ctxOf(store), 20, 20); // click A (the only selection)
    expect(store.keyObjectId).toBeNull();
  });

  it("clicking a DIFFERENT object replaces the selection and leaves no key", () => {
    const { store, A, B, C } = setup();
    store.setSelection([A, B]);
    store.setKeyObject(B);
    click(createSelectionTool(), ctxOf(store), 20, 120); // click C → fresh single selection
    expect(store.selection).toEqual([C]);
    expect(store.keyObjectId).toBeNull(); // new selection drops the key
  });

  it("Shift-clicking does not designate a key", () => {
    const { store, A, B } = setup();
    store.setSelection([A, B]);
    click(createSelectionTool(), ctxOf(store), 120, 20, { shift: true }); // shift-toggle B off
    expect(store.keyObjectId).toBeNull();
  });
});
