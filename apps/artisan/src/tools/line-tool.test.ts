// ─────────────────────────────────────────────────────────────
// tools/line-tool.test — the Line Segment tool (\)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Line Segment tool — drag draws a straight line
// from the press point to the cursor; SHIFT constrains the angle to 45°
// increments (keeping the dragged LENGTH). A line is stroke-only (no fill).

import { describe, it, expect } from "vitest";
import { createShapeTool } from "./shapes";
import { ArtisanStore, makeDocument, type LineItem } from "../engine";
import type { ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number, o: { shift?: boolean } = {}): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: !!o.shift, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;

const drawLine = (start: [number, number], end: [number, number], shift = false) => {
  const store = new ArtisanStore();
  store.replaceDoc(makeDocument(), { markClean: true });
  const tool = createShapeTool("line");
  const ctx = ctxOf(store);
  tool.onPointerDown!(ptr(start[0], start[1]), ctx);
  tool.onPointerMove!(ptr(end[0], end[1], { shift }), ctx);
  tool.onPointerUp!(ptr(end[0], end[1], { shift }), ctx);
  return { store, line: store.getState().doc.layers[0].items[0] as LineItem };
};

describe("Line Segment tool", () => {
  it("drag draws the line from the press point to the cursor (no fill)", () => {
    const { line } = drawLine([100, 100], [300, 200]);
    expect(line.type).toBe("line");
    expect(line.x1).toBe(0);
    expect(line.y1).toBe(0);
    expect(line.x2).toBe(200); // local end = drag delta
    expect(line.y2).toBe(100);
    expect(line.transform.e).toBe(100); // origin at the press point
    expect(line.transform.f).toBe(100);
    expect(line.fill.type).toBe("none");
  });

  it("Shift constrains a ~45° drag to exactly 45° (length preserved)", () => {
    const { line } = drawLine([100, 100], [300, 210], true); // raw ≈28.8° → snaps to 45°
    expect(line.x2).toBeCloseTo(line.y2, 4); // 45° → equal components
    expect(Math.hypot(line.x2, line.y2)).toBeCloseTo(Math.hypot(200, 110), 4); // length kept
  });

  it("Shift constrains a shallow drag to horizontal (0°)", () => {
    const { line } = drawLine([100, 100], [300, 150], true); // raw ≈14° → snaps to 0°
    expect(line.y2).toBeCloseTo(0, 6);
    expect(line.x2).toBeCloseTo(Math.hypot(200, 50), 4); // length along the axis
  });

  it("is one undoable step", () => {
    const { store } = drawLine([100, 100], [300, 200]);
    expect(store.getState().doc.layers[0].items).toHaveLength(1);
    store.undo();
    expect(store.getState().doc.layers[0].items).toHaveLength(0);
  });
});
