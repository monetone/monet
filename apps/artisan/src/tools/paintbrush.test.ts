// ─────────────────────────────────────────────────────────────
// tools/paintbrush.test — Paintbrush as a CALLIGRAPHIC brush
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Calligraphic Brush — a fixed-angle "nib" whose
// stroke width depends on the drawing DIRECTION: thin when the drag runs along
// the nib axis, full width when it crosses the nib. Our tool offsets the drag
// centerline by a fixed nib vector (−45°) into a closed FILLED ribbon painted
// with the current brush (stroke) color, no stroke. One undoable step.

import { describe, it, expect } from "vitest";
import { createPaintbrushTool } from "./paintbrush";
import { ArtisanStore, Ops, makeDocument, Query, type PathItem } from "../engine";
import type { Tool, ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;

const paths = (store: ArtisanStore): PathItem[] =>
  store.getState().doc.layers.flatMap((l) => l.items).filter((it): it is PathItem => it.type === "path");
const geomOf = (store: ArtisanStore, id: string) => (Query.getItem(store.getState().doc, id) as PathItem).geometry;
// shoelace area of a closed polygon of anchors
const ribbonArea = (store: ArtisanStore, id: string) => {
  const a = geomOf(store, id).anchors.map((an) => an.point);
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const j = (i + 1) % a.length;
    s += a[i].x * a[j].y - a[j].x * a[i].y;
  }
  return Math.abs(s) / 2;
};

const drag = (tool: Tool, ctx: ToolContext, pts: Array<[number, number]>) => {
  tool.onPointerDown!(ptr(pts[0][0], pts[0][1]), ctx);
  for (let i = 1; i < pts.length; i++) tool.onPointerMove!(ptr(pts[i][0], pts[i][1]), ctx);
  tool.onPointerUp!(ptr(pts[pts.length - 1][0], pts[pts.length - 1][1]), ctx);
};
const setup = () => {
  const store = new ArtisanStore();
  store.replaceDoc(makeDocument(), { markClean: true });
  return store;
};
const HALF_W = 5; // 5 / zoom(1)
const NIB = Math.PI / 4; // offset direction = NIB_ANGLE + π/2 = −π/4 + π/2

describe("Paintbrush tool — calligraphic ribbon", () => {
  it("a drag makes a closed FILLED ribbon in the brush color, no stroke", () => {
    const store = setup();
    drag(createPaintbrushTool(), ctxOf(store), [[0, 0], [50, 0], [100, 0]]);

    const p = paths(store);
    expect(p).toHaveLength(1);
    expect(p[0].geometry.closed).toBe(true);
    expect(p[0].fill.type).toBe("solid"); // default brush/stroke color
    expect(p[0].stroke.paint.type).toBe("none");
    // ribbon = left edge + right edge → twice the centerline point count (3 → 6)
    expect(p[0].geometry.anchors).toHaveLength(6);
    expect(store.getState().selection).toEqual([p[0].id]);
  });

  it("offsets the centerline by the fixed nib vector (±halfW at the nib angle)", () => {
    const store = setup();
    drag(createPaintbrushTool(), ctxOf(store), [[0, 0], [20, 0]]);
    const a = geomOf(store, paths(store)[0].id).anchors;
    // left[0] = centerline(0,0) + nib offset
    expect(a[0].point.x).toBeCloseTo(HALF_W * Math.cos(NIB), 5);
    expect(a[0].point.y).toBeCloseTo(HALF_W * Math.sin(NIB), 5);
  });

  it("is CALLIGRAPHIC — a cross-nib stroke is far wider than an along-nib stroke", () => {
    // along the nib axis (45°): the offset is parallel to motion → ribbon collapses
    const along = setup();
    drag(createPaintbrushTool(), ctxOf(along), [[0, 0], [40, 40]]);
    const areaAlong = ribbonArea(along, paths(along)[0].id);

    // across the nib (−45°): offset ⟂ motion → full-width band
    const across = setup();
    drag(createPaintbrushTool(), ctxOf(across), [[0, 0], [40, -40]]);
    const areaAcross = ribbonArea(across, paths(across)[0].id);

    expect(areaAlong).toBeLessThan(1); // ~degenerate (thin)
    expect(areaAcross).toBeGreaterThan(100); // wide band
  });

  it("a too-short drag draws nothing", () => {
    const store = setup();
    const tool = createPaintbrushTool();
    const ctx = ctxOf(store);
    tool.onPointerDown!(ptr(5, 5), ctx);
    tool.onPointerUp!(ptr(5, 5), ctx);
    expect(paths(store)).toHaveLength(0);
    expect(store.canUndo).toBe(false);
  });

  it("uses the active Brushes panel calligraphic settings", () => {
    const store = setup();
    const brushId = store.getState().activeBrushId!;
    store.transact("Edit Brush", (doc) => {
      Ops.Brushes.updateCalligraphicBrush(doc, brushId, { name: "Wide vertical nib", size: 20, angle: 0, roundness: 1 });
    });

    drag(createPaintbrushTool(), ctxOf(store), [[0, 0], [20, 0]]);

    const p = paths(store)[0];
    const a = p.geometry.anchors;
    expect(p.name).toBe("Wide vertical nib");
    expect(p.brush).toMatchObject({
      brushId,
      brushName: "Wide vertical nib",
      expanded: true,
      settings: { size: 20, angle: 0, roundness: 1, paintSource: "stroke" },
    });
    expect(a[0].point.x).toBeCloseTo(0, 5);
    expect(a[0].point.y).toBeCloseTo(10, 5);
  });

  it("is one undoable step — undo removes the brush stroke", () => {
    const store = setup();
    drag(createPaintbrushTool(), ctxOf(store), [[0, 0], [50, 0], [100, 0]]);
    expect(paths(store)).toHaveLength(1);
    store.undo();
    expect(paths(store)).toHaveLength(0);
  });
});
