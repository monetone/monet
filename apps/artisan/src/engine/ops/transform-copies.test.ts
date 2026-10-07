// ─────────────────────────────────────────────────────────────
// ops/transform-copies.test — Effect ▸ Distort & Transform ▸ Transform (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Transform effect — stamps `copies` extra copies,
// each cumulatively transformed (move steps, rotate fans, scale shrinks),
// grouped with the original.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, Ops, Query, solid, rgba } from "../index";
import type { GroupItem } from "../index";

const RED = rgba(220, 0, 0);
const groupOf = (doc: ReturnType<typeof makeDocument>, id: string): GroupItem => {
  const it = Query.getItem(doc, id)!;
  if (it.type !== "group") throw new Error("not a group");
  return it;
};
const box = (doc: ReturnType<typeof makeDocument>, id: string) => Query.worldBounds(doc, id)!;
const childBox = (doc: ReturnType<typeof makeDocument>, g: GroupItem, k: number) => box(doc, g.children[k].id);

describe("ops.transform-copies.transformCopies", () => {
  it("steps copies by a move and groups original + copies", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, r);

    const ids = Ops.TransformCopies.transformCopies(doc, [r.id], { moveX: 50, moveY: 0, copies: 2 });
    expect(ids).toHaveLength(1);
    expect(doc.layers[0].items).toHaveLength(1); // replaced by the group
    const g = groupOf(doc, ids[0]);
    expect(g.children).toHaveLength(3); // original + 2 copies
    expect(childBox(doc, g, 0).x).toBe(0); // original
    expect(childBox(doc, g, 1).x).toBe(50); // step 1
    expect(childBox(doc, g, 2).x).toBe(100); // step 2
  });

  it("rotates a copy 90° about the object's own centre (non-square bbox swaps)", () => {
    const doc = makeDocument();
    const r = makeRect(100, 100, 40, 20, 0, 0, { fill: solid(RED) }); // centre (120,110)
    Ops.Items.addItem(doc, r);
    const g = groupOf(doc, Ops.TransformCopies.transformCopies(doc, [r.id], { rotate: Math.PI / 2, copies: 1 })[0]);
    const c = childBox(doc, g, 1);
    // 40×20 rotated 90° about (120,110) → 20×40, centre unchanged
    expect(c.x).toBeCloseTo(110, 6);
    expect(c.y).toBeCloseTo(90, 6);
    expect(c.width).toBeCloseTo(20, 6);
    expect(c.height).toBeCloseTo(40, 6);
  });

  it("rotates about a corner reference (off-centre fan)", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 40, 20, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, r);
    const g = groupOf(doc, Ops.TransformCopies.transformCopies(doc, [r.id], { rotate: Math.PI / 2, reference: "top-left", copies: 1 })[0]);
    const c = childBox(doc, g, 1);
    // 90° about (0,0): corners (0,0)(40,0)(40,20)(0,20) → (0,0)(0,40)(-20,40)(-20,0)
    expect(c.x).toBeCloseTo(-20, 6);
    expect(c.y).toBeCloseTo(0, 6);
    expect(c.width).toBeCloseTo(20, 6);
    expect(c.height).toBeCloseTo(40, 6);
  });

  it("scales copies about the centre", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED) }); // centre (20,20)
    Ops.Items.addItem(doc, r);
    const g = groupOf(doc, Ops.TransformCopies.transformCopies(doc, [r.id], { scaleX: 0.5, scaleY: 0.5, copies: 1 })[0]);
    const c = childBox(doc, g, 1);
    expect([c.x, c.y, c.width, c.height]).toEqual([10, 10, 20, 20]); // half size, centre (20,20)
  });

  it("clamps copies to ≥1", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, r);
    const g = groupOf(doc, Ops.TransformCopies.transformCopies(doc, [r.id], { moveX: 10, copies: 0 })[0]);
    expect(g.children).toHaveLength(2); // original + 1 (clamped)
  });
});
