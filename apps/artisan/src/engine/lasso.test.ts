// ─────────────────────────────────────────────────────────────
// lasso.test — Lasso selection (touch-select, parity with the marquee)
// ─────────────────────────────────────────────────────────────
// The Lasso must select any object whose bounds the lasso TOUCHES (like the
// rectangular marquee / Illustrator), not only objects whose centre is enclosed.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, Ops, Query } from "./index";

// One rect with world bounds [100,200] × [100,200], centre (150,150).
const oneRect = () => {
  const doc = makeDocument();
  const r = makeRect(100, 100, 100, 100);
  Ops.Items.addItem(doc, r);
  return { doc, r };
};
const hits = (doc: ReturnType<typeof makeDocument>, poly: { x: number; y: number }[]) => Query.itemsInPolygon(doc, poly);

describe("Query.itemsInPolygon (lasso)", () => {
  it("selects an object the lasso fully encloses", () => {
    const { doc, r } = oneRect();
    expect(hits(doc, [{ x: 50, y: 50 }, { x: 250, y: 50 }, { x: 250, y: 250 }, { x: 50, y: 250 }])).toEqual([r.id]);
  });

  it("selects an object the lasso only CROSSES (centre NOT enclosed) — the fix", () => {
    const { doc, r } = oneRect();
    // band over the left edge (x 80–120); the rect's centre x=150 is outside it
    const poly = [{ x: 80, y: 80 }, { x: 120, y: 80 }, { x: 120, y: 220 }, { x: 80, y: 220 }];
    expect(hits(doc, poly)).toEqual([r.id]); // touched → selected (centre test would miss)
  });

  it("selects when only a lasso EDGE crosses the object (no vertex inside either)", () => {
    const { doc, r } = oneRect();
    const sliver = [{ x: 50, y: 150 }, { x: 250, y: 150 }, { x: 250, y: 151 }, { x: 50, y: 151 }];
    expect(hits(doc, sliver)).toEqual([r.id]);
  });

  it("selects when a single lasso vertex lands inside the object", () => {
    const { doc, r } = oneRect();
    expect(hits(doc, [{ x: 150, y: 150 }, { x: 280, y: 150 }, { x: 280, y: 280 }])).toEqual([r.id]);
  });

  it("does not select an object the lasso never touches", () => {
    const { doc } = oneRect();
    expect(hits(doc, [{ x: 300, y: 300 }, { x: 360, y: 300 }, { x: 360, y: 360 }, { x: 300, y: 360 }])).toEqual([]);
  });

  it("skips hidden and locked objects", () => {
    const doc = makeDocument();
    const a = makeRect(100, 100, 100, 100);
    const hidden = makeRect(100, 100, 100, 100);
    hidden.visible = false;
    const locked = makeRect(100, 100, 100, 100);
    locked.locked = true;
    Ops.Items.addItems(doc, [a, hidden, locked]);
    const enclose = [{ x: 50, y: 50 }, { x: 250, y: 50 }, { x: 250, y: 250 }, { x: 50, y: 250 }];
    expect(Query.itemsInPolygon(doc, enclose)).toEqual([a.id]);
  });
});
