// ─────────────────────────────────────────────────────────────
// ops/pucker-bloat.test — Effect ▸ Distort & Transform ▸ Pucker & Bloat (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Pucker & Bloat — keeps anchor positions but sets
// each anchor's handles to amount·(P − centre). Bloat (+) bulges edges out;
// Pucker (−) caves them in.

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeCompound, makeRect, makeAnchor as anchor, Ops, Query, solid, rgba } from "../index";
import type { PathItem } from "../index";

const RED = rgba(220, 0, 0);
const square = (s = 100) => ({
  closed: true,
  anchors: [anchor({ x: 0, y: 0 }), anchor({ x: s, y: 0 }), anchor({ x: s, y: s }), anchor({ x: 0, y: s })],
});
const geomOf = (doc: ReturnType<typeof makeDocument>, id: string) => (Query.getItem(doc, id) as PathItem).geometry;

describe("ops.pucker-bloat.puckerBloat", () => {
  it("bloat sets radial handles pointing away from the centre", () => {
    const doc = makeDocument();
    const p = makePath(square(100), { fill: solid(RED) }); // centre (50,50)
    Ops.Items.addItem(doc, p);
    const ids = Ops.PuckerBloat.puckerBloat(doc, [p.id], 0.5);
    expect(ids).toEqual([p.id]);
    const g = geomOf(doc, p.id);
    // anchor (0,0): v = 0.5·((0,0)−(50,50)) = (−25,−25) → away from centre
    expect(g.anchors[0].point).toEqual({ x: 0, y: 0 }); // position unchanged
    expect(g.anchors[0].handleIn).toEqual({ x: -25, y: -25 });
    expect(g.anchors[0].handleOut).toEqual({ x: -25, y: -25 });
    // anchor (100,100): v = 0.5·(50,50) = (25,25)
    expect(g.anchors[2].handleIn).toEqual({ x: 25, y: 25 });
  });

  it("pucker (negative) points handles toward the centre", () => {
    const doc = makeDocument();
    const p = makePath(square(100));
    Ops.Items.addItem(doc, p);
    Ops.PuckerBloat.puckerBloat(doc, [p.id], -0.5);
    const g = geomOf(doc, p.id);
    // anchor (0,0): v = −0.5·(−50,−50) = (25,25) → toward centre
    expect(g.anchors[0].handleOut).toEqual({ x: 25, y: 25 });
  });

  it("bloat grows the tight bounds (edges bulge past the box)", () => {
    const doc = makeDocument();
    const p = makePath(square(100));
    Ops.Items.addItem(doc, p);
    const before = Query.worldBounds(doc, p.id)!;
    Ops.PuckerBloat.puckerBloat(doc, [p.id], 0.5);
    const after = Query.worldBounds(doc, p.id)!;
    expect(after.x).toBeLessThan(before.x); // bulges out past x=0
    expect(after.width).toBeGreaterThan(before.width);
  });

  it("keeps all anchor positions fixed", () => {
    const doc = makeDocument();
    const p = makePath(square(100));
    Ops.Items.addItem(doc, p);
    Ops.PuckerBloat.puckerBloat(doc, [p.id], 0.7);
    expect(geomOf(doc, p.id).anchors.map((a) => [a.point.x, a.point.y])).toEqual([[0, 0], [100, 0], [100, 100], [0, 100]]);
  });

  it("blends from existing curve handles continuously near zero", () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [
      anchor({ x: 0, y: 0 }, { x: -20, y: 0 }, { x: 20, y: 0 }),
      anchor({ x: 100, y: 0 }, { x: -20, y: 0 }, { x: 20, y: 0 }),
    ] });
    Ops.Items.addItem(doc, p);
    Ops.PuckerBloat.puckerBloat(doc, [p.id], 0.001);
    expect(geomOf(doc, p.id).anchors[0].handleOut.x).toBeCloseTo(19.93, 6);
  });

  it("zero amount is a no-op", () => {
    const doc = makeDocument();
    const p = makePath(square(100));
    Ops.Items.addItem(doc, p);
    expect(Ops.PuckerBloat.puckerBloat(doc, [p.id], 0)).toEqual([]);
    expect(geomOf(doc, p.id).anchors[0].handleIn).toEqual({ x: 0, y: 0 }); // unchanged
  });

  it("converts a live shape and uses a compound's combined centre", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, r);
    Ops.PuckerBloat.puckerBloat(doc, [r.id], 0.5);
    const it = Query.getItem(doc, r.id)!;
    expect(it.type).toBe("path"); // baked from a live shape

    // compound: two rings, combined bbox 0,0..200,100 → centre (100,50)
    const ring = (o: number) => ({ closed: true, anchors: [anchor({ x: o, y: 0 }), anchor({ x: o + 100, y: 0 }), anchor({ x: o + 100, y: 100 }), anchor({ x: o, y: 100 })] });
    const comp = makeCompound([ring(0), ring(100)], { fill: solid(RED) });
    Ops.Items.addItem(doc, comp);
    Ops.PuckerBloat.puckerBloat(doc, [comp.id], 0.5);
    const c = Query.getItem(doc, comp.id)!;
    if (c.type !== "compound") throw new Error("expected compound");
    // first subpath anchor (0,0): v = 0.5·((0,0)−(100,50)) = (−50,−25)
    expect(c.subpaths[0].anchors[0].handleIn).toEqual({ x: -50, y: -25 });
  });
});
