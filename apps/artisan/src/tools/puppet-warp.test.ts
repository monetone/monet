// ─────────────────────────────────────────────────────────────
// tools/puppet-warp.test — Puppet Warp pin deformation (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Puppet Warp — drop pins on a shape, then drag a pin to deform
// it; other pins HOLD their region. Our deformation weights each anchor's
// displacement by the pins' inverse-square distance (a fixed pin anchors nearby
// anchors; the dragged pin pulls the points around it).

import { describe, it, expect } from "vitest";
import { createPuppetWarpTool } from "./puppet-warp";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, solid, rgba, Query, type PathItem } from "../engine";
import type { Tool, ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;
const anchorsOf = (store: ArtisanStore, id: string) => (Query.getItem(store.getState().doc, id) as PathItem).geometry.anchors.map((a) => a.point);

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 50, y: 0 }), anchor({ x: 100, y: 0 })] }, { fill: solid(rgba(220, 0, 0)) });
  doc.layers[0].items.push(p);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([p.id]);
  return { store, p };
};
const click = (tool: Tool, ctx: ToolContext, x: number, y: number) => {
  tool.onPointerDown!(ptr(x, y), ctx);
  tool.onPointerUp!(ptr(x, y), ctx);
};

describe("Puppet Warp — pin deformation", () => {
  it("dragging one pin deforms its region while another pin holds the far region", () => {
    const { store, p } = setup();
    const tool = createPuppetWarpTool();
    const ctx = ctxOf(store);
    click(tool, ctx, 0, 0); // pin A at the left anchor
    click(tool, ctx, 100, 0); // pin B at the right anchor
    tool.onPointerDown!(ptr(0, 0), ctx); // grab pin A
    tool.onPointerMove!(ptr(0, 30), ctx); // drag it down 30
    tool.onPointerUp!(ptr(0, 30), ctx);

    const a = anchorsOf(store, p.id);
    expect(a[0].y).toBeGreaterThan(25); // left anchor (under pin A) pulled down
    expect(Math.abs(a[2].y)).toBeLessThan(2); // right anchor (under pin B) held
    expect(a[1].y).toBeGreaterThan(a[2].y); // the middle eases between the pins
    expect(a[1].y).toBeLessThan(a[0].y);
  });

  it("the warp is one undoable transaction", () => {
    const { store, p } = setup();
    const tool = createPuppetWarpTool();
    const ctx = ctxOf(store);
    click(tool, ctx, 0, 0);
    click(tool, ctx, 100, 0);
    tool.onPointerDown!(ptr(0, 0), ctx);
    tool.onPointerMove!(ptr(0, 30), ctx);
    tool.onPointerUp!(ptr(0, 30), ctx);
    expect(anchorsOf(store, p.id)[0].y).toBeGreaterThan(25);
    store.undo();
    expect(anchorsOf(store, p.id)[0]).toEqual({ x: 0, y: 0 }); // restored
  });
});
