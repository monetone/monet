// ─────────────────────────────────────────────────────────────
// ops/roughen.test — Effect ▸ Distort & Transform ▸ Roughen (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Roughen — adds `detail` points per segment and
// jitters every point by up to `size` (Corner = sharp, Smooth = wavy). The
// jitter here is seeded, so the same seed always produces the same path.

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeCompound, makeRect, makeAnchor as anchor, Ops, Query, solid, rgba } from "../index";
import type { PathItem } from "../index";

const RED = rgba(220, 0, 0);
const square = (s = 100) => ({
  closed: true,
  anchors: [anchor({ x: 0, y: 0 }), anchor({ x: s, y: 0 }), anchor({ x: s, y: s }), anchor({ x: 0, y: s })],
});
const geomOf = (doc: ReturnType<typeof makeDocument>, id: string) => (Query.getItem(doc, id) as PathItem).geometry;
const hasHandle = (a: { handleIn: { x: number; y: number }; handleOut: { x: number; y: number } }) =>
  Math.abs(a.handleIn.x) + Math.abs(a.handleIn.y) + Math.abs(a.handleOut.x) + Math.abs(a.handleOut.y) > 1e-9;
const withSquare = () => {
  const doc = makeDocument();
  const p = makePath(square(100));
  Ops.Items.addItem(doc, p);
  return { doc, p };
};

describe("ops.roughen.roughen", () => {
  it("adds `detail` points per segment (square, detail 2 ⇒ 12 anchors)", () => {
    const { doc, p } = withSquare();
    const ids = Ops.Roughen.roughen(doc, [p.id], { size: 5, detail: 2 });
    expect(ids).toEqual([p.id]);
    const g = geomOf(doc, p.id);
    expect(g.anchors).toHaveLength(12); // 4 segs × (1 node + 2 detail)
    expect(g.closed).toBe(true);
    expect(g.anchors.every((a) => !hasHandle(a))).toBe(true); // corner mode ⇒ no handles
  });

  it("jitters every point within ±size of its base position", () => {
    const { doc, p } = withSquare();
    Ops.Roughen.roughen(doc, [p.id], { size: 5, detail: 0 });
    const pts = geomOf(doc, p.id).anchors.map((a) => a.point);
    // base corners are (0,0)(100,0)(100,100)(0,100); each jittered by ≤5 per axis
    const bases = [[0, 0], [100, 0], [100, 100], [0, 100]];
    pts.forEach((pt, i) => {
      expect(Math.abs(pt.x - bases[i][0])).toBeLessThanOrEqual(5);
      expect(Math.abs(pt.y - bases[i][1])).toBeLessThanOrEqual(5);
    });
    // and it actually moved the shape
    expect(pts.some((pt, i) => pt.x !== bases[i][0] || pt.y !== bases[i][1])).toBe(true);
  });

  it("is reproducible for the same seed and differs for another", () => {
    const a = withSquare();
    const b = withSquare();
    Ops.Roughen.roughen(a.doc, [a.p.id], { size: 8, detail: 1, seed: 42 });
    Ops.Roughen.roughen(b.doc, [b.p.id], { size: 8, detail: 1, seed: 42 });
    expect(geomOf(a.doc, a.p.id).anchors).toEqual(geomOf(b.doc, b.p.id).anchors); // same seed ⇒ identical

    const c = withSquare();
    Ops.Roughen.roughen(c.doc, [c.p.id], { size: 8, detail: 1, seed: 7 });
    expect(geomOf(c.doc, c.p.id).anchors).not.toEqual(geomOf(a.doc, a.p.id).anchors); // different seed
  });

  it("smooth mode adds tangent handles", () => {
    const { doc, p } = withSquare();
    Ops.Roughen.roughen(doc, [p.id], { size: 5, detail: 2, smooth: true });
    expect(geomOf(doc, p.id).anchors.some(hasHandle)).toBe(true);
  });

  it("zero size is a no-op", () => {
    const { doc, p } = withSquare();
    expect(Ops.Roughen.roughen(doc, [p.id], { size: 0, detail: 3 })).toEqual([]);
    expect(geomOf(doc, p.id).anchors).toHaveLength(4); // unchanged
  });

  it("works on live shapes and compound subpaths", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, r);
    Ops.Roughen.roughen(doc, [r.id], { size: 5, detail: 1 });
    const it = Query.getItem(doc, r.id)!;
    expect(it.type).toBe("path");
    if (it.type === "path") expect(it.geometry.anchors).toHaveLength(8); // 4 segs × (node + 1)

    const comp = makeCompound([square(100), square(40)], { fill: solid(RED) });
    Ops.Items.addItem(doc, comp);
    Ops.Roughen.roughen(doc, [comp.id], { size: 3, detail: 1 });
    const c = Query.getItem(doc, comp.id)!;
    if (c.type !== "compound") throw new Error("expected compound");
    expect(c.subpaths[0].anchors).toHaveLength(8);
    expect(c.subpaths[1].anchors).toHaveLength(8);
  });
});
