// ─────────────────────────────────────────────────────────────
// tools/selection-constrain.test — Shift-constrained move via the Selection tool
// ─────────────────────────────────────────────────────────────
// Integration: drive the real Selection tool. A plain drag moves freely; a
// Shift-drag constrains the move to the nearest 45° axis (Illustrator parity).

import { describe, it, expect } from "vitest";
import { createSelectionTool } from "./selection";
import { ArtisanStore, makeDocument, makeRect, Query, solid, rgba } from "../engine";
import type { ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number, shift = false): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(80, 90, 40, 20, 0, 0, { fill: solid(rgba(200, 120, 60)) }); // centre (100,100)
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const pos = (store: ArtisanStore, id: string) => {
  const b = Query.worldBounds(store.getState().doc, id)!;
  return { x: b.x, y: b.y };
};

describe("Selection tool — Shift constrains the move to 45°", () => {
  it("a plain drag moves freely (both axes)", () => {
    const { store, r } = setup();
    const tool = createSelectionTool();
    const ctx = ctxOf(store);
    const before = pos(store, r.id);
    tool.onPointerDown!(ptr(100, 100), ctx); // centre of the rect → mode "move"
    tool.onPointerMove!(ptr(160, 150), ctx); // Δ (60,50), no shift
    tool.onPointerUp!(ptr(160, 150), ctx);
    const after = pos(store, r.id);
    expect(after.x - before.x).toBeCloseTo(60);
    expect(after.y - before.y).toBeCloseTo(50);
  });

  it("a Shift-drag near 45° constrains to an exact diagonal (Δx == Δy)", () => {
    const { store, r } = setup();
    const tool = createSelectionTool();
    const ctx = ctxOf(store);
    const before = pos(store, r.id);
    tool.onPointerDown!(ptr(100, 100), ctx);
    tool.onPointerMove!(ptr(160, 150, true), ctx); // Δ (60,50) + Shift → 45°
    tool.onPointerUp!(ptr(160, 150, true), ctx);
    const after = pos(store, r.id);
    const ddx = after.x - before.x, ddy = after.y - before.y;
    expect(ddx).toBeCloseTo(ddy); // exact diagonal
    expect(ddx).toBeGreaterThan(0);
  });

  it("a Shift-drag that is mostly horizontal constrains to pure horizontal", () => {
    const { store, r } = setup();
    const tool = createSelectionTool();
    const ctx = ctxOf(store);
    const before = pos(store, r.id);
    tool.onPointerDown!(ptr(100, 100), ctx);
    tool.onPointerMove!(ptr(180, 108, true), ctx); // Δ (80,8) + Shift → horizontal
    tool.onPointerUp!(ptr(180, 108, true), ctx);
    const after = pos(store, r.id);
    expect(after.y - before.y).toBeCloseTo(0); // y unchanged
    expect(after.x - before.x).toBeGreaterThan(0);
  });
});
