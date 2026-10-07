// ─────────────────────────────────────────────────────────────
// layers-visibility.test — layer/object visibility & lock semantics (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Layers panel. A HIDDEN layer/object is not drawn
// and not selectable; a LOCKED layer/object is drawn but not selectable/editable.
// Hiding/locking cascades down (layer → object → nested). `isSelectable` and the
// hit-test / marquee queries must all enforce this.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makeGroup, Ops, Query, solid, rgba } from "./index";

const RED = rgba(220, 0, 0);
const baseDoc = () => {
  const doc = makeDocument();
  const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) });
  Ops.Items.addItem(doc, r);
  return { doc, r };
};

describe("query.isSelectable — visibility/lock cascade", () => {
  it("a visible, unlocked item in a visible, unlocked layer is selectable", () => {
    const { doc, r } = baseDoc();
    expect(Query.isSelectable(doc, r.id)).toBe(true);
  });

  it("a hidden or locked item is not selectable", () => {
    const { doc, r } = baseDoc();
    Query.getItem(doc, r.id)!.visible = false;
    expect(Query.isSelectable(doc, r.id)).toBe(false);
    Query.getItem(doc, r.id)!.visible = true;
    Query.getItem(doc, r.id)!.locked = true;
    expect(Query.isSelectable(doc, r.id)).toBe(false);
  });

  it("an item on a hidden or locked layer is not selectable", () => {
    const { doc, r } = baseDoc();
    doc.layers[0].visible = false;
    expect(Query.isSelectable(doc, r.id)).toBe(false);
    doc.layers[0].visible = true;
    doc.layers[0].locked = true;
    expect(Query.isSelectable(doc, r.id)).toBe(false);
  });

  it("an item inside a hidden or locked group is not selectable", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) });
    const g = makeGroup([r]);
    Ops.Items.addItem(doc, g);
    expect(Query.isSelectable(doc, r.id)).toBe(true);
    (Query.getItem(doc, g.id)! as { visible: boolean }).visible = false;
    expect(Query.isSelectable(doc, r.id)).toBe(false);
    (Query.getItem(doc, g.id)! as { visible: boolean }).visible = true;
    (Query.getItem(doc, g.id)! as { locked: boolean }).locked = true;
    expect(Query.isSelectable(doc, r.id)).toBe(false);
  });

  it("selectableIds drops the now-unselectable ids", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 50, 50, 0, 0, { fill: solid(RED) });
    const b = makeRect(60, 0, 50, 50, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);
    Query.getItem(doc, b.id)!.locked = true;
    expect(Query.selectableIds(doc, [a.id, b.id])).toEqual([a.id]);
  });
});

describe("hit-test & marquee honour visibility/lock", () => {
  it("hitTest skips a hidden item and a locked item (unless includeLocked)", () => {
    const { doc, r } = baseDoc();
    expect(Query.hitTest(doc, { x: 50, y: 50 }, 2)?.leaf.item.id).toBe(r.id);
    Query.getItem(doc, r.id)!.visible = false;
    expect(Query.hitTest(doc, { x: 50, y: 50 }, 2)).toBeNull();
    Query.getItem(doc, r.id)!.visible = true;
    Query.getItem(doc, r.id)!.locked = true;
    expect(Query.hitTest(doc, { x: 50, y: 50 }, 2)).toBeNull();
    expect(Query.hitTest(doc, { x: 50, y: 50 }, 2, { includeLocked: true })?.leaf.item.id).toBe(r.id);
  });

  it("itemsInRect excludes hidden and locked items", () => {
    const { doc, r } = baseDoc();
    const rect = { x: -10, y: -10, width: 200, height: 200 };
    expect(Query.itemsInRect(doc, rect)).toContain(r.id);
    Query.getItem(doc, r.id)!.locked = true;
    expect(Query.itemsInRect(doc, rect)).not.toContain(r.id);
  });
});
