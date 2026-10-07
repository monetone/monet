// ─────────────────────────────────────────────────────────────
// tools/pencil.test — the Pencil (N) tool: freehand → smoothed bezier path
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Pencil — drag to draw a freeform path that
// follows the cursor; on release the raw input is SIMPLIFIED (Fidelity: points
// closer together than a tolerance are dropped) and converted to a SMOOTH bezier
// curve (anchors gain handles). A too-short drag draws nothing. Uses the current
// stroke, no fill. Drawing is ONE undoable step.

import { describe, it, expect } from "vitest";
import { createPencilTool } from "./freehand";
import { ArtisanStore, makeDocument, Query, type PathItem } from "../engine";
import type { Tool, ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;

const paths = (store: ArtisanStore): PathItem[] =>
  store.getState().doc.layers.flatMap((l) => l.items).filter((it): it is PathItem => it.type === "path");
const geomOf = (store: ArtisanStore, id: string) => (Query.getItem(store.getState().doc, id) as PathItem).geometry;

const drag = (tool: Tool, ctx: ToolContext, pts: Array<[number, number]>) => {
  tool.onPointerDown!(ptr(pts[0][0], pts[0][1]), ctx);
  for (let i = 1; i < pts.length; i++) tool.onPointerMove!(ptr(pts[i][0], pts[i][1]), ctx);
  const last = pts[pts.length - 1];
  tool.onPointerUp!(ptr(last[0], last[1]), ctx);
};

const setup = () => {
  const store = new ArtisanStore();
  store.replaceDoc(makeDocument(), { markClean: true });
  return store;
};

describe("Pencil tool — freehand smoothed path", () => {
  it("a freehand drag creates an open path that follows the cursor (current stroke, no fill)", () => {
    const store = setup();
    const tool = createPencilTool();
    drag(tool, ctxOf(store), [[0, 0], [10, 0], [20, 10], [30, 0]]);

    const p = paths(store);
    expect(p).toHaveLength(1);
    expect(p[0].geometry.closed).toBe(false);
    expect(p[0].fill.type).toBe("none");
    const a = p[0].geometry.anchors;
    expect(a.length).toBeGreaterThanOrEqual(2);
    expect(a[0].point).toEqual({ x: 0, y: 0 }); // starts at the drag start
    expect(a[a.length - 1].point).toEqual({ x: 30, y: 0 }); // ends at the drag end
    expect(store.getState().selection).toEqual([p[0].id]);
  });

  it("is a raw polyline DURING the drag, then SMOOTHS into beziers on release", () => {
    const store = setup();
    const tool = createPencilTool();
    const ctx = ctxOf(store);
    tool.onPointerDown!(ptr(0, 0), ctx);
    tool.onPointerMove!(ptr(10, 0), ctx);
    tool.onPointerMove!(ptr(20, 10), ctx);
    tool.onPointerMove!(ptr(30, 0), ctx);

    // mid-drag: live preview is a corner polyline (no handles yet)
    const mid = geomOf(store, paths(store)[0].id);
    const anyHandleMid = mid.anchors.some((an) => an.handleOut.x || an.handleOut.y || an.handleIn.x || an.handleIn.y);
    expect(anyHandleMid).toBeFalsy();

    tool.onPointerUp!(ptr(30, 0), ctx);
    // on release: Catmull-Rom tangents → handleOut = (next-prev)/6
    const done = geomOf(store, paths(store)[0].id);
    expect(done.anchors[1].handleOut.x).toBeCloseTo((20 - 0) / 6, 6); // prev=(0,0), next=(20,10)
    expect(done.anchors[1].handleOut.y).toBeCloseTo((10 - 0) / 6, 6);
    expect(done.anchors[1].handleIn.x).toBeCloseTo(-(20 - 0) / 6, 6);
  });

  it("decimates closely-spaced points (Fidelity) — fewer anchors than raw input", () => {
    const store = setup();
    const tool = createPencilTool();
    // 6 raw points 2px apart; decimate at 3px keeps every other (+ the last) → 4
    drag(tool, ctxOf(store), [[0, 0], [2, 0], [4, 0], [6, 0], [8, 0], [10, 0]]);
    const a = geomOf(store, paths(store)[0].id).anchors;
    expect(a.length).toBe(4);
    expect(a.length).toBeLessThan(6); // simplified vs raw
  });

  it("a too-short drag draws nothing (Illustrator discards it)", () => {
    const store = setup();
    const tool = createPencilTool();
    const ctx = ctxOf(store);
    tool.onPointerDown!(ptr(5, 5), ctx);
    tool.onPointerUp!(ptr(5, 5), ctx); // no movement → <2 points
    expect(paths(store)).toHaveLength(0);
    expect(store.canUndo).toBe(false);
  });

  it("is one undoable step — undo removes the whole stroke", () => {
    const store = setup();
    const tool = createPencilTool();
    drag(tool, ctxOf(store), [[0, 0], [10, 0], [20, 10], [30, 0]]);
    expect(paths(store)).toHaveLength(1);
    store.undo();
    expect(paths(store)).toHaveLength(0);
  });
});
