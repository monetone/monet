// ─────────────────────────────────────────────────────────────
// tools/area-type.test — Area Type tool (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Area Type — click a shape and text WRAPS inside it. Our
// implementation uses the clicked shape's world bounds as a wrapping text box
// (rendered via SVG <foreignObject>) and consumes the original shape. Creating
// it is ONE undoable step.

import { describe, it, expect } from "vitest";
import { createAreaTypeTool } from "./area-type";
import { ArtisanStore, makeDocument, makeRect, Mat, solid, rgba, type TextItem, type Document } from "../engine";
import type { ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;

const texts = (store: ArtisanStore): TextItem[] =>
  store.getState().doc.layers.flatMap((l) => l.items).filter((it): it is TextItem => it.type === "text");

const setup = (build?: (d: Document) => void) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  build?.(doc);
  store.replaceDoc(doc, { markClean: true });
  return store;
};

describe("Area Type tool", () => {
  it("clicking a shape makes a wrapping text box of its bounds + consumes the shape", () => {
    const rect = makeRect(100, 200, 200, 100, 0, 0, { fill: solid(rgba(80, 120, 200)) });
    const store = setup((d) => d.layers[0].items.push(rect));
    createAreaTypeTool().onPointerDown!(ptr(200, 250), ctxOf(store));

    const items = store.getState().doc.layers[0].items;
    expect(items.find((i) => i.id === rect.id)).toBeUndefined(); // shape consumed
    const t = texts(store);
    expect(t).toHaveLength(1);
    expect(t[0].boxWidth).toBe(200); // = shape bounds
    expect(t[0].boxHeight).toBe(100);
    expect(t[0].name).toBe("Area Type");
    expect(Mat.applyToPoint(t[0].transform, { x: 0, y: 0 })).toEqual({ x: 100, y: 200 }); // box origin at bounds
    expect(store.getState().selection).toEqual([t[0].id]);
  });

  it("is one undoable step — undo restores the original shape", () => {
    const rect = makeRect(100, 200, 200, 100, 0, 0, { fill: solid(rgba(80, 120, 200)) });
    const store = setup((d) => d.layers[0].items.push(rect));
    createAreaTypeTool().onPointerDown!(ptr(200, 250), ctxOf(store));
    expect(texts(store)).toHaveLength(1);

    store.undo();
    const items = store.getState().doc.layers[0].items;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(rect.id);
    expect(texts(store)).toHaveLength(0);
  });

  it("clicking empty canvas is a no-op", () => {
    const rect = makeRect(100, 200, 200, 100, 0, 0, { fill: solid(rgba(80, 120, 200)) });
    const store = setup((d) => d.layers[0].items.push(rect));
    createAreaTypeTool().onPointerDown!(ptr(600, 600), ctxOf(store));
    expect(texts(store)).toHaveLength(0);
    expect(store.canUndo).toBe(false);
  });
});
