import { describe, expect, it } from "vitest";
import { ArtisanStore, Query, defaultStroke, makeDocument, makeRect, noPaint, paintedFill, rgba, solid } from "../engine";
import { createEyedropperTool } from "./eyedropper";
import type { ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;

describe("Eyedropper tool", () => {
  it("samples and transfers the visible appearance stack", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const red = solid(rgba(220, 0, 0));
    const blue = solid(rgba(0, 0, 220));
    const source = makeRect(0, 0, 40, 40, 0, 0, { fill: red });
    source.appearance = { entries: [
      { id: "bottom", kind: "fill", paint: red },
      { id: "top", kind: "fill", paint: blue },
      { id: "stroke", kind: "stroke", stroke: { ...defaultStroke(red), width: 8 } },
    ] };
    const target = makeRect(60, 0, 40, 40, 0, 0, { fill: noPaint() });
    doc.layers[0].items.push(source, target);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([target.id]);

    createEyedropperTool().onPointerDown!(ptr(20, 20), ctxOf(store));

    const after = Query.getItem(store.doc, target.id)!;
    expect(after.appearance).toEqual(source.appearance);
    expect(paintedFill(after)).toEqual(blue);
    expect(store.getState().fill).toEqual(blue);
  });
});
