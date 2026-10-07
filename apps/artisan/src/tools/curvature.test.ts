// ─────────────────────────────────────────────────────────────
// tools/curvature.test — the Curvature tool (⇧~)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Curvature tool — you click points and the path is
// re-fitted as a smooth curve running THROUGH them, no handle dragging. The
// clicked points stay ON the path; interior anchors gain handles; Alt-clicking
// drops a corner point; clicking the first point closes the path; Escape/Enter
// finishes. Drawing is ONE undoable step, and a single stray click leaves nothing.

import { describe, it, expect } from "vitest";
import { createCurvatureTool } from "./curvature";
import { ArtisanStore, makeDocument, Query, type PathItem } from "../engine";
import type { Tool, ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number, alt = false): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt, mod: false, button: 0, detail: 1 }) as ToolPointer;

const paths = (store: ArtisanStore): PathItem[] =>
  store.getState().doc.layers.flatMap((l) => l.items).filter((it): it is PathItem => it.type === "path");
const setup = () => {
  const store = new ArtisanStore();
  store.replaceDoc(makeDocument(), { markClean: true });
  return store;
};
const click = (tool: Tool, ctx: ToolContext, x: number, y: number, alt = false) => tool.onPointerDown!(ptr(x, y, alt), ctx);
const zero = (h: { x: number; y: number }) => h.x === 0 && h.y === 0;
// vitest runs node-only here — no DOM KeyboardEvent constructor.
const key = (k: string) => ({ key: k, preventDefault: () => {} }) as unknown as KeyboardEvent;

describe("Curvature tool", () => {
  it("clicked points land ON the path and interior anchors get smooth handles", () => {
    const store = setup();
    const tool = createCurvatureTool();
    const ctx = ctxOf(store);
    click(tool, ctx, 0, 0);
    click(tool, ctx, 50, 40);
    click(tool, ctx, 100, 0);
    tool.onKeyDown!(key("Enter"), ctx);

    const p = paths(store);
    expect(p).toHaveLength(1);
    const g = p[0].geometry;
    expect(g.closed).toBe(false);
    expect(g.anchors.map((a) => a.point)).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 40 },
      { x: 100, y: 0 },
    ]);
    // Catmull-Rom: the middle anchor's tangent is a sixth of (next − prev).
    expect(g.anchors[1].handleOut).toEqual({ x: 100 / 6, y: 0 });
    expect(g.anchors[1].handleIn).toEqual({ x: -100 / 6, y: -0 });
    expect(zero(g.anchors[0].handleIn)).toBe(false); // ends still curve into the run
  });

  it("Alt-click drops a corner point (no handles)", () => {
    const store = setup();
    const tool = createCurvatureTool();
    const ctx = ctxOf(store);
    click(tool, ctx, 0, 0);
    click(tool, ctx, 50, 40, true); // alt → corner
    click(tool, ctx, 100, 0);
    tool.onKeyDown!(key("Escape"), ctx);

    const g = paths(store)[0].geometry;
    expect(zero(g.anchors[1].handleIn) && zero(g.anchors[1].handleOut)).toBe(true);
  });

  it("clicking an existing point toggles it between smooth and corner", () => {
    const store = setup();
    const tool = createCurvatureTool();
    const ctx = ctxOf(store);
    click(tool, ctx, 0, 0);
    click(tool, ctx, 50, 40);
    click(tool, ctx, 100, 0);
    click(tool, ctx, 50, 40); // back onto the middle point → corner
    tool.onKeyDown!(key("Enter"), ctx);

    const g = paths(store)[0].geometry;
    expect(g.anchors).toHaveLength(3); // toggled, not duplicated
    expect(zero(g.anchors[1].handleOut)).toBe(true);
  });

  it("clicking the first point closes the path", () => {
    const store = setup();
    const tool = createCurvatureTool();
    const ctx = ctxOf(store);
    click(tool, ctx, 0, 0);
    click(tool, ctx, 50, 40);
    click(tool, ctx, 100, 0);
    click(tool, ctx, 0, 0); // back to start

    const g = paths(store)[0].geometry;
    expect(g.closed).toBe(true);
    expect(g.anchors).toHaveLength(3);
  });

  it("a single stray click leaves no artwork and no undo step", () => {
    const store = setup();
    const tool = createCurvatureTool();
    const ctx = ctxOf(store);
    click(tool, ctx, 10, 10);
    tool.onKeyDown!(key("Escape"), ctx);

    expect(paths(store)).toHaveLength(0);
    expect(store.canUndo).toBe(false);
  });

  it("the whole curve is one undoable step", () => {
    const store = setup();
    const tool = createCurvatureTool();
    const ctx = ctxOf(store);
    click(tool, ctx, 0, 0);
    click(tool, ctx, 50, 40);
    click(tool, ctx, 100, 0);
    tool.onKeyDown!(key("Enter"), ctx);
    expect(paths(store)).toHaveLength(1);

    store.undo();
    expect(paths(store)).toHaveLength(0);
  });

  it("hovering previews the next segment without committing the point", () => {
    const store = setup();
    const tool = createCurvatureTool();
    const ctx = ctxOf(store);
    click(tool, ctx, 0, 0);
    click(tool, ctx, 50, 40);
    tool.onPointerMove!(ptr(120, 90), ctx);
    const live = paths(store)[0];
    expect(live.geometry.anchors).toHaveLength(3); // 2 real + 1 preview

    tool.onKeyDown!(key("Enter"), ctx);
    expect(Query.getItem(store.getState().doc, live.id)).toBeTruthy();
    expect((Query.getItem(store.getState().doc, live.id) as PathItem).geometry.anchors).toHaveLength(2);
  });
});
