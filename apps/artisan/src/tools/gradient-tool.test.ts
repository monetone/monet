import { describe, expect, it } from "vitest";
import { ArtisanStore, makeDocument, makeRect, paintedFill, Query, radialGradient, rgba, solid } from "../engine";
import { createGradientTool } from "./gradient-tool";
import type { ToolContext, ToolPointer } from "./types";

const pointer = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, button: 0 }) as ToolPointer;

describe("Gradient tool", () => {
  it("updates the visible fill in an appearance stack", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const item = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(rgba(220, 0, 0)) });
    item.appearance = {
      entries: [
        { id: "bottom", kind: "fill", paint: solid(rgba(220, 0, 0)) },
        { id: "top", kind: "fill", paint: solid(rgba(0, 0, 220)) },
      ],
    };
    doc.layers[0].items.push(item);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([item.id]);
    const ctx = { store, zoom: 1 } as ToolContext;
    const tool = createGradientTool();

    tool.onPointerDown!(pointer(0, 50), ctx);
    tool.onPointerMove!(pointer(100, 50), ctx);
    tool.onPointerUp!(pointer(100, 50), ctx);

    const fill = paintedFill(Query.getItem(store.doc, item.id)!);
    expect(fill.type).toBe("gradient");
    if (fill.type === "gradient") expect(fill.gradient.stops[0].color).toEqual(rgba(0, 0, 220));
    store.undo();
    expect(paintedFill(Query.getItem(store.doc, item.id)!)).toEqual(solid(rgba(0, 0, 220)));
  });

  it("re-aims an existing radial gradient through an Immer transaction", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const item = makeRect(0, 0, 100, 100, 0, 0, { fill: radialGradient() });
    doc.layers[0].items.push(item);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([item.id]);
    const ctx = { store, zoom: 1 } as ToolContext;
    const tool = createGradientTool();

    tool.onPointerDown!(pointer(10, 20), ctx);
    tool.onPointerMove!(pointer(70, 80), ctx);
    tool.onPointerUp!(pointer(70, 80), ctx);

    const fill = paintedFill(Query.getItem(store.doc, item.id)!);
    expect(fill.type).toBe("gradient");
    if (fill.type === "gradient") {
      expect([fill.gradient.cx, fill.gradient.cy, fill.gradient.fx, fill.gradient.fy]).toEqual([0.1, 0.2, 0.1, 0.2]);
      expect(fill.gradient.r).toBeCloseTo(Math.hypot(0.6, 0.6), 6);
    }
  });
});
