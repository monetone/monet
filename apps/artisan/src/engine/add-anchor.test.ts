// ─────────────────────────────────────────────────────────────
// add-anchor.test — Add / Delete Anchor Point (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Add Anchor Point tool adds a point ON a segment
// WITHOUT changing the path's shape (the segment is split at that parameter);
// Delete Anchor Point removes a point. insertAnchor must split the bezier
// losslessly — the two sub-curves trace exactly the original curve.

import { describe, it, expect } from "vitest";
import { Path, Bez, makeAnchor as anchor, makeDocument, makePath, Ops, Query } from "./index";

const closeP = (a: { x: number; y: number }, b: { x: number; y: number }, eps = 1e-9) =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

describe("Path.insertAnchor — preserves the path shape", () => {
  it("splits a cubic into two sub-curves that trace the original exactly", () => {
    const geo = {
      closed: false,
      anchors: [anchor({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 30, y: 60 }), anchor({ x: 100, y: 0 }, { x: -30, y: 60 }, { x: 0, y: 0 })],
    };
    const orig = Path.segments(geo)[0];
    const t = 0.5;
    const out = Path.insertAnchor(geo, 0, t);
    expect(out.anchors.length).toBe(3);
    expect(closeP(out.anchors[1].point, Bez.evaluate(orig, t))).toBe(true); // new anchor on the curve at t
    const [left, right] = Path.segments(out);
    // each sub-bezier matches the original at the corresponding parameter
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      expect(closeP(Bez.evaluate(left, u), Bez.evaluate(orig, u * t))).toBe(true);
      expect(closeP(Bez.evaluate(right, u), Bez.evaluate(orig, t + u * (1 - t)))).toBe(true);
    }
  });

  it("adds exactly one anchor at the split point, leaving the endpoints fixed", () => {
    const geo = { closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 100 })] };
    const out = Path.insertAnchor(geo, 0, 0.5);
    expect(out.anchors.length).toBe(4);
    expect(out.anchors[0].point).toEqual({ x: 0, y: 0 });
    expect(out.anchors[3].point).toEqual({ x: 100, y: 100 });
    expect(closeP(out.anchors[1].point, { x: 50, y: 0 })).toBe(true); // midpoint of the straight segment
  });

  it("inserts on the closing segment of a closed path (stays closed)", () => {
    const sq = {
      closed: true,
      anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 }), anchor({ x: 10, y: 10 }), anchor({ x: 0, y: 10 })],
    };
    const out = Path.insertAnchor(sq, 3, 0.5); // segIndex 3 = the (0,10)→(0,0) closing edge
    expect(out.anchors.length).toBe(5);
    expect(out.closed).toBe(true);
    expect(closeP(out.anchors[4].point, { x: 0, y: 5 })).toBe(true);
  });
});

describe("ops.path-edit.deleteAnchors — Delete Anchor Point", () => {
  it("removes an anchor and keeps the (still valid) path", () => {
    const doc = makeDocument();
    const p = makePath({ closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 }), anchor({ x: 10, y: 10 }), anchor({ x: 0, y: 10 })] });
    Ops.Items.addItem(doc, p);
    Ops.PathEdit.deleteAnchors(doc, p.id, [1]);
    const it = Query.getItem(doc, p.id)!;
    expect(it.type === "path" && it.geometry.anchors.length).toBe(3);
    expect(it.type === "path" && it.geometry.closed).toBe(true);
  });

  it("deletes the whole path when it would drop below 2 anchors", () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 })] });
    Ops.Items.addItem(doc, p);
    Ops.PathEdit.deleteAnchors(doc, p.id, [0]); // → 1 anchor → item removed
    expect(Query.getItem(doc, p.id)).toBeNull();
  });
});
