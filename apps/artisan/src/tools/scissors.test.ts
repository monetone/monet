// ─────────────────────────────────────────────────────────────
// tools/scissors.test — Scissors tool integration (parity)
// ─────────────────────────────────────────────────────────────
// Drives the real Scissors tool (createScissorsTool) against a live ArtisanStore:
// a pointer-down hit-tests the path, finds the nearest point, and cuts it in one
// undoable transaction. Closed → one open path; open → two paths.

import { describe, it, expect } from "vitest";
import { createScissorsTool } from "./path-tools";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, defaultStroke, noPaint, solid, rgba, Query } from "../engine";
import type { ToolContext, ToolPointer } from "./types";

const BLACK = rgba(0, 0, 0);
const ctxOf = (store: ArtisanStore): ToolContext =>
  ({
    store,
    state: store.getState(),
    worldToScreen: (p) => p,
    screenToWorld: (p) => p,
    requestRender: () => {},
    zoom: 1,
    viewport: { width: 800, height: 600 },
  }) as ToolContext;
const ptr = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;

const closedFor = (store: ArtisanStore, id: string) =>
  (Query.getItem(store.getState().doc, id) as { geometry: { closed: boolean } }).geometry.closed;

describe("Scissors tool — integration", () => {
  it("clicking a filled closed path opens it (one item) and undo restores it", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const sq = makePath(
      { closed: true, anchors: [anchor({ x: 100, y: 100 }), anchor({ x: 300, y: 100 }), anchor({ x: 300, y: 300 }), anchor({ x: 100, y: 300 })] },
      { fill: solid(rgba(120, 160, 220)) },
    );
    doc.layers[0].items.push(sq);
    store.replaceDoc(doc, { markClean: true });
    const tool = createScissorsTool();

    tool.onPointerDown!(ptr(200, 105), ctxOf(store)); // just inside the top edge
    expect(store.getState().doc.layers[0].items.length).toBe(1);
    expect(closedFor(store, sq.id)).toBe(false); // opened

    store.undo();
    expect(closedFor(store, sq.id)).toBe(true); // restored
  });

  it("clicking a stroked open path splits it into two paths", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const line = makePath(
      { closed: false, anchors: [anchor({ x: 100, y: 200 }), anchor({ x: 300, y: 200 }), anchor({ x: 500, y: 200 })] },
      { fill: noPaint(), stroke: defaultStroke(solid(BLACK)) },
    );
    doc.layers[0].items.push(line);
    store.replaceDoc(doc, { markClean: true });
    const tool = createScissorsTool();

    tool.onPointerDown!(ptr(200, 200), ctxOf(store)); // on the first segment
    expect(store.getState().doc.layers[0].items.length).toBe(2);
    expect(store.getState().doc.layers[0].items.every((it) => it.type === "path" && !it.geometry.closed)).toBe(true);

    store.undo();
    expect(store.getState().doc.layers[0].items.length).toBe(1); // back to one path
  });

  it("clicking empty canvas does nothing", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    doc.layers[0].items.push(makePath({ closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 }), anchor({ x: 10, y: 10 })] }, { fill: solid(BLACK) }));
    store.replaceDoc(doc, { markClean: true });
    const tool = createScissorsTool();
    tool.onPointerDown!(ptr(600, 600), ctxOf(store)); // far from any item
    expect(store.canUndo).toBe(false); // nothing transacted
  });
});
