// ─────────────────────────────────────────────────────────────
// tools/transform-tools.test — interactive Rotate / Scale / Reflect (parity)
// ─────────────────────────────────────────────────────────────
// Drives the real transform tools against a live ArtisanStore. Reference: Adobe
// Illustrator Rotate (R) / Scale (S) / Reflect (O) — drag transforms the
// selection around a pivot (selection centre by default; a click without a drag
// sets a custom pivot); ALT-drag transforms a COPY, leaving the original.

import { describe, it, expect } from "vitest";
import { createTransformTool } from "./transform-tools";
import { ArtisanStore, makeDocument, makeRect, Query } from "../engine";
import type { ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number, alt = false): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt, mod: false, button: 0, detail: 1 }) as ToolPointer;

const setup = (rects: [number, number, number, number][]) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const items = rects.map(([x, y, w, h]) => makeRect(x, y, w, h));
  items.forEach((it) => doc.layers[0].items.push(it));
  store.replaceDoc(doc, { markClean: true });
  store.setSelection(items.map((it) => it.id));
  return { store, ids: items.map((it) => it.id) };
};
const bounds = (store: ArtisanStore, id: string) => Query.worldBounds(store.getState().doc, id)!;
const drag = (tool: ReturnType<typeof createTransformTool>, ctx: ToolContext, from: ToolPointer, to: ToolPointer) => {
  tool.onPointerDown!(from, ctx);
  tool.onPointerMove!(to, ctx);
  tool.onPointerUp!(to, ctx);
};

describe("interactive transform tools", () => {
  it("Rotate: dragging 90° around the selection centre swaps the bbox dims", () => {
    const { store, ids } = setup([[80, 90, 40, 20]]); // centre (100,100)
    const tool = createTransformTool("rotate");
    drag(tool, ctxOf(store), ptr(150, 100), ptr(100, 150)); // angle 0 → +90°
    const b = bounds(store, ids[0]);
    expect([Math.round(b.width), Math.round(b.height)]).toEqual([20, 40]);
    expect([Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)]).toEqual([100, 100]); // centre fixed
  });

  it("Scale: dragging from 1× to 2× distance doubles the bbox around the centre", () => {
    const { store, ids } = setup([[80, 90, 40, 20]]); // centre (100,100)
    const tool = createTransformTool("scale");
    drag(tool, ctxOf(store), ptr(150, 100), ptr(200, 100)); // dist 50 → 100 ⇒ ×2
    const b = bounds(store, ids[0]);
    expect([Math.round(b.width), Math.round(b.height)]).toEqual([80, 40]);
    expect([Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)]).toEqual([100, 100]);
  });

  it("Scale: dragging through the pivot flips the selection", () => {
    const { store, ids } = setup([[100, 40, 20, 20], [180, 40, 20, 20]]); // centre (150,50)
    const tool = createTransformTool("scale");
    drag(tool, ctxOf(store), ptr(250, 50), ptr(50, 50)); // +100 → −100 ⇒ −1
    const b = bounds(store, ids[0]);
    expect(Math.round(b.x + b.width / 2)).toBe(190); // left marker reflected to the right
  });

  it("Shear: dragging skews the selection (bbox widens, height + centre fixed)", () => {
    const { store, ids } = setup([[80, 90, 40, 20]]); // centre (100,100)
    const tool = createTransformTool("shear");
    drag(tool, ctxOf(store), ptr(150, 100), ptr(150, 150)); // sweep 0 → 45° around the pivot
    const b = bounds(store, ids[0]);
    expect(Math.round(b.width)).toBe(60); // 40 + tan(45°)·20
    expect(Math.round(b.height)).toBe(20); // unchanged
    expect([Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)]).toEqual([100, 100]); // centre fixed
  });

  it("Reflect: a horizontal axis through the centre swaps top↔bottom objects", () => {
    const { store, ids } = setup([[80, 60, 40, 20], [80, 140, 40, 20]]); // centre y = 110
    const [a, b] = ids;
    const tool = createTransformTool("reflect");
    drag(tool, ctxOf(store), ptr(150, 110), ptr(200, 110)); // axis angle 0 (horizontal)
    expect(Math.round(bounds(store, a).y)).toBe(140); // top rect → bottom
    expect(Math.round(bounds(store, b).y)).toBe(60); // bottom rect → top
  });

  it("a click without a drag sets a custom pivot used by the next rotate", () => {
    const { store, ids } = setup([[80, 90, 40, 20]]); // centre (100,100)
    const tool = createTransformTool("rotate");
    const ctx = ctxOf(store);
    // click (no move) at (50,50) → custom pivot
    tool.onPointerDown!(ptr(50, 50), ctx);
    tool.onPointerUp!(ptr(50, 50), ctx);
    // now rotate: centre should ORBIT the custom pivot (not stay fixed)
    drag(tool, ctx, ptr(150, 100), ptr(100, 150));
    const b = bounds(store, ids[0]);
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    expect(Math.round(cx) === 100 && Math.round(cy) === 100).toBe(false); // centre moved
    // distance from the custom pivot is preserved by a pure rotation
    expect(Math.hypot(cx - 50, cy - 50)).toBeCloseTo(Math.hypot(100 - 50, 100 - 50), 3);
  });

  it("Alt-drag leaves the original and transforms a selected COPY (undoable)", () => {
    const { store, ids } = setup([[80, 90, 40, 20]]); // centre (100,100)
    const tool = createTransformTool("rotate");
    const ctx = ctxOf(store);
    tool.onPointerDown!(ptr(150, 100, true), ctx);
    tool.onPointerMove!(ptr(100, 150, true), ctx); // alt → duplicate + rotate the copy
    tool.onPointerUp!(ptr(100, 150, true), ctx);

    const items = store.getState().doc.layers[0].items;
    expect(items.length).toBe(2);
    const original = bounds(store, ids[0]);
    expect([Math.round(original.width), Math.round(original.height)]).toEqual([40, 20]); // untouched
    const copyId = items.find((it) => it.id !== ids[0])!.id;
    const copy = bounds(store, copyId);
    expect([Math.round(copy.width), Math.round(copy.height)]).toEqual([20, 40]); // rotated 90°
    expect(store.getState().selection).toEqual([copyId]); // copy selected

    store.undo();
    expect(store.getState().doc.layers[0].items.length).toBe(1); // copy removed
  });
});
