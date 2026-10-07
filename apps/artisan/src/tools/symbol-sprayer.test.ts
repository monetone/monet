// tools/symbol-sprayer.test - Symbol Sprayer linked-instance workflow

import { describe, expect, it } from "vitest";
import { createSymbolSprayerTool } from "./symbol-sprayer";
import { ArtisanStore, Ops, Query, makeDocument, makeRect, type GroupItem } from "../engine";
import type { Tool, ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;

const ptr = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;

const drag = (tool: Tool, ctx: ToolContext, pts: Array<[number, number]>) => {
  tool.onPointerDown!(ptr(pts[0][0], pts[0][1]), ctx);
  for (let i = 1; i < pts.length; i++) tool.onPointerMove!(ptr(pts[i][0], pts[i][1]), ctx);
  tool.onPointerUp!(ptr(pts[pts.length - 1][0], pts[pts.length - 1][1]), ctx);
};

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument("Symbol Sprayer");
  const source = makeRect(0, 0, 20, 20);
  doc.layers[0].items.push(source);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([source.id]);
  return { store, source };
};

describe("Symbol Sprayer tool", () => {
  it("captures selected artwork as a document symbol and sprays linked instances", () => {
    const { store, source } = setup();

    drag(createSymbolSprayerTool(), ctxOf(store), [[100, 100], [140, 100], [180, 100]]);

    const doc = store.getState().doc;
    expect(doc.symbols).toHaveLength(1);
    expect(doc.symbols?.[0].name).toBe("Sprayed Symbol 1");
    expect(doc.symbols?.[0].items[0].id).not.toBe(source.id);

    const symbolSet = doc.layers[0].items.find((item) => item.type === "group" && item.name === "Symbol Set") as GroupItem;
    expect(symbolSet).toBeTruthy();
    expect(symbolSet.children.length).toBeGreaterThan(1);
    expect(symbolSet.children.every((child) => child.type === "group" && child.symbolInstance?.symbolId === doc.symbols?.[0].id)).toBe(true);
    expect(Query.symbolDefinitionEntries(doc)[0]).toMatchObject({ instanceCount: symbolSet.children.length });
    expect(Query.symbolInstanceEntries(doc)).toHaveLength(symbolSet.children.length);
    expect(store.getState().selection).toEqual([symbolSet.id]);
  });

  it("reuses the selected symbol instance definition instead of creating duplicates", () => {
    const { store, source } = setup();
    let createdInstanceId = "";
    store.transact("Create Symbol", (doc) => {
      const result = Ops.Symbols.createSymbolFromSelection(doc, [source.id], "Tile", { replaceSelection: true })!;
      createdInstanceId = result.instanceId!;
    });
    store.setSelection([createdInstanceId]);

    drag(createSymbolSprayerTool(), ctxOf(store), [[80, 80], [120, 80]]);

    const doc = store.getState().doc;
    expect(doc.symbols).toHaveLength(1);
    expect(doc.symbols?.[0].name).toBe("Tile");
    const instanceEntries = Query.symbolInstanceEntries(doc);
    expect(instanceEntries.every((entry) => entry.symbolId === doc.symbols?.[0].id)).toBe(true);
    expect(instanceEntries.length).toBeGreaterThan(1);
  });

  it("undo removes the sprayed instances and auto-created symbol definition", () => {
    const { store } = setup();

    drag(createSymbolSprayerTool(), ctxOf(store), [[100, 100]]);
    expect(store.getState().doc.symbols).toHaveLength(1);
    expect(Query.symbolInstanceEntries(store.getState().doc)).toHaveLength(1);

    store.undo();

    expect(store.getState().doc.symbols ?? []).toHaveLength(0);
    expect(Query.symbolInstanceEntries(store.getState().doc)).toHaveLength(0);
    expect(store.getState().doc.layers[0].items).toHaveLength(1);
  });
});
