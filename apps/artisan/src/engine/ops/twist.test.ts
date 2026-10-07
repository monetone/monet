// ─────────────────────────────────────────────────────────────
// ops/twist.test — Effect ▸ Distort & Transform ▸ Twist (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Twist — whirls a shape around its centre, the
// interior spinning more than the rim. We rotate every point around the bbox
// centre by angle·(1−r), r = dist/maxR (full at the centre, 0 at the farthest
// anchor). A square (corners + one interior point at r=0.5) makes it exact.

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeCompound, makeStar, makeAnchor as anchor, Ops, Query, solid, rgba } from "../index";
import type { PathItem } from "../index";

const RED = rgba(220, 0, 0);
const geomOf = (doc: ReturnType<typeof makeDocument>, id: string) => (Query.getItem(doc, id) as PathItem).geometry;
const nearPt = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 6);
  expect(p.y).toBeCloseTo(y, 6);
};

// 4 rim corners (bbox [0,0,100,100], centre (50,50), maxR = √5000) + one interior
// anchor at (75,75), which is exactly r = 0.5 from the centre.
const shape = () => ({
  closed: true,
  anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 100 }), anchor({ x: 0, y: 100 }), anchor({ x: 75, y: 75 })],
});

describe("ops.twist.twist", () => {
  it("rotates each point by angle·(1−r): rim pinned, the r=0.5 point spins a full half-turn", () => {
    const doc = makeDocument();
    const p = makePath(shape(), { fill: solid(RED) });
    Ops.Items.addItem(doc, p);
    const ids = Ops.Twist.twist(doc, [p.id], 2 * Math.PI); // 360° at the centre
    expect(ids).toEqual([p.id]);
    const g = geomOf(doc, p.id);
    nearPt(g.anchors[0].point, 0, 0); // corner, r=1 → 0 rotation
    nearPt(g.anchors[1].point, 100, 0);
    nearPt(g.anchors[2].point, 100, 100);
    nearPt(g.anchors[3].point, 0, 100);
    nearPt(g.anchors[4].point, 25, 25); // r=0.5 → 360·0.5 = 180° → reflected through the centre
  });

  it("is a pure rotation field — every point keeps its distance from the centre", () => {
    const doc = makeDocument();
    const p = makePath(shape());
    Ops.Items.addItem(doc, p);
    Ops.Twist.twist(doc, [p.id], Math.PI / 3); // 60°
    const moved = geomOf(doc, p.id).anchors[4].point;
    expect(Math.hypot(moved.x - 50, moved.y - 50)).toBeCloseTo(Math.hypot(25, 25), 6); // radius preserved
    expect(moved).not.toEqual({ x: 75, y: 75 }); // but it rotated
  });

  it("is a no-op for a zero angle", () => {
    const doc = makeDocument();
    const p = makePath(shape());
    Ops.Items.addItem(doc, p);
    expect(Ops.Twist.twist(doc, [p.id], 0)).toEqual([]);
    expect(geomOf(doc, p.id).anchors[4].point).toEqual({ x: 75, y: 75 }); // unchanged
  });

  it("converts a live star to a path before twisting it", () => {
    const doc = makeDocument();
    const star = makeStar(50, 50, 50, 25, 5, { fill: solid(RED) });
    Ops.Items.addItem(doc, star);
    expect(Ops.Twist.twist(doc, [star.id], Math.PI / 2)).toEqual([star.id]);
    expect(Query.getItem(doc, star.id)!.type).toBe("path");
  });

  it("keeps a smooth anchor smooth: handles rotate rigidly with the anchor (no kinking)", () => {
    // an interior anchor (r=0.5) carrying SYMMETRIC smooth handles (in = −out).
    const doc = makeDocument();
    const p = makePath({
      closed: true,
      anchors: [
        anchor({ x: 0, y: 0 }),
        anchor({ x: 100, y: 0 }),
        anchor({ x: 100, y: 100 }),
        anchor({ x: 0, y: 100 }),
        anchor({ x: 75, y: 75 }, { x: -12, y: 0 }, { x: 12, y: 0 }),
      ],
    });
    Ops.Items.addItem(doc, p);
    Ops.Twist.twist(doc, [p.id], Math.PI / 2);
    const a = geomOf(doc, p.id).anchors[4];
    // The two handles must stay collinear & opposite (smooth) and keep their length
    // — the per-endpoint-radius bug would rotate them by different angles and break this.
    nearPt(a.handleIn, -a.handleOut.x, -a.handleOut.y);
    expect(Math.hypot(a.handleOut.x, a.handleOut.y)).toBeCloseTo(12, 6);
    expect(a.point).not.toEqual({ x: 75, y: 75 }); // and the anchor itself rotated
  });

  it("leaves a rim-equidistant polygon (all corners at maxR) essentially unchanged — documented limit", () => {
    const doc = makeDocument();
    const sq = makePath({ closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 100 }), anchor({ x: 0, y: 100 })] });
    Ops.Items.addItem(doc, sq);
    Ops.Twist.twist(doc, [sq.id], 2 * Math.PI);
    const g = geomOf(doc, sq.id);
    nearPt(g.anchors[0].point, 0, 0); // every corner is at r=1 → field angle 0 → pinned
    nearPt(g.anchors[1].point, 100, 0);
    nearPt(g.anchors[2].point, 100, 100);
    nearPt(g.anchors[3].point, 0, 100);
  });

  it("twists every subpath of a compound about the shared centre", () => {
    const doc = makeDocument();
    const comp = makeCompound([shape()], { fill: solid(RED) });
    Ops.Items.addItem(doc, comp);
    Ops.Twist.twist(doc, [comp.id], 2 * Math.PI);
    const it = Query.getItem(doc, comp.id)!;
    if (it.type !== "compound") throw new Error("expected compound");
    nearPt(it.subpaths[0].anchors[4].point, 25, 25); // interior point reflected through the centre
  });
});
