// ─────────────────────────────────────────────────────────────
// ops/items-insert-new.test — Ops.Items.insertNew (drawing modes)
// ─────────────────────────────────────────────────────────────
// Reference: Illustrator's drawing modes control where the creation tools place
// new art. Draw Normal appends on top (default); Draw Behind inserts at the back
// of the active layer.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makeLayer, makeGroup, Ops, Query } from "../index";

const ids = (items: { id: string }[]) => items.map((i) => i.id);

describe("ops.items.insertNew", () => {
  it("normal appends on top (byte-identical to addItem)", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 10, 10);
    Ops.Items.addItem(doc, a);
    const b = makeRect(20, 0, 10, 10);
    Ops.Items.insertNew(doc, b, { mode: "normal" });
    expect(ids(doc.layers[0].items)).toEqual([a.id, b.id]); // b on top
  });

  it("behind inserts at the BACK of the active layer", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 10, 10);
    Ops.Items.addItem(doc, a);
    const b = makeRect(20, 0, 10, 10);
    Ops.Items.insertNew(doc, b, { mode: "behind" });
    expect(ids(doc.layers[0].items)).toEqual([b.id, a.id]); // b at the bottom, a on top
  });

  it("respects the target layer id", () => {
    const doc = makeDocument();
    const L1 = makeLayer("Layer 2");
    doc.layers.push(L1);
    const b = makeRect(0, 0, 10, 10);
    Ops.Items.insertNew(doc, b, { layerId: L1.id, mode: "behind" });
    expect(ids(L1.items)).toEqual([b.id]);
    expect(doc.layers[0].items).toEqual([]); // not on the default layer
  });

  it("returns the new item id for both modes", () => {
    const doc = makeDocument();
    const b = makeRect(0, 0, 10, 10);
    expect(Ops.Items.insertNew(doc, b, { mode: "normal" })).toBe(b.id);
    const c = makeRect(0, 0, 10, 10);
    expect(Ops.Items.insertNew(doc, c, { mode: "behind" })).toBe(c.id);
  });

  it("inside WRAPS a plain target into a clip group: [clipPath, newArt]", () => {
    const doc = makeDocument();
    const target = makeRect(0, 0, 100, 100);
    Ops.Items.addItem(doc, target);
    const art = makeRect(20, 20, 30, 30);
    expect(Ops.Items.insertNew(doc, art, { mode: "inside", insideTargetId: target.id })).toBe(art.id);
    // the target is replaced by one clip group holding [target(=clip path), art]
    expect(doc.layers[0].items).toHaveLength(1);
    const g = doc.layers[0].items[0];
    if (g.type !== "group") throw new Error("expected a group");
    expect(g.clip).toBe(true);
    expect(ids(g.children)).toEqual([target.id, art.id]); // clip path first, new art on top
  });

  it("inside APPENDS into the clip group on subsequent draws (no re-wrap)", () => {
    const doc = makeDocument();
    const target = makeRect(0, 0, 100, 100);
    Ops.Items.addItem(doc, target);
    const a1 = makeRect(10, 10, 20, 20);
    Ops.Items.insertNew(doc, a1, { mode: "inside", insideTargetId: target.id }); // wraps
    const a2 = makeRect(40, 40, 20, 20);
    Ops.Items.insertNew(doc, a2, { mode: "inside", insideTargetId: target.id }); // appends into the same group
    expect(doc.layers[0].items).toHaveLength(1); // still one clip group, not nested again
    const g = doc.layers[0].items[0];
    if (g.type !== "group") throw new Error("expected a group");
    expect(ids(g.children)).toEqual([target.id, a1.id, a2.id]);
  });

  it("inside adds straight into an existing clip group target", () => {
    const doc = makeDocument();
    const clipPath = makeRect(0, 0, 100, 100);
    const content = makeRect(10, 10, 20, 20);
    const clipGroup = makeGroup([clipPath, content]);
    clipGroup.clip = true;
    Ops.Items.addItem(doc, clipGroup);
    const art = makeRect(40, 40, 20, 20);
    Ops.Items.insertNew(doc, art, { mode: "inside", insideTargetId: clipGroup.id });
    expect(ids((Query.getItem(doc, clipGroup.id) as { children: { id: string }[] }).children)).toEqual([clipPath.id, content.id, art.id]);
  });

  it("inside with a missing/null target falls back to a normal insert", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 10, 10);
    Ops.Items.addItem(doc, a);
    const b = makeRect(20, 0, 10, 10);
    Ops.Items.insertNew(doc, b, { mode: "inside", insideTargetId: "gone" });
    expect(ids(doc.layers[0].items)).toEqual([a.id, b.id]); // appended on top, no clip group
    const c = makeRect(40, 0, 10, 10);
    Ops.Items.insertNew(doc, c, { mode: "inside", insideTargetId: null });
    expect(ids(doc.layers[0].items)).toEqual([a.id, b.id, c.id]);
  });
});
