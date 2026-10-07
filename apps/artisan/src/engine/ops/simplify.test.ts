// ─────────────────────────────────────────────────────────────
// ops/simplify.test — Object ▸ Path ▸ Simplify (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Simplify — reduces anchor count while preserving
// the shape, removing points within a tolerance of the line between neighbours.

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeCompound, makeRect, makeAnchor as anchor, Ops, Query, solid, rgba } from "../index";
import type { PathItem } from "../index";

const RED = rgba(220, 0, 0);
const geomOf = (doc: ReturnType<typeof makeDocument>, id: string) => (Query.getItem(doc, id) as PathItem).geometry;
const pts = (doc: ReturnType<typeof makeDocument>, id: string) => geomOf(doc, id).anchors.map((a) => [a.point.x, a.point.y]);

describe("ops.simplify.simplify", () => {
  it("removes a collinear midpoint from an open line", () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 50, y: 0 }), anchor({ x: 100, y: 0 })] });
    Ops.Items.addItem(doc, p);
    const ids = Ops.Simplify.simplify(doc, [p.id], { tolerance: 1 });
    expect(ids).toEqual([p.id]);
    expect(pts(doc, p.id)).toEqual([[0, 0], [100, 0]]); // midpoint gone, endpoints kept
  });

  it("collapses a densely sampled straight line to its endpoints", () => {
    const doc = makeDocument();
    const anchors = [];
    for (let x = 0; x <= 100; x += 10) anchors.push(anchor({ x, y: 0 }));
    const p = makePath({ closed: false, anchors });
    Ops.Items.addItem(doc, p);
    Ops.Simplify.simplify(doc, [p.id], { tolerance: 0.5 });
    expect(pts(doc, p.id)).toEqual([[0, 0], [100, 0]]);
  });

  it("keeps real corners (a square stays four points)", () => {
    const doc = makeDocument();
    const p = makePath({ closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 100 }), anchor({ x: 0, y: 100 })] });
    Ops.Items.addItem(doc, p);
    Ops.Simplify.simplify(doc, [p.id], { tolerance: 5 });
    expect(geomOf(doc, p.id).anchors).toHaveLength(4);
  });

  it("removes redundant edge points but keeps the corners", () => {
    const doc = makeDocument();
    // square with an extra midpoint on the top edge
    const p = makePath({ closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 50, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 100 }), anchor({ x: 0, y: 100 })] });
    Ops.Items.addItem(doc, p);
    Ops.Simplify.simplify(doc, [p.id], { tolerance: 1 });
    const result = pts(doc, p.id);
    expect(result).toHaveLength(4);
    expect(result).not.toContainEqual([50, 0]); // redundant point dropped
  });

  it("a larger tolerance removes more points (a shallow bump)", () => {
    const doc = makeDocument();
    const mk = () => makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 50, y: 2 }), anchor({ x: 100, y: 0 })] });
    const lo = mk();
    const hi = mk();
    Ops.Items.addItem(doc, lo);
    Ops.Items.addItem(doc, hi);
    Ops.Simplify.simplify(doc, [lo.id], { tolerance: 1 }); // 2 > 1 ⇒ bump kept
    Ops.Simplify.simplify(doc, [hi.id], { tolerance: 5 }); // 2 < 5 ⇒ bump removed
    expect(geomOf(doc, lo.id).anchors).toHaveLength(3);
    expect(geomOf(doc, hi.id).anchors).toHaveLength(2);
  });

  it("never drops below the minimum (closed keeps ≥3)", () => {
    const doc = makeDocument();
    const p = makePath({ closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 50, y: 1 })] });
    Ops.Items.addItem(doc, p);
    Ops.Simplify.simplify(doc, [p.id], { tolerance: 1000 }); // huge tolerance
    expect(geomOf(doc, p.id).anchors).toHaveLength(3);
  });

  it("preserves the handles of retained anchors", () => {
    const doc = makeDocument();
    const smooth = anchor({ x: 50, y: 50 }, { x: -10, y: 0 }, { x: 10, y: 0 });
    // a redundant collinear point on the bottom edge + a smooth top anchor
    const p = makePath({ closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 50, y: 0 }), anchor({ x: 100, y: 0 }), smooth] });
    Ops.Items.addItem(doc, p);
    Ops.Simplify.simplify(doc, [p.id], { tolerance: 1 });
    const kept = geomOf(doc, p.id).anchors.find((a) => a.point.x === 50 && a.point.y === 50)!;
    expect(kept.handleIn).toEqual({ x: -10, y: 0 });
    expect(kept.handleOut).toEqual({ x: 10, y: 0 });
  });

  it("does not flatten handle-defined curves or remove points at tolerance zero", () => {
    const doc = makeDocument();
    const curved = makePath({ closed: false, anchors: [
      anchor({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 30, y: 50 }),
      anchor({ x: 50, y: 0 }, { x: -20, y: 50 }, { x: 20, y: -50 }),
      anchor({ x: 100, y: 0 }, { x: -30, y: -50 }, { x: 0, y: 0 }),
    ] });
    const straight = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 50, y: 0 }), anchor({ x: 100, y: 0 })] });
    Ops.Items.addItem(doc, curved);
    Ops.Items.addItem(doc, straight);
    Ops.Simplify.simplify(doc, [curved.id], { tolerance: 100 });
    Ops.Simplify.simplify(doc, [straight.id], { tolerance: 0 });
    expect(geomOf(doc, curved.id).anchors).toHaveLength(3);
    expect(geomOf(doc, straight.id).anchors).toHaveLength(3);
  });

  it("simplifies live shapes (via path conversion) and compound subpaths", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, r);
    Ops.Simplify.simplify(doc, [r.id], { tolerance: 1 });
    const it = Query.getItem(doc, r.id)!;
    expect(it.type).toBe("path");
    if (it.type === "path") expect(it.geometry.anchors).toHaveLength(4); // rect corners kept

    const ring = (o: number) => ({ closed: true, anchors: [anchor({ x: o, y: o }), anchor({ x: o + 50, y: o }), anchor({ x: o + 100, y: o }), anchor({ x: o + 100, y: o + 100 }), anchor({ x: o, y: o + 100 })] });
    const comp = makeCompound([ring(0), ring(200)], { fill: solid(RED) });
    Ops.Items.addItem(doc, comp);
    Ops.Simplify.simplify(doc, [comp.id], { tolerance: 1 });
    const c = Query.getItem(doc, comp.id)!;
    if (c.type !== "compound") throw new Error("expected compound");
    expect(c.subpaths[0].anchors).toHaveLength(4); // redundant midpoint removed
    expect(c.subpaths[1].anchors).toHaveLength(4);
  });
});
