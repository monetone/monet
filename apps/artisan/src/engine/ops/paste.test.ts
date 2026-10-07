// ─────────────────────────────────────────────────────────────
// ops/paste.test — Paste in Front / Paste in Back (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator — Paste in Front (⌘F) / Paste in Back (⌘B) paste
// the clipboard at the EXACT original position (unlike ⌘V), placing the copy at
// the front (top) / back (bottom) of the active layer's stacking order.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, Ops, Query } from "../index";

const ids = (doc: ReturnType<typeof makeDocument>) => doc.layers[0].items.map((it) => it.id);

describe("ops.items — paste placement primitives", () => {
  it("clones at the exact position with a fresh id (no offset)", () => {
    const original = makeRect(50, 60, 20, 20);
    const clone = Ops.Items.cloneItemDeep(original);
    expect(clone.id).not.toBe(original.id);
    expect(clone.transform).toEqual(original.transform); // same x/y — Paste in Front/Back keep position
  });

  it("addItems appends to the FRONT; addItemsBack prepends to the BACK", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 10, 10);
    Ops.Items.addItem(doc, a);
    const front = makeRect(10, 0, 10, 10);
    const back = makeRect(20, 0, 10, 10);
    Ops.Items.addItems(doc, [front]); // front = top = end of array
    Ops.Items.addItemsBack(doc, [back]); // back = bottom = start of array
    expect(ids(doc)).toEqual([back.id, a.id, front.id]);
  });
});

describe("ops.items — Paste in Front", () => {
  it("keeps the original position and lands on top", () => {
    const doc = makeDocument();
    const a = makeRect(50, 60, 20, 20);
    Ops.Items.addItem(doc, a);
    const copy = Ops.Items.cloneItemDeep(a);
    Ops.Items.addItems(doc, [copy]);
    expect(doc.layers[0].items.length).toBe(2);
    expect(doc.layers[0].items[1].id).toBe(copy.id); // on top
    const wbA = Query.worldBounds(doc, a.id)!;
    const wbCopy = Query.worldBounds(doc, copy.id)!;
    expect([wbCopy.x, wbCopy.y]).toEqual([wbA.x, wbA.y]); // exact same position
  });
});

describe("ops.items — Paste in Back", () => {
  it("keeps the original position and lands at the bottom", () => {
    const doc = makeDocument();
    const a = makeRect(50, 60, 20, 20);
    Ops.Items.addItem(doc, a);
    const copy = Ops.Items.cloneItemDeep(a);
    Ops.Items.addItemsBack(doc, [copy]);
    expect(doc.layers[0].items[0].id).toBe(copy.id); // at the back
    expect(doc.layers[0].items[1].id).toBe(a.id);
    const wbCopy = Query.worldBounds(doc, copy.id)!;
    expect([wbCopy.x, wbCopy.y]).toEqual([50, 60]); // exact same position
  });
});
