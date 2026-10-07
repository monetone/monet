// ─────────────────────────────────────────────────────────────
// tools/selection-handle-visibility.test — invisible handles must not grab
// ─────────────────────────────────────────────────────────────
// canvas-view only DRAWS the bounding-box handles when the selection tool is
// active and none of Hide Edges / Hide Bounding Box / Trim View is on. The
// selection tool hit-tested them whenever anything was selected, so in those
// modes an invisible handle still captured the drag and scaled or rotated
// artwork the user meant to click past.

import { describe, it, expect } from "vitest";
import { createSelectionTool } from "./selection";
import { ArtisanStore, makeDocument, makeRect, Query, solid, rgba } from "../engine";
import type { ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(100, 100, 100, 100, 0, 0, { fill: solid(rgba(200, 30, 30)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const boundsOf = (store: ArtisanStore, id: string) => JSON.stringify(Query.worldBounds(store.getState().doc, id));

// Just OUTSIDE the rect's bottom-right corner: within the handle's 7px pick
// radius (tools/handles.ts:63) but off the artwork, so with handles gated off
// this is an empty-canvas drag — a marquee — and must change nothing.
const HANDLE_ONLY = { x: 204, y: 204 };

const dragCorner = (store: ArtisanStore) => {
  const tool = createSelectionTool();
  const ctx = ctxOf(store);
  tool.onPointerDown!(ptr(HANDLE_ONLY.x, HANDLE_ONLY.y), ctx);
  tool.onPointerMove!(ptr(300, 300), ctx);
  tool.onPointerUp!(ptr(300, 300), ctx);
};

describe("bounding-box handles", () => {
  it("scale the selection when they are visible", () => {
    const { store, r } = setup();
    const before = boundsOf(store, r.id);
    dragCorner(store);
    expect(boundsOf(store, r.id)).not.toBe(before);
  });

  for (const [label, apply] of [
    ["Hide Edges (⌘H)", (s: ArtisanStore) => s.setHideEdges(true)],
    ["Hide Bounding Box (⇧⌘B)", (s: ArtisanStore) => s.setShowBoundingBox(false)],
    ["Trim View", (s: ArtisanStore) => s.setTrimView(true)],
  ] as const) {
    it(`do not grab the drag under ${label}`, () => {
      const { store, r } = setup();
      apply(store);
      const before = boundsOf(store, r.id);
      dragCorner(store);
      expect(boundsOf(store, r.id), "the artwork must not be scaled by an invisible handle").toBe(before);
    });
  }
});
