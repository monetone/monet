// ─────────────────────────────────────────────────────────────
// tools/blend-tool.test — the Blend tool (W)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Blend tool — click one object, then another, and
// the pair is blended (same result as Object ▸ Blend ▸ Make). Clicking on again
// extends the blend; clicking empty canvas cancels the pending pick.

import { describe, it, expect } from "vitest";
import { createBlendTool } from "./blend-tool";
import { ArtisanStore, makeDocument, makeRect, Query, solid, rgba, type GroupItem } from "../engine";
import type { Tool, ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;
const click = (tool: Tool, ctx: ToolContext, x: number, y: number) => tool.onPointerDown!(ptr(x, y), ctx);

// Three separated squares at x = 0 / 200 / 400, all on y = 0.
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const rects = [0, 200, 400].map((x) => makeRect(x, 0, 50, 50, 0, 0, { fill: solid(rgba(200, 30, 30)) }));
  for (const r of rects) doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  return { store, rects };
};
const topItems = (store: ArtisanStore) => store.getState().doc.layers.flatMap((l) => l.items);

describe("Blend tool", () => {
  it("clicking two objects blends them into one blend group", () => {
    const { store, rects } = setup();
    const tool = createBlendTool();
    const ctx = ctxOf(store);
    click(tool, ctx, 25, 25); // first square
    expect(topItems(store)).toHaveLength(3); // nothing yet — just a pending pick
    click(tool, ctx, 225, 25); // second square

    const items = topItems(store);
    expect(items).toHaveLength(2); // the two keys collapsed into a blend + the untouched third
    const blend = items.find((it) => it.type === "group") as GroupItem;
    expect(blend).toBeTruthy();
    expect(blend.blendKeyIds?.length).toBe(2);
    expect(store.getState().selection).toEqual([blend.id]);
    expect(Query.getItem(store.getState().doc, rects[2].id)).toBeTruthy(); // third untouched
  });

  it("a further click extends the blend rather than starting a new one", () => {
    const { store } = setup();
    const tool = createBlendTool();
    const ctx = ctxOf(store);
    click(tool, ctx, 25, 25);
    click(tool, ctx, 225, 25);
    click(tool, ctx, 425, 25); // third square joins the running blend

    const items = topItems(store);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("group");
  });

  it("clicking the same object twice does nothing", () => {
    const { store } = setup();
    const tool = createBlendTool();
    const ctx = ctxOf(store);
    click(tool, ctx, 25, 25);
    click(tool, ctx, 30, 30); // same square
    expect(topItems(store)).toHaveLength(3);
    expect(store.canUndo).toBe(false);
  });

  it("clicking empty canvas clears the pending pick", () => {
    const { store } = setup();
    const tool = createBlendTool();
    const ctx = ctxOf(store);
    click(tool, ctx, 25, 25);
    click(tool, ctx, 700, 400); // empty
    click(tool, ctx, 225, 25); // this is now a fresh first pick, not a blend
    expect(topItems(store)).toHaveLength(3);
  });

  it("the blend is one undoable step", () => {
    const { store } = setup();
    const tool = createBlendTool();
    const ctx = ctxOf(store);
    click(tool, ctx, 25, 25);
    click(tool, ctx, 225, 25);
    store.undo();
    expect(topItems(store)).toHaveLength(3);
  });
});
