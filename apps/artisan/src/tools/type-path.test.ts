// ─────────────────────────────────────────────────────────────
// tools/type-path.test — Type on a Path tool (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Type on a Path — click a path with the tool and text flows
// ALONG that path's outline. Our implementation bakes the clicked shape's
// WORLD-space outline into the text item's `pathD` (rendered via SVG <textPath>)
// and consumes the original path. Creating it is ONE undoable step.

import { describe, it, expect } from "vitest";
import { createTypeOnPathTool } from "./type-path";
import { ArtisanStore, makeDocument, makeRect, Shapes, Path, solid, rgba, type TextItem, type Document } from "../engine";
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

describe("Type on a Path tool", () => {
  it("clicking a path flows text along it and consumes the original", () => {
    const rect = makeRect(100, 200, 200, 100, 0, 0, { fill: solid(rgba(200, 80, 80)) });
    const store = setup((d) => d.layers[0].items.push(rect));
    const tool = createTypeOnPathTool();
    tool.onPointerDown!(ptr(200, 250), ctxOf(store)); // inside the rect

    const items = store.getState().doc.layers[0].items;
    expect(items.find((i) => i.id === rect.id)).toBeUndefined(); // original consumed
    const t = texts(store);
    expect(t).toHaveLength(1);
    expect(t[0].text).toBe("Type on a path");
    expect(t[0].fontSize).toBe(32);
    expect(t[0].pathD).toBeTruthy();
    expect(store.getState().selection).toEqual([t[0].id]);
  });

  it("bakes the source path's WORLD geometry into pathD", () => {
    const rect = makeRect(100, 200, 200, 100, 0, 0, { fill: solid(rgba(200, 80, 80)) });
    const store = setup((d) => d.layers[0].items.push(rect));
    createTypeOnPathTool().onPointerDown!(ptr(200, 250), ctxOf(store));
    // worldTransformAt(top-level) == its own transform; pathD = that baked outline
    const expected = Path.toSVGPath(Path.transform(Shapes.localPaths(rect)[0], rect.transform));
    expect(texts(store)[0].pathD).toBe(expected);
    // the baked path is offset to world space (origin moved from local 0,0)
    expect(expected).toContain("100");
  });

  it("is one undoable step — undo restores the original path", () => {
    const rect = makeRect(100, 200, 200, 100, 0, 0, { fill: solid(rgba(200, 80, 80)) });
    const store = setup((d) => d.layers[0].items.push(rect));
    createTypeOnPathTool().onPointerDown!(ptr(200, 250), ctxOf(store));
    expect(texts(store)).toHaveLength(1);

    store.undo();
    const items = store.getState().doc.layers[0].items;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(rect.id); // path back
    expect(texts(store)).toHaveLength(0);
  });

  it("clicking empty canvas is a no-op (no text, no transaction)", () => {
    const rect = makeRect(100, 200, 200, 100, 0, 0, { fill: solid(rgba(200, 80, 80)) });
    const store = setup((d) => d.layers[0].items.push(rect));
    createTypeOnPathTool().onPointerDown!(ptr(600, 600), ctxOf(store)); // far away
    expect(texts(store)).toHaveLength(0);
    expect(store.canUndo).toBe(false);
  });
});
