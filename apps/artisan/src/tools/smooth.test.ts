// ─────────────────────────────────────────────────────────────
// tools/smooth.test — the Smooth tool integration (parity)
// ─────────────────────────────────────────────────────────────
// Drives the real Smooth tool: dragging the brush over a path softens the anchors
// under it (moves them toward their neighbours), in one undoable transaction.

import { describe, it, expect } from "vitest";
import { createSmoothTool } from "./path-tools";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, Query, type PathItem } from "../engine";
import type { ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;
const anchorsOf = (store: ArtisanStore, id: string) => (Query.getItem(store.getState().doc, id) as PathItem).geometry.anchors.map((a) => a.point);

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 50, y: 80 }), anchor({ x: 100, y: 0 })] }); // spike at (50,80)
  doc.layers[0].items.push(p);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([p.id]);
  return { store, p };
};

describe("Smooth tool — integration", () => {
  it("brushing over a spike anchor pulls it toward its neighbours' midpoint", () => {
    const { store, p } = setup();
    const tool = createSmoothTool();
    const ctx = ctxOf(store);
    tool.onPointerDown!(ptr(50, 80), ctx); // grabs the selected path
    tool.onPointerMove!(ptr(50, 80), ctx); // brush centred on the spike
    tool.onPointerUp!(ptr(50, 80), ctx);
    const a = anchorsOf(store, p.id);
    expect(a[1].y).toBeLessThan(80); // spike softened toward (50,0)
    expect(a[1].y).toBeGreaterThan(0);
    expect(a[0]).toEqual({ x: 0, y: 0 }); // endpoints untouched (outside the 40px radius)
    expect(a[2]).toEqual({ x: 100, y: 0 });
  });

  it("the smoothing is a single undoable transaction", () => {
    const { store, p } = setup();
    const tool = createSmoothTool();
    const ctx = ctxOf(store);
    tool.onPointerDown!(ptr(50, 80), ctx);
    tool.onPointerMove!(ptr(50, 80), ctx);
    tool.onPointerUp!(ptr(50, 80), ctx);
    expect(anchorsOf(store, p.id)[1].y).toBeLessThan(80);
    store.undo();
    expect(anchorsOf(store, p.id)[1]).toEqual({ x: 50, y: 80 }); // restored
  });
});
