// ─────────────────────────────────────────────────────────────
// ops/zigzag.test — Object ▸ Path ▸ Zig Zag (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Zig Zag (Effect ▸ Distort & Transform ▸ Zig Zag) —
// inserts `ridges` points per segment, each displaced perpendicular to the path
// by `size`, alternating side to side. Corner = sharp points, Smooth = waves.

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeCompound, makeRect, makeAnchor as anchor, Ops, Query, solid, rgba } from "../index";
import type { PathItem } from "../index";

const RED = rgba(220, 0, 0);
const line = (len = 100) => ({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: len, y: 0 })] });
const square = (s = 100) => ({
  closed: true,
  anchors: [anchor({ x: 0, y: 0 }), anchor({ x: s, y: 0 }), anchor({ x: s, y: s }), anchor({ x: 0, y: s })],
});
const geomOf = (doc: ReturnType<typeof makeDocument>, id: string) => (Query.getItem(doc, id) as PathItem).geometry;
const hasHandle = (a: { handleIn: { x: number; y: number }; handleOut: { x: number; y: number } }) =>
  Math.abs(a.handleIn.x) + Math.abs(a.handleIn.y) + Math.abs(a.handleOut.x) + Math.abs(a.handleOut.y) > 1e-9;

describe("ops.zigzag.zigZag — corner", () => {
  it("inserts one displaced midpoint on a straight line (ridges 1)", () => {
    const doc = makeDocument();
    const p = makePath(line(100));
    Ops.Items.addItem(doc, p);
    const ids = Ops.ZigZag.zigZag(doc, [p.id], { size: 20, ridges: 1 });
    expect(ids).toEqual([p.id]);
    const g = geomOf(doc, p.id);
    expect(g.closed).toBe(false);
    expect(g.anchors.map((a) => a.point)).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 20 }, // midpoint pushed +20 perpendicular to the line
      { x: 100, y: 0 },
    ]);
    expect(g.anchors.every((a) => !hasHandle(a))).toBe(true); // corner mode ⇒ no handles
  });

  it("alternates ridge sides along the segment (ridges 2)", () => {
    const doc = makeDocument();
    const p = makePath(line(90));
    Ops.Items.addItem(doc, p);
    Ops.ZigZag.zigZag(doc, [p.id], { size: 10, ridges: 2 });
    const ys = geomOf(doc, p.id).anchors.map((a) => Math.round(a.point.y));
    expect(ys).toEqual([0, 10, -10, 0]); // node, +size, −size, node
  });

  it("adds `ridges` points to every segment of a closed square", () => {
    const doc = makeDocument();
    const p = makePath(square(100));
    Ops.Items.addItem(doc, p);
    Ops.ZigZag.zigZag(doc, [p.id], { size: 10, ridges: 1 });
    const g = geomOf(doc, p.id);
    expect(g.closed).toBe(true);
    expect(g.anchors).toHaveLength(8); // 4 corners + 4 ridges
    // at least one ridge bulges OUTSIDE the original 0..100 square
    const out = g.anchors.some((a) => a.point.x < -1e-6 || a.point.y < -1e-6 || a.point.x > 100 + 1e-6 || a.point.y > 100 + 1e-6);
    expect(out).toBe(true);
  });
});

describe("ops.zigzag.zigZag — smooth, shapes, compound & guards", () => {
  it("smooth mode keeps the point count but adds tangent handles", () => {
    const doc = makeDocument();
    const corner = makePath(line(100));
    const smooth = makePath(line(100));
    Ops.Items.addItem(doc, corner);
    Ops.Items.addItem(doc, smooth);
    Ops.ZigZag.zigZag(doc, [corner.id], { size: 20, ridges: 3, smooth: false });
    Ops.ZigZag.zigZag(doc, [smooth.id], { size: 20, ridges: 3, smooth: true });
    const gc = geomOf(doc, corner.id);
    const gs = geomOf(doc, smooth.id);
    expect(gs.anchors).toHaveLength(gc.anchors.length); // same points
    expect(gc.anchors.some(hasHandle)).toBe(false); // corner: no handles
    expect(gs.anchors.some(hasHandle)).toBe(true); // smooth: handles present
  });

  it("converts a live rect and zig-zags it", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, r);
    Ops.ZigZag.zigZag(doc, [r.id], { size: 10, ridges: 1 });
    const it = Query.getItem(doc, r.id)!;
    expect(it.type).toBe("path");
    if (it.type === "path") expect(it.geometry.anchors).toHaveLength(8); // 4 edges × (corner + ridge)
  });

  it("zig-zags every subpath of a compound path", () => {
    const doc = makeDocument();
    const comp = makeCompound([square(100), square(40)], { fill: solid(RED) });
    Ops.Items.addItem(doc, comp);
    Ops.ZigZag.zigZag(doc, [comp.id], { size: 5, ridges: 2 });
    const it = Query.getItem(doc, comp.id)!;
    if (it.type !== "compound") throw new Error("expected compound");
    expect(it.subpaths[0].anchors).toHaveLength(12); // 4 segs × (1 node + 2 ridges)
    expect(it.subpaths[1].anchors).toHaveLength(12);
  });

  it("clamps ridges to ≥1 and is a no-op for size 0", () => {
    const doc = makeDocument();
    const p = makePath(line(100));
    Ops.Items.addItem(doc, p);
    expect(Ops.ZigZag.zigZag(doc, [p.id], { size: 0, ridges: 3 })).toEqual([]);
    expect(geomOf(doc, p.id).anchors).toHaveLength(2); // unchanged

    Ops.ZigZag.zigZag(doc, [p.id], { size: 8, ridges: 0 }); // ridges clamped to 1
    expect(geomOf(doc, p.id).anchors).toHaveLength(3); // node + 1 ridge + node
  });
});
