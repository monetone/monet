// ─────────────────────────────────────────────────────────────
// ops/hide-above.test — Object ▸ Hide ▸ All Artwork Above (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator "Hide ▸ All Artwork Above" — hides every object
// stacked above the selection. We do it per container: in each container holding
// a selected item, hide the siblings above the topmost selected one. The mirror
// of Lock ▸ All Artwork Above, operating on `visible` instead of `locked`.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makeGroup, Ops, Query } from "../index";

const visible = (doc: ReturnType<typeof makeDocument>, item: { id: string }) => Query.getItem(doc, item.id)!.visible;

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

describe("ops.items.hideAllAbove", () => {
  it("hides every sibling above the selection, leaving it and lower ones visible", () => {
    const { doc, a, b, c, d } = stack();
    expect(Ops.Items.hideAllAbove(doc, [b.id])).toEqual([c.id, d.id]);
    expect(visible(doc, a)).toBe(true);
    expect(visible(doc, b)).toBe(true); // the selection itself stays visible
    expect(visible(doc, c)).toBe(false);
    expect(visible(doc, d)).toBe(false);
  });

  it("uses the TOPMOST selected item as the boundary for a multi-selection", () => {
    const { doc, a, b, c, d } = stack();
    expect(Ops.Items.hideAllAbove(doc, [a.id, c.id])).toEqual([d.id]); // only above c (the topmost)
    expect(visible(doc, b)).toBe(true); // b sits between a and c → not hidden
    expect(visible(doc, d)).toBe(false);
  });

  it("hides nothing when the selection is already on top", () => {
    const { doc, d } = stack();
    expect(Ops.Items.hideAllAbove(doc, [d.id])).toEqual([]);
  });

  it("skips an item that is already hidden (no duplicate in the result)", () => {
    const { doc, a, b, c, d } = stack();
    Ops.Items.setHidden(doc, [c.id], true);
    expect(Ops.Items.hideAllAbove(doc, [a.id])).toEqual([b.id, d.id]); // c omitted (already hidden)
    expect(visible(doc, b)).toBe(false);
    expect(visible(doc, d)).toBe(false);
  });

  it("when a GROUP is selected, hides siblings above the group — never the group's own children", () => {
    const doc = makeDocument();
    const x = makeRect(0, 0, 10, 10);
    const y = makeRect(0, 0, 10, 10);
    const g = makeGroup([x, y]); // top-level index 0
    const z = makeRect(0, 0, 10, 10); // top-level index 1, above the group
    Ops.Items.addItems(doc, [g, z]);
    expect(Ops.Items.hideAllAbove(doc, [g.id])).toEqual([z.id]); // z is above the group
    expect(visible(doc, z)).toBe(false);
    expect(visible(doc, x)).toBe(true); // the group's children are INSIDE it, not "above"
    expect(visible(doc, y)).toBe(true);
    expect(visible(doc, g)).toBe(true);
  });

  it("a selection spanning two containers hides above in EACH", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 10, 10); // top-level index 0
    const x = makeRect(0, 0, 10, 10);
    const y = makeRect(0, 0, 10, 10);
    const g = makeGroup([x, y]); // top-level index 1
    Ops.Items.addItems(doc, [a, g]);
    expect(new Set(Ops.Items.hideAllAbove(doc, [a.id, x.id]))).toEqual(new Set([g.id, y.id]));
    expect(visible(doc, g)).toBe(false); // above `a` in the top-level container
    expect(visible(doc, y)).toBe(false); // above `x` in the group container
    expect(visible(doc, x)).toBe(true);
  });

  it("operates within the selection's container (a group), not the layer", () => {
    const doc = makeDocument();
    const bg = makeRect(0, 0, 10, 10); // top-level, below the group
    const x = makeRect(0, 0, 10, 10);
    const y = makeRect(0, 0, 10, 10);
    const z = makeRect(0, 0, 10, 10);
    const g = makeGroup([x, y, z]); // group children x(0) · y(1) · z(2)
    Ops.Items.addItems(doc, [bg, g]);
    expect(Ops.Items.hideAllAbove(doc, [x.id])).toEqual([y.id, z.id]); // siblings inside the group
    expect(visible(doc, y)).toBe(false);
    expect(visible(doc, z)).toBe(false);
    expect(visible(doc, bg)).toBe(true); // top-level neighbours untouched
    expect(visible(doc, g)).toBe(true);
  });
});
