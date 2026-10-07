// ─────────────────────────────────────────────────────────────
// ops/shape-builder.test — region/face-based Shape Builder (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Shape Builder — decomposes overlapping selected
// shapes into their faces; dragging over faces MERGES them into one shape (Alt =
// delete), while untouched faces survive as their own shapes.
//
// Fixture: A=[0,100]×[0,100] (red, bottom), B=[50,150]×[0,100] (blue, top).
//   faces: A-only [0,50] (5000), overlap [50,100] (5000), B-only [100,150] (5000).

import { describe, it, expect } from "vitest";
import { makeAnchor as anchor, makeDocument, makePath, makeRect, Ops, solid, rgba } from "../index";
import type { Item } from "../index";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);

const ringArea = (anchors: { point: { x: number; y: number } }[]): number => {
  let a = 0;
  for (let i = 0, n = anchors.length; i < n; i++) {
    const p = anchors[i].point;
    const q = anchors[(i + 1) % n].point;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
};
const itemArea = (it: Item): number => {
  if (it.type === "path") return ringArea(it.geometry.anchors);
  if (it.type === "compound") return it.subpaths.reduce((s, sp) => s + ringArea(sp.anchors), 0);
  return 0;
};
const setup = () => {
  const doc = makeDocument();
  const a = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) });
  const b = makeRect(50, 0, 100, 100, 0, 0, { fill: solid(BLUE) });
  Ops.Items.addItems(doc, [a, b]); // a bottom, b top
  return { doc, a, b };
};
const items = (doc: ReturnType<typeof makeDocument>) => doc.layers[0].items;

describe("ops.pathfinder.shapeBuilder", () => {
  it("deletes only the touched component of a disconnected overlap", () => {
    const doc = makeDocument();
    const u = makePath({
      closed: true,
      anchors: [
        [0, 0], [100, 0], [100, 100], [70, 100],
        [70, 30], [30, 30], [30, 100], [0, 100],
      ].map(([x, y]) => anchor({ x, y })),
    }, { fill: solid(RED) });
    const bar = makeRect(0, 40, 100, 20, 0, 0, { fill: solid(BLUE) });
    Ops.Items.addItems(doc, [u, bar]);

    Ops.Pathfinder.shapeBuilder(doc, [u.id, bar.id], [{ x: 15, y: 50 }], "delete");

    expect(items(doc).reduce((sum, item) => sum + itemArea(item), 0)).toBeCloseTo(7400, 0);
    expect(items(doc).every((item) => item.type === "path")).toBe(true);
  });

  it("merge over the OVERLAP extracts it; the other faces survive separately", () => {
    const { doc, a, b } = setup();
    const ids = Ops.Pathfinder.shapeBuilder(doc, [a.id, b.id], [{ x: 75, y: 50 }], "merge"); // inside the overlap
    expect(ids.length).toBe(3); // overlap + A-only + B-only
    expect(items(doc).length).toBe(3);
    const areas = items(doc).map(itemArea).sort((x, y) => x - y);
    expect(areas).toEqual([5000, 5000, 5000].map((n) => expect.closeTo(n, 0)));
    expect(items(doc).reduce((s, it) => s + itemArea(it), 0)).toBeCloseTo(15000, 0); // no area lost
  });

  it("merge across ALL faces unites the whole selection into one shape", () => {
    const { doc, a, b } = setup();
    const ids = Ops.Pathfinder.shapeBuilder(doc, [a.id, b.id], [{ x: 25, y: 50 }, { x: 75, y: 50 }, { x: 125, y: 50 }], "merge");
    expect(ids.length).toBe(1);
    expect(itemArea(items(doc)[0])).toBeCloseTo(15000, 0); // the union of A and B
  });

  it("delete (Alt) removes the dragged-over face, the rest survive", () => {
    const { doc, a, b } = setup();
    const ids = Ops.Pathfinder.shapeBuilder(doc, [a.id, b.id], [{ x: 75, y: 50 }], "delete"); // delete the overlap
    expect(ids.length).toBe(2); // A-only + B-only
    expect(items(doc).reduce((s, it) => s + itemArea(it), 0)).toBeCloseTo(10000, 0); // overlap (5000) gone
  });

  it("is a no-op when the drag never touches a face", () => {
    const { doc, a, b } = setup();
    const ids = Ops.Pathfinder.shapeBuilder(doc, [a.id, b.id], [{ x: 500, y: 500 }], "merge");
    expect(ids).toEqual([]);
    expect(items(doc).map((it) => it.id)).toEqual([a.id, b.id]); // untouched
  });
});
