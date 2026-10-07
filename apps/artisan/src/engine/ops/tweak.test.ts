// ─────────────────────────────────────────────────────────────
// ops/tweak.test — Effect ▸ Distort & Transform ▸ Tweak (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Tweak — randomly nudges existing anchor points
// and/or in/out control handles by up to horizontal/vertical, without adding
// points. Seeded here for reproducibility.

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeCompound, makeRect, makeAnchor as anchor, Ops, Query, solid, rgba } from "../index";
import type { PathItem } from "../index";

const RED = rgba(220, 0, 0);
const square = (s = 100) => ({
  closed: true,
  anchors: [anchor({ x: 0, y: 0 }), anchor({ x: s, y: 0 }), anchor({ x: s, y: s }), anchor({ x: 0, y: s })],
});
const geomOf = (doc: ReturnType<typeof makeDocument>, id: string) => (Query.getItem(doc, id) as PathItem).geometry;
const withSquare = () => {
  const doc = makeDocument();
  const p = makePath(square(100));
  Ops.Items.addItem(doc, p);
  return { doc, p };
};

describe("ops.tweak.tweak", () => {
  it("nudges anchor points within ±amount, without adding points", () => {
    const { doc, p } = withSquare();
    const ids = Ops.Tweak.tweak(doc, [p.id], { horizontal: 5, vertical: 8 });
    expect(ids).toEqual([p.id]);
    const g = geomOf(doc, p.id);
    expect(g.anchors).toHaveLength(4); // no points added
    const bases = [[0, 0], [100, 0], [100, 100], [0, 100]];
    g.anchors.forEach((a, i) => {
      expect(Math.abs(a.point.x - bases[i][0])).toBeLessThanOrEqual(5);
      expect(Math.abs(a.point.y - bases[i][1])).toBeLessThanOrEqual(8);
      // default leaves the handles alone
      expect(a.handleIn).toEqual({ x: 0, y: 0 });
      expect(a.handleOut).toEqual({ x: 0, y: 0 });
    });
    // it actually moved something
    expect(g.anchors.some((a, i) => a.point.x !== bases[i][0] || a.point.y !== bases[i][1])).toBe(true);
  });

  it("moves control handles when enabled, leaving anchor points if disabled", () => {
    const doc = makeDocument();
    const p = makePath({ closed: true, anchors: [anchor({ x: 0, y: 0 }, { x: -10, y: 0 }, { x: 10, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 50, y: 80 })] });
    Ops.Items.addItem(doc, p);
    Ops.Tweak.tweak(doc, [p.id], { horizontal: 5, vertical: 5, anchors: false, inHandles: true, outHandles: true });
    const a0 = geomOf(doc, p.id).anchors[0];
    expect(a0.point).toEqual({ x: 0, y: 0 }); // anchor disabled ⇒ unmoved
    expect(a0.handleIn).not.toEqual({ x: -10, y: 0 }); // in handle nudged
    expect(a0.handleOut).not.toEqual({ x: 10, y: 0 }); // out handle nudged
  });

  it("is reproducible for the same seed and differs for another", () => {
    const a = withSquare();
    const b = withSquare();
    Ops.Tweak.tweak(a.doc, [a.p.id], { horizontal: 8, vertical: 8, seed: 42 });
    Ops.Tweak.tweak(b.doc, [b.p.id], { horizontal: 8, vertical: 8, seed: 42 });
    expect(geomOf(a.doc, a.p.id).anchors).toEqual(geomOf(b.doc, b.p.id).anchors);

    const c = withSquare();
    Ops.Tweak.tweak(c.doc, [c.p.id], { horizontal: 8, vertical: 8, seed: 7 });
    expect(geomOf(c.doc, c.p.id).anchors).not.toEqual(geomOf(a.doc, a.p.id).anchors);
  });

  it("no-op when both amounts are 0 or nothing is enabled", () => {
    const { doc, p } = withSquare();
    expect(Ops.Tweak.tweak(doc, [p.id], { horizontal: 0, vertical: 0 })).toEqual([]);
    expect(Ops.Tweak.tweak(doc, [p.id], { horizontal: 5, vertical: 5, anchors: false })).toEqual([]);
    expect(geomOf(doc, p.id).anchors[0].point).toEqual({ x: 0, y: 0 }); // unchanged
  });

  it("works on live shapes and compound subpaths", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, r);
    Ops.Tweak.tweak(doc, [r.id], { horizontal: 5, vertical: 5 });
    const it = Query.getItem(doc, r.id)!;
    expect(it.type).toBe("path");
    if (it.type === "path") expect(it.geometry.anchors).toHaveLength(4);

    const comp = makeCompound([square(100), square(40)], { fill: solid(RED) });
    Ops.Items.addItem(doc, comp);
    Ops.Tweak.tweak(doc, [comp.id], { horizontal: 3, vertical: 3 });
    const c = Query.getItem(doc, comp.id)!;
    if (c.type !== "compound") throw new Error("expected compound");
    expect(c.subpaths[0].anchors).toHaveLength(4);
    expect(c.subpaths[1].anchors).toHaveLength(4);
  });
});
