// ─────────────────────────────────────────────────────────────
// ops/add-anchor-points.test — Object ▸ Path ▸ Add Anchor Points (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator "Add Anchor Points" — adds one new anchor point
// between every two existing anchor points on the selected path(s) WITHOUT
// changing the path's shape. Each application roughly doubles the anchor count.

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeAnchor as anchor, makeCompound, makeGroup, makeRect, Ops, Query } from "../index";

const pts = (g: { anchors: { point: { x: number; y: number } }[] }) => g.anchors.map((a) => [a.point.x, a.point.y]);
const sq = () => ({
  closed: true,
  anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 100 }), anchor({ x: 0, y: 100 })],
});

describe("ops.path-edit.addAnchorPoints", () => {
  it("open path: inserts a midpoint on each segment, preserving the shape", () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 40, y: 0 }), anchor({ x: 100, y: 0 })] });
    Ops.Items.addItem(doc, p);
    const before = Query.worldBounds(doc, p.id)!;

    const done = Ops.PathEdit.addAnchorPoints(doc, [p.id]);
    expect(done).toEqual([p.id]);
    const g = (Query.getItem(doc, p.id) as { geometry: { anchors: unknown[] } }).geometry;
    // 3 anchors / 2 segments → 5 anchors, midpoints between each pair
    expect(pts(g as never)).toEqual([[0, 0], [20, 0], [40, 0], [70, 0], [100, 0]]);
    const after = Query.worldBounds(doc, p.id)!;
    expect([after.x, after.y, after.width, after.height]).toEqual([before.x, before.y, before.width, before.height]);
  });

  it("closed square: 4 anchors → 8, midpoints at edge centres, still closed", () => {
    const doc = makeDocument();
    const p = makePath(sq());
    Ops.Items.addItem(doc, p);
    Ops.PathEdit.addAnchorPoints(doc, [p.id]);
    const g = (Query.getItem(doc, p.id) as { geometry: { anchors: unknown[]; closed: boolean } }).geometry;
    expect(g.closed).toBe(true);
    expect(pts(g as never)).toEqual([
      [0, 0], [50, 0], [100, 0], [100, 50], [100, 100], [50, 100], [0, 100], [0, 50],
    ]);
  });

  it("idempotent doubling: applying twice quadruples the segments", () => {
    const doc = makeDocument();
    const p = makePath(sq()); // 4 anchors / 4 segments (closed)
    Ops.Items.addItem(doc, p);
    Ops.PathEdit.addAnchorPoints(doc, [p.id]);
    Ops.PathEdit.addAnchorPoints(doc, [p.id]);
    const g = (Query.getItem(doc, p.id) as { geometry: { anchors: unknown[] } }).geometry;
    expect(g.anchors.length).toBe(16); // 4 → 8 → 16
  });

  it("compound: densifies every subpath", () => {
    const doc = makeDocument();
    const c = makeCompound([
      { closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 }), anchor({ x: 10, y: 10 })] }, // 3 → 6
      { closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 })] }, // 2 → 3
    ]);
    Ops.Items.addItem(doc, c);
    Ops.PathEdit.addAnchorPoints(doc, [c.id]);
    const comp = Query.getItem(doc, c.id) as { subpaths: { anchors: unknown[] }[] };
    expect(comp.subpaths.map((sp) => sp.anchors.length)).toEqual([6, 3]);
  });

  it("skips groups / live shapes (returns only the ids it touched)", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 50, 50);
    const g = makeGroup([makeRect(0, 0, 10, 10)]);
    Ops.Items.addItem(doc, r);
    Ops.Items.addItem(doc, g);
    expect(Ops.PathEdit.addAnchorPoints(doc, [r.id, g.id])).toEqual([]);
  });
});
