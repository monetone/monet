// ─────────────────────────────────────────────────────────────
// tools/direct-selection.test — the Direct Selection (A) tool
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Direct Selection (white arrow) — click a path
// body to select it + reveal anchors; click an anchor to select just it
// (Shift adds/removes); drag an anchor to reshape; drag a bezier handle to bend
// the curve (the opposite handle mirrors unless Alt breaks symmetry); Delete
// removes the selected anchors. Anchor/handle edits are one undoable step.

import { describe, it, expect } from "vitest";
import { createDirectSelectionTool } from "./direct-selection";
import { ArtisanStore, makeCompound, makeDocument, makePath, makeAnchor, solid, rgba, Query, type CompoundPathItem, type PathItem } from "../engine";
import type { ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number, o: { shift?: boolean; alt?: boolean } = {}): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: !!o.shift, alt: !!o.alt, mod: false, button: 0, detail: 1 }) as ToolPointer;

const pathOf = (store: ArtisanStore, id: string) => Query.getItem(store.getState().doc, id) as PathItem;
const anchorSel = (store: ArtisanStore, id: string) => store.getState().anchorSelection[id] ?? [];
const compoundOf = (store: ArtisanStore, id: string) => Query.getItem(store.getState().doc, id) as CompoundPathItem;

// A 100×100 closed filled square path (corners), selected. Optional anchor overrides.
const square = (anchors = [makeAnchor({ x: 0, y: 0 }), makeAnchor({ x: 100, y: 0 }), makeAnchor({ x: 100, y: 100 }), makeAnchor({ x: 0, y: 100 })]) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const p = makePath({ closed: true, anchors }, { fill: solid(rgba(120, 160, 220)) });
  doc.layers[0].items.push(p);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([p.id]);
  return { store, id: p.id };
};

const compoundSquare = (handled = false) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const compound = makeCompound([
    { closed: true, anchors: [makeAnchor({ x: 0, y: 0 }), makeAnchor({ x: 100, y: 0 }), makeAnchor({ x: 100, y: 100 }), makeAnchor({ x: 0, y: 100 })] },
    {
      closed: true,
      anchors: [
        makeAnchor({ x: 25, y: 25 }, handled ? { x: -10, y: 0 } : undefined, handled ? { x: 10, y: 0 } : undefined),
        makeAnchor({ x: 75, y: 25 }),
        makeAnchor({ x: 75, y: 75 }),
        makeAnchor({ x: 25, y: 75 }),
      ],
    },
  ], { fill: solid(rgba(120, 160, 220)) });
  doc.layers[0].items.push(compound);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([compound.id]);
  return { store, id: compound.id };
};

