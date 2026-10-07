import { describe, expect, it } from "vitest";
import { ArtisanStore, makeDocument, makeRect, Query, rgba, solid, type Item } from "../engine";
import { createFreeTransformTool } from "./free-transform";
import { getTool, hasTool } from "./registry";
import type { ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;

const ptr = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;

const bounds = (store: ArtisanStore, id: string) => Query.selectionBounds(store.getState().doc, [id])!;

const setup = (rect: Item) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  doc.layers[0].items.push(rect);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([rect.id]);
  return { store, id: rect.id };
};

const square = () => makeRect(0, 0, 100, 100, 0, 0, { fill: solid(rgba(220, 0, 0)) });

describe("Free Transform tool", () => {
  it("is registered under its own tool id", () => {
    expect(hasTool("free-transform")).toBe(true);
    expect(getTool("free-transform").id).toBe("free-transform");
  });

  it("scales selected artwork through the bounding-box handle path", () => {
    const { store, id } = setup(square());
    const tool = createFreeTransformTool();
    const ctx = ctxOf(store);

    tool.onPointerDown!(ptr(100, 100), ctx);
    tool.onPointerMove!(ptr(150, 150), ctx);
    tool.onPointerUp!(ptr(150, 150), ctx);

    const b = bounds(store, id);
    expect(b.x).toBeCloseTo(0, 4);
    expect(b.y).toBeCloseTo(0, 4);
    expect(b.width).toBeCloseTo(150, 4);
    expect(b.height).toBeCloseTo(150, 4);

    store.undo();
    expect(bounds(store, id).width).toBeCloseTo(100, 4);
  });
});
