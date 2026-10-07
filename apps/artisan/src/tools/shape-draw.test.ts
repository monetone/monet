// ─────────────────────────────────────────────────────────────
// tools/shape-draw.test — shape tools' drag geometry + modifiers
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Rectangle/Ellipse — drag sets the bounding box
// corner-to-corner; SHIFT constrains to a square/circle; ALT draws from the
// center; Shift+Alt is a centered square. Polygon/Star radius = drag distance
// from the center. A click with no drag makes a default-sized shape. One undo.

import { describe, it, expect } from "vitest";
import { createShapeTool, shapeOptions, type ShapeKind } from "./shapes";
import { ArtisanStore, makeDocument, Shapes, type Item } from "../engine";
import type { ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number, o: { shift?: boolean; alt?: boolean } = {}): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: !!o.shift, alt: !!o.alt, mod: false, button: 0, detail: 1 }) as ToolPointer;

const dims = (it: Item): { w: number; h: number } => {
  if (it.type === "rect" || it.type === "ellipse" || it.type === "image") return { w: it.width, h: it.height };
  throw new Error(`no width/height on ${it.type}`);
};

const draw = (kind: ShapeKind, start: [number, number], end: [number, number] | null, o: { shift?: boolean; alt?: boolean } = {}) => {
  const store = new ArtisanStore();
  store.replaceDoc(makeDocument(), { markClean: true });
  const tool = createShapeTool(kind);
  const ctx = ctxOf(store);
  tool.onPointerDown!(ptr(start[0], start[1]), ctx);
  if (end) tool.onPointerMove!(ptr(end[0], end[1], o), ctx);
  const last = end ?? start;
  tool.onPointerUp!(ptr(last[0], last[1], o), ctx);
  return { store, get item() { return store.getState().doc.layers[0].items[0]; } };
};

describe("Shape tools — drag geometry & modifiers", () => {
  it("rect drag sets the bounding box corner-to-corner", () => {
    const r = draw("rect", [10, 20], [110, 80]).item;
    expect(r.type).toBe("rect");
    expect(dims(r)).toEqual({ w: 100, h: 60 });
    expect(r.transform.e).toBe(10); // min-corner origin
    expect(r.transform.f).toBe(20);
  });

  it("Shift constrains a rect to a SQUARE (max of the two sides)", () => {
    const r = draw("rect", [0, 0], [100, 40], { shift: true }).item;
    expect(dims(r)).toEqual({ w: 100, h: 100 });
  });

  it("Alt draws a rect from the CENTER", () => {
    const r = draw("rect", [50, 50], [100, 80], { alt: true }).item;
    const { w, h } = dims(r);
    expect(w).toBe(100); // 2×|Δx|
    expect(h).toBe(60); // 2×|Δy|
    expect(r.transform.e + w / 2).toBeCloseTo(50, 6); // centered on the start point
    expect(r.transform.f + h / 2).toBeCloseTo(50, 6);
  });

  it("Shift+Alt makes a centered SQUARE", () => {
    const r = draw("rect", [50, 50], [100, 80], { shift: true, alt: true }).item;
    const { w, h } = dims(r);
    expect(w).toBe(100);
    expect(h).toBe(100);
    expect(r.transform.e + w / 2).toBeCloseTo(50, 6);
    expect(r.transform.f + h / 2).toBeCloseTo(50, 6);
  });

  it("Shift+Alt sizes a centered square from a vertical-dominant drag", () => {
    const r = draw("rect", [100, 100], [110, 200], { shift: true, alt: true }).item;
    expect(dims(r)).toEqual({ w: 200, h: 200 });
    expect(r.transform.e).toBe(0);
    expect(r.transform.f).toBe(0);
  });

  it("ellipse drag sizes its bounding box like a rect", () => {
    const e = draw("ellipse", [0, 0], [80, 40]).item;
    expect(e.type).toBe("ellipse");
    expect(dims(e)).toEqual({ w: 80, h: 40 });
  });

  it("polygon radius = drag distance from the center (start)", () => {
    const p = draw("polygon", [100, 100], [100, 150]).item; // 50px down
    expect(p.type).toBe("polygon");
    if (p.type !== "polygon") throw new Error("expected polygon");
    expect(p.radius).toBeCloseTo(50, 6);
  });

  it("a click with no drag makes a default-sized shape", () => {
    const r = draw("rect", [10, 10], null).item;
    expect(dims(r)).toEqual({ w: 100, h: 100 });
  });

  it("drawing a shape is one undoable step", () => {
    const { store } = draw("rect", [10, 20], [110, 80]);
    expect(store.getState().doc.layers[0].items).toHaveLength(1);
    store.undo();
    expect(store.getState().doc.layers[0].items).toHaveLength(0);
  });

  it("the Rounded Rectangle tool draws with the configured corner radius (rounded corners)", () => {
    const r = draw("rounded-rect", [0, 0], [100, 80]).item;
    expect(r.type).toBe("rect");
    if (r.type !== "rect") throw new Error("expected a rect");
    expect(r.rx).toBe(shapeOptions.cornerRadius); // 12 by default
    expect(r.ry).toBe(shapeOptions.cornerRadius);
    expect(dims(r)).toEqual({ w: 100, h: 80 });
    // rounded → each corner becomes 2 anchors (8), vs 4 for a sharp rect
    expect(Shapes.localPaths(r)[0].anchors).toHaveLength(8);
  });

  it("a sharp rect has 4 corner anchors (contrast)", () => {
    const r = draw("rect", [0, 0], [100, 80]).item;
    if (r.type !== "rect") throw new Error("expected a rect");
    expect(r.rx).toBe(0);
    expect(Shapes.localPaths(r)[0].anchors).toHaveLength(4);
  });
});
