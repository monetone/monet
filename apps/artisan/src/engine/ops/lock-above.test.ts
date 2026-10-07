// ─────────────────────────────────────────────────────────────
// ops/lock-above.test — Object ▸ Lock ▸ All Artwork Above (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator "Lock ▸ All Artwork Above" — locks every object
// stacked above the selection. We do it per container: in each container holding
// a selected item, lock the siblings above the topmost selected one.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makeGroup, Ops, Query } from "../index";

const locked = (doc: ReturnType<typeof makeDocument>, item: { id: string }) => !!Query.getItem(doc, item.id)!.locked;

// Four rects in one layer, back→front: a (0) · b (1) · c (2) · d (3).
const stack = () => {
  const doc = makeDocument();
  const a = makeRect(0, 0, 10, 10);
  const b = makeRect(0, 0, 10, 10);
  const c = makeRect(0, 0, 10, 10);
  const d = makeRect(0, 0, 10, 10);
  Ops.Items.addItems(doc, [a, b, c, d]);
  return { doc, a, b, c, d };
};

describe("ops.items.lockAllAbove", () => {
  it("locks every sibling above the selection, leaving it and lower ones unlocked", () => {
    const { doc, a, b, c, d } = stack();
    expect(Ops.Items.lockAllAbove(doc, [b.id])).toEqual([c.id, d.id]);
    expect(locked(doc, a)).toBe(false);
    expect(locked(doc, b)).toBe(false); // the selection itself stays unlocked
    expect(locked(doc, c)).toBe(true);
    expect(locked(doc, d)).toBe(true);
  });

  it("uses the TOPMOST selected item as the boundary for a multi-selection", () => {
    const { doc, a, b, c, d } = stack();
    expect(Ops.Items.lockAllAbove(doc, [a.id, c.id])).toEqual([d.id]); // only above c (the topmost)
    expect(locked(doc, b)).toBe(false); // b sits between a and c → not locked
    expect(locked(doc, d)).toBe(true);
  });

  it("locks nothing when the selection is already on top", () => {
    const { doc, d } = stack();
    expect(Ops.Items.lockAllAbove(doc, [d.id])).toEqual([]);
  });

  it("skips an item that is already locked (no duplicate in the result)", () => {
    const { doc, a, b, c, d } = stack();
    Ops.Items.setLocked(doc, [c.id], true);
    expect(Ops.Items.lockAllAbove(doc, [a.id])).toEqual([b.id, d.id]); // c omitted (already locked)
    expect(locked(doc, b)).toBe(true);
    expect(locked(doc, d)).toBe(true);
  });

  it("when a GROUP is selected, locks siblings above the group — never the group's own children", () => {
    const doc = makeDocument();
    const x = makeRect(0, 0, 10, 10);
    const y = makeRect(0, 0, 10, 10);
    const g = makeGroup([x, y]); // top-level index 0
    const z = makeRect(0, 0, 10, 10); // top-level index 1, above the group
    Ops.Items.addItems(doc, [g, z]);
    expect(Ops.Items.lockAllAbove(doc, [g.id])).toEqual([z.id]); // z is above the group
    expect(locked(doc, z)).toBe(true);
    expect(locked(doc, x)).toBe(false); // the group's children are INSIDE it, not "above"
    expect(locked(doc, y)).toBe(false);
    expect(locked(doc, g)).toBe(false);
  });

  it("a selection spanning two containers locks above in EACH", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 10, 10); // top-level index 0
    const x = makeRect(0, 0, 10, 10);
    const y = makeRect(0, 0, 10, 10);
    const g = makeGroup([x, y]); // top-level index 1
    Ops.Items.addItems(doc, [a, g]);
    expect(new Set(Ops.Items.lockAllAbove(doc, [a.id, x.id]))).toEqual(new Set([g.id, y.id]));
    expect(locked(doc, g)).toBe(true); // above `a` in the top-level container
    expect(locked(doc, y)).toBe(true); // above `x` in the group container
    expect(locked(doc, x)).toBe(false);
  });

  it("operates within the selection's container (a group), not the layer", () => {
    const doc = makeDocument();
    const bg = makeRect(0, 0, 10, 10); // top-level, below the group
    const x = makeRect(0, 0, 10, 10);
    const y = makeRect(0, 0, 10, 10);
    const z = makeRect(0, 0, 10, 10);
    const g = makeGroup([x, y, z]); // group children x(0) · y(1) · z(2)
    Ops.Items.addItems(doc, [bg, g]);
    expect(Ops.Items.lockAllAbove(doc, [x.id])).toEqual([y.id, z.id]); // siblings inside the group
    expect(locked(doc, y)).toBe(true);
    expect(locked(doc, z)).toBe(true);
    expect(locked(doc, bg)).toBe(false); // top-level neighbours untouched
    expect(locked(doc, g)).toBe(false);
  });
});
