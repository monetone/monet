// ─────────────────────────────────────────────────────────────
// tools/star-tool.test — the Star tool's two-radius drag
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Star tool — drag sets the OUTER radius (radius1);
// the inner radius (radius2) follows the configured ratio; the star keeps the
// options-bar point count. The center stays at the press point. One undo step.

import { describe, it, expect } from "vitest";
import { createShapeTool, shapeOptions } from "./shapes";
import { ArtisanStore, makeDocument, Shapes, type StarItem } from "../engine";
import type { ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;

const drawStar = (start: [number, number], end: [number, number]) => {
  const store = new ArtisanStore();
  store.replaceDoc(makeDocument(), { markClean: true });
  const tool = createShapeTool("star");
  const ctx = ctxOf(store);
  tool.onPointerDown!(ptr(start[0], start[1]), ctx);
  tool.onPointerMove!(ptr(end[0], end[1]), ctx);
  tool.onPointerUp!(ptr(end[0], end[1]), ctx);
  return { store, star: store.getState().doc.layers[0].items[0] as StarItem };
};

describe("Star tool", () => {
  it("drag sets the outer radius; the inner radius follows the ratio; center at the press point", () => {
    const { star } = drawStar([100, 100], [100, 160]); // 60px down
    expect(star.type).toBe("star");
    expect(star.radius1).toBeCloseTo(60, 6); // drag distance
    expect(star.radius2).toBeCloseTo(60 * shapeOptions.starRatio, 6);
    expect(star.points).toBe(shapeOptions.starPoints);
    expect(star.transform.e).toBe(100); // center stays at the start
    expect(star.transform.f).toBe(100);
  });

  it("produces a 2×points alternating-radius outline", () => {
    const { star } = drawStar([100, 100], [150, 100]); // 50px → radius1 50
    const g = Shapes.localPaths(star)[0];
    expect(g.anchors).toHaveLength(2 * star.points);
    // even vertices at the outer radius, odd at the inner
    expect(Math.hypot(g.anchors[0].point.x, g.anchors[0].point.y)).toBeCloseTo(star.radius1, 5);
    expect(Math.hypot(g.anchors[1].point.x, g.anchors[1].point.y)).toBeCloseTo(star.radius2, 5);
  });

  it("is one undoable step", () => {
    const { store } = drawStar([100, 100], [100, 160]);
    expect(store.getState().doc.layers[0].items).toHaveLength(1);
    store.undo();
    expect(store.getState().doc.layers[0].items).toHaveLength(0);
  });
});
