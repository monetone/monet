// ─────────────────────────────────────────────────────────────
// ops/blend-reverse.test — Object ▸ Blend ▸ Reverse Front to Back (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Illustrator Object ▸ Blend ▸ Reverse Front to Back flips the paint
// (z) order of the objects in a blend — front-most becomes back-most — without
// touching the spine or the key objects.

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeAnchor as anchor, makeGroup, Ops, Query, solid, rgba } from "../index";
import type { GroupItem } from "../index";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);
const squareAt = (x: number, s = 20) => ({
  closed: true,
  anchors: [anchor({ x, y: 0 }), anchor({ x: x + s, y: 0 }), anchor({ x: x + s, y: s }), anchor({ x, y: s })],
});
const groupOf = (doc: ReturnType<typeof makeDocument>, id: string): GroupItem => {
  const it = Query.getItem(doc, id)!;
  if (it.type !== "group") throw new Error("not a group");
  return it;
};
const childIds = (doc: ReturnType<typeof makeDocument>, id: string) => groupOf(doc, id).children.map((c) => c.id);
// A blend of two squares with 2 interpolated steps ⇒ 4 ordered children.
const blended = () => {
  const doc = makeDocument();
  const a = makePath(squareAt(0), { fill: solid(RED) });
  const b = makePath(squareAt(100), { fill: solid(BLUE) });
  Ops.Items.addItem(doc, a);
  Ops.Items.addItem(doc, b);
  const gid = Ops.Blend.blend(doc, [a.id, b.id], { steps: 2 })!;
  return { doc, gid };
};

describe("ops.blend.reverseBlendFrontToBack", () => {
  it("reverses the blend group's child paint order and returns the group id", () => {
    const { doc, gid } = blended();
    const before = childIds(doc, gid);
    expect(before.length).toBe(4);
    expect(Ops.Blend.reverseBlendFrontToBack(doc, [gid])).toEqual([gid]);
    expect(childIds(doc, gid)).toEqual([...before].reverse());
  });

  it("preserves blendKeyIds so Release still works", () => {
    const { doc, gid } = blended();
    const keysBefore = [...groupOf(doc, gid).blendKeyIds!].sort();
    Ops.Blend.reverseBlendFrontToBack(doc, [gid]);
    expect([...groupOf(doc, gid).blendKeyIds!].sort()).toEqual(keysBefore);
    // Release after reversing still restores exactly the key objects.
    expect(Ops.Blend.releaseBlend(doc, [gid]).slice().sort()).toEqual(keysBefore);
  });

  it("is an involution — reversing twice restores the original order", () => {
    const { doc, gid } = blended();
    const before = childIds(doc, gid);
    Ops.Blend.reverseBlendFrontToBack(doc, [gid]);
    Ops.Blend.reverseBlendFrontToBack(doc, [gid]);
    expect(childIds(doc, gid)).toEqual(before);
  });

  it("ignores non-blend items and plain groups (no blendKeyIds)", () => {
    const doc = makeDocument();
    const a = makePath(squareAt(0), { fill: solid(RED) });
    Ops.Items.addItem(doc, a);
    const plain = makeGroup([makePath(squareAt(50), { fill: solid(BLUE) })], { name: "Plain" });
    Ops.Items.addItem(doc, plain);
    const childrenBefore = childIds(doc, plain.id);
    expect(Ops.Blend.reverseBlendFrontToBack(doc, [a.id, plain.id])).toEqual([]); // neither is a blend
    expect(childIds(doc, plain.id)).toEqual(childrenBefore); // plain group untouched
  });
});
