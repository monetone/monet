// ─────────────────────────────────────────────────────────────
// ops/round-corners.test — Object ▸ Path ▸ Round Corners (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Round Corners (Effect ▸ Stylize ▸ Round Corners) —
// replaces each sharp corner with a circular-arc fillet of a set radius. Corner
// anchors are pulled back along both edges by the radius and joined by a bezier;
// smooth anchors and an open path's endpoints stay put.

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeCompound, makePolygon, makeAnchor as anchor, Ops, Query, solid, rgba } from "../index";
import type { PathItem } from "../index";

const RED = rgba(220, 0, 0);
const square = (s = 100) => ({
  closed: true,
  anchors: [anchor({ x: 0, y: 0 }), anchor({ x: s, y: 0 }), anchor({ x: s, y: s }), anchor({ x: 0, y: s })],
});
const geomOf = (doc: ReturnType<typeof makeDocument>, id: string) => (Query.getItem(doc, id) as PathItem).geometry;
const hasHandle = (h: { x: number; y: number }) => Math.abs(h.x) + Math.abs(h.y) > 1e-9;

describe("ops.round-corners.roundCorners — paths", () => {
  it("turns each square corner into two arc anchors (4 corners ⇒ 8 anchors)", () => {
    const doc = makeDocument();
    const p = makePath(square(100), { fill: solid(RED) });
    Ops.Items.addItem(doc, p);

    const ids = Ops.RoundCorners.roundCorners(doc, [p.id], 10);
    expect(ids).toEqual([p.id]);
    const g = geomOf(doc, p.id);
    expect(g.anchors).toHaveLength(8);
    expect(g.closed).toBe(true);
    // first corner (0,0) becomes (0,10) then (10,0), each set back by the radius
    expect(g.anchors[0].point.x).toBeCloseTo(0, 9);
    expect(g.anchors[0].point.y).toBeCloseTo(10, 9);
    expect(g.anchors[1].point.x).toBeCloseTo(10, 9);
    expect(g.anchors[1].point.y).toBeCloseTo(0, 9);
    // the fillet anchors carry a bezier handle toward the old corner
    expect(hasHandle(g.anchors[0].handleOut)).toBe(true);
    expect(hasHandle(g.anchors[0].handleIn)).toBe(false);
    // overall bounds are unchanged — corners round inward
    const b = Query.worldBounds(doc, p.id)!;
    expect(b.x).toBeCloseTo(0, 6);
    expect(b.y).toBeCloseTo(0, 6);
    expect(b.width).toBeCloseTo(100, 6);
    expect(b.height).toBeCloseTo(100, 6);
  });

  it("clamps the radius to half the shorter adjacent edge", () => {
    const doc = makeDocument();
    const p = makePath(square(100));
    Ops.Items.addItem(doc, p);
    Ops.RoundCorners.roundCorners(doc, [p.id], 1000); // absurd radius
    const g = geomOf(doc, p.id);
    expect(g.anchors).toHaveLength(8);
    // clamped to 50 ⇒ first corner anchors land at the edge midpoints
    expect(g.anchors[0].point).toEqual({ x: 0, y: 50 });
    expect(g.anchors[1].point).toEqual({ x: 50, y: 0 });
  });

  it("uses the requested radius at a non-right corner", () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [
      anchor({ x: 100, y: 0 }),
      anchor({ x: 0, y: 0 }),
      anchor({ x: -86.6025403784, y: 50 }), // 150° interior angle
    ] });
    Ops.Items.addItem(doc, p);
    Ops.RoundCorners.roundCorners(doc, [p.id], 10);
    const g = geomOf(doc, p.id);
    const setback = Math.hypot(g.anchors[1].point.x, g.anchors[1].point.y);
    const handle = Math.hypot(g.anchors[1].handleOut.x, g.anchors[1].handleOut.y);
    expect(setback).toBeCloseTo(10 / Math.tan(75 * Math.PI / 180), 6);
    expect(handle).toBeCloseTo((4 / 3) * Math.tan(7.5 * Math.PI / 180) * 10, 6);
  });

  it("leaves an open path's endpoints and smooth anchors untouched", () => {
    const doc = makeDocument();
    const open = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 50, y: 50 }), anchor({ x: 100, y: 0 })] });
    Ops.Items.addItem(doc, open);
    Ops.RoundCorners.roundCorners(doc, [open.id], 10);
    const g = geomOf(doc, open.id);
    expect(g.closed).toBe(false);
    expect(g.anchors).toHaveLength(4); // endpoints kept, middle corner → 2
    expect(g.anchors[0].point).toEqual({ x: 0, y: 0 }); // endpoint untouched
    expect(g.anchors[3].point).toEqual({ x: 100, y: 0 }); // endpoint untouched
  });

  it("preserves smooth (curved) anchors, rounding only the corners", () => {
    const doc = makeDocument();
    const smooth = anchor({ x: 50, y: 50 }, { x: -10, y: 0 }, { x: 10, y: 0 });
    const p = makePath({ closed: true, anchors: [anchor({ x: 0, y: 0 }), smooth, anchor({ x: 100, y: 0 })] });
    Ops.Items.addItem(doc, p);
    Ops.RoundCorners.roundCorners(doc, [p.id], 5);
    const g = geomOf(doc, p.id);
    expect(g.anchors).toHaveLength(5); // 2 corners → 2 each, smooth → 1
    const kept = g.anchors.find((a) => a.point.x === 50 && a.point.y === 50)!;
    expect(kept.handleIn).toEqual({ x: -10, y: 0 }); // smooth anchor unchanged
    expect(kept.handleOut).toEqual({ x: 10, y: 0 });
  });
});

describe("ops.round-corners.roundCorners — shapes, compound & guards", () => {
  it("converts a live polygon to a path and rounds it", () => {
    const doc = makeDocument();
    const tri = makePolygon(60, 60, 40, 3, { fill: solid(RED) });
    Ops.Items.addItem(doc, tri);
    Ops.RoundCorners.roundCorners(doc, [tri.id], 5);
    const it = Query.getItem(doc, tri.id)!;
    expect(it.type).toBe("path"); // live shape baked to a path
    if (it.type === "path") expect(it.geometry.anchors).toHaveLength(6); // 3 corners → 6
  });

  it("rounds every subpath of a compound path", () => {
    const doc = makeDocument();
    const ring = (o: number, s: number) => ({
      closed: true,
      anchors: [anchor({ x: o, y: o }), anchor({ x: o + s, y: o }), anchor({ x: o + s, y: o + s }), anchor({ x: o, y: o + s })],
    });
    const comp = makeCompound([ring(0, 100), ring(30, 40)], { fill: solid(RED) });
    Ops.Items.addItem(doc, comp);
    Ops.RoundCorners.roundCorners(doc, [comp.id], 5);
    const it = Query.getItem(doc, comp.id)!;
    if (it.type !== "compound") throw new Error("expected compound");
    expect(it.subpaths[0].anchors).toHaveLength(8);
    expect(it.subpaths[1].anchors).toHaveLength(8);
  });

  it("is a no-op for a non-positive radius", () => {
    const doc = makeDocument();
    const p = makePath(square(100));
    Ops.Items.addItem(doc, p);
    expect(Ops.RoundCorners.roundCorners(doc, [p.id], 0)).toEqual([]);
    expect(geomOf(doc, p.id).anchors).toHaveLength(4); // unchanged
  });
});
