// ─────────────────────────────────────────────────────────────
// tools/group-selection.test — Group Selection progressive expansion (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Group Selection tool. The first click selects the object (the
// leaf) inside a group; each repeated click on the same object selects the next
// enclosing group up the hierarchy. Clicking a different object — or empty space —
// resets the expansion.

import { describe, it, expect } from "vitest";
import { createSelectionTool } from "./selection";
import { ArtisanStore, makeDocument, makeRect, makeGroup, solid, rgba } from "../engine";
import type { Tool, ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;
const click = (tool: Tool, ctx: ToolContext, x: number, y: number) => {
  tool.onPointerDown!(ptr(x, y), ctx);
  tool.onPointerUp!(ptr(x, y), ctx);
};
const groupSel = () => createSelectionTool({ id: "group-selection", targetLeaf: true, progressive: true });
const sel = (store: ArtisanStore) => store.getState().selection;

describe("Group Selection tool — progressive expansion", () => {
  it("repeated clicks walk up: leaf → inner group → outer group (then clamp)", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const rect = makeRect(100, 100, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0)) }); // centre (120,120)
    const inner = makeGroup([rect]);
    const outer = makeGroup([inner]);
    doc.layers[0].items.push(outer);
    store.replaceDoc(doc, { markClean: true });
    const tool = groupSel();
    const ctx = ctxOf(store);

    click(tool, ctx, 120, 120);
    expect(sel(store)).toEqual([rect.id]); // 1st → the leaf
    click(tool, ctx, 120, 120);
    expect(sel(store)).toEqual([inner.id]); // 2nd → enclosing group
    click(tool, ctx, 120, 120);
    expect(sel(store)).toEqual([outer.id]); // 3rd → next group up
    click(tool, ctx, 120, 120);
    expect(sel(store)).toEqual([outer.id]); // clamped at the top-level group
  });

  it("clicking a different object resets the expansion to its leaf", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const r1 = makeRect(100, 100, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0)) });
    const r2 = makeRect(300, 100, 40, 40, 0, 0, { fill: solid(rgba(0, 0, 220)) });
    doc.layers[0].items.push(makeGroup([r1]), makeGroup([r2]));
    store.replaceDoc(doc, { markClean: true });
    const tool = groupSel();
    const ctx = ctxOf(store);

    click(tool, ctx, 120, 120); // r1 leaf
    click(tool, ctx, 120, 120); // its group
    click(tool, ctx, 320, 120); // a DIFFERENT object → resets to that leaf
    expect(sel(store)).toEqual([r2.id]);
  });

  it("clicking empty space resets, so the next click starts at the leaf again", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const rect = makeRect(100, 100, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0)) });
    const inner = makeGroup([rect]);
    doc.layers[0].items.push(makeGroup([inner]));
    store.replaceDoc(doc, { markClean: true });
    const tool = groupSel();
    const ctx = ctxOf(store);

    click(tool, ctx, 120, 120); // leaf
    click(tool, ctx, 120, 120); // inner group
    expect(sel(store)).toEqual([inner.id]);
    click(tool, ctx, 600, 600); // empty → clears + resets the chain
    expect(sel(store)).toEqual([]);
    click(tool, ctx, 120, 120); // starts fresh at the leaf
    expect(sel(store)).toEqual([rect.id]);
  });
});
