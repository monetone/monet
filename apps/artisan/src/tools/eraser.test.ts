// ─────────────────────────────────────────────────────────────
// tools/eraser.test — the Eraser tool (drag to boolean-subtract a swept region)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Eraser — drag over artwork and the swept brush
// area is erased; dragging through the middle of a filled shape SPLITS it into
// two pieces. The shape's area drops by the erased amount; missing all art is a
// no-op. One undoable step. (Brush ≈ 12px diameter at zoom 1 here.)

import { describe, it, expect } from "vitest";
import { createEraserTool } from "./eraser";
import { ArtisanStore, makeDocument, makeRect, solid, rgba, type Item } from "../engine";
import type { Tool, ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;

const ringArea = (anchors: { point: { x: number; y: number } }[]): number => {
  let a = 0;
  for (let i = 0, n = anchors.length; i < n; i++) {
    const p = anchors[i].point, q = anchors[(i + 1) % n].point;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
};
const itemArea = (it: Item): number => {
  if (it.type === "rect") return it.width * it.height;
  if (it.type === "path") return ringArea(it.geometry.anchors);
  if (it.type === "compound") return it.subpaths.reduce((s, sp) => s + ringArea(sp.anchors), 0);
  return 0;
};
const items = (store: ArtisanStore) => store.getState().doc.layers[0].items;

const drag = (tool: Tool, ctx: ToolContext, pts: Array<[number, number]>) => {
  tool.onPointerDown!(ptr(pts[0][0], pts[0][1]), ctx);
  for (let i = 1; i < pts.length; i++) tool.onPointerMove!(ptr(pts[i][0], pts[i][1]), ctx);
  tool.onPointerUp!(ptr(pts[pts.length - 1][0], pts[pts.length - 1][1]), ctx);
};
// a dense horizontal sweep across y so the 12px brush squares overlap into a channel
const sweepY = (y: number, x0 = -12, x1 = 116, step = 8): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let x = x0; x <= x1; x += step) out.push([x, y]);
  return out;
};

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(rgba(220, 0, 0)) }); // [0,100]² area 10000
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  return { store, rect: r };
};

describe("Eraser tool", () => {
  it("dragging across the middle erases a channel and reduces the filled area", () => {
    const { store } = setup();
    drag(createEraserTool(), ctxOf(store), sweepY(50));
    const after = items(store);
    expect(after).toHaveLength(1);
    const area = itemArea(after[0]);
    // removed a full-width 100×12 strip → 10000 − 1200 ≈ 8800
    expect(area).toBeLessThan(10000);
    expect(Math.abs(area - 8800)).toBeLessThan(40);
  });

  it("erasing through the middle SPLITS the shape into two separated pieces", () => {
    const { store } = setup();
    drag(createEraserTool(), ctxOf(store), sweepY(50));
    const comp = items(store)[0];
    expect(comp.type).toBe("compound");
    if (comp.type !== "compound") throw new Error("expected a compound");
    expect(comp.subpaths).toHaveLength(2); // top + bottom
    // the two pieces are vertically disjoint across the erased band (y 44..56)
    const yrange = (sp: { anchors: { point: { y: number } }[] }) => {
      const ys = sp.anchors.map((a) => a.point.y);
      return [Math.min(...ys), Math.max(...ys)];
    };
    const ranges = comp.subpaths.map(yrange).sort((a, b) => a[0] - b[0]);
    expect(ranges[0][1]).toBeLessThanOrEqual(45); // top piece ends by the band top
    expect(ranges[1][0]).toBeGreaterThanOrEqual(55); // bottom piece starts after the band
  });

  it("replaces the shape with one compound keeping its fill; one undoable step", () => {
    const { store, rect } = setup();
    drag(createEraserTool(), ctxOf(store), sweepY(50));
    const comp = items(store)[0];
    expect(items(store).find((i) => i.id === rect.id)).toBeUndefined(); // original gone
    expect(comp.fill).toEqual(rect.fill); // appearance preserved

    store.undo();
    expect(items(store)).toHaveLength(1);
    expect(items(store)[0].id).toBe(rect.id); // rect restored
    expect(itemArea(items(store)[0])).toBeCloseTo(10000, 0);
  });

  it("a sweep that misses all art is a no-op", () => {
    const { store } = setup();
    drag(createEraserTool(), ctxOf(store), sweepY(500)); // well below the rect
    expect(items(store)).toHaveLength(1);
    expect(itemArea(items(store)[0])).toBeCloseTo(10000, 0);
    expect(store.canUndo).toBe(false);
  });
});
