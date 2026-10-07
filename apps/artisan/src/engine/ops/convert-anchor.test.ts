// ─────────────────────────────────────────────────────────────
// ops/convert-anchor.test — Convert Anchor Point (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Convert Anchor Point tool — CLICK a smooth point
// to make it a corner (one-way); clicking a corner does nothing (you DRAG a
// corner to make it smooth). cornerAnchor backs the click.

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeAnchor as anchor, Ops, Query } from "../index";

const anchorsOf = (doc: ReturnType<typeof makeDocument>, id: string) => {
  const it = Query.getItem(doc, id)!;
  if (it.type !== "path") throw new Error("not a path");
  return it.geometry.anchors;
};
const hasHandles = (a: { handleIn: { x: number; y: number }; handleOut: { x: number; y: number } }) =>
  !!(a.handleIn.x || a.handleIn.y || a.handleOut.x || a.handleOut.y);

describe("ops.path-edit.cornerAnchor", () => {
  it("converts a smooth anchor to a corner (removes its handles)", () => {
    const doc = makeDocument();
    const p = makePath({
      closed: false,
      anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 50, y: 20 }, { x: -10, y: 0 }, { x: 10, y: 0 }), anchor({ x: 100, y: 0 })],
    });
    Ops.Items.addItem(doc, p);
    expect(hasHandles(anchorsOf(doc, p.id)[1])).toBe(true); // smooth to start
    const changed = Ops.PathEdit.cornerAnchor(doc, p.id, 1);
    expect(changed).toBe(true);
    expect(hasHandles(anchorsOf(doc, p.id)[1])).toBe(false); // now a corner
  });

  it("is a no-op on an already-corner anchor (returns false, unchanged)", () => {
    const doc = makeDocument();
    const p = makePath({ closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 }), anchor({ x: 10, y: 10 })] });
    Ops.Items.addItem(doc, p);
    const before = JSON.stringify(anchorsOf(doc, p.id)[0]);
    const changed = Ops.PathEdit.cornerAnchor(doc, p.id, 0);
    expect(changed).toBe(false);
    expect(JSON.stringify(anchorsOf(doc, p.id)[0])).toBe(before); // untouched
  });
});
