// ─────────────────────────────────────────────────────────────
// ops/arrange.test — Object ▸ Arrange z-order (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator "Arrange objects" — Bring to Front / Send to Back
// move the selection to the front/back of its container preserving the selection's
// relative order; Bring Forward / Send Backward move it ONE step, keeping the
// selection together (it never leapfrogs itself) and clamping at the ends.
// Array order is bottom→top, so the LAST element is the front of the z-order.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makeGroup, Ops } from "../index";

/** Four rects A,B,C,D added bottom→top. Returns label→id + an order() reader. */
const four = () => {
  const doc = makeDocument();
  const A = makeRect(0, 0, 10, 10), B = makeRect(20, 0, 10, 10), C = makeRect(40, 0, 10, 10), D = makeRect(60, 0, 10, 10);
  Ops.Items.addItems(doc, [A, B, C, D]);
  const id = { A: A.id, B: B.id, C: C.id, D: D.id };
  const label = Object.fromEntries(Object.entries(id).map(([k, v]) => [v, k]));
  const order = () => doc.layers[0].items.map((it) => label[it.id]);
  return { doc, id, order };
};

describe("ops.arrange — Bring to Front / Send to Back", () => {
  it("bring to front moves the selection to the end (front)", () => {
    const { doc, id, order } = four();
    Ops.Arrange.bringToFront(doc, [id.B]);
    expect(order()).toEqual(["A", "C", "D", "B"]);
  });

  it("bring to front preserves the selection's relative order", () => {
    const { doc, id, order } = four();
    Ops.Arrange.bringToFront(doc, [id.A, id.C]);
    expect(order()).toEqual(["B", "D", "A", "C"]); // A before C kept
  });

  it("send to back moves the selection to the start (back)", () => {
    const { doc, id, order } = four();
    Ops.Arrange.sendToBack(doc, [id.C]);
    expect(order()).toEqual(["C", "A", "B", "D"]);
  });

  it("send to back preserves the selection's relative order", () => {
    const { doc, id, order } = four();
    Ops.Arrange.sendToBack(doc, [id.B, id.D]);
    expect(order()).toEqual(["B", "D", "A", "C"]);
  });
});

describe("ops.arrange — Bring Forward / Send Backward (one step)", () => {
  it("bring forward moves the selection up one", () => {
    const { doc, id, order } = four();
    Ops.Arrange.bringForward(doc, [id.B]);
    expect(order()).toEqual(["A", "C", "B", "D"]);
  });

  it("bring forward keeps the selection together (no leapfrog)", () => {
    const { doc, id, order } = four();
    Ops.Arrange.bringForward(doc, [id.A, id.B]);
    expect(order()).toEqual(["C", "A", "B", "D"]); // A,B both up one, kept adjacent
  });

  it("bring forward is a no-op when the selection is already at the front", () => {
    const { doc, id, order } = four();
    Ops.Arrange.bringForward(doc, [id.D]);
    expect(order()).toEqual(["A", "B", "C", "D"]);
  });

  it("send backward moves the selection down one", () => {
    const { doc, id, order } = four();
    Ops.Arrange.sendBackward(doc, [id.C]);
    expect(order()).toEqual(["A", "C", "B", "D"]);
  });

  it("send backward keeps the selection together", () => {
    const { doc, id, order } = four();
    Ops.Arrange.sendBackward(doc, [id.C, id.D]);
    expect(order()).toEqual(["A", "C", "D", "B"]);
  });

  it("send backward is a no-op when the selection is already at the back", () => {
    const { doc, id, order } = four();
    Ops.Arrange.sendBackward(doc, [id.A]);
    expect(order()).toEqual(["A", "B", "C", "D"]);
  });
});

describe("ops.arrange — within nested containers", () => {
  it("reorders inside the object's own group, not across the layer", () => {
    const doc = makeDocument();
    const p = makeRect(0, 0, 10, 10), q = makeRect(20, 0, 10, 10);
    const g = makeGroup([p, q]); // children bottom→top [p, q]
    const r = makeRect(40, 0, 10, 10);
    Ops.Items.addItems(doc, [g, r]); // layer: [g, r]
    // bring p to the front of ITS group; the layer order is untouched
    Ops.Arrange.bringToFront(doc, [p.id]);
    const group = doc.layers[0].items[0];
    expect(group.type === "group" && group.children.map((c) => c.id)).toEqual([q.id, p.id]);
    expect(doc.layers[0].items.map((it) => it.id)).toEqual([g.id, r.id]);
  });

  it("keeps a clip group's first child fixed as its mask (#360)", () => {
    const doc = makeDocument();
    const mask = makeRect(0, 0, 30, 30);
    const a = makeRect(5, 5, 10, 10);
    const b = makeRect(10, 10, 10, 10);
    const group = makeGroup([mask, a, b]);
    group.clip = true;
    Ops.Items.addItem(doc, group);

    Ops.Arrange.sendToBack(doc, [b.id]);
    expect(group.children.map((child) => child.id)).toEqual([mask.id, b.id, a.id]);

    Ops.Arrange.bringToFront(doc, [mask.id]);
    expect(group.children[0].id).toBe(mask.id);
  });
});
