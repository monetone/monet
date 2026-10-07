// ─────────────────────────────────────────────────────────────
// ops/items-move-layer.test — Ops.Items.moveToLayer (Send to Current Layer)
// ─────────────────────────────────────────────────────────────
// Reference: Illustrator "Send to Current Layer" moves the selected objects onto
// the active layer, re-stacked on top while keeping their relative order. Items
// are pulled from wherever they live — including out of a nested group.

import { describe, it, expect } from "vitest";
import { makeDocument, makeLayer, makeRect, makeGroup, solid, rgba, Ops, Query } from "../index";

const RED = solid(rgba(220, 0, 0, 1));
const rect = () => makeRect(0, 0, 10, 10, 0, 0, { fill: RED });
const ids = (items: { id: string }[]) => items.map((i) => i.id);

describe("ops.items.moveToLayer", () => {
  it("moves an item to the top of the target layer", () => {
    const doc = makeDocument(); // L0 (bottom)
    const a = rect();
    doc.layers[0].items.push(a);
    const L1 = makeLayer("Layer 2");
    doc.layers.push(L1);
    Ops.Items.moveToLayer(doc, [a.id], L1.id);
    expect(doc.layers[0].items).toEqual([]); // pulled out of its layer
    expect(ids(doc.layers[1].items)).toEqual([a.id]); // landed on the target
  });

  it("keeps GLOBAL bottom-to-top order across layers (no inversion)", () => {
    const doc = makeDocument(); // L0 (bottom)
    const a = rect(); // on the bottom layer
    doc.layers[0].items.push(a);
    const L1 = makeLayer("Layer 2");
    const b = rect(); // on the higher layer
    L1.items.push(b);
    const L2 = makeLayer("Layer 3"); // empty target
    doc.layers.push(L1, L2);
    Ops.Items.moveToLayer(doc, [a.id, b.id], L2.id);
    expect(ids(doc.layers[2].items)).toEqual([a.id, b.id]); // a (was lower) stays below b
  });

  it("preserves within-layer order", () => {
    const doc = makeDocument();
    const a = rect();
    const b = rect();
    const c = rect();
    doc.layers[0].items.push(a, b, c); // a,b,c bottom-to-top
    const L1 = makeLayer("Layer 2");
    doc.layers.push(L1);
    Ops.Items.moveToLayer(doc, [a.id, b.id, c.id], L1.id);
    expect(ids(doc.layers[1].items)).toEqual([a.id, b.id, c.id]);
  });

  it("re-stacks moved items ON TOP of the target's existing art", () => {
    const doc = makeDocument();
    const a = rect();
    doc.layers[0].items.push(a);
    const L1 = makeLayer("Layer 2");
    const b = rect();
    L1.items.push(b);
    doc.layers.push(L1);
    Ops.Items.moveToLayer(doc, [a.id], L1.id);
    expect(ids(doc.layers[1].items)).toEqual([b.id, a.id]); // a placed above the existing b
  });

  it("pulls a selected item OUT of a nested group", () => {
    const doc = makeDocument();
    const x = rect();
    const y = rect();
    const g = makeGroup([x, y]);
    doc.layers[0].items.push(g);
    const L1 = makeLayer("Layer 2");
    doc.layers.push(L1);
    Ops.Items.moveToLayer(doc, [x.id], L1.id);
    const group = Query.getItem(doc, g.id)!;
    if (group.type !== "group") throw new Error("expected a group");
    expect(ids(group.children)).toEqual([y.id]); // x removed from the group
    expect(ids(doc.layers[1].items)).toEqual([x.id]); // x now on the target layer
  });

  it("moves a selected GROUP as a unit without double-pulling a selected child", () => {
    const doc = makeDocument();
    const x = rect();
    const y = rect();
    const g = makeGroup([x, y]);
    doc.layers[0].items.push(g);
    const L1 = makeLayer("Layer 2");
    doc.layers.push(L1);
    Ops.Items.moveToLayer(doc, [g.id, x.id], L1.id); // both the group AND its child are selected
    expect(ids(doc.layers[1].items)).toEqual([g.id]); // group moved once, as one unit
    const group = Query.getItem(doc, g.id)!;
    if (group.type !== "group") throw new Error("expected a group");
    expect(ids(group.children)).toEqual([x.id, y.id]); // x rode inside g, not pulled out or duplicated
    expect(doc.layers[0].items).toEqual([]); // nothing left behind
  });

  it("handles the target being a SOURCE too — survivors stay, moved art re-stacks on top", () => {
    const doc = makeDocument(); // L0 (bottom)
    const a = rect(); // on the lower layer, selected
    doc.layers[0].items.push(a);
    const L1 = makeLayer("Layer 2"); // the TARGET
    const b = rect(); // already on target, NOT selected
    const c = rect(); // already on target, selected
    L1.items.push(b, c);
    doc.layers.push(L1);
    Ops.Items.moveToLayer(doc, [a.id, c.id], L1.id);
    expect(ids(doc.layers[1].items)).toEqual([b.id, a.id, c.id]); // b stays; a (lower layer) then c re-stacked on top
    expect(doc.layers[0].items).toEqual([]); // a left the bottom layer; nothing duplicated
  });

  it("is a no-op for an unknown target layer", () => {
    const doc = makeDocument();
    const a = rect();
    doc.layers[0].items.push(a);
    Ops.Items.moveToLayer(doc, [a.id], "nope");
    expect(ids(doc.layers[0].items)).toEqual([a.id]); // untouched
  });
});
