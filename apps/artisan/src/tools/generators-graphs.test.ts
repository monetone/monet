// tools/generators-graphs.test — graph tool integration

import { describe, expect, it } from "vitest";
import { ArtisanStore, Query, makeDocument, type GroupItem } from "../engine";
import { createGeneratorTool } from "./generators";
import type { Tool, ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;

const ptr = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;

const dragOut = (tool: Tool, ctx: ToolContext, a: [number, number], b: [number, number]) => {
  tool.onPointerDown!(ptr(a[0], a[1]), ctx);
  tool.onPointerMove!(ptr(b[0], b[1]), ctx);
  tool.onPointerUp!(ptr(b[0], b[1]), ctx);
};

const newStore = () => {
  const store = new ArtisanStore();
  store.replaceDoc(makeDocument("Graph Tool"), { markClean: true });
  return store;
};

describe("graph generator tools", () => {
  it("keeps regenerated graph metadata attached to the final group id", () => {
    const store = newStore();

    dragOut(createGeneratorTool("column-graph"), ctxOf(store), [10, 10], [130, 90]);

    const state = store.getState();
    const entries = Query.graphEntries(state.doc);
    expect(entries).toHaveLength(1);
    const item = Query.getItem(state.doc, entries[0].itemId) as GroupItem;
    expect(item.graph).toMatchObject({ id: item.id, kind: "column", width: 120, height: 80 });
    expect(state.selection).toEqual([item.id]);

    store.undo();
    expect(Query.graphEntries(store.getState().doc)).toHaveLength(0);
  });
});