describe("Direct Selection tool", () => {
  it("clicking an anchor selects just that anchor", () => {
    const { store, id } = square();
    const tool = createDirectSelectionTool();
    const ctx = ctxOf(store);
    tool.onPointerDown!(ptr(100, 0), ctx); // corner index 1
    tool.onPointerUp!(ptr(100, 0), ctx);
    expect(anchorSel(store, id)).toEqual([1]);
  });

  it("Shift-clicking anchors adds then toggles them off", () => {
    const { store, id } = square();
    const tool = createDirectSelectionTool();
    const ctx = ctxOf(store);
    tool.onPointerDown!(ptr(0, 0), ctx); tool.onPointerUp!(ptr(0, 0), ctx); // [0]
    tool.onPointerDown!(ptr(100, 0, { shift: true }), ctx); tool.onPointerUp!(ptr(100, 0), ctx); // +1
    expect(anchorSel(store, id)).toEqual([0, 1]);
    tool.onPointerDown!(ptr(0, 0, { shift: true }), ctx); tool.onPointerUp!(ptr(0, 0), ctx); // toggle 0 off
    expect(anchorSel(store, id)).toEqual([1]);
  });

  it("dragging a selected anchor moves it (reshape); one undoable step", () => {
    const { store, id } = square();
    const tool = createDirectSelectionTool();
    const ctx = ctxOf(store);
    tool.onPointerDown!(ptr(0, 0), ctx); // grab corner 0
    tool.onPointerMove!(ptr(20, 30), ctx);
    tool.onPointerUp!(ptr(20, 30), ctx);
    expect(pathOf(store, id).geometry.anchors[0].point).toEqual({ x: 20, y: 30 });
    store.undo();
    expect(pathOf(store, id).geometry.anchors[0].point).toEqual({ x: 0, y: 0 });
  });

  it("dragging a bezier handle bends the curve and MIRRORS the opposite handle", () => {
    const { store, id } = square([
      makeAnchor({ x: 0, y: 0 }),
      makeAnchor({ x: 100, y: 0 }, { x: -10, y: 0 }, { x: 10, y: 0 }), // smooth anchor 1
      makeAnchor({ x: 100, y: 100 }),
      makeAnchor({ x: 0, y: 100 }),
    ]);
    store.setAnchorSelection({ [id]: [1] }); // reveal its handles
    const tool = createDirectSelectionTool();
    const ctx = ctxOf(store);
    tool.onPointerDown!(ptr(110, 0), ctx); // handle-out tip = point(100,0)+out(10,0)
    tool.onPointerMove!(ptr(130, 20), ctx); // → local vec (30,20)
    tool.onPointerUp!(ptr(130, 20), ctx);
    const a = pathOf(store, id).geometry.anchors[1];
    expect(a.handleOut).toEqual({ x: 30, y: 20 });
    expect(a.handleIn).toEqual({ x: -30, y: -20 }); // mirrored
  });

  it("Alt-dragging a handle breaks symmetry (opposite handle unchanged)", () => {
    const { store, id } = square([
      makeAnchor({ x: 0, y: 0 }),
      makeAnchor({ x: 100, y: 0 }, { x: -10, y: 0 }, { x: 10, y: 0 }),
      makeAnchor({ x: 100, y: 100 }),
      makeAnchor({ x: 0, y: 100 }),
    ]);
    store.setAnchorSelection({ [id]: [1] });
    const tool = createDirectSelectionTool();
    const ctx = ctxOf(store);
    tool.onPointerDown!(ptr(110, 0), ctx);
    tool.onPointerMove!(ptr(130, 20, { alt: true }), ctx);
    tool.onPointerUp!(ptr(130, 20), ctx);
    const a = pathOf(store, id).geometry.anchors[1];
    expect(a.handleOut).toEqual({ x: 30, y: 20 });
    expect(a.handleIn).toEqual({ x: -10, y: 0 }); // untouched
  });

  it("clicking the path body selects the object and clears the anchor selection", () => {
    const { store, id } = square();
    store.setSelection([]); // nothing selected yet
    store.setAnchorSelection({ [id]: [2] });
    const tool = createDirectSelectionTool();
    tool.onPointerDown!(ptr(50, 50), ctxOf(store)); // inside the filled square, off any anchor
    expect(store.getState().selection).toEqual([id]);
    expect(anchorSel(store, id)).toEqual([]);
  });

  it("Delete removes the selected anchors", () => {
    const { store, id } = square();
    store.setAnchorSelection({ [id]: [1] });
    const tool = createDirectSelectionTool();
    const ev = { key: "Delete", preventDefault: () => {}, stopImmediatePropagation: () => {} } as unknown as KeyboardEvent;
    tool.onKeyDown!(ev, ctxOf(store));
    expect(pathOf(store, id).geometry.anchors).toHaveLength(3);
    expect(anchorSel(store, id)).toEqual([]);
  });

  it("selects, moves, and deletes anchors across compound subpaths", () => {
    const { store, id } = compoundSquare();
    const tool = createDirectSelectionTool();
    const ctx = ctxOf(store);

    tool.onPointerDown!(ptr(25, 25), ctx);
    expect(anchorSel(store, id)).toEqual([4]);
    tool.onPointerMove!(ptr(35, 40), ctx);
    tool.onPointerUp!(ptr(35, 40), ctx);
    expect(compoundOf(store, id).subpaths[1].anchors[0].point).toEqual({ x: 35, y: 40 });

    const ev = { key: "Delete", preventDefault: () => {}, stopImmediatePropagation: () => {} } as unknown as KeyboardEvent;
    tool.onKeyDown!(ev, ctxOf(store));
    expect(compoundOf(store, id).subpaths[1].anchors).toHaveLength(3);
  });

  it("drags a compound-path handle using the flat anchor index", () => {
    const { store, id } = compoundSquare(true);
    store.setAnchorSelection({ [id]: [4] });
    const tool = createDirectSelectionTool();
    const ctx = ctxOf(store);

    tool.onPointerDown!(ptr(35, 25), ctx);
    tool.onPointerMove!(ptr(45, 35), ctx);
    tool.onPointerUp!(ptr(45, 35), ctx);

    const anchor = compoundOf(store, id).subpaths[1].anchors[0];
    expect(anchor.handleOut).toEqual({ x: 20, y: 10 });
    expect(anchor.handleIn).toEqual({ x: -20, y: -10 });
  });
});
