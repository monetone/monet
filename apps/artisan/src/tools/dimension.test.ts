// tools/dimension.test - Dimension and Measure tool integration

import { describe, expect, it } from "vitest";
import { ArtisanStore, Query, makeDocument, type GroupItem } from "../engine";
import { createDimensionTool } from "./dimension";
import { getTool, hasTool } from "./registry";
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
  store.replaceDoc(makeDocument("Dimension Tool"), { markClean: true });
  return store;
};

describe("dimension tools", () => {
  it("registers Dimension and Measure tools", () => {
    expect(hasTool("dimension")).toBe(true);
    expect(hasTool("measure")).toBe(true);
    expect(getTool("dimension").id).toBe("dimension");
    expect(getTool("measure").id).toBe("measure");
  });

  it("keeps regenerated dimension metadata attached to the final group id", () => {
    const store = newStore();

    dragOut(createDimensionTool("dimension"), ctxOf(store), [10, 20], [110, 20]);

    const state = store.getState();
    const entries = Query.dimensionEntries(state.doc);
    expect(entries).toHaveLength(1);
    const item = Query.getItem(state.doc, entries[0].itemId) as GroupItem;
    expect(item.dimension).toMatchObject({ id: item.id, length: 100, units: "px" });
    expect(entries[0].label).toBe("100 px");
    expect(state.selection).toEqual([item.id]);

    store.undo();
    expect(Query.dimensionEntries(store.getState().doc)).toHaveLength(0);
  });
});
